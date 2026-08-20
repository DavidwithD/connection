/**
 * The Cytoscape renderer. Elements are only ever added, and no layout engine runs.
 *
 * Nodes are coloured in four tiers by hop distance from the accent. The tiers are recomputed
 * when the accent changes, and again when a read adds neighbours to it. Ghosts are the one
 * thing here that depends on the camera.
 */
import cytoscape, {
  type BoundingBox12,
  type Core,
  type Css,
  type ElementDefinition,
  type NodeSingular,
  type StylesheetJson,
} from "cytoscape"
import { LONG_EDGE, NODE_SIZE, type Point, type Slot } from "./placement.js"
import { currentPalette, type Palette } from "./palette.js"
import { NUL, edgeKey } from "./store/keys.js"
import type { World, WorldNode } from "./world.js"

/** How far a stub reaches from its node, toward the far end of a hidden long edge. */
const STUB_REACH = 44

/**
 * How far past the edge of the screen a node must be before a ghost is created for it, in
 * screen pixels. Divided by the zoom to get world units.
 *
 * A length, not a ratio. What has to be bounded here is how far the reader panned, and that
 * is one distance — a ratio wants two to compare. Wider than main.ts's keyboard pan step, so
 * a nudge and the nudge back give the same picture.
 *
 * A ghost is removed as soon as its target is visible at all, with no margin at that end.
 * This whole distance is therefore dead band on the way up. That is what stops a name being
 * shown twice: once as a ghost, once at its own position.
 */
const GHOST_MARGIN = 160

/**
 * Camera flight speed, in screen pixels per millisecond. Picked by eye from three timings of
 * one 543px flight. 720ms won.
 *
 * Screen pixels, not world units. Zoomed out, the same world distance is a shorter visual
 * move and must not take longer to cross.
 */
const FLIGHT_SPEED = 0.75
/** A minimum, so a flight to a close neighbour moves rather than snapping. */
const FLIGHT_MIN = 320
/** A maximum, because a very long flight at this speed reads as the page hanging. */
const FLIGHT_MAX = 900
/** How long a ghost takes to fade out once the camera has landed. */
const DISSOLVE_MS = 320

/**
 * The OS setting for reduced motion. Read on each flight rather than once at load, so a
 * change takes effect on the next click instead of the next reload.
 */
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)")

/**
 * The easing curve the flight timings were judged against.
 *
 * Cytoscape parses a `cubic-bezier(...)` string at runtime. See `core/animation/step.mjs`,
 * which passes the string to the style parser. Its typings only allow the bare keywords, so
 * the cast describes what the library does.
 */
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)" as Css.TransitionTimingFunction

/**
 * The gap between a name and the edge of the pill drawn around it.
 *
 * A pill takes both its dimensions from its label, and Cytoscape adds `padding` to each
 * (`nodeWidth = node.width() + 2 * padding`, in `drawing-nodes.mjs`). This one number is
 * therefore the whole pill geometry: every pill fits its name equally on all sides.
 *
 * Not one of the `NODE_SIZE` values. Those are diameters. The separations in placement.ts
 * are derived from them, and a distant node still draws as a circle at one of them.
 */
const PILL_PAD = 8

/**
 * The outline a pill draws in the surface colour, so a name reads as sitting over whatever
 * it covers.
 *
 * An outline, not a border. The border is already used: a node with unread neighbours draws
 * a dashed border.
 */
const PILL_HALO = 3

/** The font every name is set in. Named, because `nameWidth` has to measure in the same one. */
const PILL_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * Font size for a neighbour's name and for the ghost that stands in for one.
 *
 * The same size on purpose. A ghost stands in for a neighbour, so the two should look alike.
 * `nameWidth` measures at this size.
 */
const RING_FONT_SIZE = 12

/**
 * `z-index` accepts a `data()` mapper at runtime. Cytoscape's `style/parse.mjs` accepts a
 * mapper for any property without checking its type. Its typings allow only a literal
 * number, so the cast describes what the library does.
 */
const RANKED_Z = "data(lift)" as unknown as number

/**
 * The z-index range for a neighbour's name: above the distant nodes and the backdrop, below
 * a ghost and the centre. The values around this range are set in `buildStyle`.
 *
 * Within the range, names are ranked by degree. Two names overlap because they sit at the
 * same radius, so distance cannot break the tie. Degree already decides which neighbours get
 * the closest positions when room runs out, in `seatAndLink` in world.ts, so ranking by
 * degree here applies the same rule twice rather than adding a new one.
 */
const RING_Z = { top: 24, bottom: 10 } as const

/**
 * The z-index range for a ghost: above the neighbours, below the centre.
 *
 * Ranked by degree, like `RING_Z`, and it matters more here. Two overlapping names cost
 * legibility. Two overlapping ghosts cost the lower one its click, because the topmost
 * element takes the tap. Which one that is has to follow from something visible rather than
 * from the order the elements were added.
 */
const GHOST_Z = { top: 29, bottom: 26 } as const

/**
 * The z-index of the node under the pointer: one above the top of the ring's band, one below
 * the bottom of a ghost's.
 *
 * Above the ring, because a name not readable over the names always drawn is not worth showing.
 * Below a ghost and below the centre, because this pill is wider than the disc it replaces and
 * the topmost element takes the tap. A ghost's tap is a flight and the centre's is the
 * clipboard. `RING_Z` and `GHOST_Z` leave exactly this one value between them.
 */
const HOVER_Z = 25

