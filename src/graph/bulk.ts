/**
 * Operations over the whole table: reading all of it, writing many items at once, and
 * clearing the table they go into.
 *
 * These began as the seed's and are now wanted by the commands that export, rebuild and
 * reconcile the graph. Held in one place because the reasoning below is the kind that gets
 * lost in a copy: the retry loop and the two waiters each exist for a failure that never
 * happens locally, so a second copy would look like dead code right up until it ran
 * against AWS.
 */
import {
  CreateTableCommand,
  DeleteTableCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb"
import { BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"
import { db, rawClient, GRAPH_TABLE_NAME } from "../db/client.js"
import { graphTableDefinition } from "./table.js"

/** DynamoDB's hard cap on a single BatchWriteItem request. */
const BATCH_MAX = 25

export type Item = Record<string, unknown>

/**
 * Every item in the table, paginated.
 *
 * A Scan, which the key design treats as the signal that something has gone wrong
 * (src/graph/repo.ts) — and that holds for anything serving a request. The commands here are
 * the exception it was never a rule for: reading the whole table *is* the job, and there is
 * no access pattern to design for because there is no pattern, only all of it.
 */
export async function scanAll(label: string | null = "read"): Promise<Item[]> {
  const items: Item[] = []
  let start: Record<string, unknown> | undefined
  do {
    const res = await db.send(
      new ScanCommand({ TableName: GRAPH_TABLE_NAME, ExclusiveStartKey: start }),
    )
    items.push(...((res.Items ?? []) as Item[]))
    start = res.LastEvaluatedKey
    // A null label is a caller with nowhere to put a line: the API serves this too, and a
    // progress line redrawn with \r belongs to a terminal somebody is watching, not to a log.
    if (label !== null && items.length) {
      process.stdout.write(`\r  ${label} ${String(items.length)} items`)
    }
  } while (start)
  if (label !== null && items.length) process.stdout.write("\n")
  return items
}

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

export async function writeAll(items: Item[], label: string): Promise<void> {
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
 * Overwriting without clearing looked idempotent and was not: node metas were replaced but
 * stale *edge* items survived, so a node's stored `degree` stopped matching the edges in its
 * partition and reads returned more neighbours than the node claimed to have. Deleting item
 * by item fixed that and left its own gap — a run interrupted before the index landed
 * orphaned whatever it had already written. Nothing outlives the table it lived in, so
 * dropping closes both.
 *
 * That only works because the table is the graph's alone
 * (docs/decisions/0007-a-table-for-the-graph.md). Both waiters are load-bearing against real
 * DynamoDB, where the two calls are asynchronous and creating a table still being deleted
 * fails. Local completes them near-instantly.
 */
export async function recreateTable(): Promise<void> {
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

/**
 * Refuse to drop a table that is not the local emulator's, unless told plainly.
 *
 * Dropping a table is not deleting rows, and the command that does it reads the same either
 * way. Somewhere with real data has to say so out loud, and each command names its own
 * variable so that permission to rebuild from an export is never permission to re-seed.
 */
export function guardDrop(isLocal: boolean, variable: string): void {
  if (isLocal || process.env[variable] === "1") return
  throw new Error(
    `refusing to drop ${GRAPH_TABLE_NAME} outside DynamoDB Local — ` +
      `set ${variable}=1 if that is really what you want`,
  )
}
