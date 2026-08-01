/**
 * The drawing: one centre, one ring, straight edges, nothing else.
 *
 * Every node is a **spoke** — turn to a bearing, then run out to a radius — and the centre
 * is the same thing at radius zero. That is the whole trick behind the hop. The node you
 * click keeps its elements all the way in, and the node you leave keeps its elements all
 * the way out, because neither is created or destroyed: their lengths are swapped. Anything
 * that survives a hop slides, and only nodes that genuinely leave the neighbourhood fade.
 *
 * Motion is CSS. A spoke's two elements carry matching transform lists — `rotate scale` on
 * the arm, `rotate translate rotate` on the node, the trailing turn keeping the label
 * upright — so both interpolate componentwise over one duration and the arm and the node
 * it carries cannot come apart mid-flight.
 *
 * Arms and nodes live in separate layers rather than one group per spoke. They have to:
 * every arm meets at the origin, so with a group each they would be painted across the
 * centre mark.
 *
 * See docs/decisions/0005-a-second-view-that-keeps-no-world.md.
 */
import type { NodeMeta } from "../api.js"
import { angleGap, layOut, unwrap, type Seat } from "./rings.js"

const SVG_NS = "http://www.w3.org/2000/svg"

/** The centre is a fixed size. A neighbour's size is its degree — what is behind it. */
const CENTRE_R = 26
const NEIGHBOUR_R = { min: 6, max: 15 } as const

/** Degree at which a neighbour draws full size. Past this the scale saturates. */
const DEGREE_FULL = 24

/** Past this many neighbours the labels overlap into noise, and wait for a hover. */
const LABEL_LIMIT = 28

/** Room left between the outermost ring and the window edge. */
const MARGIN = 72

/** Must outlast the fade in the stylesheet, or elements vanish mid-transition. */
const LEAVE_MS = 320

/** Rings resolve outward rather than all at once. */
const RING_STAGGER_MS = 45

/** Where a spoke with nothing better to go on points. Twelve o'clock. */
const DEFAULT_BEARING = -Math.PI / 2

interface Spoke {
  arm: SVGLineElement
  node: SVGGElement
  title: SVGTitleElement
  dot: SVGCircleElement
  hit: SVGCircleElement
  label: SVGTextElement
  /** Unwrapped, so a spoke never turns the long way round to reach its next bearing. */
  angle: number
  length: number
}

interface Move {
  spoke: Spoke
  meta: NodeMeta
  angle: number
  length: number
  radius: number
  ring: number
  isCentre: boolean
}

const radiusFor = (degree: number): number => {
  const reach = Math.log1p(Math.max(0, degree)) / Math.log1p(DEGREE_FULL)
  return NEIGHBOUR_R.min + (NEIGHBOUR_R.max - NEIGHBOUR_R.min) * Math.min(1, reach)
}

export class OrbitView {
  private readonly svg: SVGSVGElement
  private readonly scene: SVGGElement
  private readonly armLayer: SVGGElement
  private readonly nodeLayer: SVGGElement
  private readonly spokes = new Map<string, Spoke>()
  private shown: { centre: NodeMeta; neighbours: NodeMeta[] } | null = null
  private pick: ((id: string) => void) | null = null

  constructor(private readonly host: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, "svg")
    this.scene = document.createElementNS(SVG_NS, "g")
    this.armLayer = document.createElementNS(SVG_NS, "g")
    this.nodeLayer = document.createElementNS(SVG_NS, "g")
    this.scene.append(this.armLayer, this.nodeLayer)
    this.svg.append(this.scene)
    host.append(this.svg)
    this.recentre()

