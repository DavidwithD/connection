/**
 * Join two existing nodes, named by their labels.
 *
 *   npm run graph:edge -- "Kavara" "Miselin"
 *   npm run graph:edge -- "Kavara-Miselin"
 *
 * The first write outside the seed, and the reason it is a transaction rather than four
 * puts: `degree` on the meta item is what tells a reader whether it has seen all of a
 * node's edges (src/graph/repo.ts), so an edge item that lands without its increment — or
 * an increment that lands twice — makes the store lie about how much graph is left. Five
 * operations, all or none.
 *
 * See docs/decisions/0009-the-first-write-outside-the-seed.md.
 */
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb"
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME, describeTarget } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import { INDEX_PK, META_SK, edgeSk, nodePk, type NodeMeta } from "./keys.js"
import { resolveLabel } from "./labels.js"

const USAGE = 'usage: npm run graph:edge -- "<label>" "<label>"'

/**
 * Two labels from the command line.
 *
 * Two arguments is the form that always works. The single `"A-B"` string is accepted only
 * when exactly one hyphen is present — with two there is no way to tell which one joins the
 * names and which one belongs to a name.
 */
export function parseArgs(argv: string[]): [string, string] {
  if (argv.length === 2) return [argv[0]!, argv[1]!]

  if (argv.length === 1) {
    const parts = argv[0]!.split("-")
    if (parts.length === 2 && parts[0]!.trim() && parts[1]!.trim()) {
      return [parts[0]!.trim(), parts[1]!.trim()]
    }
    throw new Error(
      `cannot tell where "${argv[0]!}" splits — pass the two labels as two arguments`,
    )
  }

  throw new Error(USAGE)
}

/** Positions in the transaction below, so a cancellation can be read back into English. */
const REASONS = [
  "they are already joined",
  "they are already joined",
  "no such node",
  "no such node",
  "no graph seeded — run npm run graph:seed",
]

async function resolve(label: string): Promise<NodeMeta> {
  const node = await resolveLabel(label)
  if (!node) throw new Error(`no node is called "${label}"`)
  return node
}

export async function addEdge(a: NodeMeta, b: NodeMeta): Promise<void> {
  await db.send(
    new TransactWriteCommand({
      TransactItems: [
        // The conditions are what make a second run a no-op instead of a double count.
        {
          Put: {
            TableName: GRAPH_TABLE_NAME,
            Item: { [KEYS.pk]: nodePk(a.id), [KEYS.sk]: edgeSk(b.id) },
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: { "#pk": KEYS.pk },
          },
        },
        {
          Put: {
            TableName: GRAPH_TABLE_NAME,
            Item: { [KEYS.pk]: nodePk(b.id), [KEYS.sk]: edgeSk(a.id) },
            ConditionExpression: "attribute_not_exists(#pk)",
            ExpressionAttributeNames: { "#pk": KEYS.pk },
          },
        },
        ...[a, b].map((node) => ({
          Update: {
            TableName: GRAPH_TABLE_NAME,
            Key: { [KEYS.pk]: nodePk(node.id), [KEYS.sk]: META_SK },
            UpdateExpression: "SET #degree = if_not_exists(#degree, :zero) + :one",
            ConditionExpression: "attribute_exists(#pk)",
            ExpressionAttributeNames: { "#pk": KEYS.pk, "#degree": "degree" },
            ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
          },
        })),
        {
          Update: {
            TableName: GRAPH_TABLE_NAME,
            Key: { [KEYS.pk]: INDEX_PK, [KEYS.sk]: META_SK },
            UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one",
            ConditionExpression: "attribute_exists(#pk)",
            ExpressionAttributeNames: { "#pk": KEYS.pk, "#count": "edgeCount" },
            ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
          },
        },
      ],
    }),
  )
}

/** Which of the five conditions refused, said in terms of the graph rather than the keys. */
function explain(err: TransactionCanceledException): string {
  const failed = (err.CancellationReasons ?? []).findIndex(
    (reason) => reason.Code === "ConditionalCheckFailed",
  )
  return failed >= 0 ? REASONS[failed] ?? err.message : err.message
}

async function main(): Promise<void> {
  const [labelA, labelB] = parseArgs(process.argv.slice(2))

  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)

  const [a, b] = await Promise.all([resolve(labelA), resolve(labelB)])

  // A transaction cannot touch the same item twice, so this would fail as a cancellation
  // several steps from anything a reader could act on. The graph has no self-edges anyway.
  if (a.id === b.id) throw new Error(`"${labelA}" and "${labelB}" are the same node`)

  try {
    await addEdge(a, b)
  } catch (err) {
    if (err instanceof TransactionCanceledException) throw new Error(explain(err))
    throw err
  }

  console.log(
    `✓ joined ${a.label} (${a.id}, now ${String(a.degree + 1)}) ` +
      `and ${b.label} (${b.id}, now ${String(b.degree + 1)})`,
  )
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
