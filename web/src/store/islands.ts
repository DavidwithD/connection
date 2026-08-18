/**
 * Connected components, as union-find over the stored graph. Balanced by size, with no path
 * compression.
 *
 * `settle` runs inside the write transaction. `recount` runs outside it, in chunks, and is
 * allowed to fail. Union-find has no inverse for a split, so a split has to walk the graph:
 * up to half a component, measured at about 12 seconds at this store's size limit. A
 * transaction holds its object stores locked for its whole life, so that walk cannot be
 * inside one.
 */
import { open, type StoredNode } from "./db.js"
import { MAX_EDGES_PER_NODE } from "./read.js"

/**
 * How many hops `find` walks before giving up.
 *
 * Union by size bounds the depth at log2 of the component size, so this is unreachable for
 * any graph this store holds. It is here for the case that bound does not cover: a cycle in
 * the `parent` pointers. No operation can create one, but an imported file can, and it would
 * otherwise loop forever inside a write.
 */
const MAX_DEPTH = 64

/**
 * How many records are rewritten in one transaction.
 *
 * Measured: one transaction rewriting 30,000 records stalls reads of the same store to 2.91
 * seconds, against a 22ms baseline. The lock is per object store, so during that the map, the
 * search box and the island panel are all frozen. Chunked at 200, the worst stall is 130ms.
 * That costs 1.9 times as long overall: twice the total time, in exchange for never blocking
 * a read for more than a tenth of a second.
 */
const CHUNK = 200

/**
 * How many nodes one recount visits before giving up.
 *
 * At a measured 188µs per record rewritten: 500 is invisible but gives up often, and 10,000
 * is 1.88 seconds, which is too long. 2,000 is about 376ms, and is rarely reached at all.
 * Past it, **Recount the islands** on the transfer page finishes the job.
 */
const BUDGET = 2000

/** A component: the root node that names it, and how many nodes it holds. */
export interface Island {
  root: string
  size: number
}

/**
 * The part of an object store the code below uses. It only reads and puts.
 *
 * A structural type, so `settle` can be given the store from the caller's own write
 * transaction without this file naming idb's generics. That matters: `settle` must run inside
 * the transaction that wrote the edge, and a function that opened its own would not be.
 */
export interface NodeStore {
  get(key: string): Promise<StoredNode | undefined>
  put(value: StoredNode): Promise<string>
}

/** A recount that ran out of budget. Expected. **Recount the islands** finishes the job. */
export class Lagging extends Error {
  constructor() {
    super("the island list is behind the graph — run Recount the islands on the transfer page")
    this.name = "Lagging"
  }
}

/**
 * Compute the components of a whole graph, in memory.
 *
 * Used by everything that holds a whole graph at once: a seed, an import, and the recount.
 * None of those needs to read the store to learn what it already has. Returns a parent for
 * every node, already flattened to its root, and the size of each component.
 */
export function components(
  ids: Iterable<string>,
  edges: Iterable<readonly [string, string]>,
): { parent: Map<string, string>; sizes: Map<string, number> } {
  const parent = new Map<string, string>()
  const size = new Map<string, number>()
  for (const id of ids) {
    parent.set(id, id)
    size.set(id, 1)
  }

  const root = (id: string): string => {
    let at = id
    for (let hop = 0; parent.get(at) !== at && hop < MAX_DEPTH; hop++) {
      const next = parent.get(at)
      if (next === undefined) break
      at = next
    }
    return at
  }

  for (const [a, b] of edges) {
    if (!parent.has(a) || !parent.has(b)) continue
    const ra = root(a)
    const rb = root(b)
    if (ra === rb) continue
    // The larger component absorbs the smaller, so depth stays logarithmic in its size.
    const [winner, loser] = (size.get(ra) ?? 0) >= (size.get(rb) ?? 0) ? [ra, rb] : [rb, ra]
    parent.set(loser, winner)
    size.set(winner, (size.get(winner) ?? 0) + (size.get(loser) ?? 0))
    size.delete(loser)
  }

  // Flatten on the way out. Every caller is about to write these, and a stored chain costs
  // the next reader one read per hop.
  const flat = new Map<string, string>()
  for (const id of parent.keys()) flat.set(id, root(id))
  return { parent: flat, sizes: size }
}

