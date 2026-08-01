/**
 * Generate a small-world graph and write it to the table.
 *
 *   npm run graph:seed              # default size
 *   GRAPH_N=2000 GRAPH_K=8 npm run graph:seed
 *
 * The previous graph is deleted first, partition by partition. Overwriting without
 * deleting looked idempotent and was not: node metas were replaced but stale *edge*
 * items survived, so a node's stored `degree` stopped matching the edges in its
 * partition and reads returned more neighbours than the node claimed to have.
 */
import { BatchWriteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { db, TABLE_NAME, describeTarget } from "../db/client.js"
import { KEYS } from "../db/tables.js"
import { INDEX_PK, META_SK, edgeSk, nodePk } from "./keys.js"
import { degrees, generate } from "./generate.js"
import { readIndex } from "./repo.js"

/** DynamoDB's hard cap on a single BatchWriteItem request. */
const BATCH_MAX = 25

/** Partitions probed concurrently while clearing. */
const CLEAR_CONCURRENCY = 40

const num = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim()
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

const nodeIdAt = (i: number): string => `n${String(i).padStart(4, "0")}`

type Item = Record<string, unknown>
type Key = Record<string, unknown>

async function submit(
  requests: ({ PutRequest: { Item: Item } } | { DeleteRequest: { Key: Key } })[],
): Promise<void> {
  let pending = requests
  // BatchWrite can decline part of a batch under throttling and hands the rest back
  // rather than failing. Local never does this; real DynamoDB does.
  for (let attempt = 0; pending.length > 0 && attempt < 8; attempt++) {
    const res = await db.send(
      new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: pending } }),
    )
    pending = (res.UnprocessedItems?.[TABLE_NAME] ?? []) as typeof pending
    if (pending.length > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt))
  }
  if (pending.length > 0) throw new Error("BatchWrite kept declining items")
}

async function writeAll(items: Item[], label: string): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_MAX) {
    await submit(items.slice(i, i + BATCH_MAX).map((Item) => ({ PutRequest: { Item } })))
    const done = Math.min(i + BATCH_MAX, items.length)
    if (done % 1000 === 0 || done === items.length) {
      process.stdout.write(`\r  ${label} ${done}/${items.length} items`)
    }
  }
  process.stdout.write("\n")
}

/** Every key in one node's partition. */
async function keysFor(id: string): Promise<Key[]> {
  const res = await db.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": KEYS.pk, "#sk": KEYS.sk },
      ExpressionAttributeValues: { ":pk": nodePk(id) },
      ProjectionExpression: "#pk, #sk",
    }),
  )
  return (res.Items ?? []).map((item) => ({
    [KEYS.pk]: item[KEYS.pk],
    [KEYS.sk]: item[KEYS.sk],
  }))
}

/**
 * Delete the previous graph. Node ids are positional, so the old node count from the
 * index is enough to find every partition without a Scan. A run interrupted before the
 * index was written can leave orphans; `npm run ddb:reset` is the cure for that.
 */
async function clearGraph(previousCount: number, nextCount: number): Promise<void> {
  const total = Math.max(previousCount, nextCount)
  if (total === 0) return

  const keys: Key[] = []
  for (let i = 0; i < total; i += CLEAR_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(CLEAR_CONCURRENCY, total - i) },
      (_, j) => nodeIdAt(i + j),
    )
    const found = await Promise.all(batch.map(keysFor))
    for (const list of found) keys.push(...list)
  }
  keys.push({ [KEYS.pk]: INDEX_PK, [KEYS.sk]: META_SK })

  for (let i = 0; i < keys.length; i += BATCH_MAX) {
    await submit(keys.slice(i, i + BATCH_MAX).map((Key) => ({ DeleteRequest: { Key } })))
    const done = Math.min(i + BATCH_MAX, keys.length)
    if (done % 1000 === 0 || done === keys.length) {
      process.stdout.write(`\r  cleared ${done}/${keys.length} items`)
    }
  }
  process.stdout.write("\n")
}

async function main(): Promise<void> {
  const n = num("GRAPH_N", 600)
  const k = num("GRAPH_K", 6)
  const p = num("GRAPH_P", 0.08)
  const seed = num("GRAPH_SEED", 20260729)

  console.log(`→ ${describeTarget()}`)
  console.log(`  generating n=${n} k=${k} p=${p} seed=${seed}`)

  const graph = generate({ n, k, p, seed })
  const degree = degrees(graph)

  const previous = await readIndex()
  if (previous) {
    console.log(`  clearing previous graph (${previous.nodeCount} nodes)`)
    await clearGraph(previous.nodeCount, n)
  }

  const items: Item[] = graph.nodes.map((node) => ({
    [KEYS.pk]: nodePk(node.id),
    [KEYS.sk]: META_SK,
    label: node.label,
    degree: degree.get(node.id) ?? 0,
  }))

  // Both directions, so a walk arriving from either end reads one partition.
  for (const [a, b] of graph.edges) {
    items.push({ [KEYS.pk]: nodePk(a), [KEYS.sk]: edgeSk(b) })
    items.push({ [KEYS.pk]: nodePk(b), [KEYS.sk]: edgeSk(a) })
  }

  console.log(`  ${graph.nodes.length} nodes, ${graph.edges.length} edges`)
  await writeAll(items, "wrote")

  // The best-connected node makes the most interesting centre, and the client should
  // not have to Scan to find one. Written last, so it also marks a completed run.
  const rootId = [...degree.entries()].reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    ["", -1] as [string, number],
  )[0]

  await db.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        [KEYS.pk]: INDEX_PK,
        [KEYS.sk]: META_SK,
        rootId,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
      },
    }),
  )

  console.log(`✓ seeded. root=${rootId} (degree ${degree.get(rootId) ?? 0})`)
}

main().catch((err: unknown) => {
  console.error("✗ seed failed:", err)
  process.exit(1)
})
