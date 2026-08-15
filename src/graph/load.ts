/**
 * Survey a reading against the table, then add it one write at a time.
 *
 * Additive only, and sequential: a file costs about one round trip per new name and four per
 * new pair. A thousand-edge file is around twenty seconds against DynamoDB Local, minutes
 * against AWS.
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { GRAPH_TABLE_NAME, describeTarget } from "../db/client.js"
import { parseFileArgs } from "./args.js"
import { ALREADY_JOINED, addEdge } from "./edge.js"
import { edgeSk, nodePk, normaliseLabel, type NodeMeta } from "./keys.js"
import { resolveLabel, resolveLabels } from "./labels.js"
import { NAME_TAKEN, createNode } from "./node.js"
import { Refused } from "./refused.js"
import { batchGet } from "./repo.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import { pairKey, parse, type Reading } from "./text.js"

const USAGE = "usage: npm run graph:load -- <file> [--dry-run]"

/** How many names or faults are printed before the rest become a count. */
const SHOWN = 20

/** How many writes go by between one word about them and the next. */
const REPORT_EVERY = 25

export interface Plan {
  /** Names the table does not hold yet, in the file's order. */
  fresh: string[]
  /** The nodes it does hold, by normalised name. */
  known: Map<string, NodeMeta>
  /** Pairs that are not joined yet. */
  joins: [string, string][]
  /** Pairs that already are. */
  joined: number
}

/**
 * What the file would change, read off the table before anything is written.
 *
 * Two batched reads and no more: every name at once (src/graph/labels.ts), then every pair
 * whose ends both exist. A pair with an end still to be made cannot already be joined —
 * `createNode` makes a node with no edges — so those need no asking about, which is what
 * keeps a first load into an empty table down to a single round trip of surveying.
 */
export async function survey(reading: Reading): Promise<Plan> {
  const known = await resolveLabels(reading.names)
  const fresh = reading.names.filter((name) => !known.has(normaliseLabel(name)))

  const settled: [NodeMeta, NodeMeta][] = []
  for (const [a, b] of reading.pairs) {
    const one = known.get(normaliseLabel(a))
    const two = known.get(normaliseLabel(b))
    if (one && two) settled.push([one, two])
  }

  const already = await joinedAlready(settled)
  const joins = reading.pairs.filter(([a, b]) => !already.has(pairKey(a, b)))
  return { fresh, known, joins, joined: already.size }
}

/**
 * Which of these pairs the graph already holds an edge for.
 *
 * One direction is asked about, not both. Both halves of an edge are written in one
 * transaction and a half-edge is the one fault a graph cannot repair from the inside
 * (src/graph/restore.ts), so the second copy would answer the same question twice.
 *
 * Keyed by name on the way out, because that is what the caller is holding — the ids were
 * only ever needed to build the key to ask about.
 */
async function joinedAlready(pairs: [NodeMeta, NodeMeta][]): Promise<Set<string>> {
  const keys = pairs.map(([a, b]) => ({
    [KEYS.pk]: nodePk(a.id),
    [KEYS.sk]: edgeSk(b.id),
  }))

  // An edge item carries nothing but its key, so what comes back is the answer itself.
  const found = new Set(
    (await batchGet(keys)).map(
      (item) => `${String(item[KEYS.pk] ?? "")}\u0000${String(item[KEYS.sk] ?? "")}`,
    ),
  )

  const out = new Set<string>()
  for (const [a, b] of pairs) {
    if (found.has(`${nodePk(a.id)}\u0000${edgeSk(b.id)}`)) out.add(pairKey(a.label, b.label))
  }
  return out
}

/** A list, with whatever will not fit left as a count rather than dropped in silence. */
function some(items: string[]): string {
  const shown = items.slice(0, SHOWN)
  const rest = items.length - shown.length
  return `${shown.join(", ")}${rest > 0 ? `, … and ${String(rest)} more` : ""}`
}

/**
 * How far along a load is, for a caller with somewhere to put it.
 *
 * Called at the same moments the terminal redraws its line, so the throttle is here rather
 * than in each caller — a run that reported every write would spend real time on the
 * reporting.
 */
export type Progress = (done: number, total: number, what: "name" | "pair") => void

