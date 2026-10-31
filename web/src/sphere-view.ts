/**
 * The map, drawn on the projected surface. One canvas, one frame loop, no render library.
 *
 * Positions never change here either. Every frame reads a world position out of `world.ts`
 * and turns it into an offset from the middle of the viewport. `projection.ts` bends that
 * offset. The camera is a pan and a zoom held in this file.
 *
 * Three things Cytoscape supplied are written out here: the draw, the pick, and the camera.
 * Its `z-index` becomes the order the passes in `draw` run in. Its stylesheet becomes the
 * branches inside them. Its ids stay, because an off-screen marker's id is what the page reads a
 * node back out of.
 *
 * What the page may call is `MapSurface` in map.ts. Nothing outside that reaches the canvas.
 */
import {
  SELECTED_NAME,
  SELECTED_TEXT,
  FADE_MS,
  MOVE_MAX_MS,
  MOVE_MIN_MS,
  MOVE_SPEED,
  MARKER_MARGIN,
  HOVER_NAME,
  LINE_STEP,
  LABEL_FONT,
  LABEL_OUTLINE,
  LABEL_PAD,
  NEIGHBOUR_NAME,
  NEIGHBOUR_TEXT,
  SLOT_GAP,
  STUB_REACH,
  markerId,
  markerTarget,
  type MapEvents,
  type MapSurface,
  type NameShape,
  type TextStyle,
} from "./map.js"
import { LONG_EDGE, NODE_SIZE, type Point, type Slot } from "./placement.js"
import { wrapName } from "./name-lines.js"
import { currentPalette, type Palette } from "./palette.js"
import {
  CURVATURE,
  bounds,
  visibleLimit,
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

/** How long the off-screen markers left behind take to fade, once a flight has started. */
const FADE_OTHERS_MS = 260

/**
 * The OS setting for reduced motion. Read on each flight rather than once at load, so a
 * change takes effect on the next click instead of the next reload.
 */
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)")

/** The easing the flight timings were judged against, as its four control values. */
const EASE = { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } as const

/** How round a label box's corners are, as a fraction of its shorter side. */
const LABEL_CORNER = 0.25

/**
 * The smallest a name is drawn at, in screen pixels. Below this the label box is drawn empty.
 *
 * Three pixels of text is a smear, and the shrink toward the visible limit passes through every
 * size on the way to nothing. The label box keeps shrinking, so the mark does not disappear with
 * the name.
 */
const TEXT_FLOOR = 3

/**
 * The smallest radius a disc is drawn at, in screen pixels.
 *
 * A node shrinks by `cos(t)` and reaches zero at the visible limit. Without a floor the last few
 * degrees draw as a smear. This is the size every node is at when it goes.
 */
const DOT_FLOOR = 1.5

/** How many segments a drawn edge is cut into. A straight line between two ends is wrong. */
const EDGE_STEPS = 14

/** Line widths in world units, so a line thickens with the zoom the way a node grows. */
const EDGE_WIDTH = 1.5
const SELECTED_WIDTH = 2
/** The dash an off-screen marker's lead and a stub's lead are drawn with, in world units. */
const LINE_DASH = [6, 3]
/** The dash on a node with neighbours nobody has read, in world units. */
const UNREAD_DASH = [1, 3]

/** How far a wheel notch zooms. A notch out leaves about four fifths of the scale. */
const WHEEL_SENSITIVITY = 0.22
/** A wheel event measured in lines rather than pixels, as Firefox sends. */
const LINE_HEIGHT = 16

const MIN_ZOOM = 0.14
const MAX_ZOOM = 2.4

/** How far the pointer may travel during a press and still count as a tap, in screen pixels. */
const TAP_SLOP = 8

/** How much of its contrast a node near the centre gives up, so the ring reads over it. */
const DIMMED_ALPHA = 0.22
/** A ring label box's fill. Where two overlap, the front one is still readable. */
const NEIGHBOUR_OPACITY = 0.92
/** How loud the dash on a node with unread neighbours is. */
const UNREAD_ALPHA = 0.55
/** Border widths in world units: a read in flight, an off-screen marker, and the centre's ring. */
const LOADING_WIDTH = 3
const MARKER_BORDER = 2
const SELECTED_OUTLINE_WIDTH = 3
/** The ring on the node a release would join to, and how far outside the shape it sits. */
const DROP_TARGET_WIDTH = 3
const DROP_TARGET_OFFSET = 2

/**
 * Ids for the two elements that replace a long edge: a stub at one end, and the short line
 * joining that stub to its node.
 *
 * Joined with `NUL`, including the kind letter, so neither can collide with a node whose name
 * starts with `s` or `e`. `keys.ts` owns that character.
 */
const stubId = (key: string, owner: string): string => `s${NUL}${key}${NUL}${owner}`
const lineId = (id: string): string => `e${NUL}${id}`

/** One drawn element: a node, a stub, or an off-screen marker. */
interface Drawn {
  id: string
  /** World position. Assigned once, and written again only during an off-screen marker's flight. */
  x: number
  y: number
  kind: "node" | "stub" | "marker"
  label: string
  /** 0 the centre, 1 its neighbours, 2 the rest, 3 the nodes the centre crowds. */
  tier: number
  degree: number
  /** The node has neighbours nobody has read. */
  more: boolean
  /** A read is in flight for this node. */
  loading: boolean
  /**
   * A stub an off-screen marker has replaced. It comes back when the off-screen marker is lowered.
   */
  hidden: boolean
  /** 1, except while an off-screen marker fades out. */
  alpha: number
}

