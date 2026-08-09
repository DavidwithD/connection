/**
 * Walk a component through every write that can change it, and check it survives.
 *
 *   npm run graph:smoke
 *
 * The island index is maintained by writes that are allowed to fail and repaired by a
 * command nobody runs on a schedule (src/graph/islands.ts), so the thing worth testing is
 * not any one of them but the sequence: create, join, join, part. Three of those four are
 * the cases that sank the designs this one replaced — a pair of made nodes joined only to
 * each other is invisible to a degree-zero index, and a part is the one thing union-find
 * cannot undo.
 *
 * Everything it makes, it removes: names are scoped to the run, and the last act is to
 * check the graph counts what it counted before. Safe against a dev table for that reason,
 * and only that reason — it writes to the real graph, because a component is a property of
 * the real graph and there is nowhere else to have one.
 *
 * Needs a graph to be part of: `npm run graph:init` on an empty table is enough.
 */
import { pathToFileURL } from "node:url"
import { describeTarget, GRAPH_TABLE_NAME } from "../db/client.js"
import { addEdge, removeEdge } from "./edge.js"
import { shares } from "./generate.js"
import { find } from "./islands.js"
import { createNode, deleteNode } from "./node.js"
import {
  ISLAND_LIMIT,
  readAdjacency,
  readIndex,
  readIslandCount,
  readIslandPage,
  type IslandCursor,
} from "./repo.js"
import type { GraphIndex, NodeMeta } from "./keys.js"

const run = `smoke-${String(process.pid)}`

function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`)
  if (!ok) throw new Error(`graph smoke failed: ${label}`)
}

/** The component a node is in, or a sentence about why there is not one. */
async function island(node: NodeMeta): Promise<{ root: string; size: number }> {
  const found = await find(node.id)
  if (!found) throw new Error(`${node.label} has no meta item`)
  return found
}

/** Both ends of a pair, and what each of them thinks it belongs to. */
async function islands(a: NodeMeta, b: NodeMeta): Promise<[typeof one, typeof one]> {
  const [one, two] = await Promise.all([island(a), island(b)])
  return [one, two]
}

/**
 * Whether the island index carries this root, wherever in it that falls.
 *
 * Paged rather than asked for in one go. The index is ordered by size, and the islands this
 * run makes are the smallest there are — so on any graph in enough pieces they sort past the
 * end of a single read, and a check written against the first page of them stops testing the
 * index and starts testing how fragmented the table happens to be.
 */
async function listed(root: string): Promise<boolean> {
  let after: IslandCursor | undefined
  do {
    const page = await readIslandPage(ISLAND_LIMIT, after)
    if (page.islands.some((found) => found.id === root)) return true
    after = page.cursor ?? undefined
  } while (after)
  return false
}

async function main(): Promise<void> {
  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}\n`)

  // --- the split, before anything is written ------------------------------
  // Pure, and first because it needs nothing. Every node has to land in exactly one island
  // or it sits outside every range the generator builds — no ring to join, no component to
  // belong to — and the rounding that produces the sizes moves the total both ways.
  let uncovered = ""
  for (const n of [10, 60, 600, 2000]) {
    for (let islands = 1; islands <= Math.min(n, 40); islands++) {
      const sizes = shares(n, islands)
      const sum = sizes.reduce((total, size) => total + size, 0)
      if (sum !== n || sizes.length !== islands || sizes.some((size) => size < 1)) {
        uncovered = `n=${String(n)} islands=${String(islands)} → ${sizes.join(",")} sums ${String(sum)}`
      }
    }
  }
  check(`every split covers its graph exactly${uncovered ? ` — ${uncovered}` : ""}`, !uncovered)

  const before = await readIndex()
  if (!before) throw new Error("no index item — run npm run graph:init")
  const wasListed = await readIslandCount()

  // --- three nodes, three components ---------------------------------------
  const [a, b, c] = await Promise.all([
    createNode(`${run}-alder`),
    createNode(`${run}-birch`),
    createNode(`${run}-cedar`),
  ])
  // From here on the graph holds nodes this run made, so every exit has to take them out
  // again — a check that fails is still a run that has to leave the graph as it found it.
  // Left to the happy path, one interrupted run silently adds a component, and the next
  // graph:init --check reports drift that has nothing to do with what it is gating.
  try {
    await walk(a, b, c, before, wasListed)
  } finally {
    await tidy([a, b, c])
  }
}

