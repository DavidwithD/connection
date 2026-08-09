/**
 * The graph's own table.
 *
 * Every item here belongs to one graph: the nodes, their adjacency, the starting point,
 * and one claim per label. Nothing else shares it — see
 * docs/decisions/0007-a-table-for-the-graph.md for why this is not the single overloaded
 * table it grew out of.
 *
 * Two consequences fall out of the table being the graph's alone, and both are the point:
 * clearing it is dropping it, and neither index needs a trick to stay sparse. Edge items
 * carry no label, so only the node metas are ever in `label`; and only a component's root
 * carries the island keys, so `island` holds one row per component rather than per node.
 */
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
      // largest island first — see docs/decisions/0019-every-island-has-an-address.md.
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
