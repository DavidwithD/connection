/**
 * Which nodes can reach which — components, as union-find over the stored graph.
 *
 * The map is walked outward from one node, so a component that node cannot reach is
 * unreachable by walking however long anyone looks. This is what tells the page those
 * components exist, and one Query on the `island` index is the whole read.
 *
 * Every node's meta item carries a `parent`; a node whose parent is itself is a *root*, and
 * a root is a component. Only roots carry the island keys, so the index holds one row per
 * component rather than one per node — there is no separate registry item, and so nothing
 * that can disagree with the pointers.
 *
 * Balanced by size rather than rank. Size is wanted anyway, to say how big an island is
 * before anyone goes there, and it survives what rank does not: a split can recount a size
 * exactly, while rank is a height bound that only ever rises and could never be corrected.
 * No path compression — union by size holds the depth at two or three at this scale, and
 * compression is the one part that would write during a read.
 *
 * What union-find cannot do is un-union, so `resettle` below is not an inverse of `settle`
 * but a recount, and it is why this index is derived rather than authoritative: every
 * failure here leaves the graph itself untouched, and `graph:init` reckons the index back
 * from the nodes and edges. See docs/decisions/0019-every-island-has-an-address.md.
 */
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import type { Item } from "./bulk.js"
import {
  EDGE_PREFIX,
  META_SK,
  edgeTarget,
  islandBucket,
  islandSize,
  islandSort,
  nodeId,
  nodePk,
} from "./keys.js"
import { readAdjacency } from "./repo.js"

/**
 * Reads or writes in flight at once, while walking or re-rooting a half.
 *
 * Each node owns its own partition, so a frontier is that many separate calls and nothing
 * batches them: BatchGet cannot Query, and BatchWrite only puts whole items, which these
 * updates deliberately are not.
 */
const FAN_OUT = 25

/**
 * Hops a `find` will walk before giving up.
 *
 * Union by size bounds the depth at log2 of the component, so this is unreachable for any
 * graph this holds. It is here for the shape the invariant does not cover: a `parent` cycle,
 * which no operation can create but a hand-edited table can, and which would otherwise spin
 * forever inside a write path.
 */
const MAX_DEPTH = 64

/** A component, as the store holds it: the root that names it, and what it counts. */
export interface Island {
  root: string
  size: number
}

/**
 * Components of a whole graph, in memory.
 *
 * Used by everything that writes a graph at once — the seed, a restore, the reckoning —
 * none of which needs the store to tell it what it already holds. Returns a parent for
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
    // Larger absorbs smaller, so depth stays logarithmic in the component.
    const [winner, loser] = (size.get(ra) ?? 0) >= (size.get(rb) ?? 0) ? [ra, rb] : [rb, ra]
    parent.set(loser, winner)
    size.set(winner, (size.get(winner) ?? 0) + (size.get(loser) ?? 0))
    size.delete(loser)
  }

  // Flattened on the way out. Every caller is about to write these, and a stored chain
  // costs whoever reads it next a round trip per hop.
  const flat = new Map<string, string>()
  for (const id of parent.keys()) flat.set(id, root(id))
  return { parent: flat, sizes: size }
}

/**
 * Rewrite the component keys on a whole table's worth of items, in memory.
 *
 * The counterpart to `settle` and `resettle`: those maintain the index one edge at a time
 * and can lose, this derives it from every node and edge at once and cannot. Shared by the
 * two callers that hold a whole graph — a restore, whose file may be a *subset* whose
 * components are not the ones it was exported from, and the reckoning, which exists to
 * repair exactly what the incremental path drops.
 *
 * What it compares is the *partition*, never the pointers. Which node ends up naming a
 * component is decided by the order the unions happened in, so the seed, a `settle` and this
 * all reach different roots for the same graph and every one of them is right. Reporting
 * that as drift would leave the reckoning permanently dirty and worth nothing — so a
 * component whose members already resolve to one root that is one of them keeps it, and only
 * a wrong grouping, a wrong size, or an index entry on a node that is not a root is a change.
 *
 * Chains are left alone for the same reason. `settle` re-points the losing root and not the
 * nodes behind it, so a member two joins deep reaches its root in two hops; flattening that
 * is an optimisation rather than a repair, and it would report as drift after every join.
 *
 * Keys are removed as well as written, so a node that has stopped being a root leaves the
 * index rather than lingering in it as a second address for the same component.
 */
