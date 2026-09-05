/**
 * Whole-graph operations: export, import, check and recount.
 *
 * Each one loads the whole store into memory. That is acceptable for a button someone presses
 * and waits on. Do not call any of these from anything automatic.
 */
import { counts, forget, open, unavailable, type StoredEdge, type StoredNode } from "./db.js"
import { generate, type GenerateOptions } from "./generate.js"
import { components, stampIslands, writeStamped } from "./islands.js"
import { edgeEnds, edgeKey, naming, normaliseLabel } from "./keys.js"

/**
 * The export format version this writes, and the only one it reads.
 *
 * Version 2 holds the store's own records. A file of any other version is refused whole.
 */
export const EXPORT_VERSION = 2

export interface GraphExport {
  version: number
  exportedAt: string
  nodes: StoredNode[]
  edges: StoredEdge[]
  counts: { nodes: number; edges: number }
}

/**
 * Count the stored records with a scan, rather than reading the cached totals in `counts()`.
 *
 * The scan is slow enough that db.ts caches it for the HUD. Call it on a click, where the
 * reader is already waiting and the number has to be current.
 */
export async function readCounts(): Promise<{ nodes: number; edges: number }> {
  const db = await open()
  const [nodes, edges] = await Promise.all([db.count("nodes"), db.count("edges")])
  return { nodes, edges }
}

/** Load the whole graph into memory. Two `getAll` calls, and this app's largest allocation. */
export async function readWholeGraph(): Promise<{
  nodes: StoredNode[]
  edges: StoredEdge[]
}> {
  const db = await open()
  const tx = db.transaction(["nodes", "edges"], "readonly")
  const nodes = await tx.objectStore("nodes").getAll()
  const edges = await tx.objectStore("edges").getAll()
  await tx.done
  return { nodes, edges }
}

/**
 * Export the whole graph. There is no subset option.
 *
 * There used to be one, defaulting to everything the seed had not written, because a re-seed
 * dropped the table and the question was which nodes would survive. Nothing drops a table
 * now, and no id records where a node came from, so the question has no answer.
 */
export async function exportGraph(): Promise<GraphExport> {
  const { nodes, edges } = await readWholeGraph()
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    nodes,
    edges,
    counts: { nodes: nodes.length, edges: edges.length },
  }
}

/** Reduce edge records to one undirected pair each, which is what the callers below want. */
export const pairsOf = (edges: StoredEdge[]): [string, string][] =>
  edges.map((edge) => [edge.a, edge.b])

/**
 * Find every fault in a graph.
 *
 * All faults are collected rather than thrown at the first one. Finding the second fault only
 * after fixing the first turns a repair into an afternoon's work.
 *
 * Two of these checks were not possible against the old store. Checking `degree` against the
 * edges is cheap now, because an edge is one record. Checking a record's `label` against its
 * own key only exists because the key is the name: a record that fails it is a node found
 * under one name and shown under another, which is the one fault a reader cannot see.
 */
export function verify(nodes: StoredNode[], edges: StoredEdge[]): string[] {
  const faults: string[] = []
  const held = new Map<string, StoredNode>()
  const degree = new Map<string, number>()

  for (const node of nodes) {
    if (held.has(node.labelKey)) faults.push(`two records keyed ${node.labelKey}`)
    held.set(node.labelKey, node)
    degree.set(node.labelKey, 0)

    if (!normaliseLabel(node.label)) {
      faults.push(`${node.labelKey} has no usable name`)
    } else if (normaliseLabel(node.label) !== node.labelKey) {
      faults.push(
        `${node.labelKey} is filed under a key its own name "${node.label}" does not make`,
      )
    }
  }

  const seen = new Set<string>()
  for (const edge of edges) {
    const key = edgeKey(edge.a, edge.b)
    if (seen.has(key)) faults.push(`two records for the edge ${edge.a} — ${edge.b}`)
    seen.add(key)

    if (edge.a === edge.b) faults.push(`${edge.a} is joined to itself`)
    if (edge.a > edge.b) faults.push(`edge ${edge.a} — ${edge.b} is not in canonical order`)
    // The `byEnd` index is built over `ends`, so a record whose `ends` disagree with its key
    // is an edge that cannot be found from either node it joins.
    if (edge.ends[0] !== edge.a || edge.ends[1] !== edge.b) {
      faults.push(`edge ${edge.a} — ${edge.b} carries ends that are not its key`)
    }
    for (const end of [edge.a, edge.b]) {
      if (!held.has(end)) faults.push(`edge ${edge.a} — ${edge.b} names ${end}, which is not here`)
      else degree.set(end, (degree.get(end) ?? 0) + 1)
    }
  }

  for (const node of held.values()) {
    const counted = degree.get(node.labelKey) ?? 0
    if (node.degree !== counted) {
      faults.push(
        `${node.labelKey} states degree ${String(node.degree)} and has ` +
          `${String(counted)} edge(s)`,
      )
    }
    if (!held.has(node.parent)) {
      faults.push(`${node.labelKey} points at ${node.parent}, which is not here`)
    }
    const isRoot = node.parent === node.labelKey
    if (isRoot && node.islandSize === undefined) {
      faults.push(`${node.labelKey} is a root and counts no island`)
    }
    if (!isRoot && node.islandSize !== undefined) {
      faults.push(`${node.labelKey} is not a root and still counts an island`)
    }
  }

  // Check the stated sizes against the components the graph actually has. Which node is the
  // root depends on union order and is not checked. Only the sizes are.
  const { parent } = components(held.keys(), pairsOf(edges))
  const sizes = new Map<string, number>()
  for (const id of held.keys()) {
    const root = parent.get(id) ?? id
    sizes.set(root, (sizes.get(root) ?? 0) + 1)
  }
  const stated = new Map<string, number>()
  for (const node of held.values()) {
    if (node.islandSize === undefined) continue
    stated.set(parent.get(node.labelKey) ?? node.labelKey, node.islandSize)
  }
  for (const [root, size] of sizes) {
    const said = stated.get(root)
    if (said === undefined) faults.push(`a component of ${String(size)} node(s) has no root`)
    else if (said !== size) {
      faults.push(`a root counts ${String(said)} and its component holds ${String(size)}`)
    }
  }

  return faults
}

