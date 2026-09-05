/**
 * Every read the three pages make.
 *
 * Each one is a key lookup, a key range, or an index range. `readAllNodes` is the only read
 * here that scans the store, and it says why.
 */
import { counts, open, type StoredNode } from "./db.js"
import { normaliseLabel } from "./keys.js"
import { Missing } from "./refused.js"
import type {
  IslandMeta,
  IslandPage,
  Neighbourhood,
  NodeMeta,
  NodeRow,
  Opening,
} from "./shapes.js"

/**
 * The most edges read for one node.
 *
 * A hub past this is truncated, not paginated. A view can only draw so many neighbours, and
 * `degree` still reports the real total, so nothing claims to be complete when it is not.
 * This keeps one node's read bounded, and at the size this store is built for it will fire:
 * a small-world graph of 50,000 nodes has hubs well past 120.
 *
 * This cap is also why `byEnd` is one `multiEntry` index rather than two. With a cap,
 * `multiEntry` takes it as an argument and the engine stops there. Separate `byA` and `byB`
 * indexes would each have to read 120, then sort and slice. Reading 60 from each instead
 * would be wrong: edges are stored with `a < b`, so a node whose name sorts early has nearly
 * all its edges in one of the two.
 */
export const MAX_EDGES_PER_NODE = 120

/**
 * How many islands one page holds.
 *
 * A page, not a cap. A graph can have any number of components: 688 nodes of vocabulary came
 * in as 267 of them. A list that stops at a round number without saying so claims to be the
 * whole graph. Twenty fits the panel with room to scroll.
 */
export const ISLAND_LIMIT = 20

/** The most results a prefix search returns. A search box shows a list, not a page. */
export const SEARCH_LIMIT = 20

/**
 * A deliberate delay before a neighbourhood read answers.
 *
 * The loading state is part of the demo. IndexedDB answers fast enough that without a delay
 * the demo never shows one. It is a constant rather than an environment variable, because
 * there is no process to read one from.
 *
 * Awaited before a transaction is opened, never inside one. A `setTimeout` is not an
 * IndexedDB request, so awaiting it inside a transaction commits that transaction. See db.ts.
 */
const READ_DELAY_MS = 120

const pause = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve()

/** Turn a stored record into what a caller sees. The key becomes the id. */
const metaOf = (node: StoredNode): NodeMeta => ({
  id: node.labelKey,
  label: node.label,
  degree: node.degree,
})

/**
 * Everything the first frame needs, in one call.
 *
 * The opening node is the first row of the island page. `byIsland` is read in descending
 * order, so its first row is the root of the largest component. It is derived, not stored, so
 * it cannot be stale and cannot name a node that has been deleted.
 *
 * It is not returned as its own field. That field would be a copy of the first row under a
 * second name, and the two would have to be kept in step.
 *
 * The cost is that the opening node changes when the largest component changes root or is
 * overtaken. That happens on a merge or a split, not on an ordinary join.
 */
export async function readOpening(): Promise<Opening> {
  const [totals, page, islandCount] = await Promise.all([
    counts(),
    readIslandPage(),
    readIslandCount(),
  ])

  return {
    nodeCount: totals.nodes,
    edgeCount: totals.edges,
    islands: page.islands,
    islandCursor: page.cursor,
    islandCount,
  }
}

/**
 * One node and its neighbours, each with its real degree.
 *
 * The degrees are why the neighbours are read as records and not as names. Without them the
 * map cannot tell a fully drawn node from one with more graph behind it, so nothing would
 * look worth walking to.
 *
 * One transaction covers both stores, so the node records and the edges are read against the
 * same state of the graph.
 */
export async function readNeighbourhood(id: string): Promise<Neighbourhood> {
  await pause(READ_DELAY_MS)

  const db = await open()
  const tx = db.transaction(["nodes", "edges"], "readonly")
  const nodes = tx.objectStore("nodes")

  const node = await nodes.get(id)
  if (!node) throw new Missing(`no such node: ${id}`)

  const edges = await tx
    .objectStore("edges")
    .index("byEnd")
    .getAll(IDBKeyRange.only(id), MAX_EDGES_PER_NODE)

  const neighbours: NodeMeta[] = []
  for (const edge of edges) {
    const other = edge.a === id ? edge.b : edge.a
    const meta = await nodes.get(other)
    if (meta) neighbours.push(metaOf(meta))
  }

  await tx.done
  return { node: metaOf(node), neighbours }
}

/**
 * One node, or null if the graph carries no such name.
 *
 * The only read here whose good answer is nothing. `readNeighbourhood` throws `Missing` for a
 * node that is not there, which is right when the reader walked to it and it has gone. This
 * answers whether a name is free, so absence is the answer rather than a failure.
 */
