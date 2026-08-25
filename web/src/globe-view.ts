/**
 * The map, drawn on the projected surface. One canvas, one frame loop, no render library.
 *
 * Positions never change here either. Every frame reads a world position out of `world.ts`
 * and turns it into an offset from the middle of the viewport. `projection.ts` bends that
 * offset. The camera is a pan and a zoom held in this file.
 *
 * Three things Cytoscape supplied are written out here: the draw, the pick, and the camera.
 * Its `z-index` becomes the order the passes in `draw` run in. Its stylesheet becomes the
 * branches inside them. Its ids stay, because a ghost's id is what the page reads a node back
 * out of.
 *
 * What the page may call is `MapSurface` in map.ts. Nothing outside that reaches the canvas.
 */
import {
  CENTRE_TEXT,
  DISSOLVE_MS,
  FLIGHT_MAX,
  FLIGHT_MIN,
  FLIGHT_SPEED,
  GHOST_MARGIN,
  PILL_FONT,
  PILL_HALO,
  PILL_PAD,
  RING_TEXT,
  SLOT_GAP,
  STUB_REACH,
  ghostId,
  ghostTarget,
  type MapEvents,
  type MapSurface,
  type TextStyle,
} from "./map.js"
import { LONG_EDGE, NODE_SIZE, type Point, type Slot } from "./placement.js"
import { currentPalette, type Palette } from "./palette.js"
import {
  CURVATURE,
  bounds,
  horizon,
  marginAngle,
  project,
  radius,
  unproject,
  type Projected,
} from "./projection.js"
import { NUL, edgeKey } from "./store/keys.js"
import type { World, WorldNode } from "./world.js"

const TAU = Math.PI * 2

/** The stub's own diameter, in world units. */
const STUB_SIZE = 7

/** How long the ghosts left behind take to fade, once a flight has started. */
const LEAVING_MS = 260

/**
 * The OS setting for reduced motion. Read on each flight rather than once at load, so a
 * change takes effect on the next click instead of the next reload.
 */
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)")

/** The easing the flight timings were judged against, as its four control values. */
const EASE = { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } as const

/** How round a pill's corners are, as a fraction of its shorter side. */
const PILL_CORNER = 0.25

/**
 * The smallest a name is drawn at, in screen pixels. Below this the pill is drawn empty.
 *
 * Three pixels of text is a smear, and the shrink toward the limb passes through every size on
 * the way to nothing. The pill keeps shrinking, so the mark does not disappear with the name.
 */
const TEXT_FLOOR = 3

/**
 * The smallest radius a disc is drawn at, in screen pixels.
 *
 * A node shrinks by `cos(t)` and reaches zero at the limb. Without a floor the last few
 * degrees draw as a smear. This is the size every node is at when it goes.
 */
const DOT_FLOOR = 1.5

/** How many segments a drawn edge is cut into. A straight line between two ends is wrong. */
const EDGE_STEPS = 14

/** Line widths in world units, so a line thickens with the zoom the way a node grows. */
const EDGE_WIDTH = 1.5
const ACCENT_WIDTH = 2
/** The dash a ghost's lead and a stub's lead are drawn with, in world units. */
const LEAD_DASH = [6, 3]
/** The dash on a node with neighbours nobody has read, in world units. */
const FRONTIER_DASH = [1, 3]

/** How far a wheel notch zooms. A notch out leaves about four fifths of the scale. */
const WHEEL_SENSITIVITY = 0.22
/** A wheel event measured in lines rather than pixels, as Firefox sends. */
const LINE_HEIGHT = 16

const MIN_ZOOM = 0.14
const MAX_ZOOM = 2.4

/** How far the pointer may travel during a press and still count as a tap, in screen pixels. */
const TAP_SLOP = 8

/** How much of its contrast a node near the centre gives up, so the ring reads over it. */
const BACKDROP_ALPHA = 0.22
/** A ring pill's fill. Where two overlap, the front one is still readable. */
const RING_OPACITY = 0.92
/** How loud the dash on a node with unread neighbours is. */
const FRONTIER_ALPHA = 0.55
/** Border widths in world units: a read in flight, a ghost, and the centre's ring. */
const LOADING_WIDTH = 3
const GHOST_WIDTH = 2
const CENTRE_RING = 3
/** The ring on the node a release would join to, and how far outside the shape it sits. */
const AIM_WIDTH = 3
const AIM_OFFSET = 2

/**
 * Ids for the two elements that replace a long edge: a stub at one end, and the short line
 * joining that stub to its node.
 *
 * Joined with `NUL`, including the kind letter, so neither can collide with a node whose name
 * starts with `s` or `e`. `keys.ts` owns that character.
 */
const stubId = (key: string, owner: string): string => `s${NUL}${key}${NUL}${owner}`
const leadId = (id: string): string => `e${NUL}${id}`

/** One drawn element: a node, a stub, or a ghost. */
interface Drawn {
  id: string
  /** World position. Assigned once, and written again only during a ghost's flight. */
  x: number
  y: number
  kind: "node" | "stub" | "ghost"
  label: string
  /** 0 the centre, 1 its neighbours, 2 the rest, 3 the nodes the centre crowds. */
  tier: number
  degree: number
  /** The node has neighbours nobody has read. */
  more: boolean
  /** A read is in flight for this node. */
  loading: boolean
  /** A stub a ghost has replaced. It comes back when the ghost is lowered. */
  hidden: boolean
  /** 1, except while a ghost fades out. */
  alpha: number
}

/** One drawn line, by the ids of the two elements it joins. */
interface Line {
  a: string
  b: string
  kind: "edge" | "stub" | "ghost"
}

/** A ghost on the map: its element id, the centre that raised it, and the node it names. */
interface Ghost {
  ghost: string
  centre: string
  target: string
}

/**
 * The ghost positions for one centre node, held for as long as it is the centre.
 *
 * `at` is only added to, so a ghost never moves. `slotsFor` maintains this and explains why.
 */
interface Doorways {
  centre: string
  /** Every position this centre offers, in the order they are assigned. */
  pool: Point[]
  /** The position each neighbour holds. Only added to. */
  at: Map<string, Point>
}

/**
 * What a drive script can ask this renderer.
 *
 * Registered on the container, the way Cytoscape registers `_cyreg` on its own. A canvas holds
 * no element per node, so a script driving this map has no other handle on what was drawn.
 * `scripts/drive-globe.mjs` is the only reader.
 *
 * Read-only, and one call for the whole picture. A script that had to ask twice could be told
 * two different frames.
 */
export interface MapProbe {
  report: () => Drawing
}

/** One frame, as a drive script sees it. */
export interface Drawing {
  /** How many frames this renderer has drawn. */
  frames: number
  /** How long those frames took, in milliseconds. The two together give the cost of one. */
  drawMs: number
  zoom: number
  /** Where the middle of the screen is, in world coordinates. */
  centre: Point
  /** The surface radius, in screen pixels. */
  radius: number
  /** The angle past which nothing is on screen, in radians. */
  horizon: number
  accent: string | null
  elements: DrawnAs[]
}

/** One element, as a drive script sees it. */
export interface DrawnAs {
  id: string
  kind: "node" | "stub" | "ghost"
  label: string
  tier: number
  /** Where it is drawn, in canvas pixels, or null once the surface has turned away. */
  at: Point | null
  /** How much of its size the surface left it: 1 at the middle, 0 at the limb. */
  k: number
  /** How far past the horizon its box lies, in radians. Zero or less means partly on screen. */
  past: number
  /** The footprint it draws, in world units. */
  box: Slot
}

/** Where the probe is registered, and under what name. */
type Probed = HTMLElement & { __map?: MapProbe }

/** A camera or a ghost travelling between two points. */
interface Journey {
  from: Point
  to: Point
  start: number
  ms: number
}

/**
 * A cubic bezier easing, solved for its y at time x the way a browser solves a transition.
 *
 * Newton from a straight-line guess, which converges in a few steps on a curve this shallow.
 * The flight timings were judged against this curve, so a plain cubic here would change how
 * long a flight looks.
 */
function ease(t: number): number {
  const bez = (u: number, p1: number, p2: number): number =>
    3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u
  let u = t
  for (let i = 0; i < 5; i++) {
    const slope =
      3 * (1 - u) * (1 - u) * EASE.x1 +
      6 * (1 - u) * u * (EASE.x2 - EASE.x1) +
      3 * u * u * (1 - EASE.x2)
    if (Math.abs(slope) < 1e-6) break
    u -= (bez(u, EASE.x1, EASE.x2) - t) / slope
  }
  return bez(Math.min(1, Math.max(0, u)), EASE.y1, EASE.y2)
}