/**
 * Part and delete whatever a run made, from any state it left them in.
 *
 * Every edge first, because the store refuses a node that still has one, and read back
 * rather than assumed: which edges exist depends on how far the run got. Failures are
 * reported and not thrown — this is the path a failure already took, and hiding the check
 * that failed behind a cleanup error helps nobody.
 */
async function tidy(nodes: NodeMeta[]): Promise<void> {
  for (const node of nodes) {
    try {
      // Null is the node already being gone, which is the ordinary case on the second pass
      // — the walk tidies up itself so it can check the result, and the `finally` runs
      // anyway. Silence there, so the only thing this ever prints is a real leftover.
      const adjacency = await readAdjacency(node.id)
      if (!adjacency) continue
      for (const other of adjacency.neighbourIds) await removeEdge(node.id, other)
      await deleteNode(node.id, node.label)
    } catch (err) {
      console.error(
        `  ⚠ could not remove ${node.label}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

async function walk(
  a: NodeMeta,
  b: NodeMeta,
  c: NodeMeta,
  before: GraphIndex,
  wasListed: number,
): Promise<void> {
  const fresh = await Promise.all([island(a), island(b), island(c)])
  check(
    "a made node is its own island, of one",
    fresh.every((found, i) => found.root === [a, b, c][i]!.id && found.size === 1),
  )

  // --- a join merges two ----------------------------------------------------
  await addEdge(a.id, b.id)
  const joined = await islands(a, b)
  check("a join leaves the two ends in one island", joined[0].root === joined[1].root)
  check(`that island counts two (counts ${String(joined[0].size)})`, joined[0].size === 2)
  // The case a sparse index over degree-zero nodes cannot see: neither end is loose any
  // more, and the component is made entirely of nodes somebody made by hand.
  check("and it is still listed, with neither end loose", await listed(joined[0].root))

  // --- a second join grows it ----------------------------------------------
  await addEdge(b.id, c.id)
  const chained = await islands(a, c)
  check("a second join reaches the far end of the first", chained[0].root === chained[1].root)
  check(`the island counts three (counts ${String(chained[0].size)})`, chained[0].size === 3)

  // --- a part splits it -----------------------------------------------------
  // What union-find has no operation for. The walk is the answer, and this is the assertion
  // that says the walk ran: two islands where there was one, each counting its own half.
  await removeEdge(b.id, c.id)
  const split = await islands(a, c)
  check("parting a bridge leaves two islands", split[0].root !== split[1].root)
  check(`the half that kept two counts two (counts ${String(split[0].size)})`, split[0].size === 2)
  check(`the half left alone counts one (counts ${String(split[1].size)})`, split[1].size === 1)
  check("both halves are listed", (await listed(split[0].root)) && (await listed(split[1].root)))

  // --- a part that strands the root ----------------------------------------
  // The other side of the same walk. Above, the half that closed first did not hold the
  // node naming the island, so the far side kept its root untouched. Here it does: parting
  // at the root end leaves the cheap half holding the only name the component had, and the
  // repair has to walk the side it had already stopped paying for.
  await addEdge(b.id, c.id)
  await removeEdge(a.id, b.id)
  const stranded = await islands(a, b)
  check("parting at the root end still leaves two islands", stranded[0].root !== stranded[1].root)
  check(`the stranded root counts one (counts ${String(stranded[0].size)})`, stranded[0].size === 1)
  check(`the side it left counts two (counts ${String(stranded[1].size)})`, stranded[1].size === 2)
  check(
    "and the side that lost its name has been given another",
    (await island(c)).root === stranded[1].root,
  )

  // --- and back ------------------------------------------------------------
  // The same removal `tidy` would do, run here so what follows can be checked. Doing it
  // twice is harmless: the second pass finds the edges parted and the nodes gone.
  await tidy([a, b, c])
  const after = await readIndex()
  check(
    `the graph counts what it counted before (${String(before.nodeCount)} nodes, ` +
      `${String(before.edgeCount)} edges)`,
    after?.nodeCount === before.nodeCount && after.edgeCount === before.edgeCount,
  )
  check("and lists the islands it listed before", (await readIslandCount()) === wasListed)

  console.log("\nAll checks passed — components survive every write that changes them.")
}

// Only when this file *is* the command, so nothing here runs on an import.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
