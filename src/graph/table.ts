/**
 * The graph's own table.
 *
 * Every item here belongs to one graph: the nodes, their adjacency, the starting point,
 * and one claim per label. Nothing else shares it — see
 * docs/decisions/0007-a-table-for-the-graph.md for why this is not the single overloaded
 * table it grew out of.
 *
 * Two consequences fall out of the table being the graph's alone, and both are the point:
 * clearing it is dropping it, and the label index needs no trick to stay sparse — edge
 * items carry no label, so only the node metas are ever in it.
 */
import type { CreateTableCommandInput } from "@aws-sdk/client-dynamodb"
import { GRAPH_TABLE_NAME } from "../db/client.js"

/** Attribute names, centralised so queries never hardcode string literals. */
export const GRAPH_KEYS = {
  pk: "pk",
  sk: "sk",
  labelBucket: "labelBucket",
  labelSort: "labelSort",
} as const

/** Named for what it answers, which a graph-only table can afford. */
export const LABEL_INDEX = "label"

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
  ],

  BillingMode: "PAY_PER_REQUEST",
}