/**
 * Extra width added to a ghost's slot beyond the pill that goes in it.
 *
 * `nameWidth` measures on its own 2D context and Cytoscape measures on another, so the two
 * agree only to about a pixel. A pill one pixel wider than its slot touches its neighbour,
 * which is what the slot arithmetic exists to prevent.
 */
const SLOT_GAP = 6

/**
 * The canvas context used for measuring text. Kept between calls, because it is the same
 * context every time and creating one per call is wasteful.
 */
let measurer: CanvasRenderingContext2D | null = null

/**
 * Measure how wide a name draws, in world units.
 *
 * A ghost's slot has to be reserved before the element exists, because a ghost never moves
 * once placed. So it cannot be created and then measured. Cytoscape sizes a pill from its
 * label (`width: "label"`), so this measures the same string in the same font. The caller
 * adds the pill's padding and halo.
 */
function nameWidth(label: string): number {
  measurer ??= document.createElement("canvas").getContext("2d")!
  measurer.font = `500 ${String(RING_FONT_SIZE)}px ${PILL_FONT}`
  return measurer.measureText(label).width
}

/**
 * Ids for the two elements that replace a long edge: a stub at one end, and the short line
 * joining that stub to its node.
 *
 * Every id here is joined with `NUL`, including the kind letter. An element then cannot
 * collide with a node whose name starts with `s` or `e`. `keys.ts` owns that character and
 * explains why a name-shaped id needs one.
 */
const stubId = (key: string, owner: string): string => `s${NUL}${key}${NUL}${owner}`
const leadId = (stub: string): string => `e${NUL}${stub}`

/** A ghost on the map: its element id, the centre that created it, and the node it names. */
interface Ghost {
  ghost: string
  centre: string
  target: string
}

/**
 * The ghost positions for one centre node, held for as long as it is the centre.
 *
 * The positions are computed once and then only assigned, never reassigned. `at` is only
 * added to, so a ghost never moves. A neighbour that arrives mid-visit takes an unused
 * position rather than another ghost's, and one that scrolls out of view and back finds its
 * own still reserved. `slotsFor` maintains this and explains why.
 */
interface Doorways {
  centre: string
  /** Every position this centre offers, in the order they are assigned. */
  pool: Point[]
  /** The position each neighbour holds. Only added to, so a ghost never moves. */
  at: Map<string, Point>
}

/** A ghost's id holds the centre that created it and the node it stands in for. */
const ghostId = (centre: string, target: string): string =>
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

