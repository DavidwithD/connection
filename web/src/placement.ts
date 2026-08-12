/**
 * Where nodes go in world space. Pure geometry — no Cytoscape, no DOM.
 *
 * Positions are frozen, so seating a new node cannot nudge an existing one out of the
 * way: it has to find room. That is what `Occupancy` and `seat` are for. Candidates are
 * generated on rings expanding outward from the parent and the first one clear of every
 * placed node wins, so neighbours land close when there is space and further out when
 * there is not.
 *
 * `SEAT_SEP` is sized against the *largest* a node ever draws — the accent size, not the
 * resting size. A node swells when it becomes the accent, and seating against the resting
 * size would let it grow into its neighbours as you pan past.
 *
 * These are the separations docs/design/the-centre.md points at rather than copies. See
 * docs/decisions/0003-graph-exploration-demo-stack.md.
 */

const TAU = Math.PI * 2

/** Node diameters. Which one a node draws at depends on its distance from the accent. */
export const NODE_SIZE = { accent: 50, neighbour: 34, resting: 24 } as const

/** Minimum centre-to-centre distance between any two placed nodes. */
export const SEAT_SEP = NODE_SIZE.accent + 16

/**
 * The separation used on a second pass, for neighbours the first pass could not fit.
 *
 * Still wide enough that nothing can overlap: only one node is ever the accent, so the
 * worst case is an accent radius against a neighbour radius, 25 + 17 = 42, and this is 46.
 * `SEAT_SEP` reserves room for two accents meeting, which cannot happen. Paying for that
 * on the second pass costs an edge, and an edge is the thing the map is for.
 */
export const SQUEEZE_SEP = NODE_SIZE.neighbour + 12

/** Where the first ring sits. The step outward is derived from the separation in use. */
const FIRST_RING = 104

/** Give up after this many rings and stack at the last one. */
const MAX_RINGS = 14

/** Beyond this, an edge is drawn as two stubs instead of a line. */
export const LONG_EDGE = 340

export interface Point {
  x: number
  y: number
}

export interface Placed extends Point {
  id: string
}

/** The box one name needs. Only the renderer can measure it, so it arrives from there. */
export interface Slot {
  w: number
  h: number
}

/**
 * A uniform grid over world space, so "is this spot free?" and "what is nearest the
 * middle of the screen?" both stay cheap as the map grows.
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
   * Give a spot back.
   *
   * Only for a node being taken off the map entirely — a write undone. A seat that stays
   * claimed after its node has gone is ground nothing can ever be placed on again, and the
   * grid is the only record of it. Emptied cells are dropped rather than kept, so undoing
   * a run of creates leaves the grid the size it started.
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

  /** Every placed node in the cells overlapping a square of `reach` around a point. */
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

  /** Every placed node inside a true radius, rather than the square `near` scans. */
  within(x: number, y: number, radius: number): Placed[] {
    return this.near(x, y, radius).filter(
      (p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= radius ** 2,
    )
  }

  /** Closest placed node to a point, searching outward in rings of cells. */
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
      // A hit inside this reach cannot be beaten by a cell further out.
      if (best && bestDistance <= reach ** 2) return best
    }
    return best
  }
}

/**
 * A rotation derived from an id, so seating around the same parent always comes out the
 * same way. Coordinates need not be reproducible, but stability costs nothing.
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
 * Seat `count` nodes around `parent`, avoiding everything already placed.
 *
 * Slots on a ring are taken evenly spread rather than consecutively, so four neighbours
 * on a twelve-slot ring surround the parent instead of bunching along one side. Anything
 * that will not fit on a ring falls through to the next one out.
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
  // A tighter separation buys slots per ring *and* rings per unit of radius, so both
  // derive from it. Only the first radius is fixed, because that one is where a
  // neighbour looks like a neighbour.
  const step = separation * 0.92

  // Claims are kept local rather than written into the shared index: seeding it with
  // placeholder entries would leave them there for `nearest` to return later.
  const clear = (x: number, y: number): boolean =>
    occupancy.isClear(x, y, separation) &&
    !chosen.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < separation ** 2)

  for (let ring = 0; ring < MAX_RINGS && chosen.length < count; ring++) {
    const radius = FIRST_RING + ring * step
    const slots = Math.max(1, Math.floor((TAU * radius) / separation))
    const wanted = Math.max(1, Math.min(slots, count - chosen.length))

    // Evenly-spread slots first so a few neighbours surround the parent rather than
    // bunching along one side, then every remaining slot, so a ring is fully used
    // before moving outward. Building the order explicitly avoids the repeats a
    // stride expression produces once candidates start getting rejected.
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
 * How many boxes of this width fit round a circle of this radius without touching.
 *
 * The number a ring can hold used to be stated as a literal, and the literal was this
 * calculation done once by hand for the first ring and a typical name. Computing it stays
 * true for a long name and keeps meaning something on a ring further out — see
 * docs/decisions/0027-a-ring-holds-what-it-holds.md.
 */
export const pillsAround = (radius: number, slotWidth: number): number =>
  Math.max(1, Math.floor((TAU * radius) / slotWidth))

/**
 * Positions on rings around the parent, taking no account of what is already there.
 *
 * `seat` refuses to place anything without room, which is right for a node: it owns its
 * spot for the rest of the session. A ghost owns nothing and lasts only as long as you
 * are looking at it, so for a ghost "there is no room" is not an answer — and crowding is
 * the very thing that produces the far neighbours a ghost stands in for, so the honest
 * answer has to work in a full region. The backdrop dimming and the ghost's own halo are
 * what make the resulting overlap readable.
 *
 * How many a ring offers is `pillsAround`, so a wide neighbourhood steps outward instead of
 * piling more names onto one circle. `maxRadius` is where that stops: a slot the reader cannot
 * see is a doorway nobody can open, so past it the answer is fewer slots rather than
 * unreachable ones. The first ring is offered regardless, because a viewport too small to hold
 * it is one where every neighbour is off screen too, and no slot at all is the worse answer.
 *
 * A slot also has to clear the boxes already handed out, and that is not the same test as
 * `pillsAround`. The rings step by `seat`'s stride — a little over a pill's height — while a
 * name is nearly three times as wide as it is tall, so two slots one ring apart on the same
 * bearing clear each other where the ring runs vertically and collide where it runs
 * horizontally. Rejecting the collisions is what makes every slot handed out a doorway that
 * can be read and clicked, rather than one the paint order happens to bury.
 *
 * Within a ring, candidates are scored by how far they sit from everything already taken and
 * picked greedily, so a handful of ghosts spread around the parent instead of stacking along
 * one side. The step outward and the odd-ring stagger are `seat`'s, at the separation
 * `slotsAround` asks it for, so gap slots and these interleave rather than collide.
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
      // Nothing left on this ring that clears what is already standing: go outward.
      if (best < 0) break
      const [pick] = candidates.splice(best, 1)
      if (!pick) break
      chosen.push(pick)
      taken.push(pick)
    }
  }
  return chosen
}

/** Closest pair in a set of points. Small n, so the naive scan is the right one. */
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
