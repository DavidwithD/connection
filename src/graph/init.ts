/**
 * Make the index item tell the truth about the table.
 *
 *   npm run graph:init            # write it
 *   npm run graph:init -- --check # say what it would write, write nothing
 *
 * The only graph command with no destructive mode. It reads, derives, and puts back what it
 * derived; it never drops a table and never deletes a row, so unlike its two neighbours it
 * needs no guard against being pointed at somewhere real.
 *
 * Two derived things live here now. The index item, which is the argument below; and which
 * component each node belongs to, which is maintained one edge at a time by writes that are
 * allowed to fail (src/graph/islands.ts) and so needs somewhere it can be recomputed from
 * the graph rather than from the last thing that happened to it. A split is the case that
 * makes this necessary rather than merely tidy: union-find has no un-union, so a part that
 * breaks a component in two can only be recounted, never undone.
 *
 * It exists because `graph#index` is a precondition rather than a summary. Every write is a
 * transaction carrying a conditional update on it (src/graph/edge.ts, src/graph/node.ts), so
 * a table without one refuses the first node as readily as the ten-thousandth — and until
 * now the only things that wrote it were the seed and a restore. Starting a real graph meant
 * generating six hundred invented ones first, or having a graph already to export.
 *
 * The same item is the only record of where the map starts, and nothing maintains it after a
 * write: `createNode` and `deleteNode` move the counts and leave `rootId` alone. A root that
 * is parted from its edges and deleted takes the page's first read with it
 * (web/src/main.ts), and no amount of writing fixes what only a reckoning can. This is that
 * reckoning, and it is the same one `graph:restore` performs on the way in — the difference
 * being that this one reads the table rather than a file, and puts back one item rather than
 * all of them.
 *
 * Faults found on the way are reported and do not stop the write. The index is derived, and
 * a true derivation of a damaged graph is worth more than a stale one; `--check` is the mode
 * that refuses instead. See docs/decisions/0018-the-graph-outlives-the-seed.md.
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