/** One drawn line, by the ids of the two elements it joins. A drive script reads these too. */
export interface Line {
  a: string
  b: string
  kind: "edge" | "stub" | "marker"
}

/**
 * An off-screen marker on the map: its element id, the centre that raised it, and the node it
 * names.
 */
interface OffscreenMarker {
  marker: string
  selected: string
  target: string
}

/**
 * The off-screen marker positions for one centre node, held for as long as it is the centre.
 *
 * `at` is only added to, so an off-screen marker never moves. `slotsFor` maintains this and
 * explains why.
 */
interface SlotPlan {
  selected: string
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
 * `scripts/probe.mjs` is the only reader.
 *
 * Read-only, and each of the three answers something the other two cannot. `report` is the
 * whole picture in one call, so a script cannot be told two different frames about it. `at`
 * runs the pick, which goes through `unproject` in world coordinates. `path` says where one
 * line's curve runs, which its two ends do not. A line is drawn as `EDGE_STEPS` segments, and
 * either end of it may be past the visible limit.
 */
export interface MapProbe {
  report: () => Drawing
  at: (x: number, y: number) => Hit
  path: (a: string, b: string) => (Point | null)[]
}

/**
 * What a press at one canvas point would land on.
 *
 * The node wins where both are near, which is the order `contextmenu` asks in. So one answer
 * covers a click and a right-click alike.
 */
export interface Hit {
  node: string | null
  line: [string, string] | null
}

/** One frame, as a drive script sees it. */
export interface Drawing {
  /** How many frames this renderer has drawn. */
  frames: number
  /** How long those frames took, in milliseconds. The two together give the cost of one. */
  drawMs: number
  zoom: number
  /** Where the middle of the screen is, in world coordinates. */
  middle: Point
  /** The surface radius, in screen pixels. */
  radius: number
  /** The angle past which nothing is on screen, in radians. */
  visibleLimit: number
  selected: string | null
  /** The node a release would join to, or null. */
  dropTarget: string | null
  /** False while a gesture has the drag to itself. */
  panning: boolean
  /**
   * True while the camera or an off-screen marker is still travelling.
   *
   * A flight to where the camera already is moves nothing, so the pose alone cannot say the
   * map has stopped. It still ends with a `viewport` event, and that closes the menu.
   */
  moving: boolean
  elements: DrawnAs[]
  lines: Line[]
}

/** One element, as a drive script sees it. */
export interface DrawnAs {
  id: string
  kind: "node" | "stub" | "marker"
  label: string
  tier: number
  degree: number
  /** The node has neighbours nobody has read. */
  more: boolean
  /** Where it stands in the world, which is where its box was cut. */
  x: number
  y: number
  /** Where it is drawn, in canvas pixels, or null once the surface has turned away. */
  at: Point | null
  /** How much of its size the surface left it: 1 at the middle, 0 at the visible limit. */
  k: number
  /**
   * How far past the visible limit its box lies, in radians. Zero or less means partly on screen.
   */
  past: number
  /** The footprint it draws, in world units. */
  box: Slot
}

/** Where the probe is registered, and under what name. */
type Probed = HTMLElement & { __map?: MapProbe }

/** A camera or an off-screen marker travelling between two points. */
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
  `${String(text.weight)} ${px.toFixed(2)}px ${LABEL_FONT}`

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
const LINE_ORDER = ["dim", "plain", "stub", "selected", "marker"] as const
type LineClass = (typeof LINE_ORDER)[number]

/** How each of the five classes is drawn. Widths and dashes are in world units. */
const LINE_STYLE: Record<
  LineClass,
  { ink: (palette: Palette) => string; alpha: number; width: number; dash: readonly number[] }
> = {
  dim: { ink: (p) => p.edge, alpha: 0.12, width: EDGE_WIDTH, dash: [] },
  plain: { ink: (p) => p.edge, alpha: 0.55, width: EDGE_WIDTH, dash: [] },
  stub: { ink: (p) => p.textMuted, alpha: 0.75, width: EDGE_WIDTH, dash: LINE_DASH },
  selected: { ink: (p) => p.edgeActive, alpha: 0.9, width: SELECTED_WIDTH, dash: [] },
  marker: { ink: (p) => p.edgeActive, alpha: 0.9, width: SELECTED_WIDTH, dash: LINE_DASH },
}

/** One element and where the surface put it. */
interface Shown {
  node: Drawn
  at: Projected
}

/** The border around a label box or a disc, where the node has earned one. */
interface Border {
  colour: string
  /** In world units, so it thickens with the zoom. */
  width: number
  alpha: number
  dash: readonly number[]
}

/** What a label box is made of. */
interface LabelStyle {
  text: TextStyle
  /** How the name is cut to fit. */
  shape: NameShape
  /** The fill, or null for an off-screen marker, which is drawn hollow. */
  fill: string | null
  /** How opaque that fill is. Two ring label boxes overlap, and the loser stays partly visible. */
  opacity: number
  ink: string
  border: Border | null
}

/** A name cut into lines, and the box that holds them. */
interface LabelLayout {
  lines: string[]
  box: Slot
}

/**
 * Which label box is drawn on top, by degree.
 *
 * Two names overlap because they sit at the same radius, so distance cannot break the tie.
 * `placeAndLink` in world.ts already ranks neighbours by degree for the closest positions.
 * Ranking by it here applies the same rule twice rather than adding a new one.
 *
 * Ascending, because the last label box drawn is the one on top. The id settles a tie, so the
 * picture does not depend on the order the elements arrived in.
 */
const byPaint = (a: Drawn, b: Drawn): number =>
  a.degree - b.degree || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

export class SphereView implements MapSurface {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private palette = currentPalette()