/** A name, as the canvas wants it. */
const fontOf = (text: TextStyle, px: number): string =>
  `${String(text.weight)} ${px.toFixed(2)}px ${PILL_FONT}`

/** How far a world point lies from a world segment. The right-click that parts a pair. */
function gapToSegment(at: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const along = length > 0 ? ((at.x - a.x) * dx + (at.y - a.y) * dy) / length : 0
  const held = Math.min(1, Math.max(0, along))
  return Math.hypot(at.x - (a.x + dx * held), at.y - (a.y + dy * held))
}

/** How near the pointer must come to a line before a right-click names it, in screen pixels. */
const LINE_REACH = 6

/** The five ways a line is drawn. Listed in the order the passes run. */
const LINE_ORDER = ["dim", "plain", "stub", "accent", "ghost"] as const
type LineClass = (typeof LINE_ORDER)[number]

/** How each of the five classes is drawn. Widths and dashes are in world units. */
const LINE_STYLE: Record<
  LineClass,
  { ink: (palette: Palette) => string; alpha: number; width: number; dash: readonly number[] }
> = {
  dim: { ink: (p) => p.edge, alpha: 0.12, width: EDGE_WIDTH, dash: [] },
  plain: { ink: (p) => p.edge, alpha: 0.55, width: EDGE_WIDTH, dash: [] },
  stub: { ink: (p) => p.textMuted, alpha: 0.75, width: EDGE_WIDTH, dash: LEAD_DASH },
  accent: { ink: (p) => p.edgeActive, alpha: 0.9, width: ACCENT_WIDTH, dash: [] },
  ghost: { ink: (p) => p.edgeActive, alpha: 0.9, width: ACCENT_WIDTH, dash: LEAD_DASH },
}

/** One element and where the surface put it. */
interface Shown {
  node: Drawn
  at: Projected
}

/** The border around a pill or a disc, where the node has earned one. */
interface Border {
  colour: string
  /** In world units, so it thickens with the zoom. */
  width: number
  alpha: number
  dash: readonly number[]
}

/** What a pill is made of. */
interface PillStyle {
  text: TextStyle
  /** The fill, or null for a ghost, which is drawn hollow. */
  fill: string | null
  /** How opaque that fill is. Two ring pills overlap, and the loser stays partly visible. */
  opacity: number
  ink: string
  border: Border | null
}

/**
 * Which pill is drawn on top, by degree.
 *
 * Two names overlap because they sit at the same radius, so distance cannot break the tie.
 * `seatAndLink` in world.ts already ranks neighbours by degree for the closest positions.
 * Ranking by it here applies the same rule twice rather than adding a new one.
 *
 * Ascending, because the last pill drawn is the one on top. The id settles a tie, so the
 * picture does not depend on the order the elements arrived in.
 */
const byPaint = (a: Drawn, b: Drawn): number =>
  a.degree - b.degree || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

export class GlobeView implements MapSurface {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private palette = currentPalette()

  /** Every drawn element by id: nodes, stubs and ghosts alike. */
  private readonly elements = new Map<string, Drawn>()
  /** Every drawn line by id. A short edge is its pair key, and a lead is `leadId` of its end. */
  private readonly lines = new Map<string, Line>()
  /** Which lines touch an element, so removing one does not scan the whole map. */
  private readonly linesAt = new Map<string, Set<string>>()

  /** Where the middle of the screen is in world coordinates, and the scale it draws at. */
  private readonly cam = { x: 0, y: 0, zoom: 1 }

  /** Half the canvas in CSS pixels, and the surface radius those two give. */
  private halfW = 1
  private halfH = 1
  private R = 1

  /**
   * How curved the surface is drawn. Written by `curve`, and the fallback until it is.
   *
   * Kept as the setting rather than as a radius, and read where `R` is computed. So a window
   * that changed shape and a slider that moved both take effect on the next frame. Neither
   * leaves a stale radius behind.
   */
  private curvature: number = CURVATURE.fallback

  /**
   * One list per event name, written only through `on`.
   *
   * The read casts, because TypeScript cannot see that a key and its handler list stay in step
   * across a generic parameter. Nothing else touches the map, so `on` is the whole proof.
   */
  private readonly listeners = new Map<keyof MapEvents, unknown[]>()

  private accentId: string | null = null
  private stubbed = 0
  /** True while the camera is flying. Nothing may take the accent until it lands. */
  private flying = false
  /** The node whose name the pointer is holding open, or null. */
  private hovered: string | null = null
  /** The node a drag would join to, or null. */
  private aimed: string | null = null
  /** The element the pointer was last reported over, so a crossing can be told from a move. */
  private entered: string | null = null
  /** The ghosts the current centre raised, and the node each one stands in for. */
  private ghosts: Ghost[] = []
  /** Ghost positions for the current centre. Built on the first pass, then only extended. */
  private doorways: Doorways | null = null

  /** False while a gesture has the drag to itself. See drag-join.ts. */
  private panEnabled = true
  /** Set by anything that changes the picture, and cleared by the frame that draws it. */
  private dirty = true
  /** How many frames have been drawn, and how long they took. Only the probe reads these. */
  private frames = 0
  private drawMs = 0

  /** The camera on its way somewhere, if it is. */
  private glide: Journey | null = null
  /** The ghost on its way to the node it names, if one is. */
  private flier: (Journey & { id: string }) | null = null
  /** Ghosts fading out, and how long each fade runs for. */
  private readonly fading = new Map<string, { start: number; ms: number }>()

  /** Pointers held down on the canvas, by id, at their last position in client coordinates. */
  private readonly down = new Map<number, Point>()
  /** The press in progress: how far it has travelled, and what it was last over. */
  private press: { moved: number; over: string | null } | null = null
  /** The gap between two fingers on the previous move, in screen pixels. */
  private pinch = 0

  /**
   * Measured name widths, keyed by the size and the name.
   *
   * The size identifies the whole style, because this file sets exactly two: a neighbour's
   * name and the centre's. Measured on the canvas the pill is later drawn on, so the width a
   * slot is reserved at is the width the name takes.
   */
  private readonly widths = new Map<string, number>()

  constructor(
    container: HTMLElement,
    private readonly world: World,
  ) {
    this.canvas = document.createElement("canvas")
    this.canvas.style.display = "block"
    this.canvas.style.width = "100%"
    this.canvas.style.height = "100%"
    container.append(this.canvas)
    const ctx = this.canvas.getContext("2d")
    if (!ctx) throw new Error("the map needs a 2d canvas")
    this.ctx = ctx
    ;(container as Probed).__map = { report: () => this.report() }
    this.measure()
    this.bind()
    requestAnimationFrame(this.frame)
  }

  /** Hear one of the map's events. Every handler added for a name is called, in order. */
  on<K extends keyof MapEvents>(name: K, handler: MapEvents[K]): void {
    const list = this.listeners.get(name) ?? []
    list.push(handler)
    this.listeners.set(name, list)
  }

  private each<K extends keyof MapEvents>(name: K): MapEvents[K][] {
    return (this.listeners.get(name) ?? []) as MapEvents[K][]
  }

  /** Redraw on the next frame. */
  private paint(): void {
    this.dirty = true
  }

  /** The camera moved. Every settle on the page hangs off this. */
  private moved(): void {
    this.dirty = true
    for (const hear of this.each("viewport")) hear()
  }

  /* ---------------------------------------------------------------- the frame loop */

