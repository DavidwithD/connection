/** The reads: adjacency Query, metas BatchGet, island Query. */
import { BatchGetCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME } from "../db/client.js"
import { GRAPH_KEYS as KEYS, ISLAND_INDEX } from "./table.js"
import {
  EDGE_PREFIX,
  INDEX_PK,
  META_SK,
  edgeTarget,
  islandBucket,
  islandSize,
  nodeId,
  nodePk,
  type GraphIndex,
  type IslandMeta,
  type NodeMeta,
} from "./keys.js"

/** DynamoDB's hard cap on keys in one BatchGetItem request. */
const BATCH_GET_MAX = 100

/**
 * Ceiling on edges read for one node. A hub past this is truncated rather than
 * paginated: a view can only draw a bounded number of neighbours anyway, and `degree`
 * still reports the real total so nothing silently claims to be complete.
 */
const MAX_EDGES_PER_NODE = 120

export interface Adjacency {
  node: NodeMeta
  neighbourIds: string[]
  /** True when the node has more edges than were read. */
  truncated: boolean
}

export async function readIndex(): Promise<GraphIndex | null> {
  const res = await db.send(
    new GetCommand({
      TableName: GRAPH_TABLE_NAME,
      Key: { [KEYS.pk]: INDEX_PK, [KEYS.sk]: META_SK },
    }),
  )
  const item = res.Item
  if (!item) return null
  return {
    rootId: String(item["rootId"] ?? ""),
    nodeCount: Number(item["nodeCount"] ?? 0),
    edgeCount: Number(item["edgeCount"] ?? 0),
  }
}

/**
 * Islands per page.
 *
 * A page rather than a cap: a graph can be in any number of pieces — 688 nodes of vocabulary
 * came in as 267 of them — and a list that stops at a round number without saying so claims
 * to be the whole graph. Twenty is what fits a panel with room to scroll; `readIslandPage`
 * hands back a cursor for the rest.
 */
export const ISLAND_LIMIT = 20

/** Where a page of islands stopped, to start the next one from. */
export type IslandCursor = Record<string, unknown>

export interface IslandPage {
  islands: IslandMeta[]
  /** Null when that was the last of them. */
  cursor: IslandCursor | null
}

/** What a Query wants handed back to carry on: the table's keys, and the index's. */
const CURSOR_KEYS = [KEYS.pk, KEYS.sk, KEYS.islandBucket, KEYS.islandSort]

/**
 * Whether this is a key the island index could have handed out.
 *
 * Its shape, not its provenance — the values are the store's business, and a key naming a row
 * that has since moved is a page boundary that drifted rather than a caller that lied.
 *
 * Asked here because this is where the index's shape is known. A caller that has carried a
 * cursor out to a client cannot check one on the way back in without either asking this or
 * keeping its own copy of the four attribute names — which is the copy that goes stale when
 * the index gains a fifth. Unchecked, a key missing one of them is a ValidationException,
 * which is a fault reported against the store for something the caller handed over.
 */
export function isIslandCursor(value: unknown): value is IslandCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const key = value as Record<string, unknown>
  return CURSOR_KEYS.every((name) => typeof key[name] === "string")
}

/**
 * One page of components, largest first.
 *
 * One Query, because only a component's root carries the island keys (src/graph/keys.ts) —
 * so the index holds a row per island rather than per node, and there is no filtering to
 * do. Sorted descending on a size that is zero-padded into the sort key, which is what
 * makes "the biggest place you have not been" the first row rather than a scan of all of
 * them.
 *
 * The sort key carries the island's id after its size, so no two rows share one and paging
 * can neither repeat a row nor step over one — within an index that is holding still. A join
 * changes a size, which is to say it moves a row, so pages either side of a write are pages
 * of two different lists. That is the same over-listing the island index already accepts: a
 * stale address costs a wasted trip, not a wrong map.
 *
 * Eventually consistent, like any GSI, and that costs nothing here: an island appearing a
 * beat after the write that made it is a list that catches up, not a map that lies.
 */
export async function readIslandPage(
  limit: number = ISLAND_LIMIT,
  after?: IslandCursor,
): Promise<IslandPage> {
  const res = await db.send(
    new QueryCommand({
      TableName: GRAPH_TABLE_NAME,
      IndexName: ISLAND_INDEX,
      KeyConditionExpression: "#bucket = :bucket",
      ExpressionAttributeNames: { "#bucket": KEYS.islandBucket },
      ExpressionAttributeValues: { ":bucket": islandBucket() },
      ScanIndexForward: false,
      Limit: limit,
      ...(after ? { ExclusiveStartKey: after } : {}),
    }),
  )

  return {
    // The index projects everything, so a hit is already a whole node.
    islands: (res.Items ?? []).map((item) => ({
      id: nodeId(String(item[KEYS.pk] ?? "")),
      label: String(item["label"] ?? ""),
      degree: Number(item["degree"] ?? 0),
      size: islandSize(String(item[KEYS.islandSort] ?? "")),
    })),
    cursor: res.LastEvaluatedKey ?? null,
  }
}

