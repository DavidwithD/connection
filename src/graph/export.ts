/**
 * Take a copy of the graph out of the table, as JSON.
 *
 *   npm run graph:export                       # only what was made by hand
 *   npm run graph:export -- --all              # the seed as well
 *   npm run graph:export -- --out mine.json    # somewhere other than graph-export.json
 *
 * Read-only, and the half of a rebuild that can be run as often as you like. Nothing here
 * touches the table; `graph:restore` is what puts the file back, and it drops the table to
 * do it. Splitting them that way means the destructive step reads a file rather than a
 * database, so it can check what it is about to write before anything is gone.
 *
 * The whole point is the default: a seed run replaces the graph, so nodes made since the
 * last one have to leave before it and come back after. Which items those are is read from
 * the id shape alone — `n-<uuid>` against the seed's `n0000` — and nothing else in the table
 * records where an item came from (src/graph/keys.ts).
 *
 * A subset of a graph is not automatically a graph, and that is what most of this file is
 * about. Three things are corrected on the way out, because each of them is an inconsistency
 * that reads fine right up until something walks into it:
 *
 *   - an edge with one end outside the export is dropped, since half an edge left in the
 *     table is an unreachable orphan and the reason `deleteNode` refuses a node that has any
 *   - `degree` is rewritten from the edges actually kept, since a count that outlives the
 *     edges it counted makes a finished node look like it has more graph behind it
 *   - the index item is left behind entirely and recomputed on the way in, since `rootId`
 *     usually names a node the export is dropping
 *
 * Whatever it drops or corrects, it says so.
 *
 * See docs/decisions/0018-the-graph-outlives-the-seed.md.
 */
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { GRAPH_TABLE_NAME, describeTarget } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import { scanAll, type Item } from "./bulk.js"
import {
  EDGE_PREFIX,
  INDEX_PK,
  LABEL_OWNER_SK,
  META_SK,
  edgeTarget,
  isMadeId,
  isSeedId,
  nodeId,
} from "./keys.js"

const DEFAULT_OUT = "graph-export.json"

/** What a restore reads back. Versioned so a file from an older shape is refused, not
 * misread — there is exactly one version so far, and this is where a second one would
 * announce itself. */
export const EXPORT_VERSION = 1

export interface GraphExport {
  version: number
  table: string
  exportedAt: string
  /** Everything but the index item, which `graph:restore` recomputes. */
  items: Item[]
  counts: { nodes: number; edges: number; labels: number }
}

interface Options {
  all: boolean
  out: string
}

export function parseArgs(argv: string[]): Options {
  const options: Options = { all: false, out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--all") options.all = true
    else if (arg === "--out") {
      const value = argv[++i]
      if (!value) throw new Error("--out needs a path")
      options.out = value
    } else throw new Error(`unknown argument: ${arg}\nusage: npm run graph:export -- [--all] [--out <path>]`)
  }
  return options
}

export interface Selection {
  items: Item[]
  counts: { nodes: number; edges: number; labels: number }
  /** Things the caller should be told about rather than left to discover. */
  droppedEdges: number
  droppedLabels: number
  corrected: number
}

/**
 * Which items make a graph on their own, given the ids being kept.
 *
 * Pure, and separate from both the Scan and the file write, so the rules above are one
 * readable pass rather than something inferred from where the writes happen.
 */
export function select(items: Item[], keep: (id: string) => boolean): Selection {
  const kept = new Set<string>()
  for (const item of items) {
    const pk = String(item[KEYS.pk] ?? "")
    if (!pk.startsWith("node#") || item[KEYS.sk] !== META_SK) continue
    const id = nodeId(pk)
    if (keep(id)) kept.add(id)
  }

  // Counted first, so `degree` can be rewritten in the same pass that emits the metas.
  const degree = new Map<string, number>()
  for (const id of kept) degree.set(id, 0)

  const edges: Item[] = []
  let droppedEdges = 0
  for (const item of items) {
    const pk = String(item[KEYS.pk] ?? "")
    const sk = String(item[KEYS.sk] ?? "")
    if (!pk.startsWith("node#") || !sk.startsWith(EDGE_PREFIX)) continue
    const from = nodeId(pk)
    if (!kept.has(from)) continue
    // One end inside and one outside is the half-edge case. Dropped rather than kept,
    // and counted so the run can say how much of the graph it cut.
    if (!kept.has(edgeTarget(sk))) {
      droppedEdges++
      continue
    }
    edges.push(item)
    degree.set(from, degree.get(from)! + 1)
  }

  const metas: Item[] = []
  let corrected = 0
  for (const item of items) {
    const pk = String(item[KEYS.pk] ?? "")
    if (!pk.startsWith("node#") || item[KEYS.sk] !== META_SK) continue
    const id = nodeId(pk)
    if (!kept.has(id)) continue
    const actual = degree.get(id)!
    if (Number(item["degree"] ?? 0) !== actual) corrected++
    metas.push({ ...item, degree: actual })
  }

  const labels: Item[] = []
  let droppedLabels = 0
  for (const item of items) {
    if (!String(item[KEYS.pk] ?? "").startsWith("label#")) continue
    if (item[KEYS.sk] !== LABEL_OWNER_SK) continue
    // A claim whose node is not coming holds a name against nothing, which is a name
    // nobody could ever use again.
    if (!kept.has(String(item["nodeId"] ?? ""))) {
      droppedLabels++
      continue
    }
    labels.push(item)
  }

  return {
    items: [...metas, ...edges, ...labels],
    counts: { nodes: metas.length, edges: edges.length / 2, labels: labels.length },
    droppedEdges,
    droppedLabels,
    corrected,
  }
}

