/**
 * Rebuild the graph table from a file `graph:export` wrote.
 *
 *   npm run graph:restore -- graph-export.json
 *   npm run graph:restore -- graph-export.json --dry-run   # check the file, touch nothing
 *
 * Together with the export this is how the seed leaves without taking anything with it:
 * export what was made by hand, restore it into an empty table. There is no table to copy
 * into and no table to rename, because DynamoDB has neither operation — a table's name is
 * fixed at creation, so the only way to end up with the right name is to drop that table and
 * build it again. Which is what the seed already does, and why the machinery is shared
 * (src/graph/bulk.ts).
 *
 * Everything before the drop is a check, and that ordering is the whole safety argument.
 * The file is the only copy of the graph from the moment the table goes, so it is read,
 * parsed and proved consistent first; a file that fails any check leaves the table exactly
 * as it was. The checks are the invariants the writes defend one transaction at a time
 * (docs/decisions/0009-the-first-write-outside-the-seed.md), asked of a whole graph at once:
 * both halves of every edge, degrees matching the edges they count, one live claim per name.
 *
 * The index item is rebuilt rather than restored. `rootId` has to name a node that is
 * actually here, and the export usually leaves behind the seed node the old one named.
 *
 * See docs/decisions/0018-the-graph-outlives-the-seed.md.
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME, describeTarget, isLocal } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import { guardDrop, recreateTable, writeAll, type Item } from "./bulk.js"
import { EXPORT_VERSION, guardHandmade, type GraphExport } from "./export.js"
import {
  EDGE_PREFIX,
  INDEX_PK,
  LABEL_OWNER_SK,
  META_SK,
  edgeTarget,
  nodeId,
  normaliseLabel,
} from "./keys.js"
import { stampIslands } from "./islands.js"

const USAGE = "usage: npm run graph:restore -- <file> [--dry-run]"

interface Options {
  file: string
  dryRun: boolean
}

export function parseArgs(argv: string[]): Options {
  let file = ""
  let dryRun = false
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true
    else if (arg.startsWith("-")) throw new Error(`unknown argument: ${arg}\n${USAGE}`)
    else if (file) throw new Error(`two files given: ${file} and ${arg}\n${USAGE}`)
    else file = arg
  }
  if (!file) throw new Error(USAGE)
  return { file, dryRun }
}

/**
 * What joins the two ends of an edge into one lookup key.
 *
 * A character no id can contain, so the key is unambiguous without escaping either end.
 * Written as an escape rather than the byte it denotes: a NUL anywhere in a file's first
 * 8000 bytes makes git call the whole file binary and stop diffing it, which is an
 * expensive way to hide a separator nobody reads.
 */
const PAIR = "\u0000"

export interface Graph {
  items: Item[]
  /** Node id to its degree, counted from the edge items rather than read off the metas. */
  degree: Map<string, number>
}

/**
 * Everything wrong with this file, all of it, before anything is dropped.
 *
 * Every problem is collected rather than thrown at the first one. A run that has to be
 * repaired is repaired against a list, and finding the second fault only after fixing the
 * first is how a rebuild turns into an afternoon.
 */
export function verify(items: Item[]): { faults: string[]; graph: Graph } {
  const faults: string[] = []
  const metas = new Map<string, Item>()
  const edges = new Set<string>()
  const claims = new Map<string, string>() // partition key -> node id
  const degree = new Map<string, number>()

  for (const [index, item] of items.entries()) {
    const pk = String(item[KEYS.pk] ?? "")
    const sk = String(item[KEYS.sk] ?? "")
    if (!pk || !sk) {
      faults.push(`item ${String(index)} has no key`)
      continue
    }
    if (pk === INDEX_PK) {
      faults.push("the file carries an index item — it is rebuilt here, not restored")
    } else if (pk.startsWith("node#") && sk === META_SK) {
      const id = nodeId(pk)
      if (metas.has(id)) faults.push(`two meta items for ${id}`)
      metas.set(id, item)
      degree.set(id, 0)
    } else if (pk.startsWith("node#") && sk.startsWith(EDGE_PREFIX)) {
      edges.add(`${nodeId(pk)}${PAIR}${edgeTarget(sk)}`)
    } else if (pk.startsWith("label#") && sk === LABEL_OWNER_SK) {
      if (claims.has(pk)) faults.push(`two claims on ${pk}`)
      claims.set(pk, String(item["nodeId"] ?? ""))
    } else {
      faults.push(`item ${String(index)} is of no shape this knows: ${pk} / ${sk}`)
    }
  }

  // Every edge, from both ends. Each is stored twice and a half-edge is unreachable from
  // the side that survives, so a missing mirror is the one fault that could never be
  // repaired from inside the graph afterwards.
  for (const key of edges) {
    const [from, to] = key.split(PAIR) as [string, string]
    if (!metas.has(from)) faults.push(`edge ${from}→${to} leaves a node that is not here`)
    if (!metas.has(to)) faults.push(`edge ${from}→${to} lands on a node that is not here`)
    if (!edges.has(`${to}${PAIR}${from}`)) faults.push(`edge ${from}→${to} has no mirror`)
    if (metas.has(from)) degree.set(from, (degree.get(from) ?? 0) + 1)
  }

  for (const [id, meta] of metas) {
    const counted = degree.get(id) ?? 0
    const stated = Number(meta["degree"] ?? 0)
    if (stated !== counted) {
      faults.push(`${id} states degree ${String(stated)} and has ${String(counted)} edges`)
    }
    // The label index lives on these two attributes alone, so a node missing them is
    // invisible to search while still perfectly reachable by id.
    if (!meta[KEYS.labelBucket] || !meta[KEYS.labelSort]) {
      faults.push(`${id} is missing its label index attributes`)
    }
  }

  // Two claims on one name are caught above, where the second item is read — a partition
  // key can only reach this map once, so there is nothing left here to compare.
  const claimed = new Map<string, string>()
  for (const [pk, id] of claims) {
    if (!metas.has(id)) faults.push(`${pk} claims a name for ${id}, which is not here`)
    claimed.set(pk, id)
  }
  for (const [id, meta] of metas) {
    const label = String(meta["label"] ?? "")
    if (!normaliseLabel(label)) {
      faults.push(`${id} has no usable name`)
      continue
    }
    if (claimed.get(`label#${normaliseLabel(label)}`) !== id) {
      faults.push(`${id} ("${label}") holds no claim on its own name`)
    }
  }

  return { faults, graph: { items, degree } }
}

