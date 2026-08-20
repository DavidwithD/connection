/**
 * The in-memory map state: node positions, adjacency and degrees.
 *
 * There is no method that moves a node. That is what guarantees a position is assigned
 * once. The renderer reads from here and never writes back.
 */
import {
  LONG_EDGE,
  Occupancy,
  SEAT_SEP,
  SQUEEZE_SEP,
  distance,
  ringSlots,
  rotationFor,
  seat,
  touches,
  type Placed,
  type Point,
  type Slot,
} from "./placement.js"
// The key for an undirected pair. Imported from the store rather than written twice. An id is
// a name, so the separator must be a character no name can contain. `keys.ts` owns that rule,
// because it also owns `normaliseLabel`.
import { edgeKey } from "./store/keys.js"

export interface WorldNode extends Placed {
  label: string
  /** The degree in the stored graph, not the number of edges loaded here. */
  degree: number
}

/**
 * What this file needs of a node: an id, a name and a degree.
 *
 * This is the same shape the store returns, declared separately on purpose. This file makes
 * no assumption about where a node came from.
 */
export interface NodeMeta {
  id: string
  label: string
  degree: number
}

export interface Absorbed {
  nodes: WorldNode[]
  edges: [string, string][]
  /** Neighbours that found no free spot. Kept, not discarded. See `seatPending`. */
  unseated: NodeMeta[]
}

/** A new empty result each time. The caller owns what it is given. */
const nothing = (): Absorbed => ({ nodes: [], edges: [], unseated: [] })

/**
 * How far a new island is kept from anything already placed.
 *
 * Sized against LONG_EDGE, not against a node. That is the distance at which the renderer
 * stops drawing a line and draws two stubs instead. Any closer and a line could be drawn
 * between two islands that share no edge. The line would be correct, but the reader could
 * not see that there is a gap.
 */
const CLEARANCE = LONG_EDGE

/** How far each candidate position steps out and around. The values are approximate. */
const BERTH_STEP = CLEARANCE * 0.55
const BERTH_TURN = 2.399963 // the golden angle, so no two candidates share a bearing
const BERTH_STEPS = 96

export class World {
  private readonly nodes = new Map<string, WorldNode>()
  private readonly adjacency = new Map<string, Set<string>>()
  private readonly pairs = new Set<string>()
  private readonly occupancy = new Occupancy()
  private readonly expanded = new Set<string>()
  /** Neighbours read from the store that found no room. Never discarded. */
  private readonly pending = new Map<string, NodeMeta[]>()

  get size(): number {
    return this.nodes.size
  }

  get edgeCount(): number {
    return this.pairs.size
  }

  get(id: string): WorldNode | undefined {
    return this.nodes.get(id)
  }

  has(id: string): boolean {
    return this.nodes.has(id)
  }

  neighbours(id: string): string[] {
    return [...(this.adjacency.get(id) ?? [])]
  }

  /** How many of this node's edges are not loaded yet. */
  missing(id: string): number {
    const node = this.nodes.get(id)
    if (!node) return 0
    return Math.max(0, node.degree - (this.adjacency.get(id)?.size ?? 0))
  }

  /** True if this node has unloaded edges and has not been read already. */
  isIncomplete(id: string): boolean {
    return !this.expanded.has(id) && this.missing(id) > 0
  }

  markExpanded(id: string): void {
    this.expanded.add(id)
  }

  /**
   * Clear the mark after a read that failed.
   *
   * The mark is set before the read starts. Without this a failed read would leave a node
   * marked as read while it is still missing neighbours, and nothing would ever read it
   * again.
   */
  unmarkExpanded(id: string): void {
    this.expanded.delete(id)
  }

  nearestTo(point: Point, maxReach: number): WorldNode | null {
    const hit = this.occupancy.nearest(point.x, point.y, maxReach)
    return hit ? this.nodes.get(hit.id) ?? null : null
  }