/**
 * Rewrite the component fields on a whole graph's records, in memory.
 *
 * This is the counterpart to `settle` and `recount`. Those maintain the index one edge at a
 * time and can fail. This derives it from every node and edge at once and cannot. Two callers
 * hold a whole graph: an import, whose file may be a subset with different components from
 * the graph it came from, and the recount, which exists to repair what the incremental path
 * misses.
 *
 * It compares the grouping, never the pointers. Which node names a component depends on the
 * order the unions ran in, so a seed, a `settle` and this reach different roots for the same
 * graph, and all of them are correct. Treating that as drift would leave the recount
 * permanently reporting changes. So a component whose members already resolve to a single
 * root inside that component keeps it. Only a wrong grouping, a wrong size, or an
 * `islandSize` on a node that is not a root counts as a change.
 *
 * Chains are left alone for the same reason. `settle` re-points the losing root and not the
 * nodes behind it, so a member two joins deep reaches its root in two hops. Flattening that
 * is an optimisation, not a repair, and it would report drift after every join.
 */
export function stampIslands(
  nodes: StoredNode[],
  edges: Iterable<readonly [string, string]>,
): { islands: number; changed: StoredNode[] } {
  const held = new Map<string, StoredNode>()
  for (const node of nodes) held.set(node.labelKey, node)

  /** Where a node's stored pointers lead, as the records have them now. */
  const stored = (id: string): string => {
    let at = id
    for (let hop = 0; hop < MAX_DEPTH; hop++) {
      const next = held.get(at)?.parent ?? at
      // A pointer to a node outside this set leads nowhere. That is what an imported subset
      // looks like, and it means this node needs a new root rather than following the chain.
      if (next === at || !held.has(next)) return at
      at = next
    }
    return at
  }

  const { parent } = components(held.keys(), edges)
  const groups = new Map<string, string[]>()
  for (const id of held.keys()) {
    const root = parent.get(id) ?? id
    const group = groups.get(root)
    if (group) group.push(id)
    else groups.set(root, [id])
  }

  const changed: StoredNode[] = []

  for (const group of groups.values()) {
    // Keep the root the records already agree on, when there is exactly one and it is in this
    // group. Otherwise pick the smallest key, which is what `pickRoot` does for a split, so
    // two repairs of one graph reach the same answer.
    const claimed = new Set(group.map(stored))
    const [only] = claimed
    const root =
      claimed.size === 1 && only !== undefined && group.includes(only)
        ? only
        : pickRoot(group)

    for (const id of group) {
      const node = held.get(id)
      if (!node) continue
      const wasParent = node.parent
      const wasSize = node.islandSize

      // Re-point only a node that does not already reach this root. One that reaches it
      // through another node keeps its chain.
      if (stored(id) !== root) node.parent = root
      if (id === root) node.islandSize = group.length
      else delete node.islandSize

      if (node.parent !== wasParent || node.islandSize !== wasSize) changed.push(node)
    }
  }

  return { islands: groups.size, changed }
}

/**
 * Find the root of the component a node is in, by walking the stored pointers.
 *
 * A node whose `parent` is itself is its own root. That is what any node written before this
 * index existed looks like. Returning "itself" leaves such a graph as the recount will find
 * it, rather than inventing a component nobody wrote.
 */
export async function find(nodes: NodeStore, id: string): Promise<Island | null> {
  let at = id
  for (let hop = 0; hop < MAX_DEPTH; hop++) {
    const node = await nodes.get(at)
    if (!node) return null
    if (node.parent === at) return { root: at, size: node.islandSize ?? 1 }
    at = node.parent
  }
  throw new Error(`parent pointers from ${id} do not reach a root`)
}

/**
 * Merge the two components a new edge joins, leaving one root.
 *
 * This runs inside the write transaction. It is two record updates at any graph size: the
 * losing root points at the winner and drops its `islandSize`, which removes it from
 * `byIsland`, and the winner takes the combined size.
 *
 * No conditional updates, and none are needed. IndexedDB serialises overlapping transactions,
 * so what `find` read is still true when this writes. The previous version needed two
 * conditional updates and a retry loop, because DynamoDB gave no such guarantee.
 */
export async function settle(nodes: NodeStore, aId: string, bId: string): Promise<void> {
  const a = await find(nodes, aId)
  const b = await find(nodes, bId)
  // A missing node is not this function's problem to report. The write that called it has
  // already succeeded or already refused.
  if (!a || !b || a.root === b.root) return

  const [winner, loser] = a.size >= b.size ? [a, b] : [b, a]
  const losing = await nodes.get(loser.root)
  const winning = await nodes.get(winner.root)
  if (!losing || !winning) return

  const { islandSize: _gone, ...rest } = losing
  await nodes.put({ ...rest, parent: winner.root })
  await nodes.put({ ...winning, islandSize: winner.size + loser.size })
}

