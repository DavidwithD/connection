/** The general table, and the registry `migrate` reads. */
import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb"
import { graphTableDefinition } from "../graph/table.js"
import { TABLE_NAME } from "./client.js"

/** Attribute names, centralised so queries never hardcode string literals. */
export const KEYS = {
  pk: "pk",
  sk: "sk",
  gsi1pk: "gsi1pk",
  gsi1sk: "gsi1sk",
} as const

export const GSI1_NAME = "gsi1"

export const tableDefinition: CreateTableCommandInput = {
  TableName: TABLE_NAME,

  KeySchema: [
    { AttributeName: KEYS.pk, KeyType: "HASH" },
    { AttributeName: KEYS.sk, KeyType: "RANGE" },
  ],

  // Only key attributes are declared — never the item's other fields.
  AttributeDefinitions: [
    { AttributeName: KEYS.pk, AttributeType: "S" },
    { AttributeName: KEYS.sk, AttributeType: "S" },
    { AttributeName: KEYS.gsi1pk, AttributeType: "S" },
    { AttributeName: KEYS.gsi1sk, AttributeType: "S" },
  ],

  GlobalSecondaryIndexes: [
    {
      // The standard "inverted / overloaded" index: lets you query the same
      // items by a second dimension. Items that omit gsi1pk are simply absent
      // from this index, which is how you keep it sparse and cheap.
      IndexName: GSI1_NAME,
      KeySchema: [
        { AttributeName: KEYS.gsi1pk, KeyType: "HASH" },
        { AttributeName: KEYS.gsi1sk, KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
  ],

  // On-demand: no capacity planning, and the right default until traffic has a
  // shape worth provisioning against. DynamoDB Local accepts it and ignores it.
  BillingMode: "PAY_PER_REQUEST",
}

/** Every table this project owns. Add new tables here so migrate picks them up. */
export const allTables: CreateTableCommandInput[] = [tableDefinition, graphTableDefinition]