  /**
   * One frame: advance whatever is moving, then draw if anything changed.
   *
   * The loop runs whether or not there is work, and the flag is what keeps a still map off the
   * GPU. A dropped loop would need something to restart it on the next pan.
   */
  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame)
    this.advance(now)
    if (!this.dirty) return
    this.dirty = false
    const began = performance.now()
    this.draw()
    this.drawMs += performance.now() - began
  }

  /** Move the camera, the ghost in flight, and every fade, to where `now` puts them. */
  private advance(now: number): void {
    const glide = this.glide
    if (glide) {
      const at = ease(glide.ms > 0 ? Math.min(1, (now - glide.start) / glide.ms) : 1)
      this.cam.x = glide.from.x + (glide.to.x - glide.from.x) * at
      this.cam.y = glide.from.y + (glide.to.y - glide.from.y) * at
      if (at >= 1) this.glide = null
      this.moved()
    }

    const flier = this.flier
    if (flier) {
      const at = ease(flier.ms > 0 ? Math.min(1, (now - flier.start) / flier.ms) : 1)
      const ghost = this.elements.get(flier.id)
      if (ghost) {
        ghost.x = flier.from.x + (flier.to.x - flier.from.x) * at
        ghost.y = flier.from.y + (flier.to.y - flier.from.y) * at
      }
      if (at >= 1) this.flier = null
      this.paint()
    }

    for (const [id, fade] of this.fading) {
      const element = this.elements.get(id)
      if (!element) {
        this.fading.delete(id)
        continue
      }
      element.alpha = Math.max(0, 1 - (now - fade.start) / fade.ms)
      if (element.alpha <= 0) this.fading.delete(id)
      this.paint()
    }
  }

  /* ---------------------------------------------------------------- gestures */

  /**
   * Turn pointer events into this map's own. The one place the two vocabularies meet.
   *
   * `nodeEnter` and `nodeLeave` are raised for a mouse only. A finger dragging across the map
   * would otherwise light every node it crossed, and the name it opened would be under the
   * finger.
   *
   * `pressEnd` reports null where the release landed on nothing, and for a release on a line.
   * A line is not a node, and the page has nothing to do with one at the end of a drag.
   */
  private bind(): void {
    const canvas = this.canvas

    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId)
      this.down.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (this.down.size >= 2) {
        this.pinch = this.fingerGap()
        return
      }
      const hit = this.pick(event.offsetX, event.offsetY)
      this.press = { moved: 0, over: hit }
      if (hit) for (const hear of this.each("pressStart")) hear(hit, event)
    })

    canvas.addEventListener("pointermove", (event) => {
      const last = this.down.get(event.pointerId)
      if (last) {
        const dx = event.clientX - last.x
        const dy = event.clientY - last.y
        last.x = event.clientX
        last.y = event.clientY
        if (this.press) this.press.moved += Math.hypot(dx, dy)
        if (this.down.size >= 2) {
          this.spread()
          return
        }
        // Not during a flight: the camera is already going somewhere, and a pan would land it
        // where neither asked for. Not while panning is switched off either, which is how a
        // gesture keeps the drag to itself.
        if (this.panEnabled && !this.flying) this.panBy({ x: dx, y: dy })
        for (const hear of this.each("pressMove")) hear(event)
      }
      this.crossed(event)
    })

    canvas.addEventListener("pointerup", (event) => {
      this.down.delete(event.pointerId)
      this.pinch = 0
      const press = this.press
      if (!press) return
      this.press = null
      const hit = this.pick(event.offsetX, event.offsetY)
      for (const hear of this.each("pressEnd")) hear(hit)
      // A pan that ended over a node is not a click on it. The threshold is what tells the
      // reader who dragged from the reader who meant to press.
      if (!hit || press.moved > TAP_SLOP) return
      for (const hear of this.each("nodeTap")) hear(hit)
    })

    // A cancelled pointer arrives as no release at all. drag-join.ts has to hear the end of
    // the press either way, or panning stays switched off.
    canvas.addEventListener("pointercancel", (event) => {
      this.down.delete(event.pointerId)
      this.pinch = 0
      if (!this.press) return
      this.press = null
      for (const hear of this.each("pressEnd")) hear(null)
    })

    canvas.addEventListener("pointerleave", () => {
      if (this.entered === null) return
      this.entered = null
      for (const hear of this.each("nodeLeave")) hear()
    })

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault()
        const delta = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT : event.deltaY
        const factor = Math.pow(10, (-delta / 250) * WHEEL_SENSITIVITY)
        this.zoomAbout({ x: event.offsetX, y: event.offsetY }, factor)
      },
      { passive: false },
    )

    canvas.addEventListener("contextmenu", (event) => {
      const node = this.pick(event.offsetX, event.offsetY)
      if (node) {
        for (const hear of this.each("nodeMenu")) hear(node, event)
        return
      }
      const line = this.pickLine(event.offsetX, event.offsetY)
      if (line) for (const hear of this.each("edgeMenu")) hear(line.a, line.b, event)
    })
  }

  /** What the pointer has just crossed onto, or off, during a press and outside one. */
  private crossed(event: PointerEvent): void {
    const hit = this.pick(event.offsetX, event.offsetY)
    const press = this.press
    if (press && hit !== press.over) {
      press.over = hit
      if (hit) for (const hear of this.each("pressOver")) hear(hit)
      else for (const hear of this.each("pressOut")) hear()
    }
    if (event.pointerType !== "mouse" || hit === this.entered) return
    this.entered = hit
    if (hit) for (const hear of this.each("nodeEnter")) hear(hit)
    else for (const hear of this.each("nodeLeave")) hear()
  }

  /** The gap between the two pointers on the canvas, in screen pixels. */
  private fingerGap(): number {
    const [a, b] = [...this.down.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  /** Two fingers moving apart or together, as a zoom about the point between them. */
  private spread(): void {
    const gap = this.fingerGap()
    const [a, b] = [...this.down.values()]
    if (this.pinch <= 0 || gap <= 0 || !a || !b) {
      this.pinch = gap
      return
    }
    const box = this.canvas.getBoundingClientRect()
    const middle = { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top }
    this.zoomAbout(middle, gap / this.pinch)
    this.pinch = gap
  }

  /* ---------------------------------------------------------------- the camera */

  /** Half the canvas and the radius it gives, read back from the element that holds it. */
  private measure(): void {
    this.halfW = (this.canvas.clientWidth || 2) / 2
    this.halfH = (this.canvas.clientHeight || 2) / 2
    this.R = radius(this.halfW, this.halfH, this.curvature)
  }

  panBy(by: Point): void {
    this.cam.x -= by.x / this.cam.zoom
    this.cam.y -= by.y / this.cam.zoom
    this.moved()
  }

  /**
   * Zoom by a factor, holding one point on the canvas still.
   *
   * `R` is a property of the window and the curvature. The flat offset of the world point
   * under `at` therefore does not change with the zoom. The point stays put when the camera
   * moves by the change in that offset, at the cursor as well as at the middle.
   */
  zoomAbout(at: Point, factor: number): void {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.zoom * factor))
    if (zoom === this.cam.zoom) return
    const flat = unproject(at.x - this.halfW, at.y - this.halfH, this.R)
    const held = {
      x: this.cam.x + flat.x / this.cam.zoom,
      y: this.cam.y + flat.y / this.cam.zoom,
    }
    this.cam.zoom = zoom
    this.cam.x = held.x - flat.x / zoom
    this.cam.y = held.y - flat.y / zoom
    this.moved()
  }

  panning(on: boolean): void {
    this.panEnabled = on
  }

  centre(): Point {
    return { x: this.cam.x, y: this.cam.y }
  }

  /**
   * Half the viewport's smaller span, in world units — how far a claim on the centre may look.
   *
   * The flat half-span, not the arc the surface reaches over. A node past the middle is
   * compressed. A claim reaching into that band would name a centre the reader cannot read.
   */
  reach(): number {
    return Math.min(this.halfW, this.halfH) / this.cam.zoom
  }

  resize(): void {
    this.measure()
    this.paint()
  }

  /**
   * Curve the surface, or flatten it. The reader's slider is what calls this.
   *
   * Not clamped here. `curvature()` in settings.ts is the only source, and it clamps.
   *
   * `moved` rather than `paint`, because what the window shows has changed. A flatter surface
   * reaches over less of the world. A neighbour legible at its own seat before the move may
   * need a doorway after it. Every settle a pan gets is a settle this one needs.
   */
  curve(value: number): void {
    if (value === this.curvature) return
    this.curvature = value
    this.moved()
  }

  restyle(palette: Palette): void {
    this.palette = palette
    this.paint()
  }

  /** A world point as a flat screen offset from the middle: the camera, before the surface. */
  private flatOf(at: Point): Point {
    return { x: (at.x - this.cam.x) * this.cam.zoom, y: (at.y - this.cam.y) * this.cam.zoom }
  }

  screenOf(id: string): Point | null {
    const element = this.elements.get(id)
    if (!element) return null
    const flat = this.flatOf(element)
    const at = project(flat.x, flat.y, this.R)
    return at ? { x: this.halfW + at.x, y: this.halfH + at.y } : null
  }

  containerOffset(): Point {
    const box = this.canvas.getBoundingClientRect()
    return { x: box.left, y: box.top }
  }

  /* ---------------------------------------------------------------- picking */

  /**
   * The element under a canvas position, or null.
   *
   * Run in world coordinates rather than on the drawn shapes. `project` is one-to-one inside
   * the limb, so a world-space test against a world-sized box answers the same question a
   * screen-space test would. It takes one `unproject` rather than one per element.
   *
   * A stub is never returned. It stands for the far end of a long edge and names no node.
   */
  private pick(x: number, y: number): string | null {
    const flat = unproject(x - this.halfW, y - this.halfH, this.R)
    const at = {
      x: this.cam.x + flat.x / this.cam.zoom,
      y: this.cam.y + flat.y / this.cam.zoom,
    }
    for (const element of this.topDown()) {
      if (element.hidden || element.kind === "stub" || element.alpha <= 0) continue
      const box = this.boxOf(element)
      if (
        Math.abs(at.x - element.x) <= box.w / 2 &&
        Math.abs(at.y - element.y) <= box.h / 2
      ) {
        return element.id
      }
    }
    return null
  }

  /**
   * Every element, topmost first. The reverse of the order `draw` paints them in.
   *
   * The last loop repeats the elements already yielded. A repeat is one box test that has
   * already failed, and listing the exceptions again would be more code than that.
   */
  private *topDown(): Generator<Drawn> {
    const centre = this.accentId ? this.elements.get(this.accentId) : undefined
    if (centre) yield centre

    const ghosts = this.ghosts
      .map((ghost) => this.elements.get(ghost.ghost))
      .filter((ghost): ghost is Drawn => ghost !== undefined)
      .sort((a, b) => byPaint(b, a))
    for (const ghost of ghosts) yield ghost

    const hovered = this.hovered ? this.elements.get(this.hovered) : undefined
    if (hovered) yield hovered

    if (this.accentId) {
      const ring = this.world
        .neighbours(this.accentId)
        .map((id) => this.elements.get(id))
        .filter((node): node is Drawn => node !== undefined)
        .sort((a, b) => byPaint(b, a))
      for (const node of ring) yield node
    }

    for (const element of this.elements.values()) yield element
  }

  /**
   * The line nearest the pointer, or null where none is near enough.
   *
   * Measured in world coordinates, like the pick above, and the tolerance is converted at the
   * cursor. Near the limb one screen pixel covers many world units, which is what the local
   * scale in the divisor stands for.
   */
  private pickLine(x: number, y: number): Line | null {
    const flat = unproject(x - this.halfW, y - this.halfH, this.R)
    const at = {
      x: this.cam.x + flat.x / this.cam.zoom,
      y: this.cam.y + flat.y / this.cam.zoom,
    }
    const scale = project(flat.x, flat.y, this.R)?.k ?? 1
    let nearest = LINE_REACH / (this.cam.zoom * Math.max(0.2, scale))
    let found: Line | null = null
    for (const line of this.lines.values()) {
      const a = this.elements.get(line.a)
      const b = this.elements.get(line.b)
      if (!a || !b || a.hidden || b.hidden) continue
      const gap = gapToSegment(at, a, b)
      if (gap >= nearest) continue
      nearest = gap
      found = line
    }
    return found
  }

  /** The footprint an element draws, in world units. */
  private boxOf(element: Drawn): Slot {
    if (element.kind === "stub") return { w: STUB_SIZE, h: STUB_SIZE }
    if (element.kind === "ghost") return this.pillBox(element.label, RING_TEXT)
    if (element.tier === 0) return this.pillBox(element.label, CENTRE_TEXT)
    // A disc under the pointer draws as its name, so the name is what a click lands on. The
    // pill covers the disc, so entering by the disc and leaving by the pill cannot flicker.
    if (element.tier === 1 || element.id === this.hovered) {
      return this.pillBox(element.label, RING_TEXT)
    }
    return { w: NODE_SIZE.resting, h: NODE_SIZE.resting }
  }

  private pillBox(label: string, text: TextStyle): Slot {
    return { w: this.nameWidth(label, text) + 2 * PILL_PAD, h: text.size + 2 * PILL_PAD }
  }

  /** How wide a name draws, in world units. */
  private nameWidth(label: string, text: TextStyle): number {
    const key = `${String(text.size)}${NUL}${label}`
    let width = this.widths.get(key)
    if (width === undefined) {
      this.ctx.font = fontOf(text, text.size)
      width = this.ctx.measureText(label).width
      this.widths.set(key, width)
    }
    return width
  }

  /* ---------------------------------------------------------------- the elements */

  get longEdgeCount(): number {
    return this.stubbed
  }

  get accent(): string | null {
    return this.accentId
  }

  get inFlight(): boolean {
    return this.flying
  }

  /** Add elements. Existing ones are never changed. `drop` removes, and only for an undo. */
  add(nodes: readonly WorldNode[], edges: readonly [string, string][]): void {
    // A node can arrive while its parent is already the centre, so it has to be created in the
    // right tier. Waiting for the next accent change would draw a neighbour as a distant node.
    const accent = this.accentId
    const ring = accent ? new Set(this.world.neighbours(accent)) : null

    for (const node of nodes) {
      if (this.elements.has(node.id)) continue
      this.elements.set(node.id, {
        id: node.id,
        x: node.x,
        y: node.y,
        kind: "node",
        label: node.label,
        tier: node.id === accent ? 0 : ring?.has(node.id) ? 1 : 2,
        degree: node.degree,
        more: this.world.missing(node.id) > 0,
        loading: false,
        hidden: false,
        alpha: 1,
      })
    }

    for (const [a, b] of edges) {
      const key = edgeKey(a, b)
      if (this.world.span(a, b) <= LONG_EDGE) {
        this.addLine(key, { a, b, kind: "edge" })
        continue
      }
      // Too long to draw as a line without crossing everything in between. Each end gets a
      // short stub pointing at the other, so the direction is visible without the clutter.
      const from = this.world.get(a)
      const to = this.world.get(b)
      if (!from || !to) continue
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
      const ux = (to.x - from.x) / length
      const uy = (to.y - from.y) / length
      for (const [owner, sx, sy] of [
        [a, from.x + ux * STUB_REACH, from.y + uy * STUB_REACH],
        [b, to.x - ux * STUB_REACH, to.y - uy * STUB_REACH],
      ] as const) {
        const stub = stubId(key, owner)
        this.elements.set(stub, {
          id: stub,
          x: sx,
          y: sy,
          kind: "stub",
          label: "",
          tier: 2,
          degree: 0,
          more: false,
          loading: false,
          hidden: false,
          alpha: 1,
        })
        this.addLine(leadId(stub), { a: owner, b: stub, kind: "stub" })
      }
      this.stubbed++
    }

    // A new edge can make a node complete. Update the dashed border on both ends.
    for (const [a, b] of edges) {
      for (const id of [a, b]) {
        const node = this.elements.get(id)
        if (node) node.more = this.world.missing(id) > 0
      }
    }
    // A node already on the map when this read landed was given a tier before it was known to
    // be a neighbour of the centre. Only `setAccent` recomputes tiers, and it does not run
    // until the accent moves, so promote it here.
    if (accent) this.setTiers(accent, true)
    this.paint()

    // No ghost pass here, on purpose. A read can leave new nodes off screen with no ghost
    // standing in for them, but this also runs for a late placement. Ghosts are only raised on
    // a settled camera, and main.ts schedules a settle when a read lands.
  }

  /**
   * Remove elements, for an undone write.
   *
   * The only removal on the map. It has to undo whichever form `add` chose. A short edge is
   * one line under the pair key. A long edge is two stubs and two leads, and removing a stub
   * removes its lead with it. Both forms are tried, because which one was drawn depended on a
   * distance that may have changed since.
   *
   * The ghost test is against the slot plan rather than the ghosts on screen. The plan is the
   * larger set: a slot is held for a neighbour whose ghost is lowered. Rebuilding it also lets
   * the remaining slots use the space the removal just freed.
   */
  drop(nodeIds: readonly string[], edges: readonly [string, string][]): void {
    const plan = this.doorways
    if (plan && nodeIds.some((id) => id === plan.centre || plan.at.has(id))) {
      this.clearGhosts()
    }

    for (const [a, b] of edges) {
      const key = edgeKey(a, b)
      this.removeLine(key)
      for (const owner of [a, b]) {
        const stub = stubId(key, owner)
        if (!this.elements.has(stub)) continue
        this.removeElement(stub)
        // `add` counts once per long edge, so decrement once per long edge here.
        if (owner === a) this.stubbed = Math.max(0, this.stubbed - 1)
      }
    }
    for (const id of nodeIds) this.removeElement(id)
    // An accent pointing at a deleted node would keep the HUD naming it until the camera
    // moved. Clear it here. The caller picks a new one.
    if (this.accentId && nodeIds.includes(this.accentId)) this.accentId = null

    // Each surviving end of a removed edge may have unread neighbours again.
    for (const [a, b] of edges) {
      for (const id of [a, b]) {
        if (nodeIds.includes(id)) continue
        const node = this.elements.get(id)
        if (node) node.more = this.world.missing(id) > 0
      }
    }
    this.paint()
  }

  private addLine(id: string, line: Line): void {
    if (this.lines.has(id)) return
    this.lines.set(id, line)
    for (const end of [line.a, line.b]) {
      const touching = this.linesAt.get(end) ?? new Set<string>()
      touching.add(id)
      this.linesAt.set(end, touching)
    }
  }

  private removeLine(id: string): void {
    const line = this.lines.get(id)
    if (!line) return
    this.lines.delete(id)
    for (const end of [line.a, line.b]) this.linesAt.get(end)?.delete(id)
  }

  /** Remove an element and every line that reaches it. */
  private removeElement(id: string): void {
    this.elements.delete(id)
    // Copied, because `removeLine` writes to the set being read.
    for (const line of [...(this.linesAt.get(id) ?? [])]) this.removeLine(line)
    this.linesAt.delete(id)
  }

  /**
   * Change the name a node draws, and nothing else.
   *
   * For a rename that kept its key, where the id is the same node and only the spelling moved.
   * A pill takes both dimensions from its name, so the box changes with it. Position, tier and
   * edges are untouched.
   */
  relabel(id: string, label: string): void {
    const node = this.elements.get(id)
    if (!node) return
    node.label = label
    this.paint()
  }

  loading(id: string, active: boolean): void {
    const node = this.elements.get(id)
    if (!node) return
    node.loading = active
    this.paint()
  }

  /**
   * Name the node under the pointer, or clear the one that is named.
   *
   * One at a time, and cleared here rather than by the caller. `crossed` reports the element
   * being left before the one being entered, so this normally finds nothing to clear.
   */
  hover(id: string | null): void {
    if (id === this.hovered) return
    this.hovered = id
    this.paint()
  }

  /**
   * Mark the node a drag would join to, or clear the mark.
   *
   * The same one-at-a-time shape as `hover`, and a separate field on purpose. This one is not
   * scoped to a tier. Either end of a drag may be any node drawn, the centre included. So the
   * mark has to draw wherever the pointer lands.
   */
  aim(id: string | null): void {
    if (id === this.aimed) return
    this.aimed = id
    this.paint()
  }

  /* ---------------------------------------------------------------- tiers */

  /**
   * How far the centre's neighbours reach. This is also how far the dimmed area extends.
   *
   * Measured from the neighbours joined by a drawn line, so it is a world distance and not a
   * screen one. A radius that followed the camera would dim a different set of nodes at every
   * zoom. This asks which nodes the centre crowds, and positions are what settle that.
   *
   * Long edges are excluded. A neighbour reached by two stubs is far enough that using it
   * would dim half the map for one node.
   */
  private ringReach(id: string): number {
    let reach = 0
    for (const other of this.world.neighbours(id)) {
      const span = this.world.span(id, other)
      if (span <= LONG_EDGE) reach = Math.max(reach, span)
    }
    return reach > 0 ? reach + NODE_SIZE.neighbour : 0
  }

  /**
   * The nodes the centre crowds: close enough to be in the way, but not joined to it.
   *
   * A radius test, not a corridor test. Corridor membership changes as the accent drifts,
   * which would flicker nodes in and out during a pan.
   */
  private backdropOf(id: string): string[] {
    const centre = this.world.get(id)
    const reach = this.ringReach(id)
    if (!centre || reach <= 0) return []
    const spared = new Set([id, ...this.world.neighbours(id)])
    return this.world
      .nodesWithin(centre, reach)
      .filter((node) => !spared.has(node.id))
      .map((node) => node.id)
  }

  /**
   * Set the tier of a node, its neighbours, and the nodes it crowds.
   *
   * Nothing is written to the lines. How a line is drawn follows from the tiers of its two
   * ends. `classOf` reads those at draw time, so a line's colour cannot go stale.
   */
  private setTiers(id: string, active: boolean): void {
    const node = this.elements.get(id)
    if (node) node.tier = active ? 0 : 2
    for (const other of this.world.neighbours(id)) {
      const neighbour = this.elements.get(other)
      if (neighbour) neighbour.tier = active ? 1 : 2
    }
    for (const other of this.backdropOf(id)) {
      const backdrop = this.elements.get(other)
      if (backdrop) backdrop.tier = active ? 3 : 2
    }
  }

  /**
   * Make a node the accent and demote the previous one. It touches only the two neighbourhoods
   * involved, so it stays cheap during a pan.
   */
  setAccent(id: string): boolean {
    if (id === this.accentId || !this.elements.has(id)) return false
    const previous = this.accentId
    this.accentId = id

    this.clearGhosts()
    // Clear the old tiers before setting the new ones. A node in both neighbourhoods then ends
    // up promoted rather than demoted.
    if (previous) this.setTiers(previous, false)
    this.setTiers(id, true)

    // A hovered node promoted to the centre or its ring has left the hover pill's scope. The
    // flag draws nothing at those two tiers, so dropping it here costs no mark. It stops the
    // node drawing as a hovered pill when it demotes again with the pointer elsewhere.
    const hovered = this.hovered ? this.elements.get(this.hovered) : undefined
    if (hovered && hovered.tier < 2) this.hover(null)
    this.paint()
    return true
  }

  /* ---------------------------------------------------------------- ghosts */

  /**
   * How far past the horizon a node's drawn box lies, in radians. Zero or less means some part
   * of it is on screen.
   *
   * The box, not the position, because a neighbour draws as its name. A position just past the
   * horizon can still have half its name inside it, and a ghost for it would show the same
   * name twice.
   *
   * The nearest corner of the box, because that is the part of it that leaves last.
   */
  private outsideBy(id: string, edge: number): number {
    const node = this.elements.get(id)
    // There is no node here, so return the value that raises no ghost.
    if (!node) return -Infinity
    const box = this.boxOf(node)
    const flat = this.flatOf(node)
    const gapX = Math.max(0, Math.abs(flat.x) - (box.w / 2) * this.cam.zoom)
    const gapY = Math.max(0, Math.abs(flat.y) - (box.h / 2) * this.cam.zoom)
    return Math.hypot(gapX, gapY) / this.R - edge
  }

  /**
   * Where each of a centre's ghosts stands. Built once per centre, then only extended.
   *
   * The slots cannot be recomputed on each pass. `seat` spreads what it is given evenly, so the
   * same neighbours in a different number come back on different bearings. And a ghost does not
   * occupy the grid, so asking for one slot twice returns the same point twice. Either way, a
   * set that changed with the camera would move ghosts that are already on screen.
   *
   * The pool is sized from the degree the store reports, not from the neighbours drawn so far.
   * A read that lands later then finds a slot free. A write that adds a neighbour beyond that
   * size leaves it without a slot for the rest of the visit.
   *
   * `reach` is read here only, on the pass that builds the plan, for the same reason. It sets
   * how far out the outermost ring can sit, and a reach that followed the zoom would move
   * ghosts already shown. So a visit is measured once, at the zoom it started at.
   */
  private slotsFor(
    centre: string,
    known: readonly string[],
    reach: number,
    outside: ReadonlyMap<string, number>,
    margin: number,
  ): ReadonlyMap<string, Point> {
    let plan = this.doorways
    if (!plan || plan.centre !== centre) {
      const room = Math.max(known.length, this.world.get(centre)?.degree ?? 0)
      // Slots are sized for the widest name known now. The degree covers a neighbour that
      // arrives later. A name that has not arrived cannot be measured, so a longer one will
      // overhang its slot.
      plan = {
        centre,
        pool: this.world.slotsAround(centre, room, this.slotBox(known), reach),
        at: new Map(),
      }
      this.doorways = plan
    }

    // A slot is claimed only by a neighbour past the margin, meaning one about to get a ghost.
    // Assigning one to every neighbour up front would spend the pool on names already in view.
    // A hub has more neighbours than the rings have room for.
    //
    // This depends on the camera, and that is safe because a claim is never released. The
    // camera decides who receives a free slot. It cannot move or revoke a slot already held,
    // so a neighbour that goes out of view and comes back finds its own waiting.
    if (plan.at.size < plan.pool.length) {
      for (const target of this.ghostable(known, centre)) {
        if (plan.at.has(target) || (outside.get(target) ?? -Infinity) <= margin) continue
        // The lowest slot not yet assigned, because none is ever released.
        const at = plan.pool[plan.at.size]
        if (at) plan.at.set(target, at)
      }
    }
    return plan.at
  }

  /**
   * The size one slot must hold, taken from the widest name that could land in it.
   *
   * One size for the whole plan, not one per neighbour, because any neighbour may take any
   * slot. The ranking decides who gets which, and it changes as reads land.
   *
   * The height comes from the font size, not from a measurement. A pill is one line, so its
   * height is the font size plus the padding.
   */
  private slotBox(ids: readonly string[]): Slot {
    let widest = 0
    for (const id of ids) {
      const label = this.world.get(id)?.label
      if (label) widest = Math.max(widest, this.nameWidth(label, RING_TEXT))
    }
    const around = 2 * PILL_PAD + 2 * PILL_HALO + SLOT_GAP
    return { w: widest + around, h: RING_TEXT.size + around }
  }

  /**
   * The centre's neighbours, ordered by who should get a ghost first.
   *
   * Neighbours with no drawn line first. A neighbour off screen whose edge is drawn still shows
   * which way the connection goes. One drawn as two stubs shows almost nothing, so a ghost is
   * worth more there. `add` decided which pairs got a line, and this reads the map back rather
   * than recomputing it.
   *
   * Then nearest first. Those are the most likely to be worth walking to. Degree breaks a tie,
   * as it does for the paint order, and ties are common because a parent's neighbours sit at
   * one radius. Id breaks the rest, so the result does not depend on which edge was linked
   * first.
   *
   * Every neighbour is listed. The order matters, not the length: `slotsFor` walks this list
   * and gives a slot to each neighbour that needs one.
   *
   * This does not depend on the camera, so two neighbours never swap order during a pan.
   */
  private ghostable(known: readonly string[], centre: string): string[] {
    const ranked = known.map((other) => ({
      id: other,
      unlined: this.lines.has(edgeKey(centre, other)) ? 1 : 0,
      span: this.world.span(centre, other),
      degree: this.world.get(other)?.degree ?? 0,
    }))
    ranked.sort(
      (a, b) =>
        a.unlined - b.unlined ||
        a.span - b.span ||
        b.degree - a.degree ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    return ranked.map((entry) => entry.id)
  }

  /** The stub at one end of a long edge, or nothing where the edge is drawn as a line. */
  private stubAt(owner: string, other: string): Drawn | undefined {
    return this.elements.get(stubId(edgeKey(owner, other), owner))
  }

  /**
   * Raise a ghost for every neighbour off screen, and lower every ghost whose neighbour has
   * come into view.
   *
   * Idempotent, and run on a settled camera rather than per frame. A ghost holds a doorway
   * slot, and slots appearing and disappearing during a fast pan would flicker.
   *
   * The two tests are deliberately not opposites. A ghost is lowered as soon as any part of
   * its target is on screen. It is raised only once the target is `GHOST_MARGIN` past the
   * horizon. One pass can therefore never both lower and raise a ghost for one neighbour.
   *
   * Runs whether or not the centre is itself on screen. A neighbour can come back into view
   * while the centre is still outside it. Skipping the pass would leave that ghost standing.
   *
   * Nothing is written to the occupancy grid. A ghost holds no ground, which is what stops
   * `nearestTo` ever returning one and making a ghost the centre.
   */
  reviseGhosts(): void {
    const centre = this.accentId
    if (!centre || this.flying) return

    const known = this.world.neighbours(centre)
    const edge = horizon(this.halfW, this.halfH, this.R)
    const margin = marginAngle(GHOST_MARGIN, this.R)
    // Measure every neighbour, not only the ones holding a slot, because `slotsFor` chooses
    // from these.
    const outside = new Map<string, number>()
    for (const target of known) outside.set(target, this.outsideBy(target, edge))
    // How far out a slot may sit: half the viewport's smaller side. `slotsFor` reads this only
    // on the pass that builds the plan, and explains why.
    const reach = this.reach()
    const slots = this.slotsFor(centre, known, reach, outside, margin)

    const neighbours = new Set(known)
    const standing = new Set<string>()
    const down: Ghost[] = []
    for (const ghost of this.ghosts) {
      // A ghost whose target is no longer a neighbour is lowered too. Undoing a join removes
      // the edge and keeps both nodes, so nothing else would lower it.
      const gap = outside.get(ghost.target) ?? -Infinity
      if (neighbours.has(ghost.target) && gap > 0) standing.add(ghost.target)
      else down.push(ghost)
    }

    /** A ghost about to be raised, with the slot it stands in. */
    const up: (Ghost & { at: Point })[] = []
    for (const [target, at] of slots) {
      // The plan keeps a slot for a node that is no longer a neighbour, because it is only ever
      // added to. Without this test the loop above would lower that ghost and this one would
      // raise it again, showing an edge that no longer exists.
      if (!neighbours.has(target)) continue
      if (standing.has(target) || (outside.get(target) ?? -Infinity) <= margin) continue
      const node = this.world.get(target)
      if (!node) continue
      up.push({ ghost: ghostId(centre, target), centre, target, at })
    }

    // A settle fires on every camera stop. When nothing crossed a threshold, stop here.
    if (!down.length && !up.length) return

    for (const ghost of down) this.lower(ghost)
    for (const raised of up) {
      const node = this.world.get(raised.target)
      if (!node) continue
      // Hide the long edge's stub at this end. The ghost says the same thing more clearly. A
      // short edge has no stub, and its line stays: the line shows where the neighbour actually
      // is, which a ghost cannot.
      const stub = this.stubAt(centre, raised.target)
      if (stub) stub.hidden = true
      this.elements.set(raised.ghost, {
        id: raised.ghost,
        x: raised.at.x,
        y: raised.at.y,
        kind: "ghost",
        label: node.label,
        tier: 2,
        degree: node.degree,
        more: false,
        loading: false,
        hidden: false,
        alpha: 1,
      })
      this.addLine(leadId(raised.ghost), { a: centre, b: raised.ghost, kind: "ghost" })
    }
    this.ghosts = [
      ...this.ghosts.filter((ghost) => standing.has(ghost.target)),
      ...up.map(({ ghost, centre: from, target }) => ({ ghost, centre: from, target })),
    ]
    this.paint()
  }

  /** Lower one ghost and show the stub it replaced. */
  private lower(ghost: Ghost): void {
    const stub = this.stubAt(ghost.centre, ghost.target)
    if (stub) stub.hidden = false
    this.removeElement(ghost.ghost)
    this.fading.delete(ghost.ghost)
  }

  /** Lower every ghost and discard the slot plan. */
  private clearGhosts(): void {
    // Before the early return, because a plan outlives its ghosts. A centre whose neighbours
    // are all on screen has a plan with no slots assigned. A stale plan surviving an accent
    // change is the one way the slots come out wrong.
    this.doorways = null
    if (!this.ghosts.length) return
    for (const ghost of this.ghosts) this.lower(ghost)
    this.ghosts = []
    this.paint()
  }

  /* ---------------------------------------------------------------- the flight */

  /**
   * Where a world point is drawn, clamped to the limb so a point past it still has a place.
   *
   * Only `flightTime` reads this. A flight often starts or ends outside the limb, and the
   * distance it covers on screen is what the speed is measured in.
   */
  private drawnAt(at: Point): Point {
    const flat = this.flatOf(at)
    const found = project(flat.x, flat.y, this.R)
    if (found) return found
    const d = Math.hypot(flat.x, flat.y) || 1
    return { x: (flat.x / d) * this.R, y: (flat.y / d) * this.R }
  }

  /**
   * How long a flight should take, from how far it looks on screen.
   *
   * A fixed duration cannot suit distances that vary tenfold. It is a jump cut at one end and
   * slow at the other. Holding the speed roughly constant is what the eye judges, and the two
   * clamps stop both extremes.
   *
   * The drawn distance, not the world distance times the zoom. Those two differ by the local
   * scale, and near the limb that difference is most of the answer.
   *
   * Zero when the OS asks for reduced motion. The camera then cuts to the destination and the
   * ghost fades where it lands. The fade is kept: a fade is the right replacement for a
   * movement.
   */
  private flightTime(from: Point, to: Point): number {
    if (REDUCED_MOTION.matches) return 0
    const a = this.drawnAt(from)
    const b = this.drawnAt(to)
    const pixels = Math.hypot(b.x - a.x, b.y - a.y)
    return Math.min(FLIGHT_MAX, Math.max(FLIGHT_MIN, pixels / FLIGHT_SPEED))
  }

  /** Move the camera so a node sits in the middle of the screen. */
  focus(id: string, animate = true): void {
    const node = this.world.get(id)
    if (!node) return
    if (!animate) {
      this.glide = null
      this.cam.x = node.x
      this.cam.y = node.y
      this.moved()
      return
    }
    this.glide = {
      from: this.centre(),
      to: { x: node.x, y: node.y },
      start: performance.now(),
      ms: this.flightTime(this.centre(), node),
    }
    this.moved()
  }

  /**
   * Fly to the node a ghost stands in for, and fade the ghost out on arrival.
   *
   * The ghost is not removed on the click. It moves. If it disappeared as soon as its centre
   * stopped being the centre, the thing the reader clicked would be gone by the second frame.
   * So the accent is held for the duration and the ghost travels to the real node, arriving as
   * the camera finishes centring it.
   *
   * This is the one place anything on the map moves, and `advance` is what moves it. Every
   * other position in `elements` is written once, by `add` or by `reviseGhosts`.
   */
  flyTo(ghost: string, onArrive: (target: string) => void): boolean {
    const target = ghostTarget(ghost)
    const node = target ? this.world.get(target) : null
    const flier = this.elements.get(ghost)
    if (!target || !node || this.flying || !flier) return false

    const from = this.ghosts.find((one) => one.ghost === ghost)?.centre ?? null
    const duration = this.flightTime(flier, node)
    const start = performance.now()
    this.flying = true

    // Fade out the other ghosts. They belong to the centre being left behind.
    for (const other of this.ghosts) {
      if (other.ghost === ghost) continue
      this.fading.set(other.ghost, { start, ms: LEAVING_MS })
    }

    this.glide = { from: this.centre(), to: { x: node.x, y: node.y }, start, ms: duration }
    this.flier = {
      id: ghost,
      from: { x: flier.x, y: flier.y },
      to: { x: node.x, y: node.y },
      start,
      ms: duration,
    }
    this.paint()

    // Two moments, not one. `setAccent` names the node the camera landed on, and the ghost
    // fades out over the next 320ms. Waiting for the fade would leave the map naming the node
    // the reader started from.
    setTimeout(() => {
      this.flying = false
      // Take the flying ghost out of the list. `setAccent` lowers the others, and this one is
      // still fading and outlives them. Its removal is scheduled before anything that could
      // throw, so it cannot be left on the map.
      this.ghosts = this.ghosts.filter((one) => one.ghost !== ghost)
      this.fading.set(ghost, { start: performance.now(), ms: DISSOLVE_MS })
      setTimeout(() => {
        this.removeElement(ghost)
        this.fading.delete(ghost)
        this.paint()
      }, DISSOLVE_MS)
      const stub = from ? this.stubAt(from, target) : undefined
      if (stub) stub.hidden = false
      this.setAccent(target)
      this.reviseGhosts()
      onArrive(target)
    }, duration)
    return true
  }

  /* ---------------------------------------------------------------- the draw */

  /**
   * One pass over the map, back to front.
   *
   * The limb, then the lines, then the discs, then the names. Within the names, the ring, the
   * name under the pointer, the ghosts and the centre. `byPaint` orders the ring and the
   * ghosts among themselves.
   */
  private draw(): void {
    const ctx = this.ctx
    this.frames++
    this.measure()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.round(this.halfW * 2 * dpr)
    const height = Math.round(this.halfH * 2 * dpr)
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = this.palette.plane
    ctx.fillRect(0, 0, this.halfW * 2, this.halfH * 2)
    ctx.translate(this.halfW, this.halfH)

    // The surface as a body: a fill and a ring, at every curvature. Above curvature 1 the disc
    // is wider than the window, and the ring is then off screen rather than switched off.
    ctx.beginPath()
    ctx.arc(0, 0, this.R, 0, TAU)
    ctx.fillStyle = this.palette.surface
    ctx.fill()
    ctx.setLineDash([])
    ctx.lineWidth = 1
    ctx.strokeStyle = this.palette.hairline
    ctx.stroke()

    const shown = this.onScreen()
    this.drawLines()
    this.drawDiscs(shown)
    this.drawNames(shown)
    this.drawAim(shown)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  /** Every element the surface still has room for, with where it put each one. */
  private onScreen(): Shown[] {
    const reach = bounds(this.R)
    const shown: Shown[] = []
    for (const node of this.elements.values()) {
      if (node.hidden || node.alpha <= 0) continue
      const flat = this.flatOf(node)
      // A cheap box before the arithmetic. It is wider than the disc at the corners, so it
      // passes a few nodes `project` then refuses, which is the right way round.
      if (Math.abs(flat.x) > reach || Math.abs(flat.y) > reach) continue
      const at = project(flat.x, flat.y, this.R)
      if (at) shown.push({ node, at })
    }
    return shown
  }

  /** Which of the five ways a line is drawn, from its kind and the tiers of its two ends. */
  private classOf(line: Line, a: Drawn, b: Drawn): LineClass {
    if (line.kind !== "edge") return line.kind
    if (a.tier === 0 || b.tier === 0) return "accent"
    if (a.tier === 3 || b.tier === 3) return "dim"
    return "plain"
  }

  /** Faintest class first, so a line that matters is drawn over the mesh. */
  private drawLines(): void {
    const buckets = new Map<LineClass, Line[]>()
    for (const line of this.lines.values()) {
      const a = this.elements.get(line.a)
      const b = this.elements.get(line.b)
      if (!a || !b || a.hidden || b.hidden) continue
      const cls = this.classOf(line, a, b)
      const held = buckets.get(cls)
      if (held) held.push(line)
      else buckets.set(cls, [line])
    }
    for (const cls of LINE_ORDER) this.strokeLines(cls, buckets.get(cls) ?? [])
  }

  /**
   * One class of line, as one path and one stroke.
   *
   * Every line in a class is the same colour and the same width, so the whole class is one
   * `stroke` however many lines it holds. Each line is cut into `EDGE_STEPS` segments, because
   * a straight line between two projected ends leaves the surface.
   */
  private strokeLines(cls: LineClass, lines: readonly Line[]): void {
    if (!lines.length) return
    const ctx = this.ctx
    const reach = bounds(this.R)
    ctx.beginPath()
    let drew = false
    for (const line of lines) {
      const a = this.elements.get(line.a)
      const b = this.elements.get(line.b)
      if (!a || !b) continue
      const fa = this.flatOf(a)
      const fb = this.flatOf(b)
      // Both ends far outside on the same side: nothing between them is on screen.
      if ((fa.x < -reach && fb.x < -reach) || (fa.x > reach && fb.x > reach)) continue
      if ((fa.y < -reach && fb.y < -reach) || (fa.y > reach && fb.y > reach)) continue
      let open = false
      for (let step = 0; step <= EDGE_STEPS; step++) {
        const along = step / EDGE_STEPS
        const at = project(
          fa.x + (fb.x - fa.x) * along,
          fa.y + (fb.y - fa.y) * along,
          this.R,
        )
        if (!at) {
          open = false
          continue
        }
        if (open) ctx.lineTo(at.x, at.y)
        else {
          ctx.moveTo(at.x, at.y)
          open = true
        }
        drew = true
      }
    }
    if (!drew) return
    const style = LINE_STYLE[cls]
    ctx.globalAlpha = style.alpha
    ctx.strokeStyle = style.ink(this.palette)
    ctx.lineWidth = Math.max(0.1, style.width * this.cam.zoom)
    ctx.setLineDash(style.dash.map((gap) => gap * this.cam.zoom))
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.setLineDash([])
  }

  /**
   * The nodes that draw as discs, and the stubs.
   *
   * Every disc in one pass is one colour, so a pass is one path and one fill however many
   * nodes it holds. Overlap inside a pass is invisible for the same reason, which is why
   * nothing here is sorted.
   */
  private drawDiscs(shown: readonly Shown[]): void {
    const ctx = this.ctx
    const zoom = this.cam.zoom
    ctx.setLineDash([])

    const disc = (at: Projected, size: number): void => {
      const r = Math.max(DOT_FLOOR, (size / 2) * zoom * at.k)
      ctx.moveTo(at.x + r, at.y)
      ctx.arc(at.x, at.y, r, 0, TAU)
    }
    /** A node that draws as a disc: not the centre, not a neighbour, not the one hovered. */
    const plain = (node: Drawn): boolean =>
      node.kind === "node" && node.tier >= 2 && node.id !== this.hovered

    // The backdrop first, then the rest.
    for (const [tier, alpha] of [
      [3, BACKDROP_ALPHA],
      [2, 1],
    ] as const) {
      ctx.beginPath()
      let drew = false
      for (const { node, at } of shown) {
        if (!plain(node) || node.tier !== tier) continue
        disc(at, NODE_SIZE.resting)
        drew = true
      }
      if (!drew) continue
      ctx.globalAlpha = alpha
      ctx.fillStyle = this.palette.hop[2]!
      ctx.fill()
    }

    ctx.beginPath()
    let stubs = false
    for (const { node, at } of shown) {
      if (node.kind !== "stub") continue
      disc(at, STUB_SIZE)
      stubs = true
    }
    if (stubs) {
      ctx.globalAlpha = 1
      ctx.fillStyle = this.palette.textMuted
      ctx.fill()
    }

    // "This node has unread neighbours", as a dash rather than a colour, so it still reads for
    // somebody who cannot tell two ramp steps apart. One width for the pass, so every ring is
    // drawn in one stroke.
    ctx.beginPath()
    let frontier = false
    for (const { node, at } of shown) {
      if (!plain(node) || !node.more || node.loading) continue
      disc(at, NODE_SIZE.resting)
      frontier = true
    }
    if (frontier) {
      ctx.globalAlpha = FRONTIER_ALPHA
      ctx.strokeStyle = this.palette.frontierRing
      ctx.lineWidth = Math.max(0.4, zoom)
      ctx.setLineDash(FRONTIER_DASH.map((gap) => gap * zoom))
      ctx.stroke()
      ctx.setLineDash([])
    }

    // A read in flight. One node at a time in practice, so this one is drawn per node.
    ctx.globalAlpha = 1
    ctx.strokeStyle = this.palette.accent
    for (const { node, at } of shown) {
      if (!plain(node) || !node.loading) continue
      ctx.beginPath()
      disc(at, NODE_SIZE.resting)
      ctx.lineWidth = Math.max(0.6, LOADING_WIDTH * zoom * at.k)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  /** The four bands of names, back to front. */
  private drawNames(shown: readonly Shown[]): void {
    const palette = this.palette
    const ring: Shown[] = []
    const ghosts: Shown[] = []
    let hovered: Shown | null = null
    let centre: Shown | null = null

    for (const entry of shown) {
      const node = entry.node
      if (node.kind === "ghost") {
        ghosts.push(entry)
        continue
      }
      if (node.kind !== "node") continue
      if (node.tier === 0) centre = entry
      else if (node.tier === 1) ring.push(entry)
      else if (node.id === this.hovered) hovered = entry
    }

    ring.sort((a, b) => byPaint(a.node, b.node))
    ghosts.sort((a, b) => byPaint(a.node, b.node))

    for (const entry of ring) {
      this.drawPill(entry, {
        text: RING_TEXT,
        fill: palette.surface,
        // Nearly opaque, so where two pills overlap the front one is readable.
        opacity: RING_OPACITY,
        ink: palette.hop[0]!,
        border: null,
      })
    }

    // The page's own ink, not `hop[0]`. The ring's ink says "a neighbour of the centre", and
    // this node is not one. Opaque, unlike a ring pill: there is only ever one of these, and
    // legibility is its whole job.
    if (hovered) {
      this.drawPill(hovered, {
        text: RING_TEXT,
        fill: palette.surface,
        opacity: 1,
        ink: palette.textPrimary,
        border: null,
      })
    }

    // A ghost: hollow and dashed, so it is not mistaken for the node itself. The node exists
    // once, elsewhere on the map, and while the ghost stands it is off screen.
    for (const entry of ghosts) {
      this.drawPill(entry, {
        text: RING_TEXT,
        fill: null,
        opacity: 1,
        ink: palette.textSecondary,
        border: { colour: palette.hop[0]!, width: GHOST_WIDTH, alpha: 1, dash: LEAD_DASH },
      })
    }

    if (centre) {
      this.drawPill(centre, {
        text: CENTRE_TEXT,
        fill: palette.accent,
        opacity: 1,
        ink: palette.inkOnAccent,
        border: { colour: palette.accentRing, width: CENTRE_RING, alpha: 1, dash: [] },
      })
    }
  }

  /**
   * The border a node has earned, or null to leave the pill its own.
   *
   * A read in flight beats unread neighbours, and both beat the ring the centre draws. A read
   * is the shortest-lived of the three, and the only one that ends on its own.
   */
  private borderOf(node: Drawn): Border | null {
    if (node.loading) {
      return { colour: this.palette.accent, width: LOADING_WIDTH, alpha: 1, dash: [] }
    }
    if (node.more) {
      return {
        colour: this.palette.frontierRing,
        width: 1,
        alpha: FRONTIER_ALPHA,
        dash: FRONTIER_DASH,
      }
    }
    return null
  }

  /**
   * One name on its pill, at the size the surface left it.
   *
   * The halo is stroked before the fill, so the fill covers the inner half of it and what is
   * left reads as an outline. A pill below `TEXT_FLOOR` is drawn empty: the box keeps shrinking
   * toward the limb, so the mark stays even after the name is gone.
   */
  private drawPill(shown: Shown, style: PillStyle): void {
    const ctx = this.ctx
    const { node, at } = shown
    const box = this.pillBox(node.label, style.text)
    const scale = this.cam.zoom * at.k
    const width = box.w * scale
    const height = box.h * scale
    const round = Math.min(width, height) * PILL_CORNER
    const border = this.borderOf(node) ?? style.border

    ctx.setLineDash([])
    ctx.beginPath()
    ctx.roundRect(at.x - width / 2, at.y - height / 2, width, height, round)

    ctx.globalAlpha = node.alpha
    ctx.lineWidth = 2 * PILL_HALO * scale
    ctx.strokeStyle = this.palette.surface
    ctx.stroke()

    if (style.fill) {
      ctx.globalAlpha = node.alpha * style.opacity
      ctx.fillStyle = style.fill
      ctx.fill()
    }

    if (border) {
      ctx.globalAlpha = node.alpha * border.alpha
      ctx.lineWidth = Math.max(0.4, border.width * scale)
      ctx.strokeStyle = border.colour
      ctx.setLineDash(border.dash.map((gap) => gap * scale))
      ctx.stroke()
      ctx.setLineDash([])
    }

    const size = style.text.size * scale
    if (size >= TEXT_FLOOR) {
      ctx.globalAlpha = node.alpha
      ctx.fillStyle = style.ink
      ctx.font = fontOf(style.text, size)
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(node.label, at.x, at.y)
    }
    ctx.globalAlpha = 1
  }

  /**
   * The node a release would join to.
   *
   * A ring, and no name: whatever is under the pointer is already drawing one. So this says
   * which node the release would take, and nothing more. Drawn last, over every band, because
   * it lasts only as long as the button is held.
   */
  private drawAim(shown: readonly Shown[]): void {
    const aimed = this.aimed
    if (!aimed) return
    const found = shown.find((entry) => entry.node.id === aimed)
    if (!found) return
    const ctx = this.ctx
    const { node, at } = found
    const scale = this.cam.zoom * at.k

    ctx.beginPath()
    if (node.kind === "node" && node.tier >= 2 && node.id !== this.hovered) {
      const r = Math.max(DOT_FLOOR, (NODE_SIZE.resting / 2) * scale) + AIM_OFFSET * scale
      ctx.arc(at.x, at.y, r, 0, TAU)
    } else {
      const box = this.boxOf(node)
      const width = box.w * scale + 2 * AIM_OFFSET * scale
      const height = box.h * scale + 2 * AIM_OFFSET * scale
      ctx.roundRect(
        at.x - width / 2,
        at.y - height / 2,
        width,
        height,
        Math.min(width, height) * PILL_CORNER,
      )
    }
    ctx.setLineDash([])
    ctx.lineWidth = Math.max(1, AIM_WIDTH * scale)
    ctx.strokeStyle = this.palette.accent
    ctx.stroke()
  }

  /**
   * The whole frame, for a drive script. Nothing in the page reads this.
   *
   * Every element, not only the ones on screen. A script asking about a ghost is asking
   * whether the node it stands for is drawn, and a node past the limb answers `null`.
   */
  private report(): Drawing {
    const edge = horizon(this.halfW, this.halfH, this.R)
    return {
      frames: this.frames,
      drawMs: this.drawMs,
      zoom: this.cam.zoom,
      centre: this.centre(),
      radius: this.R,
      horizon: edge,
      accent: this.accentId,
      elements: [...this.elements.values()].map((node) => {
        const flat = this.flatOf(node)
        const at = node.hidden ? null : project(flat.x, flat.y, this.R)
        return {
          id: node.id,
          kind: node.kind,
          label: node.label,
          tier: node.tier,
          at: at ? { x: this.halfW + at.x, y: this.halfH + at.y } : null,
          k: at?.k ?? 0,
          past: this.outsideBy(node.id, edge),
          box: this.boxOf(node),
        }
      }),
    }
  }
}