/**
 * Work out which components a set of nodes are in, after something between them was removed.
 *
 * An earlier version, `resettle(a, b)`, did this for two starting points. `removeEdge` passes
 * the two ends of the edge it removed. `deleteNodeWithEdges` passes every neighbour it
 * disconnected. One function covers both: the question is the same and only the number of
 * starting points differs.
 *
 * Two things kept the two-seed version cheap, and both work at k seeds:
 *
 *   Stop while one frontier is still growing. The last group left is the remainder, and
 *   enumerating it is exactly what this must not pay for. Looping while any frontier is live,
 *   instead of while more than one is, would walk every group to completion and lose this.
 *
 *   Compute the remainder's size by subtraction, never by counting.
 *
 * One thing is new at k seeds: merging. 120 starting points collapse to the number of
 * components the deletion actually produced, which is usually one.
 *
 * `was` and `deleted` are passed in, not read here. The caller captures the component before
 * removing anything. Read afterwards, a deleted root leaves every chain ending at a missing
 * record, `find` returns null, and the size needed to stamp a new root is gone with it.
 *
 * Idempotent. Run twice, the second run finds the pieces already separated and writes the
 * same pointers back.
 */
export async function recount(
  seeds: string[],
  was: Island | null,
  deleted: string | null = null,
): Promise<void> {
  if (!was) return

  const groups: Group[] = []
  const owner = new Map<string, Group>()
  for (const seed of new Set(seeds)) {
    if (seed === deleted || owner.has(seed)) continue
    const group: Group = { seen: new Set([seed]), frontier: [seed] }
    groups.push(group)
    owner.set(seed, group)
  }
  if (!groups.length) return

  const walk = { groups, owner, visits: 0 }
  await race(walk)

  // Every seed reached every other, so the component is still in one piece.
  if (groups.length === 1) {
    // Removing an edge that split nothing changes no size. No node left the graph.
    if (!deleted) return
    if (was.root === deleted) {
      // Still in one piece, but its root is the node that was deleted. Connectivity is
      // already known and only the root is missing, so adopt a new one without walking. That
      // is what the `byParent` index is for.
      await rerootByParent(deleted, Math.max(1, was.size - 1))
      return
    }
    // Still in one piece, still rooted, and one node smaller. Easy to miss because nothing
    // moved, but a root counting a node that is gone is exactly the drift this path exists to
    // prevent. It is arithmetic, not a walk.
    await adopt([deleted], was.root, () => false)
    await resize(was.root, Math.max(1, was.size - 1))
    return
  }

  // It split. The old component is now `groups.length` components.
  const survivors = was.size - (deleted ? 1 : 0)
  const closed = groups.filter((group) => !group.frontier.length)
  const rest = groups.find((group) => group.frontier.length) ?? null

  // The old root was the deleted node, so no piece inherits it. Every piece needs a root, so
  // every piece has to be walked. This is the one path that gives up the early exit.
  if (deleted && was.root === deleted) {
    if (rest) await closeOut(walk, rest)
    for (const group of groups) await stamp(group)
    return
  }

  if (!rest) {
    // Every group finished, so every size came from a walk.
    for (const group of groups) await stamp(group)
    return
  }

  if (closed.some((group) => group.seen.has(was.root))) {
    // The one case that pays for a full walk. The old root is in a piece that finished, so
    // the remainder cannot keep it and has to be enumerated after all. This is no worse at k
    // seeds than at two.
    await closeOut(walk, rest)
    for (const group of groups) await stamp(group)
    return
  }

  for (const group of closed) await stamp(group)

  // The remainder was never walked, so its pointers are unchanged, and some of them name a
  // node that is no longer in it. `settle` re-points a losing root at the winner and leaves
  // the nodes behind it alone, so a chain can run out of the remainder and into the piece
  // that just split off. Left alone, `find` would return a component the node is not in, and
  // the next write would read a root and a size belonging to another component.
  const walked = new Set<string>()
  for (const group of closed) for (const id of group.seen) walked.add(id)
  await adopt(
    deleted ? [...walked, deleted] : [...walked],
    was.root,
    (id) => walked.has(id),
  )

  // Only the remainder's size changed, and that is arithmetic rather than a walk.
  const left = survivors - closed.reduce((sum, group) => sum + group.seen.size, 0)
  await resize(was.root, Math.max(1, left))
}

