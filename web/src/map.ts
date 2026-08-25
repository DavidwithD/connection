/**
 * What every renderer of the map holds: the calls, the events, the ids and the numbers.
 *
 * Two renderers stand behind this while the globe is built. `map-view.ts` draws through
 * Cytoscape, and `globe-view.ts` draws the projected surface. main.ts, drag-join.ts and
 * explore.ts hold this type rather than either class, so neither one is named outside the file
 * that constructs it.
 *
 * A ghost's id is here because the page reads a node back out of one. The numbers are here
 * because two renderers drawing one map have to draw it alike. A second copy of a number is a
 * copy that goes stale.
 */
import type { Point } from "./placement.js"
import type { Palette } from "./palette.js"
import { NUL } from "./store/keys.js"
import type { WorldNode } from "./world.js"

/**
 * What the page hears from the map, whichever renderer is drawing it.
 *
 * Cytoscape's own names are not in this list on purpose. A second renderer has no `cxttap` and
 * no element to be the target of one. A page written against those names could only ever have
 * one renderer under it. These are named for what the reader did.
 *
 * `edgeMenu` carries the two ends rather than the edge. That is what the page reads. It is
 * also all a renderer can be relied on to hold about a line it drew.
 */
export interface MapEvents {
  /** The camera moved, by any means. */
  viewport: () => void
  nodeEnter: (id: string) => void
  nodeLeave: () => void
  nodeTap: (id: string) => void
  nodeMenu: (id: string, at: MouseEvent | undefined) => void
  edgeMenu: (a: string, b: string, at: MouseEvent | undefined) => void
  /** A button went down on a node. The rest of the press follows until `pressEnd`. */
  pressStart: (id: string, at: MouseEvent | undefined) => void
  pressMove: (at: MouseEvent | undefined) => void
  /** The button came up. Null where it came up on the background rather than an element. */
  pressEnd: (id: string | null) => void
  /** The pointer crossed onto a node mid-press, and off one again. */
  pressOver: (id: string) => void
  pressOut: () => void
}

/**
 * Every call the page makes on the map.
 *
 * One line each. Why a method behaves the way it does belongs beside the code that implements
 * it. The two renderers give different reasons for the same signature.
 */
export interface MapSurface {
  /** Hear one of the map's events. Every handler added for a name is called, in order. */
  on: <K extends keyof MapEvents>(name: K, handler: MapEvents[K]) => void
  /** Where an element is drawn, in canvas pixels. Null for one the map is not drawing. */
  screenOf: (id: string) => Point | null
  /** Where the canvas sits in the viewport, so a caller can put the two together. */
  containerOffset: () => Point
  /** Move the camera by a number of screen pixels. */
  panBy: (by: Point) => void
  /** Zoom by a factor, holding one point on the canvas still. */
  zoomAbout: (at: Point, factor: number) => void
  /** Switch panning off for the length of a gesture that takes the drag to itself. */
  panning: (on: boolean) => void
  /** Redraw in another palette. */
  restyle: (palette: Palette) => void
  /** World coordinates of the middle of the viewport. */
  centre: () => Point
  /** How far a claim on the centre may look, in world units. */
  reach: () => number
  /** Remove elements, for an undone write. */
  drop: (nodeIds: readonly string[], edges: readonly [string, string][]) => void
  /** Change the name a node draws, and nothing else. */
  relabel: (id: string, label: string) => void
  /** Add elements. Existing ones are never changed. */
  add: (nodes: readonly WorldNode[], edges: readonly [string, string][]) => void
  /** Raise a ghost for every neighbour off screen, and lower every ghost back in view. */
  reviseGhosts: () => void
  /** Make a node the accent. False where the mark did not move. */
  setAccent: (id: string) => boolean
  /** True while the camera is flying. The accent must not move until it lands. */
  readonly inFlight: boolean
  readonly accent: string | null
  /** Mark a node as having a read in flight. */
  loading: (id: string, active: boolean) => void
  /** Name the node under the pointer, or clear the one that is named. */
  hover: (id: string | null) => void
  /** Mark the node a drag would join to, or clear the mark. */
  aim: (id: string | null) => void
  /** Move the camera so a node sits in the middle of the screen. */
  focus: (id: string, animate?: boolean) => void
  /** Fly to the node a ghost stands in for, and fade the ghost out on arrival. */
  flyTo: (ghost: string, onArrive: (target: string) => void) => boolean
  /** The window changed shape. */
  resize: () => void
  /** Curve the surface the map draws on, for a renderer that has one to curve. */
  curve: (value: number) => void
}