/**
 * Stand between a rebuild and the work it would take with it.
 *
 * Called by the two commands that drop the table. Both are documented as destructive and
 * both were, in practice, one keystroke — `guardDrop` waves through anything pointed at the
 * local emulator, on the reasoning that an emulator holds nothing anyone minds losing. That
 * reasoning is wrong the moment somebody uses the demo, which is what the demo is for: on
 * 2026-08-09 a re-seed run to pick up a new index took several hundred hand-made nodes with
 * it, and nothing in the repo said a word before it happened.
 *
 * So it does both halves. It writes the file first, because a rebuild that was genuinely
 * wanted should still be recoverable; then it refuses, because one that was not should not
 * have happened. Timestamped, so a second rescue never lands on the first.
 *
 * "Yours" is anything the seed did not write — `!isSeedId`, not `isMadeId`. The difference
 * only shows for an id of neither shape, and there the safe answer is to keep it: an id this
 * file has not heard of is a reason to stop, never a reason to delete.
 *
 * Silent when the table holds nothing but a seed, which is the common case and the one where
 * a rebuild costs nothing.
 */
export async function guardHandmade(variable: string): Promise<void> {
  const items = await scanAll("checked")
  if (!items.length) return

  const selection = select(items, (id) => !isSeedId(id))
  if (!selection.counts.nodes) return

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const out = `graph-export-${stamp}.json`
  const payload: GraphExport = {
    version: EXPORT_VERSION,
    table: GRAPH_TABLE_NAME,
    exportedAt: new Date().toISOString(),
    items: selection.items,
    counts: selection.counts,
  }
  writeFileSync(out, JSON.stringify(payload, null, 2))

  const { nodes, edges } = selection.counts
  console.log(
    `  ⚠ ${String(nodes)} node(s) and ${String(edges)} edge(s) here were not written by a ` +
      `seed\n     saved to ${out}`,
  )

  if (process.env[variable] !== "1") {
    throw new Error(
      `refusing to drop ${String(nodes)} node(s) the seed cannot rebuild\n` +
        `  put them back with: npm run graph:restore -- ${out}\n` +
        `  or set ${variable}=1 to drop them anyway — the file above is your copy`,
    )
  }
}

/**
 * Refuse an id of neither shape rather than sorting it into whichever bucket the
 * predicate happens to answer for. An unrecognised id means something writes nodes that
 * this file has never heard of, and quietly treating it as scaffolding would delete it.
 */
function classify(items: Item[]): void {
  const strange: string[] = []
  for (const item of items) {
    const pk = String(item[KEYS.pk] ?? "")
    if (pk === INDEX_PK || !pk.startsWith("node#")) continue
    if (item[KEYS.sk] !== META_SK) continue
    const id = nodeId(pk)
    if (!isMadeId(id) && !isSeedId(id)) strange.push(id)
  }
  if (strange.length) {
    throw new Error(
      `${String(strange.length)} node id(s) match neither shape, so this cannot say which ` +
        `are yours: ${strange.slice(0, 5).join(", ")}${strange.length > 5 ? " …" : ""}\n` +
        "  export everything with --all, or teach src/graph/keys.ts the new shape",
    )
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)

  const items = await scanAll()
  if (!items.length) throw new Error("the table is empty — nothing to export")
  // Only the default run has to tell the two apart, so only the default run can be stopped
  // by an id it cannot place. `--all` keeps every node whatever its shape, which is the
  // escape this refusal names.
  if (!options.all) classify(items)

  const selection = select(items, options.all ? () => true : isMadeId)
  if (!selection.counts.nodes) {
    throw new Error(
      options.all
        ? "no nodes in the table"
        : "no nodes were made by hand — there is nothing here the seed would not rebuild",
    )
  }

  const payload: GraphExport = {
    version: EXPORT_VERSION,
    table: GRAPH_TABLE_NAME,
    exportedAt: new Date().toISOString(),
    items: selection.items,
    counts: selection.counts,
  }
  writeFileSync(options.out, JSON.stringify(payload, null, 2))

  const { nodes, edges, labels } = selection.counts
  console.log(
    `  kept ${String(nodes)} nodes, ${String(edges)} edges, ${String(labels)} label claims`,
  )
  if (selection.droppedEdges) {
    console.log(
      `  ⚠ dropped ${String(selection.droppedEdges)} edge item(s) with one end outside the export`,
    )
  }
  // Not a warning. Leaving a claim behind is what leaving its node behind means, and in the
  // default run that is the entire point — every seed name gives up its partition.
  if (selection.droppedLabels) {
    console.log(`  left ${String(selection.droppedLabels)} claim(s) with the nodes holding them`)
  }
  if (selection.corrected) {
    console.log(`  ⚠ rewrote degree on ${String(selection.corrected)} node(s) to match`)
  }
  console.log(`✓ wrote ${options.out} (${String(selection.items.length)} items)`)
  console.log(`  put it back with: npm run graph:restore -- ${options.out}`)
}

// Only when this file *is* the command, so `select` can be imported without running it.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
