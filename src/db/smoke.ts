/**
 * End-to-end check of the wiring, and a worked example of each core operation. Writes to a
 * `smoke#<run>` partition and deletes it afterwards.
 */
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb"
import { db, TABLE_NAME, describeTarget } from "./client.js"
import { GSI1_NAME, KEYS } from "./tables.js"

const run = `smoke#${process.pid}`

function check(label: string, ok: boolean): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`)
  if (!ok) throw new Error(`smoke check failed: ${label}`)
}

async function main(): Promise<void> {
  console.log(`→ ${describeTarget()}\n`)

  // --- put -----------------------------------------------------------------
  await db.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        [KEYS.pk]: run,
        [KEYS.sk]: "item#1",
        [KEYS.gsi1pk]: `${run}#byKind`,
        [KEYS.gsi1sk]: "kind#alpha",
        name: "first",
        count: 1,
        nested: { works: true, tags: ["a", "b"] },
      },
    }),
  )
  check("put an item", true)

  // --- get -----------------------------------------------------------------
  const got = await db.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { [KEYS.pk]: run, [KEYS.sk]: "item#1" },
      ConsistentRead: true,
    }),
  )
  check("get it back with fields intact", got.Item?.name === "first")
  check("nested objects round-trip", got.Item?.nested?.works === true)
  check("numbers stay numbers", typeof got.Item?.count === "number")

  // --- batch write ---------------------------------------------------------
  await db.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: [2, 3].map((n) => ({
          PutRequest: {
            Item: {
              [KEYS.pk]: run,
              [KEYS.sk]: `item#${n}`,
              [KEYS.gsi1pk]: `${run}#byKind`,
              [KEYS.gsi1sk]: `kind#${n === 2 ? "alpha" : "beta"}`,
              name: `number ${n}`,
            },
          },
        })),
      },
    }),
  )
  check("batch-write two more", true)

  // --- query the table -----------------------------------------------------
  const byPartition = await db.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": KEYS.pk },
      ExpressionAttributeValues: { ":pk": run },
      ConsistentRead: true,
    }),
  )
  check(`query partition returns 3 items (got ${byPartition.Count})`, byPartition.Count === 3)

  // --- query the GSI -------------------------------------------------------
  // GSIs are eventually consistent and cannot take ConsistentRead, so retry
  // briefly rather than flaking on a fresh write.
  let gsiCount = 0
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await db.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1_NAME,
        KeyConditionExpression: "#gpk = :gpk AND begins_with(#gsk, :prefix)",
        ExpressionAttributeNames: { "#gpk": KEYS.gsi1pk, "#gsk": KEYS.gsi1sk },
        ExpressionAttributeValues: { ":gpk": `${run}#byKind`, ":prefix": "kind#alpha" },
      }),
    )
    gsiCount = res.Count ?? 0
    if (gsiCount === 2) break
    await new Promise((r) => setTimeout(r, 200))
  }
  check(`query ${GSI1_NAME} with begins_with returns 2 items (got ${gsiCount})`, gsiCount === 2)

  // --- conditional write ---------------------------------------------------
  let rejected = false
  try {
    await db.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: { [KEYS.pk]: run, [KEYS.sk]: "item#1", name: "should not land" },
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": KEYS.pk },
      }),
    )
  } catch (err) {
    rejected = (err as Error).name === "ConditionalCheckFailedException"
  }
  check("conditional write is rejected on an existing item", rejected)

  // --- cleanup -------------------------------------------------------------
  for (const item of byPartition.Items ?? []) {
    await db.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { [KEYS.pk]: item[KEYS.pk], [KEYS.sk]: item[KEYS.sk] },
      }),
    )
  }
  const after = await db.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": KEYS.pk },
      ExpressionAttributeValues: { ":pk": run },
      ConsistentRead: true,
    }),
  )
  check("cleanup left nothing behind", after.Count === 0)

  console.log("\nAll checks passed — DynamoDB is ready.")
}

main().catch((err: unknown) => {
  console.error("\nSmoke test failed:")
  console.error(err)
  process.exit(1)
})