  /** Every drawn element by id: nodes, stubs and off-screen markers alike. */
  private readonly elements = new Map<string, Drawn>()
  /** Every drawn line by id. A short edge is its pair key, and a lead is `lineId` of its end. */
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

  private selectedId: string | null = null
  private stubbed = 0
  /** True while the camera is flying. Nothing may take the accent until it lands. */
  private animating = false
  /** The node whose name the pointer is holding open, or null. */
  private hovered: string | null = null
  /** The node a drag would join to, or null. */
  private dropTarget: string | null = null
  /** The element the pointer was last reported over, so a crossing can be told from a move. */
  private entered: string | null = null
  /** Where the mouse last was on the canvas, or null when it is off the canvas. */
  private pointer: Point | null = null
  /** The off-screen markers the current centre raised, and the node each one stands in for. */
  private markers: OffscreenMarker[] = []
  /**
   * Off-screen marker positions for the current centre. Built on the first pass, then only
   * extended.
   */
  private slotPlan: SlotPlan | null = null

  /** False while a gesture has the drag to itself. See drag-join.ts. */
  private panEnabled = true
  /** Set by anything that changes the picture, and cleared by the frame that draws it. */
  private dirty = true
  /** How many frames have been drawn, and how long they took. Only the probe reads these. */
  private frames = 0
  private drawMs = 0

  /** The camera on its way somewhere, if it is. */
  private cameraMove: Journey | null = null
  /** The off-screen marker on its way to the node it names, if one is. */
  private markerMove: (Journey & { id: string }) | null = null
  /** Off-screen markers fading out, and how long each fade runs for. */
  private readonly fading = new Map<string, { start: number; ms: number }>()

  /** Pointers held down on the canvas, by id, at their last position in client coordinates. */
  private readonly down = new Map<number, Point>()
  /** The press in progress: how far it has travelled, and what it was last over. */
  private press: { moved: number; over: string | null } | null = null
  /** The gap between two fingers on the previous move, in screen pixels. */
  private pinch = 0

  /**
   * Each name's lines and box, keyed by its style, its shape and the name.
   *
   * Breaking a name measures it many times. `boxOf` runs for every element on each hit test,
   * so the result is kept. It is measured on the canvas the label box is later drawn on, so the
   * width a slot is reserved at is the width the name takes.
   */
  private readonly layouts = new Map<string, LabelLayout>()

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
    ;(container as Probed).__map = {
      report: () => this.report(),
      at: (x, y) => this.hitAt(x, y),
      path: (a, b) => this.pathOf(a, b),
    }
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

