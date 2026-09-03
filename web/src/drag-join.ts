/**
 * The drag that joins two nodes, and the arrow it draws.
 *
 * Shift, press on a node, drag, release on another, and the two are joined. The mouse button
 * holds the state, so there is nothing to arm and nothing to leave behind. A release anywhere
 * but on a second node writes nothing.
 *
 * The arrow is drawn on an `svg` over the canvas rather than as elements in the graph. A node
 * that followed the cursor would be the second thing on this map that moves. It would also join
 * the element set every pass in map-view.ts walks. The only thing this file asks the map for is
 * where a node is drawn.
 *
 * What gets written, and what the undo does about it, is main.ts. The pair the gesture named is
 * all that comes from here.
 */
import type { MapSurface } from "./map.js"
import type { Point } from "./placement.js"
import type { WorldNode } from "./world.js"

/**
 * How wide the arrow is where it leaves the node, in screen pixels.
 *
 * Wide and faint at that end, narrow and solid at the cursor. The taper says which way the
 * arrow points before the head is read. The fade keeps the loud end under the pointer, where
 * the reader is looking.
 */
const TAIL_WIDTH = 11

/** And where the shaft meets the head. Not zero: a point that thin disappears at a glance. */
const TIP_WIDTH = 2

/** The head, which is the one part that does not change with the arrow's length. */
const HEAD_LENGTH = 13
const HEAD_WIDTH = 11

/**
 * The shortest arrow that gets a shaft.
 *
 * Below this there is only the head. A shaft shorter than the head would run backwards out of
 * it. The head itself is always drawn. The page hides the pointer for the length of the drag,
 * so this is the only thing the reader has left to aim with.
 */
const LEAST_SHAFT = HEAD_LENGTH + 4

/**
 * Which way the head faces before the drag has a direction.
 *
 * Up and to the left, so a press that has not moved yet leaves something shaped like the pointer
 * it replaced. The first movement puts it on the direction of travel and it stays there.
 */
const REST_FACING: Point = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }

/** What the page hands the gesture. */
export interface DragJoinHooks {
  /**
   * The node an element stands for, or null for an element that stands for none.
   *
   * A ghost names a node off screen, so a drag can start or end on one. An edge and a stub
   * name nothing.
   */
  ended: (elementId: string) => WorldNode | null
  /** A pair, named by a release on a second node. The only thing here that leads to a write. */
  join: (a: WorldNode, b: WorldNode) => void
  /** Mark the node a release would take, or clear the mark. */
  aim: (id: string | null) => void
  /** The drag has started. Whatever the page is holding open over the map should close. */
  onStart: () => void
}

/** A drag in flight. */
interface Armed {
  /** The element under the press. The arrow's tail follows it, so a ghost keeps its own place. */
  from: string
  /** The node that element stands for, which is what a release joins. */
  a: WorldNode
  /** Where the canvas sits in the viewport. Read once: it cannot move while a button is held. */
  offset: Point
}

export class DragJoin {
  private armed: Armed | null = null

  constructor(
    private readonly view: MapSurface,
    private readonly arrow: SVGPathElement,
    private readonly ink: SVGLinearGradientElement,
    private readonly hooks: DragJoinHooks,
  ) {
    this.view.on("pressStart", (id, at) => this.start(id, at))
    this.view.on("pressMove", (at) => this.move(at))
    this.view.on("pressEnd", (id) => this.end(id))
    this.view.on("pressOver", (id) => this.over(id))
    this.view.on("pressOut", () => {
      if (this.armed) this.hooks.aim(null)
    })

    // The backstop. A release the map never hears about would leave panning switched off, and
    // the map unable to move at all. `mouseup` on the window runs after `pressEnd` has had the
    // release. The canvas is inside the window, so a bubbling listener is the later of the two.
    window.addEventListener("mouseup", () => this.disarm())
    // A release outside the window arrives as no event at all. This is what covers it.
    window.addEventListener("blur", () => this.disarm())
  }

