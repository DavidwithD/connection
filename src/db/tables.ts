/**
 * Table definition.
 *
 * This is a single-table design: one physical table holds every entity type,
 * distinguished by prefixed key values (`user#123` / `profile`) rather than by
 * separate tables. That is the idiomatic DynamoDB shape and it is also the only
 * honest choice right now — the product itself is still undefined (see
 * docs/decisions/0001-product-name.md), so declaring entity-specific tables
 * would be inventing a domain model we do not have yet.
 *
 * DynamoDB only requires *key* attributes to be declared. Everything else is
 * per-item and needs no migration, so this definition should stay stable even
 * as the domain takes shape. Adding an access pattern later usually means
 * adding a GSI here, not reshaping the table.
 */
import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb"
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
export const allTables: CreateTableCommandInput[] = [tableDefinition]