/** The first page and nothing else — for the callers that only ever wanted a list. */
export async function readIslands(limit: number = ISLAND_LIMIT): Promise<IslandMeta[]> {
  return (await readIslandPage(limit)).islands
}

/**
 * How many components there are.
 *
 * Counted rather than kept. A number on the index item would have to be maintained by the
 * same `settle` and `resettle` that are allowed to fail, so it could disagree with the rows
 * it counts — and a total that is wrong is worse than the cap it replaced, because nothing
 * on the page would look wrong.
 *
 * The loop is not for this graph. DynamoDB stops a COUNT at a megabyte of keys scanned, and
 * a graph in enough pieces to reach that is exactly the graph this number exists for.
 */
export async function readIslandCount(): Promise<number> {
  let total = 0
  let after: IslandCursor | undefined

  do {
    const res = await db.send(
      new QueryCommand({
        TableName: GRAPH_TABLE_NAME,
        IndexName: ISLAND_INDEX,
        KeyConditionExpression: "#bucket = :bucket",
        ExpressionAttributeNames: { "#bucket": KEYS.islandBucket },
        ExpressionAttributeValues: { ":bucket": islandBucket() },
        Select: "COUNT",
        ...(after ? { ExclusiveStartKey: after } : {}),
      }),
    )
    total += res.Count ?? 0
    after = res.LastEvaluatedKey
  } while (after)

  return total
}

/** One item's primary key, as a BatchGet wants it handed over. */
export type ItemKey = Record<string, string>

/**
 * Whatever is there, of many items named by key.
 *
 * Chunked to DynamoDB's cap and retried for whatever it declines, which is the part a
 * second copy of this loop would lose: BatchGetItem is allowed to hand keys back unread,
 * and DynamoDB Local never does — so the retry looks like dead code right up until it runs
 * against AWS. Missing items are simply absent from the result, so a caller asking whether
 * something exists compares what came back against what it asked for.
 */
export async function batchGet(
  keys: ItemKey[],
  consistent = false,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []

  for (let i = 0; i < keys.length; i += BATCH_GET_MAX) {
    let batch = keys.slice(i, i + BATCH_GET_MAX)

    for (let attempt = 0; batch.length > 0 && attempt < 8; attempt++) {
      const res = await db.send(
        new BatchGetCommand({
          RequestItems: {
            [GRAPH_TABLE_NAME]: { Keys: batch, ConsistentRead: consistent },
          },
        }),
      )
      out.push(...(res.Responses?.[GRAPH_TABLE_NAME] ?? []))
      batch = (res.UnprocessedKeys?.[GRAPH_TABLE_NAME]?.Keys ?? []) as typeof batch
      if (batch.length > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt))
    }
  }

  return out
}

/** Labels and degrees for many ids at once, chunked and retried. */
export async function readMetas(ids: string[]): Promise<Map<string, NodeMeta>> {
  const out = new Map<string, NodeMeta>()
  const keys = [...new Set(ids)].map((id) => ({
    [KEYS.pk]: nodePk(id),
    [KEYS.sk]: META_SK,
  }))

  for (const item of await batchGet(keys)) {
    const id = nodeId(String(item[KEYS.pk] ?? ""))
    if (!id) continue
    out.set(id, {
      id,
      label: String(item["label"] ?? id),
      degree: Number(item["degree"] ?? 0),
    })
  }

  return out
}

export interface Neighbourhood {
  node: NodeMeta
  neighbours: NodeMeta[]
  truncated: boolean
}

/**
 * One node and its neighbours, with each neighbour's true degree.
 *
 * The degrees are the point of the second call: without them the client cannot tell a
 * fully-drawn node from one with more graph behind it, so nothing would ever look worth
 * expanding.
 */
export async function readNeighbourhood(id: string): Promise<Neighbourhood | null> {
  const adjacency = await readAdjacency(id)
  if (!adjacency) return null

  const metas = await readMetas(adjacency.neighbourIds)
  const neighbours = adjacency.neighbourIds
    .map((nid) => metas.get(nid))
    .filter((meta): meta is NodeMeta => meta !== undefined)

  return { node: adjacency.node, neighbours, truncated: adjacency.truncated }
}

export async function readAdjacency(id: string): Promise<Adjacency | null> {
  const res = await db.send(
    new QueryCommand({
      TableName: GRAPH_TABLE_NAME,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": KEYS.pk },
      ExpressionAttributeValues: { ":pk": nodePk(id) },
      Limit: MAX_EDGES_PER_NODE + 1, // plus one for the meta item
    }),
  )

  const items = res.Items ?? []
  const metaItem = items.find((item) => item[KEYS.sk] === META_SK)
  if (!metaItem) return null

  const neighbourIds = items
    .filter((item) => String(item[KEYS.sk] ?? "").startsWith(EDGE_PREFIX))
    .map((item) => edgeTarget(String(item[KEYS.sk])))

  const node: NodeMeta = {
    id,
    label: String(metaItem["label"] ?? id),
    degree: Number(metaItem["degree"] ?? 0),
  }

  return { node, neighbourIds, truncated: neighbourIds.length < node.degree }
}
