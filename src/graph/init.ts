/**
 * The reckoning: make what is derived match the table. Writes nothing else.
 *
 * Two derived things — the index item, and which component each node belongs to. Faults
 * found on the way are reported and do not stop the write; `--check` refuses instead.
 */
import { pathToFileURL } from "node:url"
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME, describeTarget } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import { scanAll, writeAll, type Item } from "./bulk.js"
import { pickRoot, verify } from "./restore.js"
import { stampIslands } from "./islands.js"
import { INDEX_PK, META_SK, type GraphIndex } from "./keys.js"

const USAGE = "usage: npm run graph:init -- [--check]"

export function parseArgs(argv: string[]): { check: boolean } {
  let check = false
  for (const arg of argv) {
    if (arg === "--check") check = true
    else throw new Error(`unknown argument: ${arg}\n${USAGE}`)
  }
  return { check }
}

/** What the index item says now, or null when there is none. */
function current(items: Item[]): GraphIndex | null {
  const item = items.find(
    (candidate) => candidate[KEYS.pk] === INDEX_PK && candidate[KEYS.sk] === META_SK,
  )
  if (!item) return null
  return {
    rootId: String(item["rootId"] ?? ""),
    nodeCount: Number(item["nodeCount"] ?? 0),
    edgeCount: Number(item["edgeCount"] ?? 0),
  }
}

/**
 * What it should say, from the nodes and edges themselves.
 *
 * `verify` is the restore's, unchanged, and it rejects an index item by design — so the one
 * item this command is about is the one item kept out of the reckoning that decides it.
 */
export function reckon(items: Item[]): { index: GraphIndex; faults: string[] } {
  const graphItems = items.filter((item) => item[KEYS.pk] !== INDEX_PK)
  const { faults, graph } = verify(graphItems)
  const edgeCount = [...graph.degree.values()].reduce((sum, d) => sum + d, 0) / 2
  return {
    index: { rootId: pickRoot(graph.degree), nodeCount: graph.degree.size, edgeCount },
    faults,
  }
}

/** The lines describing what changes, or none at all when nothing does. */
function drift(was: GraphIndex | null, now: GraphIndex): string[] {
  if (!was) return [`no index item — writing one`]
  const lines: string[] = []
  const say = (name: string, before: string, after: string): void => {
    if (before !== after) lines.push(`${name} ${before} → ${after}`)
  }
  say("rootId", was.rootId || "(none)", now.rootId || "(none)")
  say("nodeCount", String(was.nodeCount), String(now.nodeCount))
  say("edgeCount", String(was.edgeCount), String(now.edgeCount))
  return lines
}

async function main(): Promise<void> {
  const { check } = parseArgs(process.argv.slice(2))

  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)

  const items = await scanAll()
  const was = current(items)
  const { index, faults } = reckon(items)
  // Components, derived from every node and edge at once. The incremental path maintains
  // this one edge at a time and is allowed to lose (src/graph/islands.ts); this is where
  // whatever it dropped is found, because a walk of the whole graph cannot be wrong.
  const { islands, changed } = stampIslands(items)

  for (const fault of faults.slice(0, 20)) console.log(`  ⚠ ${fault}`)
  if (faults.length > 20) console.log(`  … and ${String(faults.length - 20)} more`)

  console.log(
    `  ${String(index.nodeCount)} nodes, ${String(index.edgeCount)} edges, ` +
      `${String(islands)} island(s), root ${index.rootId || "(none — the graph is empty)"}`,
  )
  const changes = drift(was, index)
  if (changed.length) {
    changes.push(`${String(changed.length)} node(s) in the wrong island`)
  }
  for (const line of changes) console.log(`  ${line}`)

  if (check) {
    if (!changes.length && !faults.length) {
      console.log("✓ the index item is already true")
      return
    }
    // Non-zero so this is usable as a gate, and worded for whichever of the two it found.
    throw new Error(
      changes.length && faults.length
        ? `what is derived is out of date, and the graph has ${String(faults.length)} fault(s)`
        : changes.length
          ? "what is derived is out of date — run npm run graph:init"
          : `the graph has ${String(faults.length)} fault(s)`,
    )
  }

  if (!changes.length) {
    console.log("✓ the index item was already true — nothing written")
    return
  }

  // The nodes first, then the item that says where to start. Same ordering the seed and a
  // restore use: whatever marks a completed run is written last.
  if (changed.length) await writeAll(changed, "repaired")

  await db.send(
    new PutCommand({
      TableName: GRAPH_TABLE_NAME,
      Item: {
        [KEYS.pk]: INDEX_PK,
        [KEYS.sk]: META_SK,
        rootId: index.rootId,
        nodeCount: index.nodeCount,
        edgeCount: index.edgeCount,
      },
    }),
  )

  console.log(
    index.rootId
      ? `✓ index written. root=${index.rootId}`
      : "✓ index written. The graph is empty — name a node in the page, then run this again",
  )
}

// Only when this file *is* the command, so `reckon` can be imported without running it.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