export function stampIslands(items: Item[]): { islands: number; changed: Item[] } {
  const ids: string[] = []
  const edges: [string, string][] = []
  const metas = new Map<string, Item>()

  for (const item of items) {
    const pk = String(item[KEYS.pk] ?? "")
    const sk = String(item[KEYS.sk] ?? "")
    if (!pk.startsWith("node#")) continue
    if (sk === META_SK) {
      const id = nodeId(pk)
      ids.push(id)
      metas.set(id, item)
    } else if (sk.startsWith(EDGE_PREFIX)) {
      // Both directions, undeduplicated. A union of two nodes already together is a no-op,
      // so the second copy costs nothing — and an edge stored from one end only still
      // joins what it joins, rather than being silently dropped by a canonical filter.
      edges.push([nodeId(pk), edgeTarget(sk)])
    }
  }

  /** Where a node's stored pointers lead, as the table has them now. */
  const stored = (id: string): string => {
    let at = id
    for (let hop = 0; hop < MAX_DEPTH; hop++) {
      const next = String(metas.get(at)?.["parent"] ?? at)
      // A pointer out of the set is a pointer to nothing here — which is what a restored
      // subset looks like, and it means this node needs re-rooting rather than following.
      if (next === at || !metas.has(next)) return at
      at = next
    }
    return at
  }

  const { parent } = components(ids, edges)
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const root = parent.get(id) ?? id
    const group = groups.get(root)
    if (group) group.push(id)
    else groups.set(root, [id])
  }

  const changed = new Set<Item>()

  for (const group of groups.values()) {
    // Adopt whatever the table already calls this component, when that is one answer and it
    // is in here. Otherwise name it by the smallest id — the rule a split uses (`pickRoot`),
    // so two repairs of one graph agree on the answer.
    const claimed = new Set(group.map(stored))
    const [only] = claimed
    const root =
      claimed.size === 1 && only !== undefined && group.includes(only)
        ? only
        : pickRoot(new Set(group))

    for (const id of group) {
      const meta = metas.get(id)
      if (!meta) continue
      const before = `${String(meta["parent"] ?? "")}|${String(meta[KEYS.islandSort] ?? "")}`

      // Only a node that does not already reach this root is re-pointed. One that gets
      // there through another node is left to get there that way.
      if (stored(id) !== root) meta["parent"] = root
      if (id === root) {
        meta[KEYS.islandBucket] = islandBucket()
        meta[KEYS.islandSort] = islandSort(group.length, root)
      } else {
        delete meta[KEYS.islandBucket]
        delete meta[KEYS.islandSort]
      }

      if (before !== `${String(meta["parent"] ?? "")}|${String(meta[KEYS.islandSort] ?? "")}`) {
        changed.add(meta)
      }
    }
  }

  return { islands: groups.size, changed: [...changed] }
}

/**
 * The root of the component a node is in, by walking the stored pointers.
 *
 * One `GetItem` per hop, because each node owns its own partition. Depth is two or three,
 * and the walk gives up rather than looping if a hand-edited table ever points a node at
 * something that points back.
 *
 * A node with no `parent` is treated as its own root, which is what every node written
 * before this index existed looks like. Answering "itself" leaves such a graph exactly as
 * `graph:init` will find it, rather than inventing a component nobody wrote.
 */
export async function find(id: string): Promise<Island | null> {
  let at = id
  for (let hop = 0; hop < MAX_DEPTH; hop++) {
    const res = await db.send(
      new GetCommand({
        TableName: GRAPH_TABLE_NAME,
        Key: { [KEYS.pk]: nodePk(at), [KEYS.sk]: META_SK },
        ProjectionExpression: "#parent, #sort",
        ExpressionAttributeNames: { "#parent": "parent", "#sort": KEYS.islandSort },
      }),
    )
    if (!res.Item) return null

    const parent = String(res.Item["parent"] ?? at)
    if (parent === at) {
      const sort = res.Item[KEYS.islandSort]
      return { root: at, size: sort ? islandSize(String(sort)) : 1 }
    }
    at = parent
  }
  throw new Error(`parent pointers from ${id} do not reach a root`)
}

