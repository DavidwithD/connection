/**
 * The world: what has been placed, where, and what it connects to.
 *
 * This is the store. It owns positions, and the one rule it enforces is that a position,
 * once assigned, is never reassigned — there is no method to move a node. Rendering reads
 * from here; nothing writes back.
 *
 * Each node keeps its *true* degree from the server alongside the edges actually loaded.
 * The difference is what makes a node worth expanding, and it is the only reason the map
 * can tell "fully drawn" from "there is more here".
 *
 * A neighbour that arrives with nowhere to sit is kept rather than dropped. Room is a
 * property of the map at one moment, not of the graph, so the answer can change — and
 * re-asking the store for something it already told us would be the wrong way to find out.
 *
 * The seated-once guarantee is an invariant of the whole frontend, not just of this file:
 * see docs/design/architecture.md. The reasoning is
 * docs/decisions/0003-graph-exploration-demo-stack.md.
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
  type Placed,
  type Point,
} from "./placement.js"

export interface WorldNode extends Placed {
  label: string
  /** Degree in the stored graph, not the count of edges loaded. */
  degree: number
}

export interface NodeMeta {
  id: string
  label: string
  degree: number
}

export interface Absorbed {
  nodes: WorldNode[]
  edges: [string, string][]
  /** Known neighbours that found no seat. Kept, not discarded — see `seatPending`. */
  unseated: NodeMeta[]
}

/** A fresh empty result each time: callers own what they are handed. */
const nothing = (): Absorbed => ({ nodes: [], edges: [], unseated: [] })

/**
 * Water around an island: how far a berth keeps from anything already placed.
 *
 * Sized against `LONG_EDGE` rather than against a node, because that is the distance at
 * which the renderer gives up drawing a line and stubs it instead. Anything closer and an
 * edge could be drawn between two islands that share no edge at all — not a wrong line, but
 * a picture in which the reader cannot tell there is a gap.
 */
const CLEARANCE = LONG_EDGE

/** How far out each candidate berth steps, and how far around. Rough on purpose. */
const BERTH_STEP = CLEARANCE * 0.55
const BERTH_TURN = 2.399963 // the golden angle: successive berths never share a bearing
const BERTH_STEPS = 96

/**
 * Canonical key for an undirected pair. The separator is a character no id contains,
 * and it stays written as an escape: a literal NUL byte in the source makes git call
 * the whole file binary and stop diffing it.
 */
const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

export class World {
  private readonly nodes = new Map<string, WorldNode>()
  private readonly adjacency = new Map<string, Set<string>>()
  private readonly pairs = new Set<string>()
  private readonly occupancy = new Occupancy()
  private readonly expanded = new Set<string>()
  /** Neighbours that arrived from the store but found no room. Never thrown away. */
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

  /** Edges loaded for this node, versus the degree the store reports. */
  missing(id: string): number {
    const node = this.nodes.get(id)
    if (!node) return 0
    return Math.max(0, node.degree - (this.adjacency.get(id)?.size ?? 0))
  }

  /** Worth fetching: has unloaded edges and has not already been asked for. */
  isIncomplete(id: string): boolean {
    return !this.expanded.has(id) && this.missing(id) > 0
  }

  markExpanded(id: string): void {
    this.expanded.add(id)
  }

  /**
   * Give a claim back, for a read that never answered.
   *
   * The claim is taken before the request leaves, so a cancelled or failed read would
   * otherwise leave a node marked as read and permanently short of the neighbours it
   * reports having — the one state the map is not allowed to be in.
   */
  unmarkExpanded(id: string): void {
    this.expanded.delete(id)
  }

  nearestTo(point: Point, maxReach: number): WorldNode | null {
    const hit = this.occupancy.nearest(point.x, point.y, maxReach)
    return hit ? this.nodes.get(hit.id) ?? null : null
  }

  /**
   * Spots near a node for things that need somewhere to stand without taking a seat.
   *
   * Gaps first, at the tighter separation — a ghost draws at neighbour size, not accent
   * size. Whatever finds no gap still gets a spot: crowding is precisely what puts a
   * neighbour out of drawing range in the first place, so a ghost that gave up in a full
   * region would be missing from every case it exists for. Nothing is written to the
   * occupancy grid either way, which is what keeps these from being seats — and what
   * stops `nearestTo` ever handing one back as the centre.
   */
  slotsAround(id: string, count: number): Point[] {
    const node = this.nodes.get(id)
    if (!node || count <= 0) return []
    const seed = `ghost:${id}`
    const gaps = seat(node, count, this.occupancy, seed, SQUEEZE_SEP)
    if (gaps.length >= count) return gaps
    return [...gaps, ...ringSlots(node, count - gaps.length, seed, gaps)]
  }

  /**
   * Somewhere clear to put a node that arrived by name instead of by walking.
   *
   * Everything else on the map got its spot from the node it neighbours. A searched node
   * neighbours nothing here yet, so the only thing its position can answer to is the
   * camera — and the one rule that still holds is that it cannot land on top of anything
   * already placed. `seat` is what enforces that, so this asks it for a single spot around
   * the point rather than around a parent.
   */
  landing(near: Point, seed: string): Point {
    return seat(near, 1, this.occupancy, seed, SEAT_SEP)[0] ?? near
  }