export async function readNode(id: string): Promise<NodeMeta | null> {
  const db = await open()
  const node = await db.get("nodes", id)
  return node ? metaOf(node) : null
}

/**
 * The most nodes one list read returns.
 *
 * The store is built for 50,000 nodes, so this is the whole graph rather than a page of it. A
 * graph past this is cut off, and the page that asked has to say so.
 */
export const MAX_LIST_NODES = 50_000

/**
 * Every node, with its date. The only read here that scans the store.
 *
 * The node list searches names by substring, orders by date, and orders at random. No index
 * in this schema answers any of those. `byIsland` holds one entry per component and
 * `byParent` groups by root, so neither one lists nodes. So the page takes the whole list
 * once and works over it in memory.
 *
 * The cost is one read of every record at boot, and the page reports how long it took. The
 * map does not use this. It walks outward from one node and reads a neighbourhood at a time.
 */
export async function readAllNodes(limit: number = MAX_LIST_NODES): Promise<NodeRow[]> {
  const db = await open()
  const found = await db.getAll("nodes", null, limit)
  return found.map((node) => ({ ...metaOf(node), created: node.created }))
}

/** Where a page of islands stopped: the index key of its last row. */
export type IslandKey = [number, string]

/**
 * One page of components, largest first.
 *
 * `byIsland` is sparse by construction, because only a root has `islandSize`. So this walks
 * one entry per component rather than filtering one per node. Its key is
 * `[islandSize, labelKey]`, so no two rows share a key and paging cannot repeat or skip a
 * row, as long as the index is not changing. A join changes a size, which moves a row, so
 * pages either side of a write are pages of two different lists.
 *
 * `islandSize` is a number and sorts as one. The old sort key needed six digits of
 * zero-padding to sort correctly as a string.
 */
export async function readIslandPage(
  limit: number = ISLAND_LIMIT,
  after?: IslandKey,
): Promise<IslandPage> {
  const db = await open()
  const index = db.transaction("nodes", "readonly").store.index("byIsland")

  // Start strictly past the last row of the previous page. Descending order is "prev", so
  // continuing means everything below the key already served.
  const range = after ? IDBKeyRange.upperBound(after, true) : null
  let cursor = await index.openCursor(range, "prev")

  const islands: IslandMeta[] = []
  let last: IslandKey | null = null

  while (cursor && islands.length < limit) {
    const node = cursor.value
    islands.push({
      id: node.labelKey,
      label: node.label,
      degree: node.degree,
      size: node.islandSize ?? 1,
    })
    last = cursor.key
    cursor = await cursor.continue()
  }

  // A cursor that is still open means there is a row this page did not return.
  return { islands, cursor: cursor && last ? encodeCursor(last) : null }
}

/**
 * Count the components.
 *
 * Counted on demand rather than stored. A stored total maintained by the same writes that may
 * lag could disagree with the rows it counts, and a wrong total is worse than no total.
 */
export async function readIslandCount(): Promise<number> {
  const db = await open()
  return db.countFromIndex("nodes", "byIsland")
}

/**
 * Every node whose name starts with `prefix`, in alphabetical order.
 *
 * A key range on the store itself, with no index. The key is the normalised name, so a range
 * over the keys is the whole search. U+FFFF sorts above any character a name can contain, so
 * it bounds the range.
 */
export async function searchLabels(
  prefix: string,
  limit: number = SEARCH_LIMIT,
): Promise<NodeMeta[]> {
  const key = normaliseLabel(prefix)
  if (!key) return []

  const db = await open()
  const found = await db.getAll("nodes", IDBKeyRange.bound(key, `${key}￿`), limit)
  return found.map(metaOf)
}

/**
 * Encode the cursor so callers treat it as opaque.
 *
 * Base64 of the index key rather than the key itself, for the reason it was base64 over the
 * wire: a caller that parses it will break when the index changes shape. Encoded through
 * UTF-8 first, because `btoa` rejects any character above 255 and names here are not all
 * Latin.
 */
function encodeCursor(key: IslandKey): string {
  const bytes = new TextEncoder().encode(JSON.stringify(key))
  return btoa(String.fromCharCode(...bytes))
}

/** Decode a cursor. Returns null for anything `encodeCursor` did not produce. */
export function decodeCursor(raw: string): IslandKey | null {
  try {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [size, id] = parsed as [unknown, unknown]
    return typeof size === "number" && typeof id === "string" ? [size, id] : null
  } catch {
    return null
  }
}

/** The islands after `cursor`. Called only by the island list asking for another page. */
export async function fetchIslands(cursor: string): Promise<IslandPage> {
  const key = decodeCursor(cursor)
  if (!key) return { islands: [], cursor: null }
  return readIslandPage(ISLAND_LIMIT, key)
}
