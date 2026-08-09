/**
 * Generate a small-world graph and write it to the graph table.
 *
 *   npm run graph:seed              # default size
 *   GRAPH_N=2000 GRAPH_K=8 npm run graph:seed
 *   GRAPH_HUB_K=25 npm run graph:seed   # a longer tail of well-connected nodes
 *
 * The previous graph goes by dropping the table and creating it again, which is the one
 * destructive thing here: outside DynamoDB Local it refuses to run without
 * GRAPH_SEED_DROP=1. Why a drop rather than a delete pass is in src/graph/bulk.ts, with the
 * code that does it — `graph:restore` rebuilds the same way.
 *
 * A seed run replaces whatever was there, including nodes made by hand since the last one.
 * `npm run graph:export` takes those out first; see src/graph/export.ts.
 */
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { db, GRAPH_TABLE_NAME, describeTarget, isLocal } from "../db/client.js"
import { GRAPH_KEYS as KEYS } from "./table.js"
import { guardDrop, recreateTable, writeAll, type Item } from "./bulk.js"
import { guardHandmade } from "./export.js"
import { pickRoot } from "./restore.js"
import {
  INDEX_PK,
  LABEL_OWNER_SK,
  META_SK,
  edgeSk,
  islandBucket,
  islandSort,
  labelBucket,
  labelPk,
  labelSort,
  normaliseLabel,
  nodePk,
} from "./keys.js"
import { degrees, generate } from "./generate.js"
import { components } from "./islands.js"

const num = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim()
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

async function main(): Promise<void> {
  const n = num("GRAPH_N", 600)
  const k = num("GRAPH_K", 10)
  const p = num("GRAPH_P", 0.08)
  const seed = num("GRAPH_SEED", 20260729)
  // A fifth of the graph, scaled to n rather than fixed: a walk should meet a hub every
  // few steps. At a fiftieth it met one and then wandered through nothing but the mean
  // for the rest of the session, which made the root look like the only node worth
  // seeing. Raising GRAPH_N must not bring that back.
  const hubs = num("GRAPH_HUBS", Math.max(1, Math.round(n / 5)))
  const hubK = num("GRAPH_HUB_K", 20)

  guardDrop(isLocal, "GRAPH_SEED_DROP")

  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)

  // Before anything is generated, because the answer can be "do not run this at all". The
  // guard above asks whether the *target* may be dropped; this asks whether what is in it
  // can be rebuilt, which is the question that matters on a local table.
  await guardHandmade("GRAPH_SEED_DROP")
  console.log(
    `  generating n=${n} k=${k} p=${p} seed=${seed} hubs=${hubs} hubK=${hubK}`,
  )

  const graph = generate({ n, k, p, seed, hubs, hubK })
  const degree = degrees(graph)
  // Components, from the edge list already in hand — no store access, and the answer is
  // exact rather than maintained. A rewired ring lattice comes out as one, but nothing here
  // assumes that: the generator is free to change, and the reckoning would find it anyway.
  const { parent, sizes } = components(
    graph.nodes.map((node) => node.id),
    graph.edges,
  )

  // Every label claims a partition, so two nodes sharing one would leave a claim pointing
  // at whichever was written last and the other unreachable by name. BatchWrite cannot
  // carry the condition that would catch it, and one conditional put per node is one round
  // trip per node — so the check happens here, before anything is written.
  const items: Item[] = []
  const claimed = new Map<string, string>()
  for (const node of graph.nodes) {
    const taken = claimed.get(normaliseLabel(node.label))
    if (taken) {
      throw new Error(
        `two nodes share the label "${node.label}": ${taken} and ${node.id}`,
      )
    }
    claimed.set(normaliseLabel(node.label), node.id)

    const size = sizes.get(node.id)
    items.push({
      [KEYS.pk]: nodePk(node.id),
      [KEYS.sk]: META_SK,
      label: node.label,
      degree: degree.get(node.id) ?? 0,
      // Only the meta items carry these, which is the whole of what keeps the label
      // index to one entry per node.
      [KEYS.labelBucket]: labelBucket(node.label),
      [KEYS.labelSort]: labelSort(node.label, node.id),
      parent: parent.get(node.id) ?? node.id,
      // And only a root carries these, which is what keeps the island index to one entry
      // per component. `sizes` holds a count for roots alone, so its own keys are the test.
      ...(size === undefined
        ? {}
        : {
            [KEYS.islandBucket]: islandBucket(),
            [KEYS.islandSort]: islandSort(size, node.id),
          }),
    })
    items.push({
      [KEYS.pk]: labelPk(node.label),
      [KEYS.sk]: LABEL_OWNER_SK,
      nodeId: node.id,
      label: node.label,
    })
  }

  // Both directions, so a walk arriving from either end reads one partition.
  for (const [a, b] of graph.edges) {
    items.push({ [KEYS.pk]: nodePk(a), [KEYS.sk]: edgeSk(b) })
    items.push({ [KEYS.pk]: nodePk(b), [KEYS.sk]: edgeSk(a) })
  }

  if (!isLocal) console.log("  recreating the table (tens of seconds against AWS)…")
  await recreateTable()

  console.log(
    `  ${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
      `${sizes.size} island(s): ${[...sizes.values()].sort((a, b) => b - a).join(", ")}`,
  )
  await writeAll(items, "wrote")

  // The best-connected node makes the most interesting centre, and the client should
  // not have to Scan to find one. Written last, so it also marks a completed run.
  // `pickRoot` rather than a copy of it: the reckoning uses the same function, and until it
  // did, the two picked different nodes out of a tie and drifted apart every seed run.
  const rootId = pickRoot(degree)

  await db.send(
    new PutCommand({
      TableName: GRAPH_TABLE_NAME,
      Item: {
        [KEYS.pk]: INDEX_PK,
        [KEYS.sk]: META_SK,
        rootId,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
      },
    }),
  )

  console.log(`✓ seeded. root=${rootId} (degree ${degree.get(rootId) ?? 0})`)
}

main().catch((err: unknown) => {
  console.error("✗ seed failed:", err instanceof Error ? err.message : err)
  process.exit(1)
})