function buildStyle(p: Palette): StylesheetJson {
  const pad = `${String(PILL_PAD)}px`
  return [
    // The default node: a small circle with no label. Only the centre and its neighbours
    // are labelled, and a labelled node draws as a pill. See the rules below.
    {
      selector: "node",
      style: {
        "background-color": p.hop[2]!,
        width: NODE_SIZE.resting,
        height: NODE_SIZE.resting,
        label: "",
        "font-family": PILL_FONT,
        "font-size": 11,
        // A text colour token, never the node's own colour.
        color: p.textSecondary,
        // A name is drawn inside its pill, so centre it on both axes.
        "text-valign": "center",
        "text-halign": "center",
        "border-width": 0,
        // Width and height cannot animate once they are sized from the label, so a change of
        // tier is shown through the fill colour instead.
        "transition-property": "background-color, background-opacity",
        "transition-duration": 160,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": p.edge,
        "curve-style": "straight",
        opacity: 0.55,
      },
    },
    // A neighbour of the centre. It draws as its name on a filled pill.
    {
      selector: "node[tier = 1]",
      style: {
        shape: "round-rectangle",
        width: "label",
        height: "label",
        padding: pad,
        "background-color": p.surface,
        // Nearly opaque, so where two pills overlap the front one is readable.
        "background-opacity": 0.92,
        label: "data(label)",
        color: p.hop[0]!,
        "font-size": RING_FONT_SIZE,
        "font-weight": 500,
        "outline-width": PILL_HALO,
        "outline-color": p.surface,
        "z-index": RING_Z.bottom,
      },
    },
    // The ranked z-index, set once `setTiers` has ranked them. A separate rule, so a
    // neighbour that is not ranked yet still sits above the distant nodes rather than at 0.
    { selector: "node[tier = 1][?lift]", style: { "z-index": RANKED_Z } },
    // A node near the centre but not connected to it. It drops its label and most of its
    // contrast, so the centre's neighbours can be read over it.
    {
      selector: "node[tier = 3]",
      style: { opacity: 0.22, label: "", "z-index": 0 },
    },
    { selector: "edge[dim = 1]", style: { opacity: 0.12 } },
    // The centre: the same pill, filled with the accent. It is the loudest thing on screen.
    {
      selector: "node[tier = 0]",
      style: {
        shape: "round-rectangle",
        width: "label",
        height: "label",
        padding: pad,
        "background-color": p.accent,
        "background-opacity": 1,
        label: "data(label)",
        "font-size": 15,
        "font-weight": 700,
        color: p.inkOnAccent,
        "border-width": 3,
        "border-color": p.accentRing,
        "z-index": 30,
      },
    },
    { selector: "edge[accent = 1]", style: { "line-color": p.edgeActive, opacity: 0.9, width: 2 } },
    // "This node has unread neighbours" is shown as a border style, not a colour, so it
    // still reads for someone who cannot tell two ramp steps apart.
    //
    // A thin border rather than an outline. A pill's perimeter is over twice a circle's, and
    // this appears on nearly every drawn node. Finer than the ghost's dash, so the two marks
    // are not confused.
    {
      selector: "node[?more]",
      style: {
        "border-width": 1,
        "border-color": p.frontierRing,
        "border-style": "dashed",
        "border-dash-pattern": [1, 3],
        "border-opacity": 0.55,
      },
    },
    // A ghost: a neighbour of the centre whose real position is off screen. Hollow and
    // dashed, so it is not mistaken for the node itself. The node exists once, elsewhere on
    // the map, and while the ghost is shown it is off screen.
    {
      selector: "node[?ghost]",
      style: {
        shape: "round-rectangle",
        "background-opacity": 0,
        width: "label",
        height: "label",
        padding: pad,
        "border-width": 2,
        "border-color": p.hop[0]!,
        "border-style": "dashed",
        "border-opacity": 1,
        "outline-width": PILL_HALO,
        "outline-color": p.surface,
        label: "data(label)",
        color: p.textSecondary,
        "font-size": RING_FONT_SIZE,
        "font-weight": 500,
        "z-index": GHOST_Z.bottom,
      },
    },
    // The ranked z-index, set once `rankGhosts` has run. A separate rule for the same reason
    // as the neighbour rule above: a ghost created mid-pass still sits above the neighbours.
    { selector: "node[?ghost][?lift]", style: { "z-index": RANKED_Z } },
    // A ghost's edge is dashed, because the real edge may still be drawn as a solid line. At
    // a close zoom a neighbour off screen keeps a line running to the edge of the viewport.
    // That line shows the direction. This one shows where to click to get there.
    {
      selector: "edge[?ghost]",
      style: { "line-color": p.edgeActive, "line-style": "dashed", opacity: 0.9, width: 2 },
    },
    {
      selector: "node[?stub]",
      style: {
        "background-color": p.textMuted,
        width: 7,
        height: 7,
        "border-width": 0,
        label: "",
        "z-index": 1,
        events: "no",
      },
    },
    {
      selector: "edge[?stub]",
      style: {
        width: 1.5,
        "line-color": p.textMuted,
        "line-style": "dashed",
        opacity: 0.75,
      },
    },
    { selector: "node.loading", style: { "border-width": 3, "border-style": "solid", "border-color": p.accent, "border-opacity": 1 } },
    // The node under the pointer draws as its name, the way a ring node does. Scoped to the
    // nodes that draw as discs: the centre and the ring are already named, and naming one twice
    // says nothing. A ghost carries no `tier`, which this comparison cannot match, and a stub
    // sets `events: "no"`, so neither reaches here.
    //
    // Last but for `.hidden`, so it beats the base rule's blank label and the backdrop's
    // dimming. It sets no border property, so the frontier dash and `loading` both survive.
    {
      selector: "node[?hover][tier >= 2]",
      style: {
        shape: "round-rectangle",
        width: "label",
        height: "label",
        padding: pad,
        label: "data(label)",
        "background-color": p.surface,
        // Opaque, unlike a ring pill's 0.92. Two ring pills overlap and the loser should stay
        // partly visible. There is only ever one of these, and legibility is its whole job.
        "background-opacity": 1,
        // The page's own ink, not `p.hop[0]`. The ring's ink says "a neighbour of the centre",
        // and this node is not one. It is also the pair validated against the surface.
        color: p.textPrimary,
        "font-size": RING_FONT_SIZE,
        "font-weight": 500,
        "outline-width": PILL_HALO,
        "outline-color": p.surface,
        // The backdrop's 0.22 multiplies the label as well as the fill.
        opacity: 1,
        // The fill would otherwise cross-fade from the disc's hop colour while the box snaps.
        // That shows a tinted pill for the length of the base rule's transition. This covers
        // the way in only: leaving, the base rule governs again, and its fade runs on a disc
        // rather than on a name.
        "transition-property": "none",
        "z-index": HOVER_Z,
      },
    },
    // The node a drag would join to. A ring, and no name: whatever is under the pointer is
    // already drawing one — the hover rule above, or the node's own tier. So this says which
    // node the release would take, and nothing more.
    //
    // The outline rather than the border, because the border is spoken for at three tiers: the
    // centre's ring, the frontier dash, and `loading`. It replaces the halo on a pill for as
    // long as the button is held, which is a louder mark in the same place.
    {
      selector: "node[?aim]",
      style: {
        "outline-width": 3,
        "outline-color": p.accent,
        "outline-opacity": 1,
        "outline-offset": 1,
      },
    },
    // Hidden rather than removed. A stub the centre replaced with a ghost comes back when
    // the centre moves on, and rebuilding it would mean recounting `stubbed`.
    { selector: ".hidden", style: { display: "none" } },
  ]
}

export class MapView {
  readonly cy: Core
  private accentId: string | null = null
  private stubbed = 0
  /** True while the camera is flying. Nothing may take the accent until it lands. */
  private flying = false
  /** The node whose name the pointer is holding open, or null. */
  private hovered: string | null = null
  /** The node a drag would join to, or null. */
  private aimed: string | null = null
  /** The ghosts the current centre created, and the node each one stands in for. */
  private ghosts: Ghost[] = []
  /** Ghost positions for the current centre. Built on the first pass, then only extended. */
  private doorways: Doorways | null = null

