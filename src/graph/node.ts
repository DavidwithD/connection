/**
 * Create a node, by name.
 *
 *   npm run graph:node -- "Vessarin"
 *
 * The second write outside the seed, and the first that makes a node without destroying
 * the graph around it. Where `addEdge` protects a count, this protects a name: a label owns
 * its own partition (src/graph/keys.ts), and two nodes claiming one would leave the claim
 * pointing at whichever landed last with the other unreachable by name. The seed can check
 * that in memory before it writes, because it writes every node at once
 * (src/graph/seed.ts). Nothing here can, so the check is a condition on the claim itself —
 * which is the write ADR 0008 put the reservation item there to allow.
 *
 * Three operations, all or none: the claim, the node, and the count that describes it.
 *
 * See docs/decisions/0010-writing-to-the-graph-from-the-browser.md.
 */
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb"
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME, describeTarget } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import {
  INDEX_PK,
  LABEL_OWNER_SK,
  META_SK,
  islandBucket,
  islandSort,
  labelBucket,
  labelPk,
  labelSort,
  madeId,
  nodePk,
  normaliseLabel,
  type NodeMeta,
} from "./keys.js"
import { Refused, reasonFor } from "./refused.js"

const USAGE = 'usage: npm run graph:node -- "<label>"'

/** Positions in the create below, so a cancellation can be read back into English. */
const CREATE_REASONS = [
  "that name is taken",
  "that id is taken",
  "no graph seeded — run npm run graph:seed",
]

/** The same three positions, refusing for the opposite reasons. */
const DELETE_REASONS = [
  "that name is not claimed",
  "no such node, or it still has edges",
  "no graph seeded — run npm run graph:seed",
]

/**
 * A fresh id.
 *
 * The seed numbers its nodes `n0000` upward, which works because it knows all of them
 * before it writes any. Continuing that counter here would mean reading the highest id and
 * hoping nobody else did the same — a second round trip that still races. A random id needs
 * neither, and `nodeId` only slices a prefix, so the shape is free. Collision is refused by
 * the condition on the meta item rather than trusted away.
 *
 * The shape is not free of meaning, though: it is the only record that this node was made
 * here rather than by a seed run, which is what `graph:export` reads. `madeId` holds the
 * prefix beside the seed's own, in src/graph/keys.ts, so neither can move alone.
 */
const freshId = (): string => madeId(randomUUID())

export async function createNode(label: string): Promise<NodeMeta> {
  const name = label.trim().replace(/\s+/g, " ")
  // Normalising is what the claim key is built from, so a label that normalises to nothing
  // has no partition to own and could never be found again.
  if (!normaliseLabel(name)) throw new Refused("a node needs a name")

  const id = freshId()
  // Written exactly as the seed writes it (src/graph/seed.ts). The label index lives on
  // these two attributes alone, so a node missing them is invisible to search while still
  // being perfectly reachable by id — the kind of divergence nothing would report.
  const node: NodeMeta = { id, label: name, degree: 0 }

  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: GRAPH_TABLE_NAME,
              Item: {
                [KEYS.pk]: labelPk(name),
                [KEYS.sk]: LABEL_OWNER_SK,
                nodeId: id,
                label: name,
              },
              ConditionExpression: "attribute_not_exists(#pk)",
              ExpressionAttributeNames: { "#pk": KEYS.pk },
            },
          },
          {
            Put: {
              TableName: GRAPH_TABLE_NAME,
              Item: {
                [KEYS.pk]: nodePk(id),
                [KEYS.sk]: META_SK,
                label: name,
                degree: 0,
                [KEYS.labelBucket]: labelBucket(name),
                [KEYS.labelSort]: labelSort(name, id),
                // A node with no edges is a component of one, which is a fact and not a
                // guess — so the island keys go on here, in the item the transaction was
                // already writing, and this costs no extra operation. Everything else
                // about components is maintained after the fact (src/graph/islands.ts);
                // this is the one place the answer is known before the write.
                parent: id,
                [KEYS.islandBucket]: islandBucket(),
                [KEYS.islandSort]: islandSort(1, id),
              },
              ConditionExpression: "attribute_not_exists(#pk)",
              ExpressionAttributeNames: { "#pk": KEYS.pk },
            },
          },
          {
            Update: {
              TableName: GRAPH_TABLE_NAME,
              Key: { [KEYS.pk]: INDEX_PK, [KEYS.sk]: META_SK },
              UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one",
              ConditionExpression: "attribute_exists(#pk)",
              ExpressionAttributeNames: { "#pk": KEYS.pk, "#count": "nodeCount" },
              ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
            },
          },
        ],
      }),
    )
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      throw new Refused(reasonFor(err.CancellationReasons, CREATE_REASONS, err.message))
    }
    throw err
  }

  return node
}

/**
 * Delete a node. The create above, read backwards, and refused unless it stands alone.
 *
 * `degree = 0` is the load-bearing condition. Every edge is stored twice, so a node with
 * edges leaves half of each behind when it goes: an edge item in *another* node's partition
 * pointing at nothing, and that node's degree counting it. The orphan is unreachable — the
 * only way to find it is from the partition that just went — so nothing would ever repair
 * it, and the neighbour would claim graph behind it for good. Deleting the other half means
 * reading the adjacency first and writing a transaction whose size depends on the degree,
 * which is a different decision from this one.
 *
 * The label is read here rather than taken from the caller. It is what the claim's key is
 * built from, and a wrong one would delete the node while leaving its name held.
 */
export async function deleteNode(id: string, label: string): Promise<void> {
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: GRAPH_TABLE_NAME,
              Key: { [KEYS.pk]: labelPk(label), [KEYS.sk]: LABEL_OWNER_SK },
              ConditionExpression: "attribute_exists(#pk)",
              ExpressionAttributeNames: { "#pk": KEYS.pk },
            },
          },
          {
            Delete: {
              TableName: GRAPH_TABLE_NAME,
              Key: { [KEYS.pk]: nodePk(id), [KEYS.sk]: META_SK },
              ConditionExpression: "attribute_exists(#pk) AND #degree = :zero",
              ExpressionAttributeNames: { "#pk": KEYS.pk, "#degree": "degree" },
              ExpressionAttributeValues: { ":zero": 0 },
            },
          },
          {
            Update: {
              TableName: GRAPH_TABLE_NAME,
              Key: { [KEYS.pk]: INDEX_PK, [KEYS.sk]: META_SK },
              UpdateExpression: "SET #count = #count - :one",
              ConditionExpression: "attribute_exists(#pk) AND #count >= :one",
              ExpressionAttributeNames: { "#pk": KEYS.pk, "#count": "nodeCount" },
              ExpressionAttributeValues: { ":one": 1 },
            },
          },
        ],
      }),
    )
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      throw new Refused(reasonFor(err.CancellationReasons, DELETE_REASONS, err.message))
    }
    throw err
  }
}

async function main(): Promise<void> {
  const label = process.argv.slice(2).join(" ").trim()
  if (!label) throw new Error(USAGE)

  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)

  const node = await createNode(label)
  console.log(`✓ created ${node.label} (${node.id}), no edges yet`)
}

// Only when this file *is* the command. The API imports `createNode` from here, and an
// unguarded main() would run on that import, fail to parse the server's argv, and exit the
// process before it ever served anything.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