/** Check the whole graph. Reports the faults, and the size of the graph it read. */
export async function checkGraph(): Promise<{
  faults: string[]
  nodes: number
  edges: number
  islands: number
}> {
  const { nodes, edges } = await readWholeGraph()
  const { parent } = components(
    nodes.map((node) => node.labelKey),
    pairsOf(edges),
  )
  return {
    faults: verify(nodes, edges),
    nodes: nodes.length,
    edges: edges.length,
    islands: new Set([...parent.values()]).size,
  }
}

/**
 * Rebuild the component index from the nodes and edges.
 *
 * This is the repair for the one thing allowed to lag. `settle` runs inside the write and
 * cannot fail, but a split is a walk that runs afterwards and may be cut short. Something has
 * to be able to rebuild the whole index, and this is it.
 */
export async function recountIslands(): Promise<{ islands: number; changed: number }> {
  const { nodes, edges } = await readWholeGraph()
  const { islands, changed } = stampIslands(nodes, pairsOf(edges))
  await writeStamped(changed)
  return { islands, changed: changed.length }
}

/**
 * Replace the whole graph, in one transaction.
 *
 * One transaction, because a half-applied graph is worse than a rejected one, and running out
 * of quota partway is exactly how that would happen. Either the store holds this graph
 * afterwards, or it holds what it held before.
 *
 * Nothing here awaits anything that is not a store request. A transaction commits as soon as
 * the microtask queue drains, so one timer between the clear and the last put would leave the
 * store empty.
 */
export async function replaceGraph(nodes: StoredNode[], edges: StoredEdge[]): Promise<void> {
  try {
    const db = await open()
    const tx = db.transaction(["nodes", "edges"], "readwrite")
    const nodeStore = tx.objectStore("nodes")
    const edgeStore = tx.objectStore("edges")

    await nodeStore.clear()
    await edgeStore.clear()
    for (const node of nodes) await nodeStore.put(node)
    for (const edge of edges) await edgeStore.put(edge)

    await tx.done
  } catch (err) {
    // Discard the cached totals either way. The transaction either landed whole, or landed
    // not at all and the clear was rolled back with it.
    forget()
    throw unavailable(err) ?? err
  }
  forget()
  await counts()
}

/** Build a whole graph's records from names and pairs, with the components stamped. */
export function buildGraph(
  named: { label: string }[],
  pairs: Iterable<readonly [string, string]>,
): { nodes: StoredNode[]; edges: StoredEdge[]; faults: string[] } {
  const faults: string[] = []
  const nodes = new Map<string, StoredNode>()

  for (const { label } of named) {
    const minted = naming(label)
    if (!minted) {
      faults.push(`a node has no usable name`)
      continue
    }
    if (nodes.has(minted.labelKey)) {
      faults.push(`two nodes are called "${minted.label}"`)
      continue
    }
    nodes.set(minted.labelKey, {
      labelKey: minted.labelKey,
      label: minted.label,
      degree: 0,
      parent: minted.labelKey,
      islandSize: 1,
    })
  }

  const edges = new Map<string, StoredEdge>()
  for (const [from, to] of pairs) {
    if (from === to) continue
    const [a, b] = edgeEnds(from, to)
    // Drop an edge with an end outside the node set. An edge naming a node that is not
    // there is a fault the graph cannot repair on its own.
    if (!nodes.has(a) || !nodes.has(b)) continue
    const key = edgeKey(a, b)
    if (edges.has(key)) continue
    edges.set(key, { a, b, ends: [a, b] })
  }

  // Counted from the edges kept, never taken from the file. A stored count can be wrong.
  for (const edge of edges.values()) {
    nodes.get(edge.a)!.degree += 1
    nodes.get(edge.b)!.degree += 1
  }

  const all = [...nodes.values()]
  // Compute the components from this graph, not from the source. A file may be a subset, and
  // a subset's components are not the ones it was exported from.
  stampIslands(all, [...edges.values()].map((edge) => [edge.a, edge.b] as const))
  return { nodes: all, edges: [...edges.values()], faults }
}