  constructor(
    container: HTMLElement,
    private readonly world: World,
  ) {
    this.cy = cytoscape({
      container,
      style: buildStyle(currentPalette()),
      // Cytoscape's own gestures: drag pans, wheel zooms toward the cursor.
      userPanningEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      // Positions never change, so nothing the reader drags may move a node. This stops the
      // node moving and nothing more: the pan on that press is `panFromNodes` below.
      autoungrabify: true,
      autolock: true,
      minZoom: 0.14,
      maxZoom: 2.4,
      wheelSensitivity: 0.22,
      textureOnViewport: false,
      // The map is mostly text, so a 1:1 canvas looks soft on a HiDPI screen. Capped at 2:
      // above that the fill cost rises and the names look no better.
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
    })
    this.panFromNodes()
  }

  /**
   * Pan when a drag starts on a node.
   *
   * Cytoscape pans on a drag of the background, and on a drag of an edge. A press on a node is
   * a node gesture, and `autoungrabify` means it moves nothing. That drag therefore did nothing
   * at all. A reader cannot tell which pixels are a node before pressing. The map read as stuck
   * wherever it was dense, and the map's own keys say a drag pans.
   *
   * The delta is the cursor's, so the map follows the pointer exactly as it does from the
   * background.
   */
  private panFromNodes(): void {
    let last: Point | null = null

    this.cy.on("tapstart", (event) => {
      // Cleared on every press, and set only for one on a node. The background and an edge pan
      // by themselves, so panning here as well would move the map twice as far. Clearing here
      // rather than only on the release matters. A release outside the window never arrives,
      // and it would leave this armed for the next press.
      last = null
      const original = event.originalEvent as MouseEvent | undefined
      if (!original || event.target === this.cy || !event.target.isNode()) return
      last = { x: original.clientX, y: original.clientY }
    })

    this.cy.on("tapdrag", (event) => {
      if (!last) return
      const original = event.originalEvent as MouseEvent | undefined
      // A move with no button held is a hover, and `buttons` is what tells the two apart. A
      // touch event carries no `buttons`, which is why this compares against zero rather than
      // testing for the button.
      if (!original || original.buttons === 0) return
      // Not during a flight: the camera is already going somewhere, and a pan would land it
      // where neither asked for. Not while panning is switched off either — that is how a
      // gesture keeps the drag to itself. See drag-join.ts.
      if (this.flying || !this.cy.userPanningEnabled()) return
      this.cy.panBy({ x: original.clientX - last.x, y: original.clientY - last.y })
      last = { x: original.clientX, y: original.clientY }
    })

    this.cy.on("tapend", () => {
      last = null
    })
  }

  get longEdgeCount(): number {
    return this.stubbed
  }

  restyle(palette: Palette): void {
    this.cy.style(buildStyle(palette))
  }

  /** World coordinates of the middle of the viewport. */
  centre(): Point {
    const box = this.cy.extent()
    return { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 }
  }

  /**
   * Half the viewport's smaller span, in world units — how far a claim on the centre may look.
   *
   * The smaller span and halved, so a node within reach of the middle is a node on screen. The
   * claim runs when a centre has been taken off the map and something has to replace it, and a
   * wider reach would replace it with a node the reader cannot see. It is not what keeps the
   * centre in view: nothing does, and an off-screen centre is a picture the reader asked for.
   */
  reach(): number {
    const box = this.cy.extent()
    return Math.min(box.w, box.h) / 2
  }

  /**
   * Remove elements, for an undone write.
   *
   * The only removal on the map. It has to undo whichever form `add` chose. A short edge is
   * one element under the pair key. A long edge is two stubs and two leads, and removing a
   * stub node removes its lead with it. Both forms are tried, because which one was drawn
   * depended on a distance that may have changed since.
   *
   * Ghosts are removed first when a node they stand for is going. A ghost holds its target's
   * id, and one pointing at a node that no longer exists would survive every later
   * `clearGhosts`.
   *
   * The test is against the slot plan, not the ghosts currently shown, because the plan is
   * the larger set: a slot is held for a neighbour whose ghost is hidden. Rebuilding the plan
   * also lets the remaining slots use the space the removal just freed.
   */
  drop(nodeIds: readonly string[], edges: readonly [string, string][]): void {
    const plan = this.doorways
    if (plan && nodeIds.some((id) => id === plan.centre || plan.at.has(id))) {
      this.clearGhosts()
    }

    this.cy.batch(() => {
      for (const [a, b] of edges) {
        const key = edgeKey(a, b)
        const short = this.cy.$id(key)
        if (short.nonempty()) short.remove()
        for (const owner of [a, b]) {
          const stub = this.cy.$id(stubId(key, owner))
          if (stub.nonempty()) {
            stub.remove()
            // `add` counts once per long edge, so decrement once per long edge here.
            if (owner === a) this.stubbed = Math.max(0, this.stubbed - 1)
          }
        }
      }
      // Cytoscape removes a node's edges with it, so anything still attached goes now.
      for (const id of nodeIds) this.cy.$id(id).remove()
      // An accent pointing at a deleted node would keep the HUD naming it until the camera
      // moved. Clear it here. The caller picks a new one.
      if (this.accentId && nodeIds.includes(this.accentId)) this.accentId = null

      // Each surviving end of a removed edge may have unread neighbours again.
      for (const [a, b] of edges) {
        for (const id of [a, b]) {
          if (nodeIds.includes(id)) continue
          this.cy.$id(id).data("more", this.world.missing(id) > 0)
        }
      }
    })
  }

