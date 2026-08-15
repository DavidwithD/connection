/** The graph's own table, its label index and its island index. Nothing else shares it. */
import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb"
import { GRAPH_TABLE_NAME } from "../db/client.js"

/** Attribute names, centralised so queries never hardcode string literals. */
export const GRAPH_KEYS = {
  pk: "pk",
  sk: "sk",
  labelBucket: "labelBucket",
  labelSort: "labelSort",
  islandBucket: "islandBucket",
  islandSort: "islandSort",
} as const

/** Named for what they answer, which a graph-only table can afford. */
export const LABEL_INDEX = "label"
export const ISLAND_INDEX = "island"

export const graphTableDefinition: CreateTableCommandInput = {
  TableName: GRAPH_TABLE_NAME,

  KeySchema: [
    { AttributeName: GRAPH_KEYS.pk, KeyType: "HASH" },
    { AttributeName: GRAPH_KEYS.sk, KeyType: "RANGE" },
  ],

  AttributeDefinitions: [
    { AttributeName: GRAPH_KEYS.pk, AttributeType: "S" },
    { AttributeName: GRAPH_KEYS.sk, AttributeType: "S" },
    { AttributeName: GRAPH_KEYS.labelBucket, AttributeType: "S" },
    { AttributeName: GRAPH_KEYS.labelSort, AttributeType: "S" },
    { AttributeName: GRAPH_KEYS.islandBucket, AttributeType: "S" },
    { AttributeName: GRAPH_KEYS.islandSort, AttributeType: "S" },
  ],

  GlobalSecondaryIndexes: [
    {
      // Labels, bucketed by first character so a prefix query hits one partition and a
      // `begins_with` on the sort key does the rest. Projects everything, so a hit already
      // carries the label and the degree and no second read is needed to show a result.
      IndexName: LABEL_INDEX,
      KeySchema: [
        { AttributeName: GRAPH_KEYS.labelBucket, KeyType: "HASH" },
        { AttributeName: GRAPH_KEYS.labelSort, KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
    {
      // Components, one entry per component: only a union-find root carries these two
      // attributes, so the index holds a row per island rather than per node. One bucket,
      // because the whole point is a single Query returning all of them and there are as
      // many as there are components. Sorted by size, so a descending read offers the
      // largest island first.
      IndexName: ISLAND_INDEX,
      KeySchema: [
        { AttributeName: GRAPH_KEYS.islandBucket, KeyType: "HASH" },
        { AttributeName: GRAPH_KEYS.islandSort, KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
  ],

  BillingMode: "PAY_PER_REQUEST",
}
