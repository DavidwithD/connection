/**
 * Name to node, exact and by prefix.
 *
 *   GetItem  label#<normalised>/#owner   the one node that holds this exact name
 *   Query    label index, begins_with    everything starting with what has been typed
 */
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME } from "../db/client.js"
import { GRAPH_KEYS as KEYS, LABEL_INDEX } from "./table.js"
import {
  LABEL_OWNER_SK,
  labelBucket,
  labelPk,
  nodeId,
  normaliseLabel,
  type NodeMeta,
} from "./keys.js"
import { batchGet, readMetas } from "./repo.js"

/** Most results a prefix query returns. A search box shows a list, not a page. */
export const SEARCH_LIMIT = 20

/**
 * The node holding this exact name, or null.
 *
 * The claim item names the node but carries no degree, so the meta item is read after it.
 * Two round trips, on a path where being right matters more than being quick.
 */
export async function resolveLabel(label: string): Promise<NodeMeta | null> {
  if (!normaliseLabel(label)) return null

  const res = await db.send(
    new GetCommand({
      TableName: GRAPH_TABLE_NAME,
      Key: { [KEYS.pk]: labelPk(label), [KEYS.sk]: LABEL_OWNER_SK },
      ConsistentRead: true,
    }),
  )

  const id = String(res.Item?.["nodeId"] ?? "")
  if (!id) return null

  // A claim outliving its node would be a bug rather than a miss, but the caller can only
  // act on what exists either way.
  return (await readMetas([id])).get(id) ?? null
}

/**
 * The same question asked of many names at once, keyed by the normalised name.
 *
 * `resolveLabel` is two round trips, which is the right shape for one name and the wrong
 * one for a whole file of them (src/graph/load.ts). The two reads are the same two — the
 * claims, then the nodes they name — batched into a request per hundred names rather than
 * a pair of requests per name.
 *
 * Strongly consistent for the same reason as above: this feeds writes, and a name claimed
 * a moment ago has to be found rather than made twice.
 *
 * A name with no claim is simply absent from the result, which is what a caller about to
 * create it is asking about. Keyed by the normalised form because two spellings of one name
 * are one node, and a caller holding either spelling has to reach it.
 */
export async function resolveLabels(labels: string[]): Promise<Map<string, NodeMeta>> {
  const wanted = new Set<string>()
  for (const label of labels) {
    const key = normaliseLabel(label)
    if (key) wanted.add(key)
  }
  if (!wanted.size) return new Map()

  const claims = await batchGet(
    [...wanted].map((key) => ({ [KEYS.pk]: labelPk(key), [KEYS.sk]: LABEL_OWNER_SK })),
    true,
  )

  // The claim carries the label it was made under, so the key comes back off the item
  // rather than being matched against what was asked for.
  const named = new Map<string, string>() // node id -> normalised name
  for (const claim of claims) {
    const id = String(claim["nodeId"] ?? "")
    const key = normaliseLabel(String(claim["label"] ?? ""))
    if (id && key) named.set(id, key)
  }

  const metas = await readMetas([...named.keys()])
  const out = new Map<string, NodeMeta>()
  for (const [id, key] of named) {
    const meta = metas.get(id)
    // A claim outliving its node is a fault rather than a miss, and the caller can only act
    // on what exists either way — same as the single-name read above.
    if (meta) out.set(key, meta)
  }
  return out
}

/** Every node whose name starts with `prefix`, nearest the front of the alphabet first. */
export async function searchLabels(
  prefix: string,
  limit: number = SEARCH_LIMIT,
): Promise<NodeMeta[]> {
  const normalised = normaliseLabel(prefix)
  if (!normalised) return []

  const res = await db.send(
    new QueryCommand({
      TableName: GRAPH_TABLE_NAME,
      IndexName: LABEL_INDEX,
      KeyConditionExpression: "#bucket = :bucket AND begins_with(#sort, :prefix)",
      ExpressionAttributeNames: { "#bucket": KEYS.labelBucket, "#sort": KEYS.labelSort },
      ExpressionAttributeValues: {
        ":bucket": labelBucket(prefix),
        ":prefix": normalised,
      },
      Limit: limit,
    }),
  )

  // The index projects everything, so a hit is already a whole node.
  return (res.Items ?? []).map((item) => ({
    id: nodeId(String(item[KEYS.pk] ?? "")),
    label: String(item["label"] ?? ""),
    degree: Number(item["degree"] ?? 0),
  }))
}