    this.svg.addEventListener("click", (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const node = target.closest(".node")
      if (!node || node.classList.contains("is-centre")) return
      const id = node.getAttribute("data-id")
      if (id) this.pick?.(id)
    })
  }

  onPick(handler: (id: string) => void): void {
    this.pick = handler
  }

  /** Redraw the neighbourhood already on screen against a new window size. */
  resize(): void {
    if (this.shown) this.show(this.shown.centre, this.shown.neighbours)
  }

  /**
   * Start the hop before the answer exists.
   *
   * The neighbours of the clicked node are still a fetch away, but one thing is already
   * known: that node is about to be the centre. Sending it there now is what keeps the
   * page feeling immediate — waiting for the response first would spend the whole of the
   * API's latency on a still screen.
   */
  beginHop(id: string): void {
    this.svg.classList.add("is-hopping")
    const spoke = this.spokes.get(id)
    if (!spoke) return
    this.mark(spoke, "is-centre", true)
    this.delay(spoke, 0)
    this.wear(spoke, CENTRE_R)
    this.aim(spoke, spoke.angle, 0, false)
  }

  /** Draw this neighbourhood, moving whatever is already on screen into place. */
  show(centre: NodeMeta, neighbours: NodeMeta[]): void {
    this.shown = { centre, neighbours }
    this.recentre()

    const { seats, scale } = layOut(neighbours.length, this.available())
    // Read before anything moves: seating depends on where the spokes currently point.
    const ordered = this.assign(neighbours, seats)
    this.svg.classList.toggle("dense", neighbours.length > LABEL_LIMIT)

    // A ring that had to be compressed shrinks its marks with it. One that was given room
    // to breathe does not — a neighbour swelling toward the size of the centre would read
    // as an encoding, and the only thing size means here is degree.
    const markScale = Math.min(1, scale)

    const moves: Move[] = []
    const alive = new Set<string>()
    let born = false

    const enrol = (
      meta: NodeMeta,
      angle: number,
      length: number,
      radius: number,
      ring: number,
      isCentre: boolean,
    ): void => {
      alive.add(meta.id)
      let spoke = this.spokes.get(meta.id)
      if (!spoke) {
        // Born on its own bearing, short of its seat and invisible, so it blooms outward
        // instead of appearing whole.
        spoke = this.create(meta.id, angle, length * 0.86)
        born = true
      }
      moves.push({ spoke, meta, angle, length, radius, ring, isCentre })
    }

    // The centre keeps whatever bearing it arrived on — it sits at radius zero, so the
    // bearing stays invisible until it leaves again.
    const inbound = this.spokes.get(centre.id)
    enrol(centre, inbound?.angle ?? DEFAULT_BEARING, 0, CENTRE_R, 0, true)

    ordered.forEach((meta, index) => {
      const seat = seats[index]
      if (!meta || !seat) return
      enrol(
        meta,
        Math.atan2(seat.y, seat.x),
        Math.hypot(seat.x, seat.y),
        Math.max(3, radiusFor(meta.degree) * markScale),
        seat.ring,
        false,
      )
    })

    // A just-inserted element has no previous computed style, so its first transition is
    // skipped. One forced layout read gives the browser a state to move away from.
    if (born) void this.svg.getBoundingClientRect()

    for (const move of moves) this.settle(move)

    for (const [id, spoke] of [...this.spokes]) {
      if (!alive.has(id)) this.retire(id, spoke)
    }

    this.svg.classList.remove("is-hopping")
  }

  private settle(move: Move): void {
    const { spoke, meta, radius, ring, isCentre } = move
    this.mark(spoke, "is-centre", isCentre)
    this.mark(spoke, "is-entering", false)
    this.delay(spoke, isCentre ? 0 : ring * RING_STAGGER_MS)

    if (spoke.label.textContent !== meta.label) spoke.label.textContent = meta.label
    spoke.title.textContent = `${meta.label} · degree ${String(meta.degree)}`
    this.wear(spoke, radius)

    // A spoke resting at the origin has no bearing worth keeping. Turning it there is
    // invisible anyway, so snap it rather than sweep a stale angle round to the new one.
    this.aim(spoke, move.angle, move.length, spoke.length === 0 && move.length > 0)
  }

  /** Size the mark, its hit area, and where the label hangs. */
  private wear(spoke: Spoke, radius: number): void {
    spoke.dot.setAttribute("r", String(radius))
    spoke.hit.setAttribute("r", String(Math.max(radius + 10, 17)))
    spoke.label.setAttribute("y", String(radius + 14))
  }

  private aim(spoke: Spoke, angle: number, length: number, snap: boolean): void {
    const bearing = unwrap(spoke.angle, angle)
    spoke.angle = bearing
    spoke.length = length

    if (snap) {
      // One frame without a transition, so only the run outward is animated.
      spoke.arm.style.transition = "none"
      spoke.node.style.transition = "none"
      this.pose(spoke, bearing, length)
      void this.svg.getBoundingClientRect()
      spoke.arm.style.transition = ""
      spoke.node.style.transition = ""
    }
    this.pose(spoke, bearing, length)
  }

  /**
   * The arm is a unit line stretched to length, so one transform carries both its bearing
   * and its reach. The node turns the same way, runs out the same distance, then turns
   * back — which is what keeps its label upright through the sweep.
   */
  private pose(spoke: Spoke, bearing: number, length: number): void {
    const turn = `rotate(${String(bearing)}rad)`
    spoke.arm.style.transform = `${turn} scale(${String(Math.max(length, 0.001))}, 1)`
    spoke.node.style.transform =
      `${turn} translate(${String(length)}px, 0) rotate(${String(-bearing)}rad)`
  }

  private mark(spoke: Spoke, name: string, on: boolean): void {
    spoke.arm.classList.toggle(name, on)
    spoke.node.classList.toggle(name, on)
  }

  private delay(spoke: Spoke, ms: number): void {
    const value = `${String(ms)}ms`
    spoke.arm.style.transitionDelay = value
    spoke.node.style.transitionDelay = value
  }

  /**
   * Seat the neighbours, keeping whoever is already on screen where they are.
   *
   * A returning neighbour takes the free seat nearest the bearing it already holds.
   * Seating in the order the API returned them would reshuffle the ring on every hop, and
   * then nothing would look like it stayed put — which is the one thing the surviving
   * elements exist to convey.
   */
  private assign(neighbours: NodeMeta[], seats: Seat[]): (NodeMeta | undefined)[] {
    const out = new Array<NodeMeta | undefined>(seats.length).fill(undefined)
    const taken = new Set<number>()
    const fresh: NodeMeta[] = []

    for (const meta of neighbours) {
      const spoke = this.spokes.get(meta.id)
      // Length zero means the node being left. It is at the origin, so it has no bearing
      // to preserve and may as well take whatever seat is going.
      if (!spoke || spoke.length === 0) {
        fresh.push(meta)
        continue
      }

      let best = -1
      let bestGap = Infinity
      for (let index = 0; index < seats.length; index++) {
        const seat = seats[index]
        if (!seat || taken.has(index)) continue
        const gap = Math.abs(angleGap(Math.atan2(seat.y, seat.x), spoke.angle))
        if (gap < bestGap) {
          bestGap = gap
          best = index
        }
      }

      if (best < 0) {
        fresh.push(meta)
        continue
      }
      taken.add(best)
      out[best] = meta
    }

    let cursor = 0
    for (const meta of fresh) {
      while (cursor < seats.length && taken.has(cursor)) cursor++
      if (cursor >= seats.length) break
      taken.add(cursor)
      out[cursor] = meta
    }

    return out
  }

  private create(id: string, angle: number, length: number): Spoke {
    const arm = document.createElementNS(SVG_NS, "line")
    arm.setAttribute("class", "arm is-entering")
    arm.setAttribute("x1", "0")
    arm.setAttribute("y1", "0")
    arm.setAttribute("x2", "1")
    arm.setAttribute("y2", "0")
    // Without this the stroke would stretch with the scale that gives the arm its length.
    arm.setAttribute("vector-effect", "non-scaling-stroke")

    const node = document.createElementNS(SVG_NS, "g")
    node.setAttribute("class", "node is-entering")
    node.setAttribute("data-id", id)

    const title = document.createElementNS(SVG_NS, "title")

    // A transparent disc wider than the mark: a six-pixel dot is not a click target.
    const hit = document.createElementNS(SVG_NS, "circle")
    hit.setAttribute("class", "hit")
    hit.setAttribute("r", "17")

    const dot = document.createElementNS(SVG_NS, "circle")
    dot.setAttribute("class", "dot")
    dot.setAttribute("r", String(NEIGHBOUR_R.min))

    const label = document.createElementNS(SVG_NS, "text")
    label.setAttribute("class", "label")
    label.setAttribute("y", "20")

    node.append(title, hit, dot, label)
    this.armLayer.append(arm)
    this.nodeLayer.append(node)

    const spoke: Spoke = { arm, node, title, dot, hit, label, angle, length }
    // Where it comes from, not where it is going: set before the first transition can run.
    this.pose(spoke, angle, length)

    this.spokes.set(id, spoke)
    return spoke
  }

  private retire(id: string, spoke: Spoke): void {
    this.spokes.delete(id)
    spoke.node.removeAttribute("data-id")
    this.mark(spoke, "is-leaving", true)
    this.delay(spoke, 0)
    // Drifting outward as it goes reads as leaving, rather than as being switched off.
    this.pose(spoke, spoke.angle, spoke.length * 1.12)
    window.setTimeout(() => {
      spoke.arm.remove()
      spoke.node.remove()
    }, LEAVE_MS)
  }

  private recentre(): void {
    const x = this.host.clientWidth / 2
    const y = this.host.clientHeight / 2
    this.scene.setAttribute("transform", `translate(${String(x)}, ${String(y)})`)
  }

  /** How far out the outermost ring may go before it has to be compressed. */
  private available(): number {
    const shortest = Math.min(this.host.clientWidth, this.host.clientHeight)
    return Math.max(96, shortest / 2 - MARGIN)
  }
}