  /**
   * Temporary positions near a node, for ghosts. These are not seats.
   *
   * Real gaps first, at the tighter separation, because a ghost draws at neighbour size and
   * not at accent size. Anything with no gap still gets a position: a crowded area is what
   * puts a neighbour out of drawing range in the first place, so a ghost that gave up there
   * would be missing from every case it exists for.
   *
   * Nothing is written to the occupancy grid. That is what keeps these from being seats, and
   * what stops `nearestTo` returning one as the centre node.
   *
   * `slot` is how much room one ghost needs. Only the renderer knows, because a ghost draws
   * as a name. It sets how many fit on a ring, and so how many rings are used.
   */
  slotsAround(id: string, count: number, slot: Slot, maxRadius: number): Point[] {
    const node = this.nodes.get(id)
    if (!node || count <= 0) return []
    const seed = `ghost:${id}`
    // Two reasons a gap `seat` found is no good here. It walks outward until it has the count
    // and knows nothing about where the screen ends, so one beyond the reach is a doorway
    // nobody can open. And it spaces by a scalar sized for discs, while these draw as names —
    // so two gaps far enough apart to be separate seats can still bury one another as pills.
    // Both drop out, and `ringSlots` refills from rings that are inside the reach.
    const gaps: Point[] = []
    for (const point of seat(node, count, this.occupancy, seed, SQUEEZE_SEP)) {
      if (distance(node, point) > maxRadius) continue
      if (gaps.some((other) => touches(point, other, slot))) continue
      gaps.push(point)
    }
    if (gaps.length >= count) return gaps
    return [...gaps, ...ringSlots(node, count - gaps.length, seed, gaps, slot, maxRadius)]
  }

  /**
   * A clear position for a node that arrived by search rather than by walking.
   *
   * Every other node gets its position from a neighbour. A searched node has no neighbour on
   * the map yet, so its position can only be based on the camera. The one rule left is that
   * it must not land on top of something already placed. `seat` enforces that, so this asks
   * `seat` for a single spot around a point instead of around a parent node.
   */
  landing(near: Point, seed: string): Point {
    return seat(near, 1, this.occupancy, seed, SEAT_SEP)[0] ?? near
  }

  /**
   * A position with room around it, for setting down a whole component.
   *
   * `landing` is the answer for a single node arriving alone. It takes the first clear spot
   * near the camera, which suits a node that was searched for and is read one hop at a time.
   * An island is different. It is the first node of a neighbourhood that grows as the reader
   * walks it. Started from a gap between two nodes of another island, it would grow through
   * them, and two unconnected regions would share one patch of ground with no way to tell
   * which node belongs to which. Positions are never reassigned, so it would stay that way.
   *
   * So this asks for room, not for a gap. Candidates run outward along a spiral from the
   * origin, and the first one with CLEARANCE clear on all sides wins. That gives each island
   * its own space, including the space its first ring will need. If no candidate is clear,
   * the island is placed beyond everything already on the map. An island drawn far away is
   * still readable; one drawn on top of another is not.
   */
  berth(seed: string): Point {
    const rotation = rotationFor(seed)
    for (let step = 0; step < BERTH_STEPS; step++) {
      // Angle and radius grow together, so the candidates spread around the origin instead
      // of running outward along one bearing.
      const angle = rotation + step * BERTH_TURN
      const radius = CLEARANCE + step * BERTH_STEP
      const point = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
      if (!this.occupancy.within(point.x, point.y, CLEARANCE).length) return point
    }

    let far = CLEARANCE
    for (const node of this.nodes.values()) {
      far = Math.max(far, Math.hypot(node.x, node.y))
    }
    return { x: Math.cos(rotation) * (far + CLEARANCE), y: Math.sin(rotation) * (far + CLEARANCE) }
  }

  /** Placed nodes inside a radius. Used to find what is crowding the centre. */
  nodesWithin(point: Point, radius: number): WorldNode[] {
    const out: WorldNode[] = []
    for (const hit of this.occupancy.within(point.x, point.y, radius)) {
      const node = this.nodes.get(hit.id)
      if (node) out.push(node)
    }
    return out
  }

  /** Add a node at a given point. Returns the existing node if the id is already placed. */
  place(meta: NodeMeta, at: Point): WorldNode {
    const existing = this.nodes.get(meta.id)
    if (existing) return existing
    const node: WorldNode = { ...meta, x: at.x, y: at.y }
    this.nodes.set(meta.id, node)
    this.adjacency.set(meta.id, new Set())
    this.occupancy.add(node)
    return node
  }

