/**
 * Where the neighbours sit. Pure geometry — no DOM, no fetch, no state.
 *
 * A ring of radius r holds `2πr / SEP` nodes before they touch, so the number of rings
 * follows from the neighbour count and nothing has to be tuned per graph. Rings are then
 * filled *proportionally* rather than in order: filling in order packs the inner ring and
 * leaves the outer one nearly empty, which reads as a mistake rather than as a layout.
 *
 * Positions are recomputed on every hop and nothing is remembered between them. That is
 * the whole difference from `placement.ts`, whose seats are frozen for the life of the
 * page and therefore need an occupancy grid to find room.
 *
 * See docs/design/one-node-at-a-time.md for how this fits the rest of the page, and
 * docs/decisions/0005-a-second-view-that-keeps-no-world.md for why the page exists.
 */

const TAU = Math.PI * 2

/** Minimum centre-to-centre gap between two neighbours sharing a ring. */
const SEP = 46

/** The innermost ring, and the step outward. Screen pixels, before any compression. */
const FIRST_RING = 132
const RING_STEP = 62

/** How much of the room available a small ring should try to use. */
const TARGET_FILL = 0.62

/** A ring is never blown up past this, however much space there is. */
const MAX_GROW = 1.7

const radiusOf = (ring: number): number => FIRST_RING + ring * RING_STEP

const capacityOf = (radius: number): number =>
  Math.max(1, Math.floor((TAU * radius) / SEP))

export interface Seat {
  x: number
  y: number
  /** 0 is the innermost ring. Geometry, not data — nothing is encoded with it. */
  ring: number
}

export interface Layout {
  seats: Seat[]
  /** Uniform shrink applied to fit the window. 1 when nothing had to give. */
  scale: number
  /** Radius of the outermost occupied ring, after compression. */
  extent: number
}

/**
 * Seats for `count` neighbours, no further out than `available` pixels.
 *
 * A hub whose rings do not fit is compressed uniformly rather than clipped or paginated:
 * the page's one claim is that it shows the whole ring, and dropping a neighbour to keep
 * a nice radius would break it. A node with six neighbours has the opposite problem, so
 * the same factor also works upward — six dots at the base radius leave most of a large
 * window empty, and the drawing reads as small rather than as sparse.
 */
export function layOut(count: number, available: number): Layout {
  if (count <= 0) return { seats: [], scale: 1, extent: 0 }

  const caps: number[] = []
  for (let seated = 0; seated < count; ) {
    const cap = capacityOf(radiusOf(caps.length))
    caps.push(cap)
    seated += cap
  }

  const outer = radiusOf(caps.length - 1)
  const scale =
    available <= 0
      ? 1
      : outer > available
        ? available / outer
        : Math.min(MAX_GROW, Math.max(1, (available * TARGET_FILL) / outer))

  const seats: Seat[] = []
  distribute(count, caps).forEach((take, ring) => {
    if (take <= 0) return
    const radius = radiusOf(ring) * scale
    const step = TAU / take
    // Twelve o'clock, with every other ring turned half a slot. Rings that line up
    // radially read as spokes, and the spokes would be an artifact of the seating.
    const start = -TAU / 4 + (ring % 2) * (step / 2)
    for (let slot = 0; slot < take; slot++) {
      const angle = start + slot * step
      seats.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, ring })
    }
  })

  return { seats, scale, extent: outer * scale }
}

/** Split `count` across the rings in proportion to what each one holds. */
function distribute(count: number, caps: number[]): number[] {
  const total = caps.reduce((sum, cap) => sum + cap, 0)
  const exact = caps.map((cap) => (count * cap) / total)
  const take = exact.map((value) => Math.floor(value))

  let left = count - take.reduce((sum, n) => sum + n, 0)
  const byRemainder = exact
    .map((value, ring) => ({ ring, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  // Largest remainder first, and never past what a ring holds. Bounded by the number of
  // rings: each pass hands out at least one seat, or every ring is already full.
  for (let pass = 0; left > 0 && pass <= caps.length; pass++) {
    for (const { ring } of byRemainder) {
      if (left === 0) break
      const current = take[ring] ?? 0
      if (current < (caps[ring] ?? 0)) {
        take[ring] = current + 1
        left--
      }
    }
  }

  return take
}

/** The angle equivalent to `target` that is nearest `previous`, so nothing spins the long way. */
export function unwrap(previous: number, target: number): number {
  let delta = (target - previous) % TAU
  if (delta > Math.PI) delta -= TAU
  if (delta < -Math.PI) delta += TAU
  return previous + delta
}

/** Signed angular distance, in (-π, π]. */
export function angleGap(a: number, b: number): number {
  let delta = (a - b) % TAU
  if (delta > Math.PI) delta -= TAU
  if (delta < -Math.PI) delta += TAU
  return delta
}
