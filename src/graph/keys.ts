/**
 * Key layout for nodes, edges, labels and components.
 *
 *   pk=node#<id>           sk=#meta           { label, degree, parent, index keys }
 *   pk=node#<id>           sk=edge#<other>    one item per direction
 *   pk=label#<normalised>  sk=#owner          { nodeId, label }
 */

const NODE_PREFIX = "node#"

export const nodePk = (id: string): string => `${NODE_PREFIX}${id}`

/** Recover the node id from a partition key. */
export const nodeId = (pk: string): string => pk.slice(NODE_PREFIX.length)

/**
 * The two id shapes, named together: a change to either one alone reclassifies a graph.
 */
const MADE_PREFIX = "n-"

/** Made one at a time, by the command or the API. */
export const isMadeId = (id: string): boolean => id.startsWith(MADE_PREFIX)

/** Written by a seed run. Deliberately not `!isMadeId` — an id of neither shape is a
 * question, not a seed node, and the export refuses rather than guessing. */
export const isSeedId = (id: string): boolean => /^n\d+$/.test(id)

export const madeId = (uuid: string): string => `${MADE_PREFIX}${uuid}`

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

/** Labels, as an address. Two shapes: the claim's partition key, and the index's sort key. */
const LABEL_PREFIX = "label#"

export const normaliseLabel = (label: string): string =>
  label.trim().toLowerCase().replace(/\s+/g, " ")

/** The partition a label owns. One item lives in it, and it names the node. */
export const labelPk = (label: string): string => `${LABEL_PREFIX}${normaliseLabel(label)}`

export const LABEL_OWNER_SK = "#owner"

/**
 * Which bucket of the label index a name sits in. Anything not a plain letter or digit
 * shares `_` rather than inventing a bucket per symbol.
 */
export const labelBucket = (label: string): string => {
  const first = normaliseLabel(label).slice(0, 1)
  return `${LABEL_PREFIX}${/[a-z0-9]/.test(first) ? first : "_"}`
}

/** The id rides along so a hit needs no second read to say which node it found. */
export const labelSort = (label: string, id: string): string =>
  `${normaliseLabel(label)}#${id}`

/** Components, as an address. Both keys below are stamped on roots alone. */
const ISLAND_BUCKET = "island"

export const islandBucket = (): string => ISLAND_BUCKET

/**
 * Size first, then the id to break ties. Six digits of padding: past any graph this demo
 * will hold, and enough that the key sorts as a number rather than as text.
 */
export const islandSort = (size: number, id: string): string =>
  `${String(Math.max(0, Math.trunc(size))).padStart(6, "0")}#${id}`

/** The size back out of a sort key, for a union that has to add two of them. */
export const islandSize = (sort: string): number => Number(sort.slice(0, sort.indexOf("#")))

export interface NodeMeta {
  id: string
  label: string
  /** True degree in the stored graph, not the count currently loaded. */
  degree: number
}

/** A component, named by its root. What the page offers as somewhere else to go. */
export interface IslandMeta extends NodeMeta {
  /** Nodes in the component, maintained by the union and repaired by the reckoning. */
  size: number
}

export interface GraphIndex {
  rootId: string
  nodeCount: number
  edgeCount: number
}

/** One undirected edge, canonicalised so a pair yields a single key. */
export const edgeKey = (a: string, b: string): string =>
  a < b ? `${a}~${b}` : `${b}~${a}`