/**
 * Re-point any node that still names a node no longer in this component.
 *
 * This is the one repair a walk cannot cover, and it is needed because a `parent` pointer is
 * not an edge. `settle` re-points a losing root at the winner and leaves everything behind it
 * alone, so a node deep in the graph can be named by many others without being a root. A
 * chain can therefore cross whatever an edge removal or a delete just cut.
 *
 * Two cases, one question. After a delete, the chains ending at the deleted node. After a
 * split, the chains running from the remainder into the piece that separated. `gone` is
 * whichever set that is. `inside` names the nodes a walk has already re-pointed; touching one
 * of those would undo the root it was just given.
 *
 * One range read per name in `gone`. After a split that is the piece already walked, so it
 * costs the same order as the walk that found it.
 */
async function adopt(
  gone: Iterable<string>,
  root: string,
  inside: (id: string) => boolean,
): Promise<void> {
  const db = await open()
  const orphaned: string[] = []

  for (const name of gone) {
    for (const child of await db.getAllFromIndex("nodes", "byParent", name)) {
      // A root points at itself, and the root being repaired towards keeps its own pointer.
      if (child.labelKey === name || child.labelKey === root) continue
      if (inside(child.labelKey)) continue
      orphaned.push(child.labelKey)
    }
  }

  await rewrite(orphaned, (node) => {
    // A node pointing at another is not a root, so drop any size it carries. Left in place,
    // it would appear in `byIsland` as a component that does not exist.
    const { islandSize: _gone, ...rest } = node
    return { ...rest, parent: root }
  })
}

/** One starting point and everything it has reached so far, while the race runs. */
interface Group {
  seen: Set<string>
  frontier: string[]
}

interface Walk {
  groups: Group[]
  owner: Map<string, Group>
  visits: number
}

const live = (groups: Group[]): Group[] => groups.filter((group) => group.frontier.length)

/** Grow every frontier one hop at a time until one is left, merging groups that meet. */
async function race(walk: Walk): Promise<void> {
  while (live(walk.groups).length > 1) {
    for (const group of [...walk.groups]) {
      // Both conditions are rechecked each turn. A merge may have removed this group, and the
      // previous group may have been the one whose finishing left a single frontier.
      if (!walk.groups.includes(group) || !group.frontier.length) continue
      if (live(walk.groups).length <= 1) return
      await advance(walk, group)
    }
  }
}

/** Grow one group by one hop. */
async function advance(walk: Walk, group: Group): Promise<void> {
  const frontier = group.frontier
  group.frontier = []

  walk.visits += frontier.length
  if (walk.visits > BUDGET) throw new Lagging()

  const next: string[] = []
  for (const id of await step(frontier)) {
    const other = walk.owner.get(id)
    if (other && other !== group) {
      absorb(walk, group, other)
      continue
    }
    if (group.seen.has(id)) continue
    group.seen.add(id)
    walk.owner.set(id, group)
    next.push(id)
  }
  // Append rather than assign. A merge above may have given this group a frontier already.
  group.frontier.push(...next)
}

/** Two starting points are in one component. One group survives, holding both. */
function absorb(walk: Walk, keep: Group, gone: Group): void {
  for (const id of gone.seen) {
    keep.seen.add(id)
    walk.owner.set(id, keep)
  }
  keep.frontier.push(...gone.frontier)
  gone.frontier = []
  const at = walk.groups.indexOf(gone)
  if (at >= 0) walk.groups.splice(at, 1)
}

/** Walk one group until its frontier is empty. The full cost, paid only where needed. */
async function closeOut(walk: Walk, group: Group): Promise<void> {
  while (group.frontier.length) await advance(walk, group)
}

/** Every node one hop out from a frontier, read in chunks so no lock is held for long. */
async function step(frontier: string[]): Promise<string[]> {
  const db = await open()
  const out: string[] = []

  for (let i = 0; i < frontier.length; i += CHUNK) {
    const slice = frontier.slice(i, i + CHUNK)
    const tx = db.transaction("edges", "readonly")
    const byEnd = tx.store.index("byEnd")
    for (const id of slice) {
      const edges = await byEnd.getAll(IDBKeyRange.only(id), MAX_EDGES_PER_NODE)
      for (const edge of edges) out.push(edge.a === id ? edge.b : edge.a)
    }
    await tx.done
  }

  return out
}

/** Pick a component's root: the smallest key. Stable, so re-running a repair picks the same
 *  root and writes the same pointers back. */
