/**
 * Key layout for the graph, on the table from
 * docs/decisions/0007-a-table-for-the-graph.md.
 *
 * Two item kinds share a node's partition, so one Query returns a node together
 * with its whole adjacency list:
 *
 *   pk=node#<id>  sk=#meta         { label, degree }
 *   pk=node#<id>  sk=edge#<other>  -- one item per direction
 *
 * A third kind gives a label its own partition, so a name resolves to a node without
 * reading anything else:
 *
 *   pk=label#<normalised>  sk=#owner  { nodeId, label }
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
 * Scan for somewhere to begin, and a Scan is the thing this key design treats as the
 * signal that it has gone wrong.
 */
export const INDEX_PK = "graph#index"

/**
 * Labels, as an address — see docs/decisions/0008-finding-a-node-by-name.md.
 *
 * Two shapes, because exact and prefix want different keys. The claim item below has the
 * label in its *partition* key, so resolving a name is one strongly-consistent GetItem and
 * a conditional put on it is what keeps a label pointing at one node. The index keys are
 * stamped on the meta item and put the label in the *sort* key, which is the only place
 * `begins_with` can reach it — bucketed by first character so a prefix query still lands
 * on one partition.
 *
 * Normalising is deliberately shallow: case, surrounding space, and runs of whitespace.
 * Nothing folds diacritics, so `Zoë` and `Zoe` are two labels, not one.
 */
const LABEL_PREFIX = "label#"

export const normaliseLabel = (label: string): string =>
  label.trim().toLowerCase().replace(/\s+/g, " ")

/** The partition a label owns. One item lives in it, and it names the node. */
export const labelPk = (label: string): string => `${LABEL_PREFIX}${normaliseLabel(label)}`

export const LABEL_OWNER_SK = "#owner"

/**
 * Which bucket of the label index a name sits in.
 *
 * A prefix search always knows its own first character, so bucketing by it costs the
 * caller nothing and keeps any one partition to a fraction of the labels. Anything not a
 * plain letter or digit shares `_` rather than inventing a bucket per symbol.
 */
export const labelBucket = (label: string): string => {
  const first = normaliseLabel(label).slice(0, 1)
  return `${LABEL_PREFIX}${/[a-z0-9]/.test(first) ? first : "_"}`
}

/** The id rides along so a hit needs no second read to say which node it found. */
export const labelSort = (label: string, id: string): string =>
  `${normaliseLabel(label)}#${id}`

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