  /**
   * Change the name a node draws, and nothing else.
   *
   * For a rename that kept its key, where the id is the same node and only the spelling
   * moved. A pill takes both dimensions from its label, so Cytoscape resizes it on this
   * write. Position, tier and edges are untouched.
   */
  relabel(id: string, label: string): void {
    const node = this.cy.$id(id)
    if (node.nonempty()) node.data("label", label)
  }

  /** Add elements. Existing ones are never changed. `drop` removes, and only for an undo. */
  add(nodes: readonly WorldNode[], edges: readonly [string, string][]): void {
    const elements: ElementDefinition[] = []
    // A node can arrive while its parent is already the centre. It has to be created in the
    // right tier. Waiting for the next accent change would draw the centre's own neighbour
    // as a distant node.
    const accent = this.accentId
    const ring = accent ? new Set(this.world.neighbours(accent)) : null

    for (const node of nodes) {
      elements.push({
        group: "nodes",
        data: {
          id: node.id,
          label: node.label,
          degree: node.degree,
          tier: node.id === accent ? 0 : ring?.has(node.id) ? 1 : 2,
          more: this.world.missing(node.id) > 0,
        },
        position: { x: node.x, y: node.y },
      })
    }

    for (const [a, b] of edges) {
      const key = edgeKey(a, b)
      if (this.world.span(a, b) <= LONG_EDGE) {
        elements.push({ group: "edges", data: { id: key, source: a, target: b } })
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
        elements.push({
          group: "nodes",
          data: { id: stub, stub: true, tier: 2 },
          position: { x: sx, y: sy },
        })
        elements.push({
          group: "edges",
          data: { id: leadId(stub), source: owner, target: stub, stub: true },
        })
      }
      this.stubbed++
    }

    this.cy.batch(() => {
      this.cy.add(elements)
      // A new edge can make a node complete. Update the dashed border on both ends.
      for (const [a, b] of edges) {
        for (const id of [a, b]) {
          this.cy.$id(id).data("more", this.world.missing(id) > 0)
        }
      }
      // Edges reaching the centre are the centre's edges, and are drawn as such.
      if (accent) {
        this.cy.$id(accent).connectedEdges().data("accent", 1)
        // A node already on the map when this read landed was given a tier before it was
        // known to be a neighbour of the centre. Only `setAccent` recomputes tiers, and it
        // does not run until the accent moves, so promote it here. This is
        // O(degree + nearby nodes), once per read rather than once per frame.
        this.setTiers(accent, true)
      }
    })
    // No ghost pass here, on purpose. A read can leave new nodes off screen with no ghost
    // standing in for them, but this also runs for a late placement, and creating elements
    // here would put that work on a pan's frame budget. Ghosts are only created on a settled
    // camera, and main.ts schedules a settle when a read lands.
  }