export function pickRoot(ids: Iterable<string>): string {
  return [...ids].sort()[0] ?? ""
}

/** Give a fully walked component its own root, and the size the walk counted. */
async function stamp(group: Group): Promise<void> {
  const ids = [...group.seen]
  await reroot(ids, pickRoot(ids), ids.length)
}

/**
 * Point a set of nodes at a root, and set `islandSize` on that root only.
 *
 * The root is written last, so nothing points at a node that is not a root yet. A run cut
 * short leaves the index over-listing components or reporting a wrong size, which is what
 * **Recount the islands** repairs.
 */
async function reroot(ids: string[], root: string, size: number): Promise<void> {
  await rewrite(
    ids.filter((id) => id !== root),
    (node) => {
      const { islandSize: _gone, ...rest } = node
      return { ...rest, parent: root }
    },
  )
  await rewrite([root], (node) => ({ ...node, parent: root, islandSize: size }))
}

/** Update a root's size, for a component that lost members but kept its root. */
async function resize(root: string, size: number): Promise<void> {
  await rewrite([root], (node) => ({ ...node, islandSize: size }))
}

/**
 * Give a component a new root after its old root was deleted, without walking it.
 *
 * Every broken chain `n → p₁ → … → X` has a last node `c` whose `parent` is `X`. Re-pointing
 * those nodes alone repairs every chain behind them. The `byParent` index turns "which nodes
 * point at X" into one range read. The alternative is giving up the early exit and walking
 * the whole component to rediscover connectivity that is already known.
 *
 * X always has at least one direct child while any node survives: they were all in its
 * component, so they all reached it, so at least one pointed at it.
 *
 * How many children X has depends on how the graph was built. A graph grown by joins leaves X
 * few, because `settle` re-points only the losing root: one child per merge won. A graph that
 * has been imported or recounted leaves X all of them, because `stampIslands` flattens every
 * node onto its root. Even then only the writes are O(component). Finding them is still one
 * range read.
 */
async function rerootByParent(deleted: string, size: number): Promise<void> {
  const db = await open()
  const children = (await db.getAllFromIndex("nodes", "byParent", deleted)).filter(
    (node) => node.labelKey !== deleted,
  )
  if (!children.length) return

  const root = pickRoot(children.map((node) => node.labelKey))
  // Write the root first here. The chains are already broken, so nothing points at a valid
  // record in the meantime, and everything else is about to point at this one.
  await rewrite([root], (node) => ({ ...node, parent: root, islandSize: size }))
  await rewrite(
    children.map((node) => node.labelKey).filter((id) => id !== root),
    (node) => {
      const { islandSize: _gone, ...rest } = node
      return { ...rest, parent: root }
    },
  )
}

/**
 * Rewrite a set of node records, in chunks, one transaction per chunk.
 *
 * IndexedDB has no partial update, so whole records are rewritten. How matters. `openCursor`
 * with `cursor.update()` reads and writes in one pass. A `get` then `put` per key costs two
 * round trips per record. The ids are sorted and the cursor jumps to each one with
 * `continue(key)`, so a scattered set still costs one pass rather than a full scan.
 */
async function rewrite(
  ids: string[],
  change: (node: StoredNode) => StoredNode,
): Promise<void> {
  if (!ids.length) return
  const db = await open()
  const sorted = [...new Set(ids)].sort()

  for (let i = 0; i < sorted.length; i += CHUNK) {
    const slice = sorted.slice(i, i + CHUNK)
    const tx = db.transaction("nodes", "readwrite")
    let at = 0
    let cursor = await tx.store.openCursor(IDBKeyRange.lowerBound(slice[0]!))

    while (cursor && at < slice.length) {
      const want = slice[at]!
      if (cursor.key < want) {
        cursor = await cursor.continue(want)
        continue
      }
      if (cursor.key === want) {
        await cursor.update(change(cursor.value))
        at++
        cursor = await cursor.continue()
        continue
      }
      // The cursor is past this id, so it is not in the store. A concurrent delete can do
      // that. Skip it.
      at++
    }

    await tx.done
  }
}

/** Write a whole graph's stamped records back, chunked for the reason given at `CHUNK`. */
export async function writeStamped(changed: StoredNode[]): Promise<void> {
  if (!changed.length) return
  const db = await open()
  for (let i = 0; i < changed.length; i += CHUNK) {
    const tx = db.transaction("nodes", "readwrite")
    for (const node of changed.slice(i, i + CHUNK)) await tx.store.put(node)
    await tx.done
  }
}
