/**
 * Placement geometry and the spatial index. Pure functions. No Cytoscape and no DOM.
 *
 * Candidate positions are generated on rings that expand outward from the parent node. The
 * first candidate that clears every placed node wins.
 */

const TAU = Math.PI * 2

/** Node diameters. A node draws at one of these, by its distance from the accent. */
export const NODE_SIZE = { accent: 50, neighbour: 34, resting: 24 } as const

/**
 * Minimum centre-to-centre distance between two placed nodes.
 *
 * Sized against the largest a node ever draws, which is the accent size. A node grows when
 * it becomes the accent. Spacing to the resting size would let it grow over its neighbours
 * as the reader pans past.
 */
export const SEAT_SEP = NODE_SIZE.accent + 16

/**
 * The separation used on the second pass, for neighbours the first pass could not fit.
 *
 * Still wide enough that nothing overlaps. Only one node is the accent at a time, so the
 * worst case is an accent radius against a neighbour radius: 25 + 17 = 42, and this is 46.
 * SEAT_SEP leaves room for two accents meeting, which cannot happen. Requiring that on the
 * second pass would drop an edge instead.
 */
export const SQUEEZE_SEP = NODE_SIZE.neighbour + 12

/** The radius of the first ring. The step outward comes from the separation in use. */
const FIRST_RING = 104

/** Stop after this many rings. */
const MAX_RINGS = 14

/** An edge longer than this is drawn as two stubs instead of one line. */
export const LONG_EDGE = 340

export interface Point {
  x: number
  y: number
}

export interface Placed extends Point {
  id: string
}

/** The box one name needs. Only the renderer can measure it, so the caller passes it in. */
export interface Slot {
  w: number
  h: number
}

/**
 * A uniform grid over world space. It keeps two questions cheap as the map grows: is this
 * spot free, and what is the nearest node to this point.
 */
export class Occupancy {
  private readonly cells = new Map<string, Placed[]>()

  constructor(private readonly cell: number = SEAT_SEP) {}

  private static key(cx: number, cy: number): string {
    return `${cx},${cy}`
  }

  private coord(value: number): number {
    return Math.floor(value / this.cell)
  }

  add(placed: Placed): void {
    const key = Occupancy.key(this.coord(placed.x), this.coord(placed.y))
    const bucket = this.cells.get(key)
    if (bucket) bucket.push(placed)
    else this.cells.set(key, [placed])
  }

  /**
   * Free a spot.
   *
   * Only for a node removed from the map, such as an undone write. A spot left claimed after
   * its node is gone can never be reused, and this grid is the only record of it. Empty cells
   * are deleted, so undoing a run of creates leaves the grid at its original size.
   */
  remove(id: string): void {
    for (const [key, bucket] of this.cells) {
      const at = bucket.findIndex((placed) => placed.id === id)
      if (at < 0) continue
      bucket.splice(at, 1)
      if (!bucket.length) this.cells.delete(key)
      return
    }
  }

  /** Every placed node in the cells that overlap a square of `reach` around a point. */
  private near(x: number, y: number, reach: number): Placed[] {
    const span = Math.max(1, Math.ceil(reach / this.cell))
    const cx = this.coord(x)
    const cy = this.coord(y)
    const found: Placed[] = []
    for (let ix = cx - span; ix <= cx + span; ix++) {
      for (let iy = cy - span; iy <= cy + span; iy++) {
        const bucket = this.cells.get(Occupancy.key(ix, iy))
        if (bucket) found.push(...bucket)
      }
    }
    return found
  }

  isClear(x: number, y: number, separation: number = SEAT_SEP): boolean {
    return !this.near(x, y, separation).some(
      (p) => (p.x - x) ** 2 + (p.y - y) ** 2 < separation ** 2,
    )
  }

  /** Every placed node inside a circle of `radius`, not the square that `near` scans. */
  within(x: number, y: number, radius: number): Placed[] {
    return this.near(x, y, radius).filter(
      (p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= radius ** 2,
    )
  }

  /** The closest placed node to a point. Searches outward, one ring of cells at a time. */
  nearest(x: number, y: number, maxReach: number): Placed | null {
    let best: Placed | null = null
    let bestDistance = Infinity
    for (let reach = this.cell; reach <= maxReach + this.cell; reach += this.cell) {
      for (const placed of this.near(x, y, reach)) {
        const distance = (placed.x - x) ** 2 + (placed.y - y) ** 2
        if (distance < bestDistance) {
          bestDistance = distance
          best = placed
        }
      }
      // A hit within this reach cannot be beaten by a node in a cell further out.
      if (best && bestDistance <= reach ** 2) return best
    }
    return best
  }
}

/**
 * Derive a rotation angle from an id. Placing nodes around the same parent then gives the
 * same layout every time. Nothing requires this, but it costs nothing.
 */
export function rotationFor(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967296) * TAU
}

/**
 * Place `count` nodes around `parent`, clear of everything already placed.
 *
 * Slots on a ring are taken spread out, not one after another. Four neighbours on a
 * twelve-slot ring then surround the parent instead of bunching on one side. Anything that
 * does not fit on a ring falls through to the next ring out.
 */