/**
 * How far past the edge of the drawn map a node must be before a ghost stands in for it, in
 * screen pixels.
 *
 * A length, not a ratio. What has to be bounded here is how far the reader panned, and that is
 * one distance. Wider than main.ts's keyboard pan step, so a nudge and the nudge back give the
 * same picture. Each renderer converts it: map-view.ts divides by the zoom, and globe-view.ts
 * turns it into an angle through `marginAngle`.
 *
 * A ghost is lowered as soon as its target is visible at all, with no margin at that end. This
 * whole distance is therefore dead band on the way up. That is what stops a name being shown
 * twice: once as a ghost, once at its own position.
 */
export const GHOST_MARGIN = 160

/** How far a stub reaches from its node, toward the far end of a hidden long edge. */
export const STUB_REACH = 44

/**
 * Camera flight speed, in screen pixels per millisecond. Picked by eye from three timings of
 * one 543px flight. 720ms won.
 *
 * Screen pixels, not world units. Zoomed out, the same world distance is a shorter visual
 * move and must not take longer to cross.
 */
export const FLIGHT_SPEED = 0.75
/** A minimum, so a flight to a close neighbour moves rather than snapping. */
export const FLIGHT_MIN = 320
/** A maximum, because a very long flight at this speed reads as the page hanging. */
export const FLIGHT_MAX = 900
/** How long a ghost takes to fade out once the camera has landed. */
export const DISSOLVE_MS = 320

/**
 * The gap between a name and the edge of the pill drawn around it, in world units.
 *
 * A pill takes both its dimensions from its name, and this is added to each. So this one
 * number is the whole pill geometry: every pill fits its name equally on all sides.
 *
 * Not one of the `NODE_SIZE` values. Those are diameters. The separations in placement.ts are
 * derived from them, and a distant node still draws as a circle at one of them.
 */
export const PILL_PAD = 8

/**
 * The outline a pill draws in the surface colour, so a name reads as sitting over whatever it
 * covers.
 *
 * An outline, not a border. The border is already used: a node with unread neighbours draws a
 * dashed border.
 */
export const PILL_HALO = 3

/**
 * Extra width added to a ghost's slot beyond the pill that goes in it.
 *
 * A pill one pixel wider than its slot touches its neighbour, which is what the slot
 * arithmetic exists to prevent. It also covers a renderer that measures a name on one canvas
 * and draws it on another. Those two agree only to about a pixel.
 */
export const SLOT_GAP = 6

/** The font every name is set in. Named, so that measuring and drawing use the same one. */
export const PILL_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/** What a name is drawn at. */
export interface TextStyle {
  size: number
  weight: number
}

/**
 * A neighbour's name, a ghost's name, and the name under the pointer.
 *
 * One size for all three on purpose. A ghost stands in for a neighbour, and the pointer opens
 * the same kind of name. None of the three should look louder than another.
 */
export const RING_TEXT: TextStyle = { size: 12, weight: 500 }

/** The centre's name, which is the loudest mark on screen. */
export const CENTRE_TEXT: TextStyle = { size: 15, weight: 700 }

/**
 * A ghost's id holds the centre that raised it and the node it stands in for.
 *
 * Joined with `NUL`, including the kind letter, so the id cannot collide with a node whose
 * name starts with `g`. `keys.ts` owns that character and explains why a name-shaped id needs
 * one.
 */
export const ghostId = (centre: string, target: string): string =>
  `g${NUL}${centre}${NUL}${target}`

/**
 * The node a ghost stands in for, or null if this is not a ghost.
 *
 * The split is on the second NUL, so the target is everything after it. The centre cannot be
 * read back out of the id, and nothing needs it.
 */
export function ghostTarget(id: string): string | null {
  if (!id.startsWith(`g${NUL}`)) return null
  const cut = id.indexOf(NUL, 2)
  return cut < 0 ? null : id.slice(cut + 1)
}