/**
 * Write the plan. Nodes first, because an edge needs both its ends.
 *
 * The two refusals that mean "already here" are counted rather than raised: this is what
 * makes a file editable, since the second run of an edited file meets everything the first
 * one wrote. Every other refusal is real — "no graph seeded" is not something to skip past
 * five hundred times — and stops the run where it stands, having written whatever came
 * before it. There is no transaction over the file, and there could not be one.
 *
 * Exported, and saying nothing on its own, because the API serves this file too
 * (src/server/index.ts). A write loop copied to sit behind a route is a write loop that
 * stops counting the refusals the moment one of them is reworded.
 */
export async function apply(
  plan: Plan,
  onProgress: Progress = () => undefined,
): Promise<{ created: number; joined: number }> {
  const nodes = new Map(plan.known)
  let created = 0

  for (const [index, name] of plan.fresh.entries()) {
    try {
      const node = await createNode(name)
      nodes.set(normaliseLabel(name), node)
      created++
    } catch (err) {
      if (!(err instanceof Refused) || err.message !== NAME_TAKEN) throw err
      // Claimed between the survey and now. The node is somebody's either way, and the
      // edges on this line still want it.
      const node = await resolveLabel(name)
      if (node) nodes.set(normaliseLabel(name), node)
    }
    // Position, not `created` — a name claimed underneath the run would otherwise leave the
    // line short of its own total, and what was created is the line at the end.
    const done = index + 1
    if (done % REPORT_EVERY === 0 || done === plan.fresh.length) {
      onProgress(done, plan.fresh.length, "name")
    }
  }

  let joined = 0
  for (const [index, [a, b]] of plan.joins.entries()) {
    const one = nodes.get(normaliseLabel(a))
    const two = nodes.get(normaliseLabel(b))
    // Only reachable if a name was refused above and then could not be resolved either,
    // which is a table changing underneath the run rather than anything the file did.
    if (!one || !two) throw new Error(`"${one ? b : a}" is not in the graph — nothing joins it`)

    try {
      await addEdge(one.id, two.id)
      joined++
    } catch (err) {
      if (!(err instanceof Refused) || err.message !== ALREADY_JOINED) throw err
    }
    const done = index + 1
    if (done % REPORT_EVERY === 0 || done === plan.joins.length) {
      onProgress(done, plan.joins.length, "pair")
    }
  }

  return { created, joined }
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8")
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main(): Promise<void> {
  const options = parseFileArgs(process.argv.slice(2), USAGE)
  const reading = parse(read(options.file))

  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)
  console.log(
    `  ${options.file}: ${String(reading.lines)} line(s), ` +
      `${String(reading.names.length)} name(s), ${String(reading.pairs.length)} pair(s)`,
  )

  if (reading.faults.length) {
    for (const fault of reading.faults.slice(0, SHOWN)) console.error(`  ✗ ${fault}`)
    if (reading.faults.length > SHOWN) {
      console.error(`  … and ${String(reading.faults.length - SHOWN)} more`)
    }
    throw new Error(`${String(reading.faults.length)} fault(s) — nothing has been written`)
  }

  const plan = await survey(reading)
  console.log(
    `  ${String(plan.fresh.length)} new node(s), ${String(plan.joins.length)} new edge(s) — ` +
      `${String(reading.names.length - plan.fresh.length)} name(s) and ` +
      `${String(plan.joined)} pair(s) are already here`,
  )
  if (plan.fresh.length) console.log(`  new: ${some(plan.fresh)}`)

  if (options.dryRun) {
    // The pairs, because the file cannot say whether a line was meant as a star or a chain
    // and this is the only place that reading is ever shown back.
    for (const [a, b] of plan.joins.slice(0, SHOWN)) console.log(`  ${a} — ${b}`)
    if (plan.joins.length > SHOWN) {
      console.log(`  … and ${String(plan.joins.length - SHOWN)} more`)
    }
    if (plan.fresh.length) {
      console.log("  every new name is a node that is not here — a misspelling looks the same")
    }
    console.log("✓ dry run — nothing written")
    return
  }

  if (!plan.fresh.length && !plan.joins.length) {
    console.log("✓ the graph already holds all of it — nothing written")
    return
  }

  // One line, redrawn, and a newline once each stage is through — which only the terminal
  // wants, so only the terminal asks for it.
  const done = await apply(plan, (at, total, what) => {
    process.stdout.write(`\r  ${String(at)}/${String(total)} ${what}(s)`)
    if (at === total) process.stdout.write("\n")
  })
  console.log(
    `✓ loaded ${String(done.created)} node(s) and ${String(done.joined)} edge(s). ` +
      `Run npm run graph:init to move the root and settle the islands`,
  )
}

// Only when this file *is* the command, so `parse` can be imported without running it.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