export function seat(
  parent: Point,
  count: number,
  occupancy: Occupancy,
  seed: string,
  separation: number = SEAT_SEP,
): Point[] {
  if (count <= 0) return []

  const chosen: Point[] = []
  const rotation = rotationFor(seed)
  // A smaller separation gives more slots per ring and more rings per unit of radius, so
  // both come from it. Only the first radius is fixed: that distance is what makes a node
  // read as a neighbour.
  const step = separation * 0.92

  // Track the spots chosen in this call locally. Writing them into the shared index would
  // leave placeholder entries there for `nearest` to return later.
  const clear = (x: number, y: number): boolean =>
    occupancy.isClear(x, y, separation) &&
    !chosen.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < separation ** 2)

  for (let ring = 0; ring < MAX_RINGS && chosen.length < count; ring++) {
    const radius = FIRST_RING + ring * step
    const slots = Math.max(1, Math.floor((TAU * radius) / separation))
    const wanted = Math.max(1, Math.min(slots, count - chosen.length))

    // Spread-out slots first, so a few neighbours surround the parent. Then the remaining
    // slots, so a ring is used fully before moving outward. The order is built as a list
    // because a stride expression repeats indices once candidates start being rejected.
    const order: number[] = []
    const taken = new Set<number>()
    for (let k = 0; k < wanted; k++) {
      const index = Math.round((k * slots) / wanted) % slots
      if (!taken.has(index)) {
        taken.add(index)
        order.push(index)
      }
    }
    for (let index = 0; index < slots; index++) {
      if (!taken.has(index)) order.push(index)
    }

    const stagger = (ring % 2) * (TAU / (slots * 2))
    for (const index of order) {
      if (chosen.length >= count) break
      const angle = rotation + (TAU * index) / slots + stagger
      const x = parent.x + Math.cos(angle) * radius
      const y = parent.y + Math.sin(angle) * radius
      if (clear(x, y)) chosen.push({ x, y })
    }
  }

  return chosen
}

/**
 * How many boxes of this width fit around a circle of this radius without touching.
 *
 * This was a literal before: the same sum done by hand once, for the first ring and an
 * average name. Computing it stays correct for a long name and for a ring further out.
 */
export const pillsAround = (radius: number, slotWidth: number): number =>
  Math.max(1, Math.floor((TAU * radius) / slotWidth))

/**
 * Positions on rings around the parent, for ghosts. Unlike `seat`, this ignores the
 * occupancy grid.
 *
 * `seat` returns nothing when there is no room, which is correct for a node: a node keeps
 * its spot for the rest of the session. A ghost keeps nothing and exists only while the
 * reader is looking at it. A crowded area is also exactly where far neighbours appear, so
 * a ghost has to be placeable in a full region. The dimmed backdrop and the ghost's halo
 * keep the overlap readable.
 *
 * `pillsAround` sets how many slots a ring offers, so a wide neighbourhood steps outward
 * instead of crowding one circle. `maxRadius` stops that: a slot the reader cannot see
 * cannot be clicked. The first ring is always offered. A viewport too small for it is one
 * where every neighbour is off screen anyway, and no slot at all is worse.
 *
 * A slot must also clear the slots already handed out, which is a different test from
 * `pillsAround`. The rings step by `seat`'s stride, a little more than a pill's height,
 * while a name box is about three times as wide as it is tall. Two slots one ring apart on
 * the same bearing therefore clear each other where the ring runs vertically and collide
 * where it runs horizontally. Rejecting those collisions keeps every slot clickable.
 *
 * Within a ring, each candidate is scored by its distance from everything already taken,
 * and the best is picked. A few ghosts then spread around the parent instead of stacking on
 * one side. The step and the odd-ring stagger match `seat`, so these slots interleave with
 * the ones `seat` produces rather than colliding with them.
 */
export function ringSlots(
  parent: Point,
  count: number,
  seed: string,
  avoid: readonly Point[],
  slot: Slot,
  maxRadius: number,
): Point[] {
  if (count <= 0) return []
  const rotation = rotationFor(seed)
  const step = SQUEEZE_SEP * 0.92
  const taken: Point[] = [...avoid]
  const chosen: Point[] = []

  const clears = (point: Point): boolean =>
    !chosen.some(
      (other) => Math.abs(other.x - point.x) < slot.w && Math.abs(other.y - point.y) < slot.h,
    )

  for (let ring = 0; ring < MAX_RINGS && chosen.length < count; ring++) {
    const radius = FIRST_RING + ring * step
    if (ring > 0 && radius > maxRadius) break

    const slots = pillsAround(radius, slot.w)
    const stagger = (ring % 2) * (TAU / (slots * 2))
    const candidates: Point[] = []
    for (let i = 0; i < slots; i++) {
      const angle = rotation + (TAU * i) / slots + stagger
      candidates.push({
        x: parent.x + Math.cos(angle) * radius,
        y: parent.y + Math.sin(angle) * radius,
      })
    }

    while (chosen.length < count && candidates.length > 0) {
      let best = -1
      let bestScore = -1
      candidates.forEach((point, i) => {
        if (!clears(point)) return
        const score = taken.length
          ? Math.min(...taken.map((other) => distance(point, other)))
          : Infinity
        if (score > bestScore) {
          bestScore = score
          best = i
        }
      })
      // Nothing left on this ring clears what is already placed. Go to the next ring.
      if (best < 0) break
      const [pick] = candidates.splice(best, 1)
      if (!pick) break
      chosen.push(pick)
      taken.push(pick)
    }
  }
  return chosen
}

/** The distance between the closest pair of points. n is small, so a full scan is fine. */
export function minSpacing(points: readonly Point[]): number {
  let min = Infinity
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!
      const b = points[j]!
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  return min
}

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