  private link(a: string, b: string): boolean {
    if (a === b) return false
    const key = edgeKey(a, b)
    if (this.pairs.has(key)) return false
    this.pairs.add(key)
    this.adjacency.get(a)?.add(b)
    this.adjacency.get(b)?.add(a)
    return true
  }

  /**
   * Place what fits, link everything that is on the map, and return the rest.
   *
   * Used by both the first pass and the second. They differ only in the separation they ask
   * for and in where the candidates came from.
   */
  private seatAndLink(
    parent: WorldNode,
    candidates: NodeMeta[],
    separation: number,
  ): Absorbed {
    const fresh = candidates.filter((meta) => !this.nodes.has(meta.id))
    // Highest degree first, so the best-connected neighbours get the closest spots when
    // room runs out.
    fresh.sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1))

    const seats = seat(parent, fresh.length, this.occupancy, parent.id, separation)
    const nodes: WorldNode[] = []
    seats.forEach((point, i) => {
      const meta = fresh[i]
      if (!meta) return
      nodes.push(this.place(meta, point))
    })

    const edges: [string, string][] = []
    for (const meta of candidates) {
      if (!this.nodes.has(meta.id)) continue // no room for it yet
      if (this.link(parent.id, meta.id)) edges.push([parent.id, meta.id])
    }

    return { nodes, edges, unseated: fresh.slice(seats.length) }
  }

  private remember(parentId: string, unseated: NodeMeta[]): void {
    if (unseated.length) this.pending.set(parentId, unseated)
    else this.pending.delete(parentId)
  }

  /**
   * Add a node's neighbours to the map. A neighbour already on the map keeps its position
   * and is only linked. That is what makes a node appear exactly once. An edge to a distant
   * node is returned as a normal pair; the renderer decides to draw it as stubs.
   */
  absorb(parentId: string, neighbours: NodeMeta[]): Absorbed {
    const parent = this.nodes.get(parentId)
    this.markExpanded(parentId)
    if (!parent) return nothing()

    const result = this.seatAndLink(parent, neighbours, SEAT_SEP)
    this.remember(parentId, result.unseated)
    return result
  }

  /**
   * Retry the neighbours the first pass could not fit, at a tighter separation. This needs
   * no read: the metadata was kept in `pending`.
   */
  seatPending(parentId: string, separation: number = SQUEEZE_SEP): Absorbed {
    const parent = this.nodes.get(parentId)
    const waiting = this.pending.get(parentId)
    if (!parent || !waiting?.length) return nothing()

    const result = this.seatAndLink(parent, waiting, separation)
    this.remember(parentId, result.unseated)
    return result
  }


  /** Link two nodes that are both already on the map. */
  linkExisting(a: string, b: string): boolean {
    return this.nodes.has(a) && this.nodes.has(b) && this.link(a, b)
  }

  /**
   * Record that the stored graph gained an edge at this node.
   *
   * This is the only change to a node this class allows. It exists because of `missing`,
   * which is `degree - adjacency.size`. That difference is how the map tells a fully drawn
   * node from one with more graph behind it. Writing an edge to the store raises both terms.
   * Linking locally without calling this raises only the second, so the difference drops by
   * one and a node with unread neighbours starts reporting itself as complete.
   *
   * Never call this on its own. Link and bump together, or do neither.
   */
  bumpDegree(id: string): void {
    const node = this.nodes.get(id)
    if (node) node.degree += 1
  }

  /** The reverse, for an undone join. Never goes below zero. */
  lowerDegree(id: string): void {
    const node = this.nodes.get(id)
    if (node) node.degree = Math.max(0, node.degree - 1)
  }

  /**
   * Remove an edge from the map.
   *
   * Pair this with `lowerDegree`, as `link` is paired with `bumpDegree`, for the mirror
   * reason. Removing the edge alone would leave the degree still counting it, and the node
   * would report neighbours that cannot be read.
   */
  unlink(a: string, b: string): boolean {
    const key = edgeKey(a, b)
    if (!this.pairs.has(key)) return false
    this.pairs.delete(key)
    this.adjacency.get(a)?.delete(b)
    this.adjacency.get(b)?.delete(a)
    return true
  }

  /**
   * Give a node a new id, at the position it already holds.
   *
   * The store keys a node by its name, so a rename there is a delete and a re-add. Here it is
   * neither: `forget` refuses a node with edges, and `place` would have to unlink every edge
   * first and link them all again. So the maps are rewritten in place instead.
   *
   * This does not break the rule at the top of this file. Nothing moves — `x` and `y` are
   * carried across untouched, and the occupancy entry is re-added at the same point. What
   * changes is the name the map files it under.
   *
   * Every structure holding the old id has to be reached. The node itself, both directions of
   * the adjacency, the pair keys, the occupancy grid, the expanded mark, and any pending list
   * naming it. One missed leaves a node that is drawn but cannot be walked from.
   */
  rename(from: string, to: string, label: string): boolean {
    const node = this.nodes.get(from)
    if (!node) return false
    // A case-only rename keeps the key, and the key is the id. Nothing filed by id moves, so
    // the spelling is the whole of it.
    if (from === to) {
      node.label = label
      return true
    }
    if (this.nodes.has(to)) return false

    const moved: WorldNode = { ...node, id: to, label }
    this.nodes.delete(from)
    this.nodes.set(to, moved)

    // The grid stores the record it was given, so the old one goes and the new one is added
    // at the same point. `remove` is what frees the spot for a name that no longer exists.
    this.occupancy.remove(from)
    this.occupancy.add(moved)

    const neighbours = this.adjacency.get(from) ?? new Set<string>()
    this.adjacency.delete(from)
    this.adjacency.set(to, neighbours)
    for (const other of neighbours) {
      const theirs = this.adjacency.get(other)
      if (!theirs) continue
      theirs.delete(from)
      theirs.add(to)
      // A pair key is built from the two names, so every pair this node is in is re-keyed.
      this.pairs.delete(edgeKey(from, other))
      this.pairs.add(edgeKey(to, other))
    }

    // The mark says this node's neighbours have been read, and that is still true of the same
    // node under a new name. Dropping it would make the map read the ring again.
    if (this.expanded.delete(from)) this.expanded.add(to)

    const waiting = this.pending.get(from)
    if (waiting) {
      this.pending.delete(from)
      this.pending.set(to, waiting)
    }
    // The renamed node may itself be waiting for a seat under another parent. There it is
    // held as metadata rather than as a placed node.
    for (const list of this.pending.values()) {
      const at = list.findIndex((meta) => meta.id === from)
      const held = list[at]
      if (held) list[at] = { id: to, label, degree: held.degree }
    }

    return true
  }

  /**
   * Remove a node from the map and free its position.
   *
   * This is the one exception to "a position is never reassigned". That rule exists so
   * nothing already drawn moves under the reader, and this moves nothing: the node goes, and
   * its position returns to the grid for the next node. What would break the rule is reusing
   * the same id at a different position later, so the node must also be gone from the store.
   * Both callers delete it there first: an undone create, and a node removed with its edges.
   *
   * Refuses a node that still has edges. Removing one would leave its neighbours' adjacency
   * pointing at nothing, and `pairs` counting an edge with one end missing.
   */
  forget(id: string): boolean {
    if (!this.nodes.has(id)) return false
    if (this.adjacency.get(id)?.size) return false

    this.nodes.delete(id)
    this.adjacency.delete(id)
    this.occupancy.remove(id)
    this.expanded.delete(id)
    this.pending.delete(id)
    // Drop this node from any other node's pending list. It cannot be placed now.
    for (const [parent, waiting] of this.pending) {
      const left = waiting.filter((meta) => meta.id !== id)
      if (left.length !== waiting.length) this.remember(parent, left)
    }
    return true
  }

  span(a: string, b: string): number {
    const from = this.nodes.get(a)
    const to = this.nodes.get(b)
    return from && to ? distance(from, to) : 0
  }
}
