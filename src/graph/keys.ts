/**
 * Key layout for the graph demo, on the single table from
 * docs/decisions/0002-single-table-layout.md.
 *
 * Two item kinds share a node's partition, so one Query returns a node together
 * with its whole adjacency list:
 *
 *   pk=node#<id>  sk=#meta         { label, degree }
 *   pk=node#<id>  sk=edge#<other>  -- one item per direction
 *
 * The meta key is `#meta`, not `meta`: `#` sorts below `e`, so the node itself
 * always comes back ahead of its edges and a Query with a Limit can never return
 * a partition's edges while dropping the node they belong to.
 *
 * The graph is undirected, so each edge is stored twice. That doubles the writes
 * to buy a single-partition read from either end, which is the trade a graph
 * walked from arbitrary starting points wants. `degree` is denormalised onto the
 * meta item because the client needs it to know a node is incomplete — see
 * docs/decisions/0003-graph-exploration-demo-stack.md.
 */

const NODE_PREFIX = "node#"

export const nodePk = (id: string): string => `${NODE_PREFIX}${id}`

/** Recover the node id from a partition key. */
export const nodeId = (pk: string): string => pk.slice(NODE_PREFIX.length)

export const META_SK = "#meta"

export const EDGE_PREFIX = "edge#"

export const edgeSk = (otherId: string): string => `${EDGE_PREFIX}${otherId}`

/** Recover the neighbour id from an edge item's sort key. */
export const edgeTarget = (sk: string): string => sk.slice(EDGE_PREFIX.length)

/**
 * Where the seed records a starting point. Without it the client would have to
 * Scan for somewhere to begin, and a Scan is the thing ADR 0002 treats as the
 * signal that a key design has gone wrong.
 */
export const INDEX_PK = "graph#index"

export interface NodeMeta {
  id: string
  label: string
  /** True degree in the stored graph, not the count currently loaded. */
  degree: number
}

export interface GraphIndex {
  rootId: string
  nodeCount: number
  edgeCount: number
}

/** One undirected edge, canonicalised so a pair yields a single key. */
export const edgeKey = (a: string, b: string): string =>
  a < b ? `${a}~${b}` : `${b}~${a}`
