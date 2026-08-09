/**
 * Read a graph out of a text file and add it to the one already in the table.
 *
 *   npm run graph:load -- graph.txt
 *   npm run graph:load -- graph.txt --dry-run   # say what it would write, write nothing
 *
 * A line names a node and whoever it joins:
 *
 *   # a comment, and a blank line, both say nothing
 *   Thorne                        # a node and no edges — an island of one
 *   Kavara | Miselin | Vessarin   # Kavara joins Miselin, and Kavara joins Vessarin
 *
 * The first name on a line is the one the rest are joined to. A star, not a chain:
 * `a | b | c` is two edges out of `a`, not a path through `b`. That is how a graph is
 * thought about while it is being typed — this node, and what it connects to — it puts a
 * hub on one line, and it gives a line of one name the meaning it should have: a node with
 * no edges, which is the component ADR 0019 exists for and the case a chain reading would
 * have to bolt on as a special one. A path is still a path, one line per step.
 *
 * Nothing in the file says which of those two rules is in force, so `--dry-run` prints the
 * pairs it read rather than leaving them to be assumed.
 *
 * Names, not ids, because a label already owns a partition and resolves in one read
 * (src/graph/keys.ts, docs/decisions/0008-finding-a-node-by-name.md) — a node *is* its name
 * here (docs/decisions/0012-the-name-is-the-node.md), so a file of names needs no id column
 * and no header. What that costs is the one failure this cannot catch: a misspelled name is
 * a new node, not an error, and it looks exactly like a node you meant to add. Which is why
 * the plan prints every name it is about to create, and why `--dry-run` exists.
 *
 * Two things it deliberately is not:
 *
 * - **Authoritative.** The file is a patch, not a picture. Deleting a line does not part an
 *   edge and nothing here removes anything, so this is the one graph command needing no
 *   guard against being pointed somewhere real. `graph:export` is the way back out.
 * - **Its own writer.** Every node goes through `createNode` and every edge through
 *   `addEdge`, one transaction each, so a bulk load defends `degree` and the label claims
 *   exactly as the terminal and the page do
 *   (docs/decisions/0009-the-first-write-outside-the-seed.md). Running it twice is a no-op:
 *   both refuse what is already there, and those two refusals are counted rather than
 *   raised, which is the whole of what makes the file editable.
 *
 * Sequential, and that is the price. Every one of those transactions carries a conditional
 * update on the single `graph#index` item, so running them at once makes them contend, and
 * a transaction conflict comes back as a cancellation with no condition in it — which
 * `reasonFor` can only hand back raw (src/graph/refused.ts). So a file costs about one
 * round trip per new name and four per new pair, in series: a thousand-edge file is around
 * twenty seconds against DynamoDB Local and minutes against AWS.
 *
 * `rootId` is left alone, as it is by every single write. A load large enough to change
 * where the map should start wants `npm run graph:init` after it — which is also what
 * repairs the island index if any `settle` lagged on the way through.
 *
 * See docs/decisions/0021-a-graph-in-a-text-file.md.
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

const USAGE = "usage: npm run graph:load -- <file> [--dry-run]"

/** What separates the names on a line, and what starts a comment. A name can hold neither. */
const SEPARATOR = "|"
const COMMENT = "#"

/** How many names or faults are printed before the rest become a count. */
const SHOWN = 20

/**
 * One pair, either way round, as one key.
 *
 * `\u0000` joins the two because no name can hold one, so the key needs no escaping — and
 * it is written as an escape rather than the byte for the reason src/graph/restore.ts
 * gives: a NUL early in a file makes git call the whole thing binary. Not `edgeKey` from
 * keys.ts, which canonicalises a pair of *ids* with a character a name is free to contain.
 */
const pairKey = (a: string, b: string): string =>
  [normaliseLabel(a), normaliseLabel(b)].sort().join("\u0000")

export interface Reading {
  /** Every distinct name, in the order the file first spells it. */
  names: string[]
  /** Every distinct pair, by those same spellings. */
  pairs: [string, string][]
  faults: string[]
  /** Lines that said something, comments and blanks not counted. */
  lines: number
}

/**
 * The file, as names and pairs. Pure: it reads no table and asks nothing of one.
 *
 * Every fault is collected rather than thrown at the first, which is the habit
 * src/graph/restore.ts sets for the same reason — a hand-typed file repaired one complaint
 * at a time is an afternoon.
 *
 * Names are deduplicated by their normalised form and kept in the spelling the file uses
 * first, because that is the spelling `createNode` will store and the one every later line
 * has to agree with. `normaliseLabel` folds case and runs of whitespace and nothing else
 * (src/graph/keys.ts), so `Kavara` and `kavara` are one node while `Zoë` and `Zoe` are two.
 */
export function parse(text: string): Reading {
  const faults: string[] = []
  const names = new Map<string, string>() // normalised -> the spelling that came first
  const pairs = new Map<string, [string, string]>()
  let lines = 0

  text.split(/\r?\n/).forEach((raw, index) => {
    const at = index + 1
    const hash = raw.indexOf(COMMENT)
    const line = (hash < 0 ? raw : raw.slice(0, hash)).trim()
    if (!line) return
    lines++

    const named: string[] = []
    for (const field of line.split(SEPARATOR)) {
      // The same tidy `createNode` performs, so what is checked here is what is written.
      const name = field.trim().replace(/\s+/g, " ")
      const key = normaliseLabel(name)
      if (!key) {
        faults.push(`line ${String(at)}: "${line}" has an empty name`)
        continue
      }
      if (!names.has(key)) names.set(key, name)
      named.push(names.get(key)!)
    }

    // Everything on the line was empty; the fault above already says so.
    const [anchor, ...rest] = named
    if (anchor === undefined) return

    for (const other of rest) {
      // Both are first spellings, so equal strings are the one node — and the store has no
      // self-edges (src/graph/edge.ts), so this is the file's mistake rather than a write's.
      if (other === anchor) {
        faults.push(`line ${String(at)}: "${anchor}" is joined to itself`)
        continue
      }
      const key = pairKey(anchor, other)
      if (!pairs.has(key)) pairs.set(key, [anchor, other])
    }
  })

  return { names: [...names.values()], pairs: [...pairs.values()], faults, lines }
}

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
 * Write the plan. Nodes first, because an edge needs both its ends.
 *
 * The two refusals that mean "already here" are counted rather than raised: this is what
 * makes a file editable, since the second run of an edited file meets everything the first
 * one wrote. Every other refusal is real — "no graph seeded" is not something to skip past
 * five hundred times — and stops the run where it stands, having written whatever came
 * before it. There is no transaction over the file, and there could not be one.
 */
async function write(plan: Plan): Promise<{ created: number; joined: number }> {
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
    if (done % 25 === 0 || done === plan.fresh.length) {
      process.stdout.write(`\r  ${String(done)}/${String(plan.fresh.length)} name(s)`)
    }
  }
  if (plan.fresh.length) process.stdout.write("\n")

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
    if (done % 25 === 0 || done === plan.joins.length) {
      process.stdout.write(`\r  ${String(done)}/${String(plan.joins.length)} pair(s)`)
    }
  }
  if (plan.joins.length) process.stdout.write("\n")

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

  const done = await write(plan)
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