/**
 * How many shape faults to list. A file of the wrong shape is usually wrong the same way all
 * the way down, so a thousand rows saying so tell the reader no more than five.
 */
const SHAPE_SHOWN = 5

/**
 * Check that the records in a file have the shape the code below assumes.
 *
 * `verify` checks whether a graph is consistent, and to do that it reads fields such as
 * `edge.ends[0]` and `node.label.trim()`. A file is JSON that someone may have edited, so each
 * of those fields may be missing, and a missing one throws where a fault was wanted. So the
 * shape is checked first, separately, against `unknown`.
 *
 * Both loops stop at the cap. A malformed file can be as long as any other, and there is no
 * reason to walk fifty thousand records to collect the sixth complaint.
 */
function shapeFaults(nodes: unknown[], edges: unknown[]): string[] {
  const faults: string[] = []
  const is = (value: unknown, key: string, type: "string" | "number"): boolean =>
    typeof (value as Record<string, unknown>)[key] === type

  for (let at = 0; at < nodes.length && faults.length < SHAPE_SHOWN; at++) {
    const node = nodes[at]
    if (typeof node !== "object" || node === null) {
      faults.push(`node ${String(at)} is not a record`)
      continue
    }
    if (
      !is(node, "labelKey", "string") ||
      !is(node, "label", "string") ||
      !is(node, "degree", "number") ||
      !is(node, "parent", "string")
    ) {
      faults.push(`node ${String(at)} is missing labelKey, label, degree or parent`)
      continue
    }
    const size = (node as Record<string, unknown>)["islandSize"]
    if (size !== undefined && typeof size !== "number") {
      faults.push(`node ${String(at)} carries an islandSize that is not a number`)
    }
  }

  for (let at = 0; at < edges.length && faults.length < SHAPE_SHOWN; at++) {
    const edge = edges[at]
    if (typeof edge !== "object" || edge === null) {
      faults.push(`edge ${String(at)} is not a record`)
      continue
    }
    if (!is(edge, "a", "string") || !is(edge, "b", "string")) {
      faults.push(`edge ${String(at)} is missing a or b`)
      continue
    }
    // The `byEnd` index is built over `ends`, so a record without it is an edge neither of
    // its nodes can reach. It is the one missing field that causes no error.
    const ends = (edge as Record<string, unknown>)["ends"]
    if (!Array.isArray(ends) || ends.length !== 2 || ends.some((e) => typeof e !== "string")) {
      faults.push(`edge ${String(at)} does not carry two names in ends`)
    }
  }

  return faults
}

/**
 * Read a file into records this store can hold.
 *
 * A version 2 file already holds these records, so this checks their shape and their
 * consistency. It does not convert anything.
 */
export function readExport(payload: unknown): {
  nodes: StoredNode[]
  edges: StoredEdge[]
  faults: string[]
} {
  // `null` is valid JSON and reading `.version` off it throws. The reader would then see a
  // TypeError where a fault was wanted. Anything that is not an object falls through to the
  // version fault below.
  const file = (typeof payload === "object" && payload !== null ? payload : {}) as
    Partial<GraphExport>

  if (file.version === EXPORT_VERSION && Array.isArray(file.nodes)) {
    const nodes = file.nodes
    const edges = Array.isArray(file.edges) ? file.edges : []
    // Stop here if the records are the wrong shape. `verify` would read fields that are not
    // there, and "is this graph consistent" has no answer for something that is not a graph.
    const malformed = shapeFaults(nodes, edges)
    if (malformed.length) return { nodes: [], edges: [], faults: malformed }
    return { nodes, edges, faults: verify(nodes, edges) }
  }

  return {
    nodes: [],
    edges: [],
    faults: [
      `this reads version ${String(EXPORT_VERSION)}, and that file says ` +
        `${String(file.version)}`,
    ],
  }
}

/** Build the demo graph's records. The generator's ids are mapped to names here. */
export function buildSeed(options: GenerateOptions): {
  nodes: StoredNode[]
  edges: StoredEdge[]
  faults: string[]
} {
  const graph = generate(options)
  const named = new Map<string, string>()
  for (const node of graph.nodes) named.set(node.id, node.label)

  const pairs: [string, string][] = []
  for (const [a, b] of graph.edges) {
    const from = named.get(a)
    const to = named.get(b)
    if (from && to) pairs.push([normaliseLabel(from), normaliseLabel(to)])
  }

  return buildGraph(graph.nodes, pairs)
}
