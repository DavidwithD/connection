/**
 * Join two existing nodes, and part them again.
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
 * `removeEdge` is the same five in reverse, and it is constrained from the other side: an
 * edge item deleted without its decrement leaves a degree counting something that is gone,
 * and the node claims graph behind it that nobody can ever read. Deleting an edge that was
 * never there must not lower a degree either, which is what the conditions are for.
 *
 * Both are shared with the routes, so everything a caller has to get right lives inside
 * them: the self-edge guard, and turning a cancellation into a sentence. The browser gets
 * the same refusals the terminal does.
 *
 * See docs/decisions/0009-the-first-write-outside-the-seed.md,
 * docs/decisions/0010-writing-to-the-graph-from-the-browser.md and
 * docs/decisions/0011-taking-a-write-back.md.
 */
import { pathToFileURL } from "node:url"
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb"
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME, describeTarget } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import { INDEX_PK, META_SK, edgeSk, nodePk, type NodeMeta } from "./keys.js"
import { resolveLabel } from "./labels.js"
import { Refused, reasonFor } from "./refused.js"

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

/** Positions in the join below, so a cancellation can be read back into English. */
const JOIN_REASONS = [
  "they are already joined",
  "they are already joined",
  "no such node",
  "no such node",
  "no graph seeded — run npm run graph:seed",
]

/** The same five positions, refusing for the opposite reasons. */
const PART_REASONS = [
  "they are not joined",
  "they are not joined",
  "no such node",
  "no such node",
  "no graph seeded — run npm run graph:seed",
]

async function resolve(label: string): Promise<NodeMeta> {
  const node = await resolveLabel(label)
  if (!node) throw new Error(`no node is called "${label}"`)
  return node
}

/**
 * Ids, not metas: the transaction addresses items by key, and a caller holding only an id
 * should not have to invent a degree to satisfy the signature.
 */
export async function addEdge(aId: string, bId: string): Promise<void> {
  // A transaction cannot touch the same item twice, so this would otherwise fail as a
  // cancellation several steps from anything a caller could act on. The graph has no
  // self-edges anyway. Guarded here rather than in either caller, so both are covered.
  if (aId === bId) throw new Refused("a node cannot be joined to itself")

  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          // The conditions are what make a second run a no-op instead of a double count.
          ...[
            [aId, bId],
            [bId, aId],
          ].map(([from, to]) => ({
            Put: {
              TableName: GRAPH_TABLE_NAME,
              Item: { [KEYS.pk]: nodePk(from!), [KEYS.sk]: edgeSk(to!) },
              ConditionExpression: "attribute_not_exists(#pk)",
              ExpressionAttributeNames: { "#pk": KEYS.pk },
            },
          })),
          ...[aId, bId].map((id) => ({
            Update: {
              TableName: GRAPH_TABLE_NAME,
              Key: { [KEYS.pk]: nodePk(id), [KEYS.sk]: META_SK },
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
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      throw new Refused(reasonFor(err.CancellationReasons, JOIN_REASONS, err.message))
    }
    throw err
  }
}

/**
 * Part two nodes. The join above, read backwards.
 *
 * Position for position with `addEdge`, deliberately: the same five items in the same
 * order, so the reason tables line up and a reader can hold both in mind at once. The
 * conditions carry the weight again. Deleting an edge item that is not there would lower
 * two degrees for nothing, and a degree short of its edges is the one state a reader
 * cannot detect — it simply stops asking for graph that exists.
 */
export async function removeEdge(aId: string, bId: string): Promise<void> {
  if (aId === bId) throw new Refused("a node cannot be joined to itself")

  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          ...[
            [aId, bId],
            [bId, aId],
          ].map(([from, to]) => ({
            Delete: {
              TableName: GRAPH_TABLE_NAME,
              Key: { [KEYS.pk]: nodePk(from!), [KEYS.sk]: edgeSk(to!) },
              ConditionExpression: "attribute_exists(#pk)",
              ExpressionAttributeNames: { "#pk": KEYS.pk },
            },
          })),
          ...[aId, bId].map((id) => ({
            Update: {
              TableName: GRAPH_TABLE_NAME,
              Key: { [KEYS.pk]: nodePk(id), [KEYS.sk]: META_SK },
              UpdateExpression: "SET #degree = #degree - :one",
              // Never below zero. A degree that went negative would make `missing`
              // meaningless for that node for the rest of the graph's life.
              ConditionExpression: "attribute_exists(#pk) AND #degree >= :one",
              ExpressionAttributeNames: { "#pk": KEYS.pk, "#degree": "degree" },
              ExpressionAttributeValues: { ":one": 1 },
            },
          })),
          {
            Update: {
              TableName: GRAPH_TABLE_NAME,
              Key: { [KEYS.pk]: INDEX_PK, [KEYS.sk]: META_SK },
              UpdateExpression: "SET #count = #count - :one",
              ConditionExpression: "attribute_exists(#pk) AND #count >= :one",
              ExpressionAttributeNames: { "#pk": KEYS.pk, "#count": "edgeCount" },
              ExpressionAttributeValues: { ":one": 1 },
            },
          },
        ],
      }),
    )
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      throw new Refused(reasonFor(err.CancellationReasons, PART_REASONS, err.message))
    }
    throw err
  }
}

async function main(): Promise<void> {
  const [labelA, labelB] = parseArgs(process.argv.slice(2))

  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)

  const [a, b] = await Promise.all([resolve(labelA), resolve(labelB)])

  await addEdge(a.id, b.id)

  console.log(
    `✓ joined ${a.label} (${a.id}, now ${String(a.degree + 1)}) ` +
      `and ${b.label} (${b.id}, now ${String(b.degree + 1)})`,
  )
}

// Only when this file *is* the command. The API imports `addEdge` from here, and an
// unguarded main() would run on that import, fail to parse the server's argv, and exit the
// process before it ever served anything.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