/**
 * The best-connected node makes the most interesting centre, and the page reads this rather
 * than Scanning for somewhere to begin. The seed calls this too, rather than keeping its own
 * copy — the two have to agree, and for a while they did not.
 *
 * Ties break on the id, and that is the whole reason this is not a one-line reduce. A plain
 * "strictly greater wins" keeps whichever maximum it met first, so the answer depends on the
 * order the degrees were counted in — node order in the seed, Scan order in the reckoning.
 * With a hundred hubs all driven to `hubK` exactly, ties are the common case, and the two
 * routinely disagreed about a graph neither of them was wrong about. That made
 * `graph:init --check` report drift it could never clear.
 */
export function pickRoot(degree: Map<string, number>): string {
  return [...degree.entries()].reduce(
    (best, entry) =>
      entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0]) ? entry : best,
    ["", -1] as [string, number],
  )[0]
}

function read(file: string): GraphExport {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const payload = parsed as Partial<GraphExport>
  if (payload.version !== EXPORT_VERSION) {
    throw new Error(
      `${file} is version ${String(payload.version)}, and this reads ${String(EXPORT_VERSION)}`,
    )
  }
  if (!Array.isArray(payload.items)) throw new Error(`${file} carries no items`)
  return payload as GraphExport
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  const payload = read(options.file)
  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)
  console.log(
    `  ${options.file}: ${String(payload.items.length)} items, ` +
      `exported ${payload.exportedAt} from ${payload.table}`,
  )
  if (payload.table !== GRAPH_TABLE_NAME) {
    console.log(`  ⚠ that is not the table this would write to`)
  }

  const { faults, graph } = verify(payload.items)
  if (faults.length) {
    for (const fault of faults.slice(0, 20)) console.error(`  ✗ ${fault}`)
    if (faults.length > 20) console.error(`  … and ${String(faults.length - 20)} more`)
    throw new Error(
      `${String(faults.length)} fault(s) — the table has not been touched`,
    )
  }

  const nodeCount = graph.degree.size
  const edgeCount = [...graph.degree.values()].reduce((sum, d) => sum + d, 0) / 2
  const rootId = pickRoot(graph.degree)
  console.log(
    `  ✓ consistent: ${String(nodeCount)} nodes, ${String(edgeCount)} edges, ` +
      `root ${rootId} (degree ${String(graph.degree.get(rootId) ?? 0)})`,
  )

  if (options.dryRun) {
    console.log("✓ dry run — nothing written")
    return
  }

  guardDrop(isLocal, "GRAPH_RESTORE_DROP")
  // The same hazard from the other direction: an older export written back over a table that
  // has moved on since. Every check above is about the file; this one is about what the file
  // is being written on top of.
  await guardHandmade("GRAPH_RESTORE_DROP")

  // Rebuilt, not restored, and for the same reason as the index item below: the file is
  // often a subset, and a subset's components are not the ones it was exported from. The
  // keys carried in from the old table would name roots that are no longer here.
  const { islands } = stampIslands(payload.items)
  console.log(`  ${String(islands)} island(s)`)

  if (!isLocal) console.log("  recreating the table (tens of seconds against AWS)…")
  await recreateTable()
  await writeAll(payload.items, "wrote")

  // Written last, so it also marks a completed run: a rebuild interrupted before this
  // leaves a table the API refuses to serve rather than half a graph it will.
  await db.send(
    new PutCommand({
      TableName: GRAPH_TABLE_NAME,
      Item: { [KEYS.pk]: INDEX_PK, [KEYS.sk]: META_SK, rootId, nodeCount, edgeCount },
    }),
  )

  console.log(`✓ restored. root=${rootId}`)
}

// Only when this file *is* the command, so `verify` can be imported without running it.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