/**
 * Merge the two components a new edge joins, and leave one root standing.
 *
 * Runs after the edge is written, never inside that transaction: the join is the graph, and
 * this is an index over it. Two conditional updates on two different items — a transaction
 * may not touch one item twice (src/graph/edge.ts) — and both conditions make the same
 * claim from opposite ends, that what `find` read is still true.
 *
 * A failed condition means somebody merged one of these components while this was deciding.
 * That is not a fault: the retry re-reads, and either finds work to do or finds it done.
 */
export async function settle(aId: string, bId: string, attempts = 3): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const [a, b] = await Promise.all([find(aId), find(bId)])
    // A node that is not there is not this function's problem to report: the write that
    // called it has already succeeded, or already refused.
    if (!a || !b || a.root === b.root) return

    const [winner, loser] = a.size >= b.size ? [a, b] : [b, a]

    try {
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              // The loser stops being a root, and leaves the index by losing the only two
              // attributes that put it there.
              Update: {
                TableName: GRAPH_TABLE_NAME,
                Key: { [KEYS.pk]: nodePk(loser.root), [KEYS.sk]: META_SK },
                UpdateExpression: "SET #parent = :winner REMOVE #bucket, #sort",
                ConditionExpression: "#parent = :loser",
                ExpressionAttributeNames: {
                  "#parent": "parent",
                  "#bucket": KEYS.islandBucket,
                  "#sort": KEYS.islandSort,
                },
                ExpressionAttributeValues: { ":winner": winner.root, ":loser": loser.root },
              },
            },
            {
              // The winner carries both sizes now. Conditioning on the sort key is what
              // makes this safe without a lock: it is the exact value `find` just read.
              // Absent is allowed too, for a graph written before this index existed.
              Update: {
                TableName: GRAPH_TABLE_NAME,
                Key: { [KEYS.pk]: nodePk(winner.root), [KEYS.sk]: META_SK },
                UpdateExpression: "SET #bucket = :bucket, #sort = :next",
                ConditionExpression:
                  "#parent = :winner AND (attribute_not_exists(#sort) OR #sort = :now)",
                ExpressionAttributeNames: {
                  "#parent": "parent",
                  "#bucket": KEYS.islandBucket,
                  "#sort": KEYS.islandSort,
                },
                ExpressionAttributeValues: {
                  ":bucket": islandBucket(),
                  ":next": islandSort(winner.size + loser.size, winner.root),
                  ":now": islandSort(winner.size, winner.root),
                  ":winner": winner.root,
                },
              },
            },
          ],
        }),
      )
      return
    } catch (err) {
      // The last attempt tells the caller; the ones before it try again on fresh reads.
      if (attempt === attempts - 1) throw err
    }
  }
}

/**
 * Recount the component an edge has just left, and give the far half its own root.
 *
 * Union-find has no un-union, so this is a walk rather than a pointer flip. It goes outward
 * from both ends at once and stops the moment either side closes: whichever closes first
 * *is* the smaller half, and stopping there is what keeps this from ever paying for the
 * larger one. Half the component is the worst case, not the usual one — in the undo this
 * was written for, the half is a single node.
 *
 * Not a transaction, and it cannot be: the walk spans a partition per node. It is idempotent
 * instead — run twice, the second run finds the halves already apart and writes the same
 * pointers back. What a crash halfway leaves is an index that over-lists or misstates a
 * size, which is the thing `graph:init` exists to reckon.
 */
export async function resettle(aId: string, bId: string): Promise<void> {
  const was = await find(aId)
  const split = await reach(aId, bId)
  if (!split) return // the walks met: the edge was not a bridge, and nothing moved

  let { half, from } = split
  // The side keeping the old root must be the side that is *not* re-pointed, or every node
  // left behind would point at a root that has gone to the other component. When the old
  // root turns out to be in the closed half, the other half is the one that has to move —
  // and that is the one case this pays a full walk for, having stopped early on the wrong
  // side.
  if (was && half.has(was.root)) {
    half = await closure(from === aId ? bId : aId)
    from = from === aId ? bId : aId
  }

  const root = pickRoot(half)
  const rest = was ? Math.max(1, was.size - half.size) : half.size
  await reroot([...half], root, half.size)
  // The other half keeps the root it had; only what it counts has changed.
  if (was && !half.has(was.root)) await resize(was.root, rest)
}