  /**
   * How far the centre's neighbours reach. This is also how far the dimmed area extends.
   *
   * Measured from the neighbours joined by a drawn line, so it is a world distance and not a
   * screen one. A radius that followed the camera would dim a different set of nodes at every
   * zoom, and every settle would restyle everything near the centre. The question is which
   * nodes this centre crowds, which depends on positions, not on the zoom.
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
   * The centre's neighbours, ordered by who should get a ghost first.
   *
   * Neighbours with no drawn line first. A neighbour off screen whose edge is drawn still
   * shows the reader which way the connection goes. One drawn as two stubs shows almost
   * nothing, so a ghost is worth more there. `add` decided which pairs got a line, and this
   * asks the map rather than recomputing it.
   *
   * Then nearest first. Those are the most likely to be worth walking to, and the ones
   * `Explorer` may already have read. Degree breaks a tie, as it does for the paint order,
   * and ties are common because a parent's neighbours sit at one radius. Id breaks the rest,
   * so the result does not depend on which edge was linked first.
   *
   * Every neighbour is listed. The order matters, not the length: `slotsFor` walks this list
   * and gives a slot to each neighbour that needs one, so this decides who is served when a
   * neighbourhood asks for more slots than the rings have.
   *
   * This does not depend on the camera, so two neighbours never swap order during a pan.
   * Which of them is eligible does change, and `slotsFor` explains why that cannot move a
   * ghost that is already shown.
   */
  private ghostable(known: readonly string[], centre: string): string[] {
    const ranked = known.map((other) => ({
      id: other,
      unlined: this.cy.$id(edgeKey(centre, other)).empty() ? 0 : 1,
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

  /**
   * How far a node's drawn box lies outside the viewport, in world units. Zero or less means
   * some part of it is on screen.
   *
   * The box, not the position, because a neighbour draws as its name. A position just past
   * the edge can still have half its label visible, and a ghost for it would show the same
   * name twice.
   *
   * The largest of the four axis gaps, not the distance to a corner. Negative on all four
   * axes is what overlapping the viewport means, and a positive value is how far one axis
   * must move to bring the node on screen. That is what the margin measures.
   */
  private outsideBy(id: string, view: BoundingBox12): number {
    const node = this.cy.$id(id)
    // Cytoscape gives an empty collection a box at the origin, which would read as on screen
    // whenever the origin is. There is no node here, so return the value that creates no
    // ghost.
    if (node.empty()) return -Infinity
    const box = node.boundingBox()
    return Math.max(view.x1 - box.x2, box.x1 - view.x2, view.y1 - box.y2, box.y1 - view.y2)
  }

  /**
   * Where each of a centre's ghosts stands. Built once per centre, then only extended.
   *
   * The slots cannot be recomputed on each pass. `seat` spreads what it is given evenly, so
   * the same neighbours in a different number come back on different bearings. And a ghost
   * does not occupy the grid, so asking for one slot twice returns the same point twice and
   * the second ghost lands on the first. Either way, a set that changed with the camera would
   * move ghosts that are already on screen, and nothing on this map moves.
   *
   * The pool is sized from the degree the store reports, not from the neighbours drawn so
   * far, so a read that lands later finds a slot waiting instead of shifting what is already
   * shown. A write that adds a neighbour beyond that size leaves it without a slot for the
   * rest of the visit. It keeps whatever line the map already drew for it.
   *
   * `reach` is read here only, on the pass that builds the plan, for the same reason. It sets
   * how far out the outermost ring can sit, and a reach that followed the zoom would move
   * ghosts already shown. So a visit is measured once, at the zoom it started at.
   *
   * Built here rather than in `setAccent`, so `seat` runs with the rest of the ghost work on a
   * settled camera. Naming a centre is a click's worth of work; cutting a plan is not.
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
      // arrives later, but a name that has not arrived cannot be measured, so a longer one
      // will overhang its slot.
      plan = {
        centre,
        pool: this.world.slotsAround(centre, room, this.slotBox(known), reach),
        at: new Map(),
      }
      this.doorways = plan
    }

    // A slot is claimed only by a neighbour past the margin, meaning one about to get a ghost.
    // Assigning a slot to every neighbour up front would spend the pool on names already in
    // view: a hub has more neighbours than the rings have room for.
    //
    // This depends on the camera, and that is safe because a claim is never released. The
    // camera decides who receives a free slot. It cannot move or revoke a slot already held,
    // so a neighbour that goes out of view and comes back finds its own waiting, and a pan
    // never moves a ghost on screen. `ghostable` orders the claimants among themselves.
    //
    // The guard is on a slot being left, not on the neighbourhood having grown, because the
    // answer now depends on the camera. Once the pool is fully assigned there is nothing to
    // do, so the sort only runs while slots remain.
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
   * height is the font size plus the padding, which is what Cytoscape computes.
   */
  private slotBox(ids: readonly string[]): Slot {
    let widest = 0
    for (const id of ids) {
      const label = this.world.get(id)?.label
      if (label) widest = Math.max(widest, nameWidth(label))
    }
    const around = 2 * PILL_PAD + 2 * PILL_HALO + SLOT_GAP
    return { w: widest + around, h: RING_FONT_SIZE + around }
  }

  /**
   * Set the paint order of the ghosts on screen, by degree. This is the same rule `setTiers`
   * uses for the neighbours, applied to ghosts for the reason given at `GHOST_Z`.
   *
   * Recomputed whenever the set changes, not fixed when a ghost is created. The rank is a
   * position within the set, so one ghost leaving changes it for the rest. Setting `lift`
   * only restyles, so nothing moves.
   */
  private rankGhosts(standing: readonly Ghost[]): void {
    const ranked = [...standing].sort(
      (a, b) =>
        (this.world.get(b.target)?.degree ?? 0) - (this.world.get(a.target)?.degree ?? 0) ||
        (a.target < b.target ? -1 : 1),
    )
    const band = GHOST_Z.top - GHOST_Z.bottom
    ranked.forEach((ghost, i) => {
      const lift =
        ranked.length > 1
          ? GHOST_Z.top - Math.round((i / (ranked.length - 1)) * band)
          : GHOST_Z.top
      this.cy.$id(ghost.ghost).data("lift", lift)
    })
  }

  /** The stub at one end of a long edge, together with its lead. */
  private stubAt(owner: string, other: string) {
    const stub = stubId(edgeKey(owner, other), owner)
    return this.cy.$id(stub).union(this.cy.$id(leadId(stub)))
  }

  /**
   * Create a ghost for every neighbour that is off screen, and remove every ghost whose
   * neighbour has come into view.
   *
   * Idempotent, and run on a settled camera rather than per frame. A ghost is an element, and
   * elements appearing and disappearing during a fast pan would flicker.
   *
   * The two tests are deliberately not opposites. A ghost is removed as soon as any part of
   * its target is visible, and created only once the target is `GHOST_MARGIN` past the edge.
   * One pass can therefore never both remove and create a ghost for the same neighbour, and
   * a name is never readable at its own position and shown as a ghost at the same time.
   *
   * Runs whether or not the centre is itself on screen. A pan carries the centre off the edge
   * and its doorways with it now that neither answers to the camera, and skipping the pass for
   * a picture nobody is looking at is the obvious saving — but a neighbour can come back into
   * view while the centre is still outside it, and the pass that did not run is the one that
   * would have taken that ghost down. Measuring regardless is what the invariant above costs.
   *
   * Nothing is written to the occupancy grid — a ghost holds no ground, which is also what
   * stops `nearestTo` ever returning one and making a ghost the centre.
   */
  reviseGhosts(): void {
    const centre = this.accentId
    if (!centre || this.flying) return

    const known = this.world.neighbours(centre)
    const view = this.cy.extent()
    const margin = GHOST_MARGIN / this.cy.zoom()
    // Measure before opening the batch. A box sized from a label needs the style pass, and a
    // batch defers that until the outermost batch closes. Measure every neighbour, not only
    // the ones holding a slot, because `slotsFor` chooses from these.
    const outside = new Map<string, number>()
    for (const target of known) outside.set(target, this.outsideBy(target, view))
    // How far out a slot may sit: half the viewport's smaller side. A ghost further out than
    // this is not worth creating. `slotsFor` reads this only on the pass that builds the
    // plan, and explains why.
    const reach = Math.min(view.x2 - view.x1, view.y2 - view.y1) / 2
    const slots = this.slotsFor(centre, known, reach, outside, margin)

    const neighbours = new Set(known)
    const standing = new Set<string>()
    const down: Ghost[] = []
    for (const ghost of this.ghosts) {
      // A ghost whose target is no longer a neighbour is removed too. Undoing a join removes
      // the edge and keeps both nodes, so nothing else would remove it.
      const gap = outside.get(ghost.target) ?? -Infinity
      if (neighbours.has(ghost.target) && gap > 0) standing.add(ghost.target)
      else down.push(ghost)
    }

    const up: Ghost[] = []
    const elements: ElementDefinition[] = []
    for (const [target, at] of slots) {
      // The plan keeps a slot for a node that is no longer a neighbour, because it is only
      // ever added to. Without this test the loop above would remove that ghost and this one
      // would recreate it, showing an edge that no longer exists.
      if (!neighbours.has(target)) continue
      if (standing.has(target) || (outside.get(target) ?? -Infinity) <= margin) continue
      const node = this.world.get(target)
      if (!node) continue
      const ghost = ghostId(centre, target)
      up.push({ ghost, centre, target })
      elements.push({
        group: "nodes",
        data: { id: ghost, label: node.label, ghost: true },
        position: { x: at.x, y: at.y },
      })
      elements.push({
        group: "edges",
        data: { id: leadId(ghost), source: centre, target: ghost, ghost: true },
      })
    }

    // A settle fires on every camera stop. When nothing crossed a threshold, stop here: no
    // batch, no style pass, no redraw.
    if (!down.length && !up.length) return

    const after = [...this.ghosts.filter((ghost) => standing.has(ghost.target)), ...up]
    this.cy.batch(() => {
      for (const ghost of down) this.lower(ghost)
      // Hide the long edge's stub at this end. The ghost says the same thing more clearly. A
      // short edge has no stub, and its line stays: the line shows where the neighbour
      // actually is, which a ghost cannot.
      for (const ghost of up) this.stubAt(centre, ghost.target).addClass("hidden")
      this.cy.add(elements)
      this.rankGhosts(after)
    })
    this.ghosts = after
  }

  /** Remove one ghost and show the stub it replaced. */
  private lower(ghost: Ghost): void {
    this.stubAt(ghost.centre, ghost.target).removeClass("hidden")
    this.cy.$id(ghost.ghost).remove()
  }

  /** Remove every ghost and discard the slot plan. */
  private clearGhosts(): void {
    // Before the early return, because a plan outlives its ghosts. A centre whose neighbours
    // are all on screen has a plan with no slots assigned, and a stale plan surviving an
    // accent change is the one way the slots come out wrong.
    this.doorways = null
    if (!this.ghosts.length) return
    for (const ghost of this.ghosts) this.lower(ghost)
    this.ghosts = []
  }

  private setTiers(id: string, active: boolean): void {
    const node = this.cy.$id(id)
    node.data("tier", active ? 0 : 2)
    const neighbours = this.world.neighbours(id)
    if (active) {
      // Spread across the `RING_Z` range rather than numbered one by one. A hub's neighbours
      // would otherwise run past the bottom of the range and stack in an arbitrary order.
      const ranked = [...neighbours].sort(
        (a, b) => (this.world.get(b)?.degree ?? 0) - (this.world.get(a)?.degree ?? 0),
      )
      const band = RING_Z.top - RING_Z.bottom
      ranked.forEach((other, i) => {
        const lift =
          ranked.length > 1
            ? RING_Z.top - Math.round((i / (ranked.length - 1)) * band)
            : RING_Z.top
        this.cy.$id(other).data({ tier: 1, lift })
      })
    } else {
      for (const other of neighbours) this.cy.$id(other).data("tier", 2)
    }
    node.connectedEdges().data("accent", active ? 1 : 0)
    for (const other of this.backdropOf(id)) {
      const backdrop = this.cy.$id(other)
      backdrop.data("tier", active ? 3 : 2)
      backdrop.connectedEdges().data("dim", active ? 1 : 0)
    }
  }

  /**
   * Make a node the accent and demote the previous one. It touches only the two
   * neighbourhoods involved, so it stays cheap during a pan.
   */
  setAccent(id: string): boolean {
    if (id === this.accentId || this.cy.$id(id).empty()) return false
    const previous = this.accentId
    this.accentId = id

    this.cy.batch(() => {
      this.clearGhosts()
      // Clear the old tiers before setting the new ones. A node in both neighbourhoods then
      // ends up promoted rather than demoted.
      if (previous) this.setTiers(previous, false)
      this.setTiers(id, true)
    })

    // A hovered node promoted to the centre or its ring has left the hover rule's scope. The
    // flag draws nothing at those two tiers, so dropping it here costs no mark. It stops the
    // node drawing as a hovered pill when it demotes again with the pointer elsewhere.
    // Cytoscape will not drop it: the pointer crossed no element, so the element it last
    // reported was never rewritten. Reading the tier back covers both tiers without repeating
    // `setTiers`'s neighbour list.
    if (this.hovered && Number(this.cy.$id(this.hovered).data("tier")) < 2) this.hover(null)
    return true
  }

  /** True while a ghost is flying. The accent must not move until it lands. */
  get inFlight(): boolean {
    return this.flying
  }

  get accent(): string | null {
    return this.accentId
  }

  loading(id: string, active: boolean): void {
    const node = this.cy.$id(id)
    if (active) node.addClass("loading")
    else node.removeClass("loading")
  }

  /**
   * Name the node under the pointer, or clear the one that is named.
   *
   * One at a time, and cleared here rather than by the caller. Cytoscape emits `mouseout` on
   * the element being left before `mouseover` on the one being entered, so this normally finds
   * nothing to clear.
   *
   * A node `drop` removes while hovered needs no guard there. The flag went with the element,
   * and `$id` of an id that is gone writes to no elements.
   *
   * Nothing else may clear this. Cytoscape writes the element it last reported only on a
   * pointer move that changes which one that is. A flag cleared from anywhere else would not be
   * set again until the pointer left the node and came back. A node under a resting pointer
   * would then show nothing.
   */
  hover(id: string | null): void {
    if (id === this.hovered) return
    if (this.hovered) this.cy.$id(this.hovered).data("hover", false)
    this.hovered = id
    if (id) this.cy.$id(id).data("hover", true)
  }

  /**
   * Mark the node a drag would join to, or clear the mark.
   *
   * The same one-at-a-time shape as `hover`, and a separate flag on purpose. This one is not
   * scoped to a tier. Either end of a drag may be any node drawn, the centre and its ring
   * included. So the mark has to draw wherever the pointer lands.
   */
  aim(id: string | null): void {
    if (id === this.aimed) return
    if (this.aimed) this.cy.$id(this.aimed).data("aim", false)
    this.aimed = id
    if (id) this.cy.$id(id).data("aim", true)
  }

  /**
   * How long a flight should take, from how far it looks on screen.
   *
   * A fixed duration cannot suit distances that vary tenfold. It is a jump cut at one end
   * and slow at the other. Holding the speed roughly constant is what the eye judges, and
   * the two clamps stop both extremes.
   *
   * Zero when the OS asks for reduced motion. The camera then cuts to the destination and
   * the ghost fades where it lands. The fade is kept: a fade is the right replacement for a
   * movement.
   */
  private flightTime(from: Point, to: Point): number {
    if (REDUCED_MOTION.matches) return 0
    const pixels = Math.hypot(to.x - from.x, to.y - from.y) * this.cy.zoom()
    return Math.min(FLIGHT_MAX, Math.max(FLIGHT_MIN, pixels / FLIGHT_SPEED))
  }

  /** Move the camera so a node sits in the middle of the screen. */
  focus(id: string, animate = true): void {
    const node = this.world.get(id)
    if (!node) return
    if (!animate) {
      this.cy.center(this.cy.$id(id))
      return
    }
    this.cy.animate(
      { center: { eles: this.cy.$id(id) } },
      { duration: this.flightTime(this.centre(), node), easing: EASING },
    )
  }

  /**
   * Fly to the node a ghost stands in for, and fade the ghost out on arrival.
   *
   * The ghost is not removed on click. It moves. If it disappeared as soon as its centre
   * stopped being the centre, the thing the reader clicked would be gone by the second
   * frame. So the accent is held for the duration and the ghost moves to the real node,
   * arriving as the camera finishes centring it.
   *
   * This is the one place anything on the map moves. `autolock` normally makes every
   * position immutable, which is what keeps positions fixed, so it is turned off for the
   * flight and back on afterwards. `autoungrabify` is left on throughout, so nothing the
   * reader does can move a node.
   */
  flyTo(ghost: string, onArrive: (target: string) => void): boolean {
    const target = ghostTarget(ghost)
    const node = target ? this.world.get(target) : null
    const flier = this.cy.$id(ghost) as NodeSingular
    if (!target || !node || this.flying || flier.empty()) return false

    const from = this.ghosts.find((g) => g.ghost === ghost)?.centre ?? null
    const duration = this.flightTime(flier.position(), node)
    this.flying = true
    this.cy.autolock(false)

    // Fade out the other ghosts. They belong to the centre being left behind.
    for (const other of this.ghosts) {
      if (other.ghost === ghost) continue
      this.cy.$id(other.ghost).animate({ style: { opacity: 0 } }, { duration: 260 })
    }

    this.cy.animate({ center: { eles: this.cy.$id(target) } }, { duration, easing: EASING })
    flier
      .animate({ position: { x: node.x, y: node.y } }, { duration, easing: EASING })
      .animate({ style: { opacity: 0 } }, { duration: DISSOLVE_MS })

    // Two moments, not one. The destination becomes the accent as the camera lands, and the
    // ghost fades out over the next 320ms. Waiting for the fade would leave the map naming
    // the node the reader started from.
    setTimeout(() => {
      this.cy.autolock(true)
      this.flying = false
      // Take the flying ghost out of the list. `setAccent` removes the others, but this one
      // is still fading and outlives them. Its removal is scheduled before anything that
      // could throw, so it cannot be left on the map.
      this.ghosts = this.ghosts.filter((g) => g.ghost !== ghost)
      // Remove the element, not the id. Ghosts come and go as the camera moves, so walking
      // straight back can create a new ghost with this same id before the fade finishes, and
      // removing by id would delete that one instead.
      setTimeout(() => flier.remove(), DISSOLVE_MS)
      if (from) this.stubAt(from, target).removeClass("hidden")
      this.setAccent(target)
      this.reviseGhosts()
      onArrive(target)
    }, duration)
    return true
  }

  resize(): void {
    this.cy.resize()
  }
}
