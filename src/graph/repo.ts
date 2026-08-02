/**
 * Primitive reads. One partition per node holds the node and its whole adjacency:
 *
 *   Query     pk = node#<id>          -> the meta item, then every edge item
 *   BatchGet  node#<other>/#meta      -> labels and true degrees, in bulk
 *
 * `#meta` sorts ahead of `edge#`, so the node item is always the first result and a
 * Limit can only ever truncate edges. Degree is read from the meta item rather than
 * counted from the edge items, which keeps it exact even when a Query was truncated.
 *
 * That last sentence is an invariant the frontend leans on — see docs/design/architecture.md.
 * The reasoning is docs/decisions/0003-graph-exploration-demo-stack.md.
 */
import { BatchGetCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import {
  EDGE_PREFIX,
  INDEX_PK,
  META_SK,
  edgeTarget,
  nodeId,
  nodePk,
  type GraphIndex,
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

/** Labels and degrees for many ids at once, chunked and retried. */
export async function readMetas(ids: string[]): Promise<Map<string, NodeMeta>> {
  const out = new Map<string, NodeMeta>()
  const unique = [...new Set(ids)]

  for (let i = 0; i < unique.length; i += BATCH_GET_MAX) {
    let keys = unique
      .slice(i, i + BATCH_GET_MAX)
      .map((id) => ({ [KEYS.pk]: nodePk(id), [KEYS.sk]: META_SK }))

    for (let attempt = 0; keys.length > 0 && attempt < 8; attempt++) {
      const res = await db.send(
        new BatchGetCommand({ RequestItems: { [GRAPH_TABLE_NAME]: { Keys: keys } } }),
      )
      for (const item of res.Responses?.[GRAPH_TABLE_NAME] ?? []) {
        const id = nodeId(String(item[KEYS.pk] ?? ""))
        if (!id) continue
        out.set(id, {
          id,
          label: String(item["label"] ?? id),
          degree: Number(item["degree"] ?? 0),
        })
      }
      keys = (res.UnprocessedKeys?.[GRAPH_TABLE_NAME]?.Keys ?? []) as typeof keys
      if (keys.length > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt))
    }
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