/**
 * Walk from both ends until one side closes, or the two meet.
 *
 * Null when they meet — still connected, nothing to split. Otherwise the side that closed,
 * which is a whole component, and which end it grew from.
 */
async function reach(
  aId: string,
  bId: string,
): Promise<{ half: Set<string>; from: string } | null> {
  const sides = [
    { end: aId, seen: new Set([aId]), frontier: [aId] },
    { end: bId, seen: new Set([bId]), frontier: [bId] },
  ]

  for (;;) {
    // Alternating, so the smaller side closes before the larger one has been paid for.
    for (const side of sides) {
      const other = side === sides[0] ? sides[1]! : sides[0]!
      if (!side.frontier.length) return { half: side.seen, from: side.end }

      const next: string[] = []
      for (const id of await step(side.frontier)) {
        if (side.seen.has(id)) continue
        // Anything the other side has already reached is a path between the two ends.
        if (other.seen.has(id)) return null
        side.seen.add(id)
        next.push(id)
      }
      side.frontier = next
    }
  }
}

/** Every node one hop out from a frontier, with the reads capped rather than all at once. */
async function step(frontier: string[]): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < frontier.length; i += FAN_OUT) {
    const found = await Promise.all(
      frontier.slice(i, i + FAN_OUT).map((id) => readAdjacency(id)),
    )
    for (const adjacency of found) out.push(...(adjacency?.neighbourIds ?? []))
  }
  return out
}

/** Everything reachable from a node. The other half, once the cheap side turned out wrong. */
async function closure(from: string): Promise<Set<string>> {
  const seen = new Set([from])
  let frontier = [from]
  while (frontier.length) {
    const next: string[] = []
    for (const id of await step(frontier)) {
      if (seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    frontier = next
  }
  return seen
}

/** Stable, so re-running a repair picks the same root and writes the same pointers back. */
function pickRoot(half: Set<string>): string {
  return [...half].sort()[0]!
}

/**
 * Point a set of nodes at a root, and put the island keys on that root alone.
 *
 * One update per node rather than a batch: `BatchWriteItem` only puts whole items, and these
 * carry a label, a degree and their label-index keys that a put would have to reproduce
 * intact. An update touches the two attributes that changed and leaves the rest alone.
 */
async function reroot(ids: string[], root: string, size: number): Promise<void> {
  const others = ids.filter((id) => id !== root)
  for (let i = 0; i < others.length; i += FAN_OUT) {
    await Promise.all(
      others.slice(i, i + FAN_OUT).map((id) =>
        db.send(
          new UpdateCommand({
            TableName: GRAPH_TABLE_NAME,
            Key: { [KEYS.pk]: nodePk(id), [KEYS.sk]: META_SK },
            UpdateExpression: "SET #parent = :root REMOVE #bucket, #sort",
            ConditionExpression: "attribute_exists(#pk)",
            ExpressionAttributeNames: {
              "#pk": KEYS.pk,
              "#parent": "parent",
              "#bucket": KEYS.islandBucket,
              "#sort": KEYS.islandSort,
            },
            ExpressionAttributeValues: { ":root": root },
          }),
        ),
      ),
    )
  }
  // The root last, so nothing points at a node that is not one yet.
  await resize(root, size, true)
}

/** What a root counts, and — on a node being made one — that it is a root at all. */
async function resize(root: string, size: number, claim = false): Promise<void> {
  await db.send(
    new UpdateCommand({
      TableName: GRAPH_TABLE_NAME,
      Key: { [KEYS.pk]: nodePk(root), [KEYS.sk]: META_SK },
      UpdateExpression: claim
        ? "SET #parent = :root, #bucket = :bucket, #sort = :sort"
        : "SET #bucket = :bucket, #sort = :sort",
      ConditionExpression: "attribute_exists(#pk)",
      ExpressionAttributeNames: {
        "#pk": KEYS.pk,
        ...(claim ? { "#parent": "parent" } : {}),
        "#bucket": KEYS.islandBucket,
        "#sort": KEYS.islandSort,
      },
      ExpressionAttributeValues: {
        ":bucket": islandBucket(),
        ":sort": islandSort(size, root),
        ...(claim ? { ":root": root } : {}),
      },
    }),
  )
}
