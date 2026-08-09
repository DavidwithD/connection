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
 * The meta item carries two index stamps besides: the label keys, and — on a component's
 * root alone — the island keys, which is how the page finds the graph it cannot walk to.
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

/**
 * Two id shapes, and the only thing telling them apart.
 *
 * The seed numbers its nodes `n0000` upward because it knows all of them before it writes
 * any (src/graph/generate.ts); a node made one at a time cannot, so `freshId` mints
 * `n-<uuid>` instead (src/graph/node.ts). Nothing else marks where an item came from — no
 * attribute, no separate partition — so the hyphen is what an export reads to decide which
 * items are somebody's own work and which are scaffolding. Both shapes are named here,
 * together, because a change to either one alone would quietly reclassify a graph.
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

/**
 * Components, as an address — see docs/decisions/0019-every-island-has-an-address.md.
 *
 * Every node carries a `parent` pointer and a component is whatever its nodes point at, so
 * a *root* — a node whose parent is itself — is a component. The two keys below are stamped
 * on roots alone, which is the whole of what keeps the index to one row per component.
 *
 * One bucket for all of them. The access pattern is "every component", so there is nothing
 * to spread across partitions and a second bucket would only mean a second Query. That does
 * put every root in one partition, which is affordable because there are as many roots as
 * components and only a write that merges or splits one ever touches them.
 */
const ISLAND_BUCKET = "island"

export const islandBucket = (): string => ISLAND_BUCKET

/**
 * Size first, so a descending Query offers the largest island first, and zero-padded so it
 * sorts as a number rather than as text — without the padding "9" lands after "100". Six
 * digits is past any graph this demo will hold, and the id breaks ties so two islands of
 * equal size both keep a row.
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
