/**
 * The shapes a caller sees, as opposed to what the store holds. `StoredNode` and
 * `StoredEdge` in db.ts are the records.
 *
 * They live here rather than in read.ts because write.ts returns them too. Either file
 * importing the other would be a cycle for the sake of two interfaces.
 */

export interface NodeMeta {
  /** The normalised name. Unique, and the store's own key. */
  id: string
  label: string
  /** The degree in the stored graph, not the number of edges loaded. */
  degree: number
}

export interface Neighbourhood {
  node: NodeMeta
  neighbours: NodeMeta[]
}

/**
 * A connected component of the graph, named after one of its nodes.
 *
 * The map is walked outward from where the reader is, so a component with no node they have
 * reached cannot be found by walking. This gives a way to reach one, and says how many nodes
 * are in it.
 *
 * Which node names it depends on the order the unions ran in. The name is stable only while
 * nothing merges or splits the component. See ADR 0020.
 */
export interface IslandMeta extends NodeMeta {
  size: number
}

/**
 * One page of islands, and where to continue from.
 *
 * A graph can have any number of components, so the list is paged. `cursor` is null only
 * when the last row is included. The cursor is opaque: it is the store's own index key, and
 * a caller that parses it will break when the index changes shape.
 */
export interface IslandPage {
  islands: IslandMeta[]
  cursor: string | null
}

/**
 * Everything the map page needs on its first frame.
 *
 * The map starts at `islands[0]`: the largest component, and the node that names it. That is
 * one field rather than three, because the opening node, the island holding it, and the node
 * the map will show are all the same id. An empty `islands` means a graph with no nodes,
 * which is the only case with nowhere to start.
 */
export interface Opening {
  nodeCount: number
  edgeCount: number
  /** The first page of components, largest first. The map opens on the first one. */
  islands: IslandMeta[]
  /** Where to continue from, or null when `islands` holds all of them. */
  islandCursor: string | null
  /** How many components there are in total, which one page cannot say. */
  islandCount: number
}

/**
 * What a text file would do to the graph. Read from the store, and written nowhere.
 *
 * A non-empty `faults` means the file cannot be applied at all. Everything else describes a
 * file that can. The pairs are included because a line's meaning is not obvious from the
 * line. See text.ts.
 */
export interface LoadPlan {
  /** Lines that said something. Comments and blank lines are not counted. */
  lines: number
  faults: string[]
  /** Names the graph does not hold yet. Each becomes a node. A misspelling looks the same. */
  fresh: string[]
  joins: [string, string][]
  /** Pairs already joined. A second run of the same file would skip these. */
  joined: number
}