  /**
   * Open water: somewhere a whole component can be set down without touching another.
   *
   * `landing` is the answer for a node arriving alone — it takes the first clear spot near
   * the camera, which is right for something searched for and read one hop at a time. An
   * island is not that. It is the first node of a neighbourhood that will grow as it is
   * walked, and grown from a seat wedged between two nodes of somewhere else it would
   * interleave with them: two unconnected regions occupying one patch of ground, and no way
   * to tell by looking which node belongs to which. Positions are never reassigned, so that
   * is not a picture that tidies itself up later.
   *
   * So this asks for room rather than for a gap. Candidates go outward along a spiral from
   * the origin and the first with `CLEARANCE` of nothing around it wins, which puts each
   * island in its own water and leaves the space its ring will need. Failing that — a map
   * so full that no berth exists — it lands beyond everything placed, because an island
   * drawn far away is still readable and an island drawn on top of another is not.
   */
  berth(seed: string): Point {
    const rotation = rotationFor(seed)
    for (let step = 0; step < BERTH_STEPS; step++) {
      // Angle and radius grow together, so candidates spread around the origin instead of
      // marching out along one bearing.
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

  /** Placed nodes inside a radius. Answers "what is the centre crowded by?". */
  nodesWithin(point: Point, radius: number): WorldNode[] {
    const out: WorldNode[] = []
    for (const hit of this.occupancy.within(point.x, point.y, radius)) {
      const node = this.nodes.get(hit.id)
      if (node) out.push(node)
    }
    return out
  }

  /** The first node, at the origin. */
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
    const key = pairKey(a, b)
    if (this.pairs.has(key)) return false
    this.pairs.add(key)
    this.adjacency.get(a)?.add(b)
    this.adjacency.get(b)?.add(a)
    return true
  }

  /**
   * Seat whatever fits, link everything that is on the map, and hand back the rest.
   *
   * Shared by the first pass and the squeeze, which differ only in the separation they
   * ask for and in where the candidates came from.
   */
  private seatAndLink(
    parent: WorldNode,
    candidates: NodeMeta[],
    separation: number,
  ): Absorbed {
    const fresh = candidates.filter((meta) => !this.nodes.has(meta.id))
    // Highest degree first, so the best-connected neighbours get the closest seats when
    // room runs short.
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
      if (!this.nodes.has(meta.id)) continue // still nowhere to sit
      if (this.link(parent.id, meta.id)) edges.push([parent.id, meta.id])
    }

    return { nodes, edges, unseated: fresh.slice(seats.length) }
  }

  private remember(parentId: string, unseated: NodeMeta[]): void {
    if (unseated.length) this.pending.set(parentId, unseated)
    else this.pending.delete(parentId)
  }

  /**
   * Add a node's neighbours. Ones already on the map keep the position they have — they
   * are only linked — which is what makes a node appear exactly once. The edge to a
   * distant existing node comes back as a long pair for the renderer to stub.
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
   * Try again for the neighbours the first pass could not fit, in whatever room is left
   * and at a tighter separation. Costs no request: the metadata never went anywhere.
   */
  seatPending(parentId: string, separation: number = SQUEEZE_SEP): Absorbed {
    const parent = this.nodes.get(parentId)
    const waiting = this.pending.get(parentId)
    if (!parent || !waiting?.length) return nothing()

    const result = this.seatAndLink(parent, waiting, separation)
    this.remember(parentId, result.unseated)
    return result
  }


  /** Link two nodes already on the map, for edges discovered between existing nodes. */
  linkExisting(a: string, b: string): boolean {
    return this.nodes.has(a) && this.nodes.has(b) && this.link(a, b)
  }

  /**
   * Record that the stored graph gained an edge here.
   *
   * The only mutation of a node this class allows, and it exists because of `missing`: that
   * is `degree - adjacency.size`, and it is the whole of how the map tells "fully drawn"
   * from "there is more here". An edge written to the store raises both sides of that
   * subtraction. Linking it locally without this raises only the second, so the difference
   * falls by one and a node with graph still behind it starts claiming to be finished — the
   * same drift docs/decisions/0009-the-first-write-outside-the-seed.md is about, arriving
   * from the client instead of the store.
   *
   * So it is never called alone. Link and bump, together, or not at all.
   */
  bumpDegree(id: string): void {
    const node = this.nodes.get(id)
    if (node) node.degree += 1
  }

  /** The same, for a join taken back. Never below zero, whatever the caller thinks. */
  lowerDegree(id: string): void {
    const node = this.nodes.get(id)
    if (node) node.degree = Math.max(0, node.degree - 1)
  }

  /**
   * Take an edge back off the map.
   *
   * Paired with `lowerDegree` exactly as `link` is with `bumpDegree`, and for the mirror
   * reason: dropping the edge alone would leave the degree counting it, and the node would
   * report graph behind it that nobody can read.
   */
  unlink(a: string, b: string): boolean {
    const key = pairKey(a, b)
    if (!this.pairs.has(key)) return false
    this.pairs.delete(key)
    this.adjacency.get(a)?.delete(b)
    this.adjacency.get(b)?.delete(a)
    return true
  }

  /**
   * Take a node off the map, seat and all.
   *
   * The one hole in "a position, once assigned, is never reassigned". The rule exists so
   * that nothing already drawn moves under the reader, and this does not move anything: the
   * node leaves, and the ground it held goes back into the grid for whoever comes next.
   * What would break the rule is *reusing* the id later at a different spot, so the node
   * has to be genuinely gone from the store too. Both callers have removed it there first:
   * an undone create, and a node taken off the map with its edges
   * (docs/decisions/0022-taking-a-node-out-with-its-edges.md).
   *
   * Refuses a node with edges. Removing one would leave adjacency in its neighbours
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
    // Anything still waiting for a seat beside this node is waiting on nothing.
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