  private start(from: string, at: MouseEvent | undefined): void {
    if (this.armed) return
    if (!at?.shiftKey) return

    const a = this.hooks.ended(from)
    if (!a) return

    this.armed = { from, a, offset: this.view.containerOffset() }
    // The map began a pan on this press, and this is what calls it off. Without it the map
    // slides under the drag, and the arrow chases a node that is moving.
    this.view.panning(false)
    this.hooks.onStart()
    document.body.classList.add("joining")
    this.draw(at.clientX, at.clientY)
  }

  private move(at: MouseEvent | undefined): void {
    if (!this.armed || !at) return
    this.draw(at.clientX, at.clientY)
  }

  /** Mark what a release would take, so the pair is readable before the button comes up. */
  private over(id: string): void {
    const armed = this.armed
    if (!armed) return
    // The element the drag started from is not a target, so it takes no mark.
    if (id === armed.from) return
    this.hooks.aim(this.hooks.ended(id) ? id : null)
  }

  private end(id: string | null): void {
    const armed = this.armed
    if (!armed) return
    // Before anything that can return early. Panning has to come back on every path out.
    this.disarm()

    // Null is a release over the background. A release on the element the drag started from is
    // the same non-event. The reader named one node and not a pair, so there is nothing to
    // refuse and nothing to say.
    if (id === null || id === armed.from) return

    const b = this.hooks.ended(id)
    if (!b || b.id === armed.a.id) return
    this.hooks.join(armed.a, b)
  }

  /**
   * The tail at the source node, the head at the cursor.
   *
   * The tail is read every frame rather than kept from the press. Panning is off, but the wheel
   * still zooms, and a tail kept from the start would come away from the node it belongs to.
   * `screenOf` measures from the canvas, and the cursor from the viewport, which is what
   * `offset` reconciles.
   *
   * The path is drawn from the tail outwards. Down one side to the head's base, out to a barb,
   * to the point, and back the other way. So the shaft and the head are one closed shape, and
   * the gradient over it has no seam to show.
   *
   * A drag too short for a shaft draws the head alone. That lands on top of the node it started
   * from. It reads there as a mark on the pill rather than as an arrow going nowhere.
   */
  private draw(x: number, y: number): void {
    const armed = this.armed
    if (!armed) return
    const from = this.view.screenOf(armed.from)
    if (!from) return
    const tail = { x: from.x + armed.offset.x, y: from.y + armed.offset.y }

    // The axis, and the perpendicular every width is measured along. A press that has not moved
    // has no axis to take, which is what `REST_FACING` answers for.
    const length = Math.hypot(x - tail.x, y - tail.y)
    const axis = length > 0 ? { x: (x - tail.x) / length, y: (y - tail.y) / length } : REST_FACING
    const side = { x: -axis.y, y: axis.x }
    // Where the head begins, so the shaft stops there instead of running on under it.
    const base = { x: x - axis.x * HEAD_LENGTH, y: y - axis.y * HEAD_LENGTH }
    const off = (at: Point, half: number): string =>
      `${(at.x + side.x * half).toFixed(1)},${(at.y + side.y * half).toFixed(1)}`
    const point = `${x.toFixed(1)},${y.toFixed(1)}`

    this.arrow.setAttribute(
      "d",
      length < LEAST_SHAFT
        ? `M${off(base, HEAD_WIDTH / 2)}L${point}L${off(base, -HEAD_WIDTH / 2)}Z`
        : `M${off(tail, TAIL_WIDTH / 2)}` +
          `L${off(base, TIP_WIDTH / 2)}` +
          `L${off(base, HEAD_WIDTH / 2)}` +
          `L${point}` +
          `L${off(base, -HEAD_WIDTH / 2)}` +
          `L${off(base, -TIP_WIDTH / 2)}` +
          `L${off(tail, -TAIL_WIDTH / 2)}Z`,
    )

    // The fade runs along the arrow, so it is aimed with it. These two ends are also the only
    // place the arrow's geometry can be read back from the page.
    this.ink.setAttribute("x1", String(tail.x))
    this.ink.setAttribute("y1", String(tail.y))
    this.ink.setAttribute("x2", String(x))
    this.ink.setAttribute("y2", String(y))
  }

  /** Put the map back the way the press found it. Every way out of a drag comes through here. */
  private disarm(): void {
    if (!this.armed) return
    this.armed = null
    this.view.panning(true)
    this.hooks.aim(null)
    document.body.classList.remove("joining")
  }
}
