/**
 * Generate a small-world graph and write it to the graph table.
 *
 *   npm run graph:seed              # default size
 *   GRAPH_N=2000 GRAPH_K=8 npm run graph:seed
 *   GRAPH_HUB_K=25 npm run graph:seed   # a longer tail of well-connected nodes
 *
 * The previous graph goes by dropping the table and creating it again. Overwriting without
 * clearing looked idempotent and was not: node metas were replaced but stale *edge* items
 * survived, so a node's stored `degree` stopped matching the edges in its partition and
 * reads returned more neighbours than the node claimed to have. Deleting item by item fixed
 * that and left its own gap — a run interrupted before the index landed orphaned whatever
 * it had already written. Nothing outlives the table it lived in, so dropping closes both.
 *
 * That only works because the table is the graph's alone
 * (docs/decisions/0007-a-table-for-the-graph.md), and it is the one destructive thing here:
 * outside DynamoDB Local it refuses to run without GRAPH_SEED_DROP=1.
 */
import {
  CreateTableCommand,
  DeleteTableCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb"
import { BatchWriteCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import {
  db,
  rawClient,
  GRAPH_TABLE_NAME,
  describeTarget,
  isLocal,
} from "../db/client.js"
import { GRAPH_KEYS as KEYS, graphTableDefinition } from "./table.js"
import {
  INDEX_PK,
  LABEL_OWNER_SK,
  META_SK,
  edgeSk,
  labelBucket,
  labelPk,
  labelSort,
  normaliseLabel,
  nodePk,
} from "./keys.js"
import { degrees, generate } from "./generate.js"

/** DynamoDB's hard cap on a single BatchWriteItem request. */
const BATCH_MAX = 25

const num = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim()
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

type Item = Record<string, unknown>

async function submit(requests: { PutRequest: { Item: Item } }[]): Promise<void> {
  let pending = requests
  // BatchWrite can decline part of a batch under throttling and hands the rest back
  // rather than failing. Local never does this; real DynamoDB does.
  for (let attempt = 0; pending.length > 0 && attempt < 8; attempt++) {
    const res = await db.send(
      new BatchWriteCommand({ RequestItems: { [GRAPH_TABLE_NAME]: pending } }),
    )
    pending = (res.UnprocessedItems?.[GRAPH_TABLE_NAME] ?? []) as typeof pending
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

/**
 * Drop the graph table and build it again from the same definition `ddb:migrate` uses.
 *
 * Both waiters are load-bearing against real DynamoDB, where the two calls are asynchronous
 * and creating a table still being deleted fails. Local completes them near-instantly.
 */
async function recreateTable(): Promise<void> {
  try {
    await rawClient.send(new DeleteTableCommand({ TableName: GRAPH_TABLE_NAME }))
    await waitUntilTableNotExists(
      { client: rawClient, maxWaitTime: 300 },
      { TableName: GRAPH_TABLE_NAME },
    )
    console.log(`  dropped ${GRAPH_TABLE_NAME}`)
  } catch (err) {
    // Nothing to drop on a first run, which is not a failure.
    if (!(err instanceof ResourceNotFoundException)) throw err
  }

  await rawClient.send(new CreateTableCommand(graphTableDefinition))
  await waitUntilTableExists(
    { client: rawClient, maxWaitTime: 300 },
    { TableName: GRAPH_TABLE_NAME },
  )
  console.log(`  created ${GRAPH_TABLE_NAME}`)
}

async function main(): Promise<void> {
  const n = num("GRAPH_N", 600)
  const k = num("GRAPH_K", 10)
  const p = num("GRAPH_P", 0.08)
  const seed = num("GRAPH_SEED", 20260729)
  // A fifth of the graph, scaled to n rather than fixed: a walk should meet a hub every
  // few steps. At a fiftieth it met one and then wandered through nothing but the mean
  // for the rest of the session, which made the root look like the only node worth
  // seeing. Raising GRAPH_N must not bring that back.
  const hubs = num("GRAPH_HUBS", Math.max(1, Math.round(n / 5)))
  const hubK = num("GRAPH_HUB_K", 20)

  // Dropping a table is not deleting rows, and the command that does it reads the same
  // either way. Somewhere with real data has to say so out loud.
  if (!isLocal && process.env["GRAPH_SEED_DROP"] !== "1") {
    throw new Error(
      `refusing to drop ${GRAPH_TABLE_NAME} outside DynamoDB Local — ` +
        "set GRAPH_SEED_DROP=1 if that is really what you want",
    )
  }

  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)
  console.log(
    `  generating n=${n} k=${k} p=${p} seed=${seed} hubs=${hubs} hubK=${hubK}`,
  )

  const graph = generate({ n, k, p, seed, hubs, hubK })
  const degree = degrees(graph)

  // Every label claims a partition, so two nodes sharing one would leave a claim pointing
  // at whichever was written last and the other unreachable by name. BatchWrite cannot
  // carry the condition that would catch it, and one conditional put per node is one round
  // trip per node — so the check happens here, before anything is written.
  const items: Item[] = []
  const claimed = new Map<string, string>()
  for (const node of graph.nodes) {
    const taken = claimed.get(normaliseLabel(node.label))
    if (taken) {
      throw new Error(
        `two nodes share the label "${node.label}": ${taken} and ${node.id}`,
      )
    }
    claimed.set(normaliseLabel(node.label), node.id)

    items.push({
      [KEYS.pk]: nodePk(node.id),
      [KEYS.sk]: META_SK,
      label: node.label,
      degree: degree.get(node.id) ?? 0,
      // Only the meta items carry these, which is the whole of what keeps the label
      // index to one entry per node.
      [KEYS.labelBucket]: labelBucket(node.label),
      [KEYS.labelSort]: labelSort(node.label, node.id),
    })
    items.push({
      [KEYS.pk]: labelPk(node.label),
      [KEYS.sk]: LABEL_OWNER_SK,
      nodeId: node.id,
      label: node.label,
    })
  }

  // Both directions, so a walk arriving from either end reads one partition.
  for (const [a, b] of graph.edges) {
    items.push({ [KEYS.pk]: nodePk(a), [KEYS.sk]: edgeSk(b) })
    items.push({ [KEYS.pk]: nodePk(b), [KEYS.sk]: edgeSk(a) })
  }

  if (!isLocal) console.log("  recreating the table (tens of seconds against AWS)…")
  await recreateTable()

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
      TableName: GRAPH_TABLE_NAME,
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
  console.error("✗ seed failed:", err instanceof Error ? err.message : err)
  process.exit(1)
})