  /** Move the camera, the off-screen marker in flight, and every fade, to where `now` puts them. */
  private advance(now: number): void {
    const cameraMove = this.cameraMove
    if (cameraMove) {
      const at = ease(cameraMove.ms > 0 ? Math.min(1, (now - cameraMove.start) / cameraMove.ms) : 1)
      this.cam.x = cameraMove.from.x + (cameraMove.to.x - cameraMove.from.x) * at
      this.cam.y = cameraMove.from.y + (cameraMove.to.y - cameraMove.from.y) * at
      if (at >= 1) this.cameraMove = null
      this.moved()
    }

    const markerMove = this.markerMove
    if (markerMove) {
      const at = ease(markerMove.ms > 0 ? Math.min(1, (now - markerMove.start) / markerMove.ms) : 1)
      const marker = this.elements.get(markerMove.id)
      if (marker) {
        marker.x = markerMove.from.x + (markerMove.to.x - markerMove.from.x) * at
        marker.y = markerMove.from.y + (markerMove.to.y - markerMove.from.y) * at
      }
      if (at >= 1) this.markerMove = null
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
        if (this.panEnabled && !this.animating) this.panBy({ x: dx, y: dy })
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
      this.pointer = null
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
    if (event.pointerType === "mouse") this.pointer = { x: event.offsetX, y: event.offsetY }
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

  middle(): Point {
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
   * reaches over less of the world. A neighbour legible at its own position before the move may
   * need an off-screen marker after it. Every settle a pan gets is a settle this one needs.
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
   * the visible limit, so a world-space test against a world-sized box answers the same question a
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
    const selected = this.selectedId ? this.elements.get(this.selectedId) : undefined
    if (selected) yield selected

    const markers = this.markers
      .map((marker) => this.elements.get(marker.marker))
      .filter((marker): marker is Drawn => marker !== undefined)
      .sort((a, b) => byPaint(b, a))
    for (const marker of markers) yield marker

    const hovered = this.hovered ? this.elements.get(this.hovered) : undefined
    if (hovered) yield hovered

    if (this.selectedId) {
      const neighbourList = this.world
        .neighbours(this.selectedId)
        .map((id) => this.elements.get(id))
        .filter((node): node is Drawn => node !== undefined)
        .sort((a, b) => byPaint(b, a))
      for (const node of neighbourList) yield node
    }

    for (const element of this.elements.values()) yield element
  }

  /**
   * The line nearest the pointer, or null where none is near enough.
   *
   * Measured in world coordinates, like the pick above, and the tolerance is converted at the
   * cursor. Near the visible limit one screen pixel covers many world units, which is what the
   * local scale in the divisor stands for.
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
    if (element.kind === "marker") return this.labelLayout(element.label, NEIGHBOUR_TEXT, NEIGHBOUR_NAME).box
    if (element.tier === 0) {
      const shape = element.id === this.hovered ? SELECTED_NAME : NEIGHBOUR_NAME
      return this.labelLayout(element.label, SELECTED_TEXT, shape).box
    }
    // The node under the pointer draws as its full name, so the name is what a click lands on.
    // The opened label box covers the ring label box or the disc it replaces, so entering by one
    // and leaving by the other cannot flicker.
    if (element.id === this.hovered) {
      return this.labelLayout(element.label, NEIGHBOUR_TEXT, HOVER_NAME).box
    }
    if (element.tier === 1) return this.labelLayout(element.label, NEIGHBOUR_TEXT, NEIGHBOUR_NAME).box
    return { w: NODE_SIZE.resting, h: NODE_SIZE.resting }
  }

  /**
   * A name cut to a shape, and the box around it.
   *
   * A one-line name gets the box it always had: its own width and the type size, plus the
   * padding. Each further line adds `LINE_STEP` times the type size.
   */
  private labelLayout(label: string, text: TextStyle, shape: NameShape): LabelLayout {
    const key = [text.size, text.weight, shape.width, shape.lines, label].join(NUL)
    let layout = this.layouts.get(key)
    if (!layout) {
      this.ctx.font = fontOf(text, text.size)
      const { lines, width } = wrapName(
        label,
        (line) => this.ctx.measureText(line).width,
        shape.width - 2 * LABEL_PAD,
        shape.lines,
      )
      const rest = (lines.length - 1) * text.size * LINE_STEP
      layout = { lines, box: { w: width + 2 * LABEL_PAD, h: text.size + rest + 2 * LABEL_PAD } }
      this.layouts.set(key, layout)
    }
    return layout
  }

  /* ---------------------------------------------------------------- the elements */

  get longEdgeCount(): number {
    return this.stubbed
  }

  get selected(): string | null {
    return this.selectedId
  }

  get cameraMoving(): boolean {
    return this.animating
  }

  /** Add elements. Existing ones are never changed. `drop` removes, and only for an undo. */
  add(nodes: readonly WorldNode[], edges: readonly [string, string][]): void {
    // A node can arrive while its parent is already the centre, so it has to be created in the
    // right tier. Waiting for the next accent change would draw a neighbour as a distant node.
    const selected = this.selectedId
    const neighbourList = selected ? new Set(this.world.neighbours(selected)) : null

    for (const node of nodes) {
      if (this.elements.has(node.id)) continue
      this.elements.set(node.id, {
        id: node.id,
        x: node.x,
        y: node.y,
        kind: "node",
        label: node.label,
        tier: node.id === selected ? 0 : neighbourList?.has(node.id) ? 1 : 2,
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
        this.addLine(lineId(stub), { a: owner, b: stub, kind: "stub" })
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
    // be a neighbour of the centre. Only `select` recomputes tiers, and it does not run
    // until the accent moves, so promote it here.
    if (selected) this.setTiers(selected, true)
    this.paint()

    // No off-screen marker pass here, on purpose. A read can leave new nodes off screen with no
    // off-screen marker standing in for them, but this also runs for a late placement. Off-screen
    // markers are only raised on a settled camera, and main.ts schedules a settle when a read
    // lands.
  }

  /**
   * Remove elements, for an undone write.
   *
   * The only removal on the map. It has to undo whichever form `add` chose. A short edge is
   * one line under the pair key. A long edge is two stubs and two leads, and removing a stub
   * removes its lead with it. Both forms are tried, because which one was drawn depended on a
   * distance that may have changed since.
   *
   * The off-screen marker test is against the slot plan rather than the off-screen markers on
   * screen. The plan is the larger set: a slot is held for a neighbour whose off-screen marker is
   * lowered. Rebuilding it also lets the remaining slots use the space the removal just freed.
   */
  drop(nodeIds: readonly string[], edges: readonly [string, string][]): void {
    const plan = this.slotPlan
    if (plan && nodeIds.some((id) => id === plan.selected || plan.at.has(id))) {
      this.clearMarkers()
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
    // An accent pointing at a deleted node would keep the map marking it until the camera
    // moved. Clear it here. The caller picks a new one.
    if (this.selectedId && nodeIds.includes(this.selectedId)) this.selectedId = null

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
   * A label box takes both dimensions from its name, so the box changes with it. Position, tier and
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
  markDropTarget(id: string | null): void {
    if (id === this.dropTarget) return
    this.dropTarget = id
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
  private neighbourReach(id: string): number {
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
   * A radius test, not a corridor test. Corridor membership changes as the accent moves,
   * which would flicker nodes in and out during a pan.
   */
  private dimmedOf(id: string): string[] {
    const selected = this.world.get(id)
    const reach = this.neighbourReach(id)
    if (!selected || reach <= 0) return []
    const spared = new Set([id, ...this.world.neighbours(id)])
    return this.world
      .nodesWithin(selected, reach)
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
    for (const other of this.dimmedOf(id)) {
      const dimmed = this.elements.get(other)
      if (dimmed) dimmed.tier = active ? 3 : 2
    }
  }

  /**
   * Make a node the accent and demote the previous one. It touches only the two neighbourhoods
   * involved, so it stays cheap during a pan.
   */
  select(id: string): boolean {
    if (id === this.selectedId || !this.elements.has(id)) return false
    const previous = this.selectedId
    this.selectedId = id

    this.clearMarkers()
    // Clear the old tiers before setting the new ones. A node in both neighbourhoods then ends
    // up promoted rather than demoted.
    if (previous) this.setTiers(previous, false)
    this.setTiers(id, true)

    this.refreshHover()
    this.paint()
    return true
  }

  /**
   * Name whatever is under the pointer now.
   *
   * A click moves no camera, so the node clicked is still under the pointer when it becomes the
   * centre. No pointer event follows, so nothing else would open its name. The same goes for a
   * node the centre leaves: the pointer may no longer be over it, and the flag would keep it
   * drawn as a hovered label box. Both are the same question asked again, and `pick` answers it.
   */
  private refreshHover(): void {
    const hit = this.pointer ? this.pick(this.pointer.x, this.pointer.y) : null
    this.entered = hit
    this.hover(hit)
  }

  /* ---------------------------------------------------------------- off-screen markers */

  /**
   * How far past the visible limit a node's drawn box lies, in radians. Zero or less means some
   * part of it is on screen.
   *
   * The box, not the position, because a neighbour draws as its name. A position just past the
   * visible limit can still have half its name inside it, and an off-screen marker for it would
   * show the same name twice.
   *
   * The nearest corner of the box, because that is the part of it that leaves last.
   */
  private outsideBy(id: string, edge: number): number {
    const node = this.elements.get(id)
    // There is no node here, so return the value that raises no off-screen marker.
    if (!node) return -Infinity
    const box = this.boxOf(node)
    const flat = this.flatOf(node)
    const gapX = Math.max(0, Math.abs(flat.x) - (box.w / 2) * this.cam.zoom)
    const gapY = Math.max(0, Math.abs(flat.y) - (box.h / 2) * this.cam.zoom)
    return Math.hypot(gapX, gapY) / this.R - edge
  }

  /**
   * Where each of a centre's off-screen markers stands. Built once per centre, then only extended.
   *
   * The slots cannot be recomputed on each pass. `freeSpots` spreads what it is given evenly, so the
   * same neighbours in a different number come back on different bearings. And an off-screen marker
   * does not occupy the grid, so asking for one slot twice returns the same point twice. Either
   * way, a set that changed with the camera would move off-screen markers that are already on
   * screen.
   *
   * The pool is sized from the degree the store reports, not from the neighbours drawn so far.
   * A read that lands later then finds a slot free. A write that adds a neighbour beyond that
   * size leaves it without a slot for the rest of the visit.
   *
   * `reach` is read here only, on the pass that builds the plan, for the same reason. It sets
   * how far out the outermost ring can sit, and a reach that followed the zoom would move
   * off-screen markers already shown. So a visit is measured once, at the zoom it started at.
   */
  private slotsFor(
    selected: string,
    known: readonly string[],
    reach: number,
    outside: ReadonlyMap<string, number>,
    margin: number,
  ): ReadonlyMap<string, Point> {
    let plan = this.slotPlan
    if (!plan || plan.selected !== selected) {
      const room = Math.max(known.length, this.world.get(selected)?.degree ?? 0)
      // Slots are sized for the widest name known now. The degree covers a neighbour that
      // arrives later. A name that has not arrived cannot be measured, so a longer one will
      // overhang its slot.
      plan = {
        selected,
        pool: this.world.slotsAround(selected, room, this.slotBox(known), reach),
        at: new Map(),
      }
      this.slotPlan = plan
    }

    // A slot is claimed only by a neighbour past the margin, meaning one about to get an off-screen
    // marker. Assigning one to every neighbour up front would spend the pool on names already in
    // view. A hub has more neighbours than the rings have room for.
    //
    // This depends on the camera, and that is safe because a claim is never released. The
    // camera decides who receives a free slot. It cannot move or revoke a slot already held,
    // so a neighbour that goes out of view and comes back finds its own waiting.
    if (plan.at.size < plan.pool.length) {
      for (const target of this.markerOrder(known, selected)) {
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
   * Each name is cut to the ring's shape first, so one long name widens a slot to the cap
   * and no further. The height is the tallest cut name: one line when every name fits on one.
   */
  private slotBox(ids: readonly string[]): Slot {
    let widest = 0
    let tallest = NEIGHBOUR_TEXT.size
    for (const id of ids) {
      const label = this.world.get(id)?.label
      if (!label) continue
      const { box } = this.labelLayout(label, NEIGHBOUR_TEXT, NEIGHBOUR_NAME)
      widest = Math.max(widest, box.w - 2 * LABEL_PAD)
      tallest = Math.max(tallest, box.h - 2 * LABEL_PAD)
    }
    const around = 2 * LABEL_PAD + 2 * LABEL_OUTLINE + SLOT_GAP
    return { w: widest + around, h: tallest + around }
  }

  /**
   * The centre's neighbours, ordered by who should get an off-screen marker first.
   *
   * Neighbours with no drawn line first. A neighbour off screen whose edge is drawn still shows
   * which way the connection goes. One drawn as two stubs shows almost nothing, so an off-screen
   * marker is worth more there. `add` decided which pairs got a line, and this reads the map back
   * rather than recomputing it.
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
  private markerOrder(known: readonly string[], selected: string): string[] {
    const ranked = known.map((other) => ({
      id: other,
      unlined: this.lines.has(edgeKey(selected, other)) ? 1 : 0,
      span: this.world.span(selected, other),
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
   * Raise an off-screen marker for every neighbour off screen, and lower every off-screen marker
   * whose neighbour has come into view.
   *
   * Idempotent, and run on a settled camera rather than per frame. An off-screen marker holds an
   * off-screen marker slot, and slots appearing and disappearing during a fast pan would flicker.
   *
   * The two tests are deliberately not opposites. An off-screen marker is lowered as soon as any
   * part of its target is on screen. It is raised only once the target is `MARKER_MARGIN` past the
   * visible limit. One pass can therefore never both lower and raise an off-screen marker for one
   * neighbour.
   *
   * Runs whether or not the centre is itself on screen. A neighbour can come back into view
   * while the centre is still outside it. Skipping the pass would leave that off-screen marker
   * standing.
   *
   * Nothing is written to the occupancy grid. An off-screen marker holds no ground, which is what
   * stops `nearestTo` ever returning one and making an off-screen marker the centre.
   */
  updateMarkers(): void {
    const selected = this.selectedId
    if (!selected || this.animating) return

    const known = this.world.neighbours(selected)
    const edge = visibleLimit(this.halfW, this.halfH, this.R)
    const margin = marginAngle(MARKER_MARGIN, this.R)
    // Measure every neighbour, not only the ones holding a slot, because `slotsFor` chooses
    // from these.
    const outside = new Map<string, number>()
    for (const target of known) outside.set(target, this.outsideBy(target, edge))
    // How far out a slot may sit: half the viewport's smaller side. `slotsFor` reads this only
    // on the pass that builds the plan, and explains why.
    const reach = this.reach()
    const slots = this.slotsFor(selected, known, reach, outside, margin)

    const neighbours = new Set(known)
    const standing = new Set<string>()
    const down: OffscreenMarker[] = []
    for (const marker of this.markers) {
      // An off-screen marker whose target is no longer a neighbour is lowered too. Undoing a join
      // removes the edge and keeps both nodes, so nothing else would lower it.
      const gap = outside.get(marker.target) ?? -Infinity
      if (neighbours.has(marker.target) && gap > 0) standing.add(marker.target)
      else down.push(marker)
    }

    /** An off-screen marker about to be raised, with the slot it stands in. */
    const up: (OffscreenMarker & { at: Point })[] = []
    for (const [target, at] of slots) {
      // The plan keeps a slot for a node that is no longer a neighbour, because it is only ever
      // added to. Without this test the loop above would lower that off-screen marker and this one
      // would raise it again, showing an edge that no longer exists.
      if (!neighbours.has(target)) continue
      if (standing.has(target) || (outside.get(target) ?? -Infinity) <= margin) continue
      const node = this.world.get(target)
      if (!node) continue
      up.push({ marker: markerId(selected, target), selected, target, at })
    }

    // A settle fires on every camera stop. When nothing crossed a threshold, stop here.
    if (!down.length && !up.length) return

    for (const marker of down) this.lower(marker)
    for (const raised of up) {
      const node = this.world.get(raised.target)
      if (!node) continue
      // Hide the long edge's stub at this end. The off-screen marker says the same thing more
      // clearly. A short edge has no stub, and its line stays: the line shows where the neighbour
      // actually is, which an off-screen marker cannot.
      const stub = this.stubAt(selected, raised.target)
      if (stub) stub.hidden = true
      this.elements.set(raised.marker, {
        id: raised.marker,
        x: raised.at.x,
        y: raised.at.y,
        kind: "marker",
        label: node.label,
        tier: 2,
        degree: node.degree,
        more: false,
        loading: false,
        hidden: false,
        alpha: 1,
      })
      this.addLine(lineId(raised.marker), { a: selected, b: raised.marker, kind: "marker" })
    }
    this.markers = [
      ...this.markers.filter((marker) => standing.has(marker.target)),
      ...up.map(({ marker, selected: from, target }) => ({ marker, selected: from, target })),
    ]
    this.paint()
  }

  /** Lower one off-screen marker and show the stub it replaced. */
  private lower(marker: OffscreenMarker): void {
    const stub = this.stubAt(marker.selected, marker.target)
    if (stub) stub.hidden = false
    this.removeElement(marker.marker)
    this.fading.delete(marker.marker)
  }

  /** Lower every off-screen marker and discard the slot plan. */
  private clearMarkers(): void {
    // Before the early return, because a plan outlives its off-screen markers. A centre whose
    // neighbours are all on screen has a plan with no slots assigned. A stale plan surviving an
    // accent change is the one way the slots come out wrong.
    this.slotPlan = null
    if (!this.markers.length) return
    for (const marker of this.markers) this.lower(marker)
    this.markers = []
    this.paint()
  }

  /* ---------------------------------------------------------------- the flight */

  /**
   * Where a world point is drawn, clamped to the visible limit so a point past it still has a
   * place.
   *
   * Only `moveTime` reads this. A flight often starts or ends outside the visible limit, and the
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
   * scale, and near the visible limit that difference is most of the answer.
   *
   * Zero when the OS asks for reduced motion. The camera then cuts to the destination and the
   * off-screen marker fades where it lands. The fade is kept: a fade is the right replacement for a
   * movement.
   */
  private moveTime(from: Point, to: Point): number {
    if (REDUCED_MOTION.matches) return 0
    const a = this.drawnAt(from)
    const b = this.drawnAt(to)
    const pixels = Math.hypot(b.x - a.x, b.y - a.y)
    return Math.min(MOVE_MAX_MS, Math.max(MOVE_MIN_MS, pixels / MOVE_SPEED))
  }

  /** Move the camera so a node sits in the middle of the screen. */
  focus(id: string, animate = true): void {
    const node = this.world.get(id)
    if (!node) return
    if (!animate) {
      this.cameraMove = null
      this.cam.x = node.x
      this.cam.y = node.y
      this.moved()
      return
    }
    this.cameraMove = {
      from: this.middle(),
      to: { x: node.x, y: node.y },
      start: performance.now(),
      ms: this.moveTime(this.middle(), node),
    }
    this.moved()
  }

  /**
   * Fly to the node an off-screen marker stands in for, and fade the off-screen marker out on
   * arrival.
   *
   * The off-screen marker is not removed on the click. It moves. If it disappeared as soon as its
   * centre stopped being the centre, the thing the reader clicked would be gone by the second
   * frame. So the accent is held for the duration and the off-screen marker travels to the real
   * node, arriving as the camera finishes centring it.
   *
   * This is the one place anything on the map moves, and `advance` is what moves it. Every
   * other position in `elements` is written once, by `add` or by `updateMarkers`.
   */
  moveToMarker(marker: string, onArrive: (target: string) => void): boolean {
    const target = markerTarget(marker)
    const node = target ? this.world.get(target) : null
    const markerMove = this.elements.get(marker)
    if (!target || !node || this.animating || !markerMove) return false

    const from = this.markers.find((one) => one.marker === marker)?.selected ?? null
    const duration = this.moveTime(markerMove, node)
    const start = performance.now()
    this.animating = true

    // Fade out the other off-screen markers. They belong to the centre being left behind.
    for (const other of this.markers) {
      if (other.marker === marker) continue
      this.fading.set(other.marker, { start, ms: FADE_OTHERS_MS })
    }

    this.cameraMove = { from: this.middle(), to: { x: node.x, y: node.y }, start, ms: duration }
    this.markerMove = {
      id: marker,
      from: { x: markerMove.x, y: markerMove.y },
      to: { x: node.x, y: node.y },
      start,
      ms: duration,
    }
    this.paint()

    // Two moments, not one. `select` names the node the camera landed on, and the off-screen marker
    // fades out over the next 320ms. Waiting for the fade would leave the map naming the node
    // the reader started from.
    setTimeout(() => {
      this.animating = false
      // Take the flying off-screen marker out of the list. `select` lowers the others, and this one
      // is still fading and outlives them. Its removal is scheduled before anything that could
      // throw, so it cannot be left on the map.
      this.markers = this.markers.filter((one) => one.marker !== marker)
      this.fading.set(marker, { start: performance.now(), ms: FADE_MS })
      setTimeout(() => {
        this.removeElement(marker)
        this.fading.delete(marker)
        this.paint()
      }, FADE_MS)
      const stub = from ? this.stubAt(from, target) : undefined
      if (stub) stub.hidden = false
      this.select(target)
      this.updateMarkers()
      onArrive(target)
    }, duration)
    return true
  }

  /* ---------------------------------------------------------------- the draw */

  /**
   * One pass over the map, back to front.
   *
   * The visible limit, then the lines, then the discs, then the names. Within the names, the ring,
   * the name under the pointer, the off-screen markers and the centre. `byPaint` orders the ring
   * and the off-screen markers among themselves.
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
    this.drawDropTarget(shown)
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
    if (a.tier === 0 || b.tier === 0) return "selected"
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

    // The dimmed nodes first, then the rest.
    for (const [tier, alpha] of [
      [3, DIMMED_ALPHA],
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
    let unread = false
    for (const { node, at } of shown) {
      if (!plain(node) || !node.more || node.loading) continue
      disc(at, NODE_SIZE.resting)
      unread = true
    }
    if (unread) {
      ctx.globalAlpha = UNREAD_ALPHA
      ctx.strokeStyle = this.palette.unreadOutline
      ctx.lineWidth = Math.max(0.4, zoom)
      ctx.setLineDash(UNREAD_DASH.map((gap) => gap * zoom))
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
    const neighbourList: Shown[] = []
    const markers: Shown[] = []
    let hovered: Shown | null = null
    let selected: Shown | null = null

    for (const entry of shown) {
      const node = entry.node
      if (node.kind === "marker") {
        markers.push(entry)
        continue
      }
      if (node.kind !== "node") continue
      if (node.tier === 0) selected = entry
      else if (node.id === this.hovered) hovered = entry
      else if (node.tier === 1) neighbourList.push(entry)
    }

    neighbourList.sort((a, b) => byPaint(a.node, b.node))
    markers.sort((a, b) => byPaint(a.node, b.node))

    for (const entry of neighbourList) {
      this.drawLabelBox(entry, {
        text: NEIGHBOUR_TEXT,
        shape: NEIGHBOUR_NAME,
        fill: palette.surface,
        // Nearly opaque, so where two label boxes overlap the front one is readable.
        opacity: NEIGHBOUR_OPACITY,
        ink: palette.hop[0]!,
        border: null,
      })
    }

    // A disc takes the page's own ink, not `hop[0]`. The ring's ink says "a neighbour of the
    // centre", and a disc is not one. A ring name keeps its ink as it opens. Opaque, unlike a
    // ring label box: there is only ever one of these, and legibility is its whole job.
    if (hovered) {
      const isNeighbour = hovered.node.kind === "node" && hovered.node.tier === 1
      this.drawLabelBox(hovered, {
        text: NEIGHBOUR_TEXT,
        shape: HOVER_NAME,
        fill: palette.surface,
        opacity: 1,
        ink: isNeighbour ? palette.hop[0]! : palette.textPrimary,
        border: null,
      })
    }

    // An off-screen marker: hollow and dashed, so it is not mistaken for the node itself. The node
    // exists once, elsewhere on the map, and while the off-screen marker stands it is off screen.
    for (const entry of markers) {
      this.drawLabelBox(entry, {
        text: NEIGHBOUR_TEXT,
        shape: NEIGHBOUR_NAME,
        fill: null,
        opacity: 1,
        ink: palette.textSecondary,
        border: { colour: palette.hop[0]!, width: MARKER_BORDER, alpha: 1, dash: LINE_DASH },
      })
    }

    if (selected) {
      this.drawLabelBox(selected, {
        text: SELECTED_TEXT,
        shape: selected.node.id === this.hovered ? SELECTED_NAME : NEIGHBOUR_NAME,
        fill: palette.accent,
        opacity: 1,
        ink: palette.inkOnAccent,
        border: { colour: palette.selectedOutline, width: SELECTED_OUTLINE_WIDTH, alpha: 1, dash: [] },
      })
    }
  }

  /**
   * The border a node has earned, or null to leave the label box its own.
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
        colour: this.palette.unreadOutline,
        width: 1,
        alpha: UNREAD_ALPHA,
        dash: UNREAD_DASH,
      }
    }
    return null
  }

  /**
   * One name on its label box, at the size the surface left it.
   *
   * The label outline is stroked before the fill, so the fill covers the inner half of it and what
   * is left reads as an outline. A label box below `TEXT_FLOOR` is drawn empty: the box keeps
   * shrinking toward the visible limit, so the mark stays even after the name is gone.
   */
  private drawLabelBox(shown: Shown, style: LabelStyle): void {
    const ctx = this.ctx
    const { node, at } = shown
    const { lines, box } = this.labelLayout(node.label, style.text, style.shape)
    const scale = this.cam.zoom * at.k
    const width = box.w * scale
    const height = box.h * scale
    const round = Math.min(width, height) * LABEL_CORNER
    const border = this.borderOf(node) ?? style.border

    ctx.setLineDash([])
    ctx.beginPath()
    ctx.roundRect(at.x - width / 2, at.y - height / 2, width, height, round)

    ctx.globalAlpha = node.alpha
    ctx.lineWidth = 2 * LABEL_OUTLINE * scale
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
      const top = at.y - height / 2 + (LABEL_PAD + style.text.size / 2) * scale
      lines.forEach((line, i) => {
        ctx.fillText(line, at.x, top + i * style.text.size * LINE_STEP * scale)
      })
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
  private drawDropTarget(shown: readonly Shown[]): void {
    const dropTarget = this.dropTarget
    if (!dropTarget) return
    const found = shown.find((entry) => entry.node.id === dropTarget)
    if (!found) return
    const ctx = this.ctx
    const { node, at } = found
    const scale = this.cam.zoom * at.k

    ctx.beginPath()
    if (node.kind === "node" && node.tier >= 2 && node.id !== this.hovered) {
      const r = Math.max(DOT_FLOOR, (NODE_SIZE.resting / 2) * scale) + DROP_TARGET_OFFSET * scale
      ctx.arc(at.x, at.y, r, 0, TAU)
    } else {
      const box = this.boxOf(node)
      const width = box.w * scale + 2 * DROP_TARGET_OFFSET * scale
      const height = box.h * scale + 2 * DROP_TARGET_OFFSET * scale
      ctx.roundRect(
        at.x - width / 2,
        at.y - height / 2,
        width,
        height,
        Math.min(width, height) * LABEL_CORNER,
      )
    }
    ctx.setLineDash([])
    ctx.lineWidth = Math.max(1, DROP_TARGET_WIDTH * scale)
    ctx.strokeStyle = this.palette.accent
    ctx.stroke()
  }

  /**
   * The whole frame, for a drive script. Nothing in the page reads this.
   *
   * Every element, not only the ones on screen. A script asking about an off-screen marker is
   * asking whether the node it stands for is drawn, and a node past the visible limit answers
   * `null`.
   */
  private report(): Drawing {
    const edge = visibleLimit(this.halfW, this.halfH, this.R)
    return {
      frames: this.frames,
      drawMs: this.drawMs,
      zoom: this.cam.zoom,
      middle: this.middle(),
      radius: this.R,
      visibleLimit: edge,
      selected: this.selectedId,
      dropTarget: this.dropTarget,
      panning: this.panEnabled,
      moving: this.cameraMove !== null || this.markerMove !== null,
      elements: [...this.elements.values()].map((node) => {
        const flat = this.flatOf(node)
        const at = node.hidden ? null : project(flat.x, flat.y, this.R)
        return {
          id: node.id,
          kind: node.kind,
          label: node.label,
          tier: node.tier,
          degree: node.degree,
          more: node.more,
          x: node.x,
          y: node.y,
          at: at ? { x: this.halfW + at.x, y: this.halfH + at.y } : null,
          k: at?.k ?? 0,
          past: this.outsideBy(node.id, edge),
          box: this.boxOf(node),
        }
      }),
      // Copied rather than handed out, so a reader cannot write to the map through them.
      lines: [...this.lines.values()].map(({ a, b, kind }) => ({ a, b, kind })),
    }
  }

  /**
   * What a press at one canvas point would land on, for a drive script.
   *
   * The node first and the line second, which is the order `contextmenu` asks in. A script
   * aiming at a line has to know whether a label box covers the point it picked. This is the
   * answer the page itself would give.
   */
  private hitAt(x: number, y: number): Hit {
    const node = this.pick(x, y)
    if (node) return { node, line: null }
    const line = this.pickLine(x, y)
    return { node: null, line: line ? [line.a, line.b] : null }
  }

  /**
   * Where one line is drawn, in canvas pixels, at the steps `strokeLines` draws it through.
   *
   * Null at a step the surface has turned away. An off-screen marker's lead from a centre past the
   * visible limit is drawn from the first step that lands. Its two ends do not say where it runs.
   */
  private pathOf(a: string, b: string): (Point | null)[] {
    const from = this.elements.get(a)
    const to = this.elements.get(b)
    if (!from || !to) return []
    const fa = this.flatOf(from)
    const fb = this.flatOf(to)
    const path: (Point | null)[] = []
    for (let step = 0; step <= EDGE_STEPS; step++) {
      const along = step / EDGE_STEPS
      const at = project(fa.x + (fb.x - fa.x) * along, fa.y + (fb.y - fa.y) * along, this.R)
      path.push(at ? { x: this.halfW + at.x, y: this.halfH + at.y } : null)
    }
    return path
  }
}
