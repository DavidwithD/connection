/**
 * The map. Cytoscape draws it; the camera is the user's.
 *
 * The smoothness rule is that this class only ever *adds* elements. Nothing is moved,
 * restyled per frame, or removed, so a pan is pure camera work and costs nothing beyond
 * the redraw. Panning triggers no fetch and no layout because there is no layout.
 *
 * Cytoscape's native gestures are exactly the Google Maps convention already: drag pans,
 * wheel zooms toward the cursor. `autoungrabify` turns a drag that starts on a node into
 * a pan rather than a move, which both matches a map and protects the frozen positions.
 *
 * Importance is four discrete tiers — accent, its graph neighbours, everything else, and
 * the backdrop it crowds — recomputed when the accent changes and again when a reply lands
 * on it, which is O(degree) rather than per frame. A continuous falloff would mean
 * restyling every node per frame.
 *
 * Ghosts are the one exception to all of the above, and the exception is deliberate. They are
 * also the one thing here the camera decides: a ghost stands for a neighbour of the centre
 * while that neighbour is off screen, so zooming and panning raise and lower them. That costs
 * a handful of measurements once the camera stops, never per frame, and it is what keeps a
 * name from being readable at its own seat and stood in for in the ring at the same time.
 *
 * Tiers, ghosts and the flight are drawn out in docs/design/the-centre.md; the reasoning
 * is docs/decisions/0004-the-centre-and-its-neighbourhood.md, with the viewport rule above
 * in docs/decisions/0025-when-a-ghost-stands.md, and
 * docs/decisions/0003-graph-exploration-demo-stack.md for the world model underneath.
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
import type { World, WorldNode } from "./world.js"

/** How far a stub reaches from its node, toward the far end of a hidden long edge. */
const STUB_REACH = 44

/**
 * How far past the edge of the screen a seat must sit before a ghost is raised for it, in
 * screen pixels, divided by the zoom to reach world units.
 *
 * A length rather than a ratio: `ACCENT_HYSTERESIS` in main.ts compares two distances to the
 * middle, so a proportion is what it measures, but here there is one distance and what needs
 * bounding is how far the reader's hand moved. Wider than main.ts's keyboard pan step, so a
 * nudge and the nudge back land on the same picture.
 *
 * A ghost comes down the moment its target shows at all, with no margin at that end, so this
 * whole distance is dead band on the way up — which is what stops the ring holding a name
 * that is also readable at its own seat.
 */
const GHOST_MARGIN = 160

/**
 * Flight speed across the screen, in pixels per millisecond. Chosen by eye against the
 * three-way comparison in docs/design/names-and-options.html, figure 5: 543px in 720ms.
 *
 * Screen pixels rather than world units, because zoomed out the same world distance is a
 * shorter visual move and must not take longer to cross.
 */
const FLIGHT_SPEED = 0.75
/** A close neighbour would otherwise snap rather than move. */
const FLIGHT_MIN = 320
/** A proportionally long flight reads as broken, so the longest ones run faster. */
const FLIGHT_MAX = 900
/** How long the ghost takes to dissolve once it has landed. */
const DISSOLVE_MS = 320

/**
 * The OS asking for less movement. Read per flight rather than once at load, so the
 * setting takes effect on the next click instead of the next reload.
 */
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)")

/**
 * The same curve the timing was judged against in the figure.
 *
 * Cytoscape parses a parameterised `cubic-bezier(...)` at runtime — see its
 * `core/animation/step.mjs`, which hands the string to the style parser — but its
 * typings only model the bare keyword. The cast describes the library, rather than
 * working around it.
 */
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)" as Css.TransitionTimingFunction

/**
 * The inset between a name and the edge of the pill it draws as.
 *
 * Both of a pill's dimensions come from its label and Cytoscape adds `padding` to each of
 * them (`nodeWidth = node.width() + 2 * padding`, in its `drawing-nodes.mjs`), so this one
 * number is the whole geometry: every pill hugs its name equally on all sides, at whatever
 * size that name is set in.
 *
 * Not a `NODE_SIZE`: those diameters are what the separations are derived from
 * (placement.ts) and what a field node still draws at, and a pill is neither.
 */
const PILL_PAD = 8

/**
 * The halo a pill wears in the surface colour, so a name reads as being *over* what it covers
 * rather than colliding with it.
 *
 * An outline rather than a border, because the border is already spoken for: a node that is
 * also a frontier has to keep its dashed edge.
 */
const PILL_HALO = 3

/** The typeface every name is set in. Named, because the slot measurement has to match it. */
const PILL_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * Type size for a ring name and for the ghost that stands in for one.
 *
 * Shared deliberately: a ghost is a stand-in for a ring node, so a reader comparing the two
 * is comparing the same name at the same size. It is also what `nameWidth` has to measure at.
 */
const RING_FONT_SIZE = 12

/**
 * `z-index` takes a `data()` mapper at runtime — cytoscape's `style/parse.mjs` accepts a
 * mapper for any property without consulting its type — but the typings model only the
 * literal number. The cast describes the library.
 */
const RANKED_Z = "data(lift)" as unknown as number

/**
 * Paint order within the ring: above the field and the backdrop, below a ghost and the
 * centre. The band's ends are here; the tiers it has to stay between are in `buildStyle`.
 *
 * Ranked by degree, because a tie has to be settled by something a reader can infer and
 * distance cannot settle it: pills collide *because* they are siblings on one ring, which
 * is to say at one radius. Degree already decides which neighbours get the closest seats
 * when room runs short (`seatAndLink` in world.ts), so the better-connected name being the
 * one drawn whole is the same rule twice rather than a new one.
 */
const RING_Z = { top: 24, bottom: 10 } as const

/**
 * Paint order among ghosts: above the ring, below the centre.
 *
 * Ranked by the same key as `RING_Z`, and for a sharper version of the same reason. Two ring
 * names overlapping costs legibility; two doorways overlapping costs the one underneath its
 * click, since the topmost element takes the tap. Which of them that is has to follow from
 * something the reader can see rather than from the order the elements were added in.
 */
const GHOST_Z = { top: 29, bottom: 26 } as const

/**
 * Slack between a ghost's slot and the pill that lands in it.
 *
 * `nameWidth` measures on a 2D context and Cytoscape measures with its own, so the two agree
 * to about a pixel. A pill a pixel wider than its slot touches its neighbour, and touching is
 * the thing the slot arithmetic exists to prevent.
 */
const SLOT_GAP = 6

/**
 * Kept between calls because it is the same context every time. The one Cytoscape's canvas
 * renderer runs on, so a page that cannot get one has no map to stand a ghost on either.
 */
let measurer: CanvasRenderingContext2D | null = null

/**
 * How wide a name draws, in world units.
 *
 * A slot has to be reserved before the element exists, because a ghost may never move: it
 * cannot be placed and then measured. Cytoscape sizes a pill from its label
 * (`width: "label"`), so this measures the same string at the same font, and the pill's own
 * padding and halo are added by the caller.
 */
function nameWidth(label: string): number {
  measurer ??= document.createElement("canvas").getContext("2d")!
  measurer.font = `500 ${String(RING_FONT_SIZE)}px ${PILL_FONT}`
  return measurer.measureText(label).width
}

const pairKey = (a: string, b: string): string => (a < b ? `${a} ${b}` : `${b} ${a}`)

/** A ghost on the map: its element, the centre that raised it, and the node it stands for. */
interface Ghost {
  ghost: string
  centre: string
  target: string
}

/**
 * Where one centre's ghosts stand, for as long as it is the centre.
 *
 * Cut once and handed out for keeps: `at` is only ever added to, so a ghost never moves. A
 * neighbour arriving mid-visit takes a spare rather than anyone's seat, and one that goes out
 * of view and comes back finds its own still reserved. `slotsFor` is where this is maintained,
 * and says why it has to be.
 */
interface Doorways {
  centre: string
  /** Every slot this centre offers, in the order they are handed out. */
  pool: Point[]
  /** The slot each neighbour holds. Only ever added to, so a doorway never moves. */
  at: Map<string, Point>
}

/** A ghost belongs to the centre that raised it, and names the node it stands in for. */
const ghostId = (centre: string, target: string): string => `g:${centre}:${target}`

/** The node a ghost stands in for, or null if this is not a ghost. */
export function ghostTarget(id: string): string | null {
  if (!id.startsWith("g:")) return null
  const cut = id.indexOf(":", 2)
  return cut < 0 ? null : id.slice(cut + 1)
}

function buildStyle(p: Palette): StylesheetJson {
  const pad = `${String(PILL_PAD)}px`
  return [
    // A node at rest: a disc, and unnamed. Only the centre and its ring are named, and a
    // named node draws as its name — see the pill selectors below.
    {
      selector: "node",
      style: {
        "background-color": p.hop[2]!,
        width: NODE_SIZE.resting,
        height: NODE_SIZE.resting,
        label: "",
        "font-family": PILL_FONT,
        "font-size": 11,
        // Ink tokens, never the node's own colour.
        color: p.textSecondary,
        // A name sits inside its pill, so it is centred on both axes for every node that
        // has one.
        "text-valign": "center",
        "text-halign": "center",
        "border-width": 0,
        // Neither axis can tween once width is sized from the label, so promotion reads
        // through the fill instead — and mostly through a name appearing at all.
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
    // The ring: the name *is* the node. Why it keeps a plate instead of floating as bare
    // type is docs/decisions/0012-the-name-is-the-node.md.
    {
      selector: "node[tier = 1]",
      style: {
        shape: "round-rectangle",
        width: "label",
        height: "label",
        padding: pad,
        "background-color": p.surface,
        // Near-opaque, so where two pills overlap the front one reads whole instead of the
        // two interleaving. Why they are allowed to overlap: docs/design/the-centre.md.
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
    // Ranked paint order, once `setTiers` has ranked them. Kept a separate rule so a ring
    // node that has not been ranked yet still sits above the field rather than at zero.
    { selector: "node[tier = 1][?lift]", style: { "z-index": RANKED_Z } },
    // The backdrop: close to the centre, but connected to something else. It gives up
    // its label and most of its contrast so the ring can be read across it.
    {
      selector: "node[tier = 3]",
      style: { opacity: 0.22, label: "", "z-index": 0 },
    },
    { selector: "edge[dim = 1]", style: { opacity: 0.12 } },
    // The centre: the same pill, filled. The fill is what carries "you are here", and it is
    // the loudest thing on screen.
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
    // "More this way" is a border style, not a hue — it still reads for someone who
    // cannot separate the two ramp steps.
    //
    // A seam rather than an outline, because a pill's perimeter is over twice a disc's and
    // this sits on nearly every drawn node — see 0006's consequences. Finer than the
    // ghost's dash, so the two are not read as one.
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
    // A ghost: a neighbour of the centre whose real seat is off screen. Hollow and dashed,
    // because it must never be mistaken for the node itself — there is only ever one of
    // those, somewhere else on the map, and while this stands it is somewhere you cannot see.
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
    // Ranked once `rankGhosts` has ranked them, the same shape as the ring's rule above: a
    // ghost raised mid-pass and not yet ranked still sits above the ring rather than at zero.
    { selector: "node[?ghost][?lift]", style: { "z-index": RANKED_Z } },
    // Dashed, because the edge a ghost stands for may still be drawn as a line: a neighbour
    // off screen at close zoom keeps the line that runs to the edge of the viewport. That
    // line says which way the connection goes; this one says here is the door to it. Two
    // marks meaning different things cannot be painted the same.
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
    // Hidden rather than removed: a stub the centre has replaced with a ghost comes back
    // when the centre moves on, and re-deriving it would cost another `stubbed` count.
    { selector: ".hidden", style: { display: "none" } },
  ]
}

export class MapView {
  readonly cy: Core
  private accentId: string | null = null
  private stubbed = 0
  /** Set while a ghost is travelling. Nothing may take the accent until it lands. */
  private flying = false
  /** The ghosts the current centre has raised, and the node each one stands in for. */
  private ghosts: Ghost[] = []
  /** Where this centre's ghosts stand. Cut on the first pass of a visit, then only extended. */
  private doorways: Doorways | null = null

  constructor(
    container: HTMLElement,
    private readonly world: World,
  ) {
    this.cy = cytoscape({
      container,
      style: buildStyle(currentPalette()),
      // Native gestures: drag pans, wheel zooms to the cursor.
      userPanningEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      // Positions are frozen. A drag on a node pans instead of moving it.
      autoungrabify: true,
      autolock: true,
      minZoom: 0.14,
      maxZoom: 2.4,
      wheelSensitivity: 0.22,
      textureOnViewport: false,
      // Type is the mark, so a 1:1 canvas would read as soft on every HiDPI screen. Capped
      // at 2: past that the fill cost climbs and nothing about the names looks better.
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
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
   * centre in view: nothing does, and docs/decisions/0028-the-centre-is-named.md says why that
   * is allowed.
   */
  reach(): number {
    const box = this.cy.extent()
    return Math.min(box.w, box.h) / 2
  }

  /**
   * Take elements back off, for a write undone.
   *
   * The only subtraction on the map, and it has to undo whichever shape `add` chose. A
   * short edge is one element under the pair key; a long one is two stubs and two leads,
   * and removing a stub node takes its lead with it. Both are attempted, because which was
   * drawn depended on a distance that may since have changed.
   *
   * Ghosts come down first when a node they stand for is leaving. A ghost holds a reference
   * to a target, and one pointing at a node that no longer exists would survive every
   * later `clearGhosts` looking for a stub that is not there either.
   *
   * The test is against the slot plan rather than the ghosts standing, because the plan is the
   * wider of the two: a slot is held for a neighbour whose ghost is currently down. Rebuilding
   * it also lets the surviving slots take account of the ground the removal just freed.
   */
  drop(nodeIds: readonly string[], edges: readonly [string, string][]): void {
    const plan = this.doorways
    if (plan && nodeIds.some((id) => id === plan.centre || plan.at.has(id))) {
      this.clearGhosts()
    }

    this.cy.batch(() => {
      for (const [a, b] of edges) {
        const key = pairKey(a, b)
        const short = this.cy.$id(key)
        if (short.nonempty()) short.remove()
        for (const owner of [a, b]) {
          const stub = this.cy.$id(`s:${key}:${owner}`)
          if (stub.nonempty()) {
            stub.remove()
            // Counted once per long edge by `add`, so undone once per long edge here.
            if (owner === a) this.stubbed = Math.max(0, this.stubbed - 1)
          }
        }
      }
      // Cytoscape takes a node's own edges with it, so anything still attached goes now.
      for (const id of nodeIds) this.cy.$id(id).remove()
      // An accent pointing at a node that no longer exists would keep the HUD naming it
      // until the camera next moved. Cleared here; the caller re-picks.
      if (this.accentId && nodeIds.includes(this.accentId)) this.accentId = null

      // Whatever is left of each pair may have become incomplete again.
      for (const [a, b] of edges) {
        for (const id of [a, b]) {
          if (nodeIds.includes(id)) continue
          this.cy.$id(id).data("more", this.world.missing(id) > 0)
        }
      }
    })
  }

  /** Additive: existing elements are never touched. Removal is `drop`, and only for undo. */
  add(nodes: readonly WorldNode[], edges: readonly [string, string][]): void {
    const elements: ElementDefinition[] = []
    // An arrival is a node that turns up while its parent is already the centre. It has
    // to be born into the right tier: waiting for the next accent change would draw the
    // centre's own neighbour as a distant one, which is the bug this all began with.
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
      const key = pairKey(a, b)
      if (this.world.span(a, b) <= LONG_EDGE) {
        elements.push({ group: "edges", data: { id: key, source: a, target: b } })
        continue
      }
      // Too far to draw as a line without cutting across everything between. Each end
      // gets a stub pointing at the other, so the connection is visible as a direction
      // without the tangle.
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
        const stubId = `s:${key}:${owner}`
        elements.push({
          group: "nodes",
          data: { id: stubId, stub: true, tier: 2 },
          position: { x: sx, y: sy },
        })
        elements.push({
          group: "edges",
          data: { id: `e:${stubId}`, source: owner, target: stubId, stub: true },
        })
      }
      this.stubbed++
    }

    this.cy.batch(() => {
      this.cy.add(elements)
      // An arrival can complete a node that was previously incomplete.
      for (const [a, b] of edges) {
        for (const id of [a, b]) {
          this.cy.$id(id).data("more", this.world.missing(id) > 0)
        }
      }
      // Edges that arrive at the centre are the centre's edges, and read as such.
      if (accent) {
        this.cy.$id(accent).connectedEdges().data("accent", 1)
        // A node already seated when this reply landed was tiered for a neighbourhood it
        // was not yet known to be in — a sibling close enough to be backdrop is exactly
        // the node the centre turns out to be joined to. Only `setAccent` re-tiers, and
        // it will not fire until the accent moves, so the promotion has to happen here.
        // O(degree + backdrop), once per reply rather than per frame.
        this.setTiers(accent, true)
      }
    })
    // No ghost pass here, deliberately. A reply does leave arrivals off screen with nothing
    // standing in for them, but this is also reached from `trackAccent` for a late seating, so
    // raising elements here would put them on the frame budget of a pan. Ghosts stay on the
    // settle gate, and main.ts schedules one when a read lands.
  }

  /**
   * How far out the centre's own ring reaches, which is how far the backdrop extends.
   *
   * Measured from the neighbours joined by a drawn line, and so from the world rather than
   * from the screen. A radius that answered to the camera would dim a different set of nodes
   * at every zoom, which turns each settle into a restyle over everything near the centre —
   * and what the backdrop is asking is what this centre *crowds*, which is a fact about where
   * the seats are. A neighbour reached by two stubs is far enough that letting it set the
   * radius would dim half the map for one node.
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
   * Everything the centre crowds: close enough to be in the way, connected to something
   * else. A radius test rather than a corridor test — corridor membership shifts as the
   * accent drifts, and would strobe nodes in and out during a pan.
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
   * The neighbours a centre may raise a ghost for, in the order slots are handed out.
   *
   * Unlined first. A neighbour off screen whose edge is drawn still shows the reader which way
   * the connection goes; one drawn as two stubs shows almost nothing, so the ghost is worth
   * more there. `add` already decided which pairs got a line, and asking the map is what keeps
   * this from drifting from that decision.
   *
   * Then nearest first, so the ones most likely to be worth walking to are served first — and
   * the ones `Explorer` is already holding a reply for, so the door opens without a read. Degree
   * settles a tie, as it does for the ring's paint order, and ties are the common case because
   * a parent's neighbours are seated at one radius. Id settles the rest, so nothing depends on
   * which edge happened to be linked first.
   *
   * Every neighbour is offered, and the order is what matters rather than the length: `slotsFor`
   * walks this list giving a slot to each neighbour that needs one, so this decides who is
   * served when a neighbourhood asks for more than its rings have room for.
   *
   * Camera-independent, so two neighbours never swap places under a pan. Which of them is
   * eligible does change, and `slotsFor` says why that cannot disturb a doorway standing.
   */
  private ghostable(known: readonly string[], centre: string): string[] {
    const ranked = known.map((other) => ({
      id: other,
      unlined: this.cy.$id(pairKey(centre, other)).empty() ? 0 : 1,
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
   * How far a node's drawn box lies outside the viewport, in world units. Zero or less if any
   * part of it is on screen.
   *
   * The box and not the position, because a ring node draws as its name: a seat just past the
   * edge still has half its label readable, and a ghost raised for it would be the same name
   * twice — the thing this measurement exists to prevent, only narrower.
   *
   * The largest of the four axis gaps rather than the distance to a corner. Negative on all
   * four axes is what overlapping the viewport means, and where it is positive the value is
   * how far one axis has to travel to bring the node in, which is what the margin is about.
   */
  private outsideBy(id: string, view: BoundingBox12): number {
    const node = this.cy.$id(id)
    // Cytoscape gives an empty collection a box at the origin, which would read as on screen
    // whenever the origin is. A ghost is a door to a node, and there is no node here, so the
    // answer that raises nothing is the honest one.
    if (node.empty()) return -Infinity
    const box = node.boundingBox()
    return Math.max(view.x1 - box.x2, box.x1 - view.x2, view.y1 - box.y2, box.y1 - view.y2)
  }

  /**
   * Where each of a centre's ghosts stands. Cut once per visit, then only ever extended.
   *
   * The slots cannot simply be asked for again each pass. `seat` spreads what it is given
   * evenly, so the same neighbours in a different number come back on different bearings; and
   * a ghost holds no ground, so asking for one slot twice returns the same point twice and the
   * second ghost lands on the first. Either way a set that moved with the camera would walk
   * the standing ghosts around the ring, and nothing on this map moves except a ghost in
   * flight.
   *
   * Sized from the degree the store reports rather than from the neighbours drawn so far, so a
   * reply landing later finds a slot waiting instead of shifting what is already standing. A
   * write that links a neighbour beyond that size leaves it without one for the rest of the
   * visit: it keeps whatever line the map already drew for it.
   *
   * `reach` is read here and only here, on the pass that cuts the plan, for the same reason the
   * slots are: it decides how far out the outermost ring may sit, and a reach that followed the
   * zoom would move ghosts already standing. So a visit is measured once, at the zoom it began
   * at, and holds that until the centre changes.
   *
   * Cut here rather than in `setAccent`, because `trackAccent` moves the accent on every frame
   * of a pan and `seat` must not be on that budget.
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
      // Reserved for the widest name known now. Degree covers a neighbour arriving later, but
      // nothing can measure a name that has not arrived, so one longer than any of these
      // overhangs its slot — the same bet the pool size makes, one property along.
      plan = {
        centre,
        pool: this.world.slotsAround(centre, room, this.slotBox(known), reach),
        at: new Map(),
      }
      this.doorways = plan
    }

    // A slot is claimed only by a neighbour past the margin, which is to say one about to have a
    // doorway raised for it. Claiming for every neighbour up front spends the pool on names in
    // plain view: a hub has more neighbours than its rings have room for, and near is nearly the
    // same thing as on screen, so nothing is left by the time the far ones leave it.
    //
    // Camera-dependent, and safe because a claim is never taken back. The camera decides who
    // receives a *free* slot; it cannot move or revoke one already held, so a neighbour that
    // goes out of view and comes back finds its own waiting, and no doorway standing on screen
    // is disturbed by a pan. `ghostable` still orders the claimants among themselves.
    //
    // Guarded on a slot being left rather than on the neighbourhood having grown, since the
    // question now answers to the camera. Once the pool is spoken for there is nothing to do,
    // so the sort is paid for only while doorways are still to be given out.
    if (plan.at.size < plan.pool.length) {
      for (const target of this.ghostable(known, centre)) {
        if (plan.at.has(target) || (outside.get(target) ?? -Infinity) <= margin) continue
        // The lowest slot not yet handed out, because none is ever given back.
        const at = plan.pool[plan.at.size]
        if (at) plan.at.set(target, at)
      }
    }
    return plan.at
  }

  /**
   * The box one slot has to hold, sized for the widest name that could land in it.
   *
   * One box for the whole plan rather than one per neighbour, because any of them may take any
   * slot: the ranking decides who gets which, and it changes as replies land.
   *
   * Height comes from the type rather than from a measurement — a pill is one line, so its
   * height is the font size and the padding, the same arithmetic Cytoscape does.
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
   * Paint order among the ghosts standing, by degree — `setTiers`' rule for the ring, applied
   * to the doorways for the reason in `GHOST_Z`.
   *
   * Re-ranked whenever the set changes rather than fixed when a ghost goes up: the rank is a
   * position within the set, so one leaving changes it for the rest. Setting `lift` restyles
   * and does not reposition, so nothing moves.
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

  /** A long edge's stub at one end, with its lead. */
  private stubAt(owner: string, other: string) {
    const stub = `s:${pairKey(owner, other)}:${owner}`
    return this.cy.$id(stub).union(this.cy.$id(`e:${stub}`))
  }

  /**
   * Stand a ghost in the ring for every neighbour off screen, and take down every one whose
   * neighbour has come into view.
   *
   * Idempotent, and run on a settled camera rather than per frame: a ghost is an element, and
   * elements arriving and leaving during a fast pan would strobe.
   *
   * The two tests are deliberately not each other's negation. A ghost comes down the moment
   * any part of its target shows, and goes up only once the target is `GHOST_MARGIN` clear of
   * the edge. So one pass can never both drop and raise the same neighbour, and no name is
   * ever readable at its own seat and stood in for at the same time.
   *
   * Runs whether or not the centre is itself on screen. A pan carries the centre off the edge
   * and its doorways with it now that neither answers to the camera
   * (docs/decisions/0028-the-centre-is-named.md), and skipping the pass for a picture nobody
   * is looking at is the obvious saving — but a neighbour can come back into view while the
   * centre is still outside it, and the pass that did not run is the one that would have taken
   * that ghost down. Measuring regardless is what the invariant above costs.
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
    // Measured before the batch opens: a box sized from a label needs the style pass, and a
    // batch holds that back until the outermost one closes. Every neighbour rather than only
    // the ones already holding a slot, because `slotsFor` picks who to give a free slot to
    // from these.
    const outside = new Map<string, number>()
    for (const target of known) outside.set(target, this.outsideBy(target, view))
    // How far out a slot may sit: half the viewport's smaller span, which is the reach a ghost
    // has to be inside to be worth raising. `slotsFor` reads it only on the pass that cuts the
    // plan, and says why.
    const reach = Math.min(view.x2 - view.x1, view.y2 - view.y1) / 2
    const slots = this.slotsFor(centre, known, reach, outside, margin)

    const neighbours = new Set(known)
    const standing = new Set<string>()
    const down: Ghost[] = []
    for (const ghost of this.ghosts) {
      // A ghost whose target is no longer a neighbour goes too. Undoing a join leaves the edge
      // gone and both nodes in place, so nothing else would ever take it down.
      const gap = outside.get(ghost.target) ?? -Infinity
      if (neighbours.has(ghost.target) && gap > 0) standing.add(ghost.target)
      else down.push(ghost)
    }

    const up: Ghost[] = []
    const elements: ElementDefinition[] = []
    for (const [target, at] of slots) {
      // The plan keeps a slot for a neighbour that has since stopped being one, because it is
      // only ever added to. Without this test the pass above would take that ghost down and
      // this one would put it straight back, leaving it claiming an edge that is gone.
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
        data: { id: `e:${ghost}`, source: centre, target: ghost, ghost: true },
      })
    }

    // The settle fires on every camera stop, so a picture that has crossed no threshold must
    // cost the boxes above and nothing more: no batch, no style pass, no redraw.
    if (!down.length && !up.length) return

    const after = [...this.ghosts.filter((ghost) => standing.has(ghost.target)), ...up]
    this.cy.batch(() => {
      for (const ghost of down) this.lower(ghost)
      // A long edge's stub at this end was saying the same thing, less clearly. A short edge
      // has no stub and its line stays up, saying the one thing a ghost in the ring cannot:
      // where the neighbour actually is.
      for (const ghost of up) this.stubAt(centre, ghost.target).addClass("hidden")
      this.cy.add(elements)
      this.rankGhosts(after)
    })
    this.ghosts = after
  }

  /** One ghost down, and whatever it was standing in front of gets its meaning back. */
  private lower(ghost: Ghost): void {
    this.stubAt(ghost.centre, ghost.target).removeClass("hidden")
    this.cy.$id(ghost.ghost).remove()
  }

  /** Take every ghost down and forget where they stood. */
  private clearGhosts(): void {
    // Ahead of the early return, because a plan outlives its ghosts: a centre whose
    // neighbours are all on screen has its slots cut and none of them handed out, and a stale
    // plan surviving an accent change is the one way the slots can come out wrong.
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
      // Ranked into the `RING_Z` band rather than given consecutive values: a hub's ring
      // would otherwise run off the bottom of the band and stack arbitrarily again.
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
   * Promote a node to the accent, demoting the last one. Touches only the two
   * neighbourhoods involved, so this stays cheap while panning.
   */
  setAccent(id: string): boolean {
    if (id === this.accentId || this.cy.$id(id).empty()) return false
    const previous = this.accentId
    this.accentId = id

    this.cy.batch(() => {
      this.clearGhosts()
      // Clear the old before setting the new, so a node in both neighbourhoods ends up
      // promoted rather than demoted.
      if (previous) this.setTiers(previous, false)
      this.setTiers(id, true)
    })
    return true
  }

  /** True while a ghost is in the air. The accent must not move until it lands. */
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
   * How long to spend travelling somewhere, from how far it looks.
   *
   * A fixed duration cannot be right when the distances vary tenfold: it is a jump-cut
   * at one end and a drag at the other. Holding the speed roughly constant is what the
   * eye is actually judging, and the clamps stop both extremes.
   *
   * Nothing, when the OS has asked for reduced motion: the camera cuts to where it was
   * going and the ghost dissolves where it lands. The dissolve is left alone — a fade is
   * what a move is meant to be replaced with.
   */
  private flightTime(from: Point, to: Point): number {
    if (REDUCED_MOTION.matches) return 0
    const pixels = Math.hypot(to.x - from.x, to.y - from.y) * this.cy.zoom()
    return Math.min(FLIGHT_MAX, Math.max(FLIGHT_MIN, pixels / FLIGHT_SPEED))
  }

  /** Glide the camera so a node sits in the middle. */
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
   * Fly to the node a ghost stands in for, and dissolve the ghost into it on arrival.
   *
   * The ghost is not torn down when you click it — it *travels*. If it vanished the
   * moment its centre stopped being the centre, the thing under the cursor would be gone
   * by the second frame and the journey would have no subject. So the accent is pinned
   * for the duration and the ghost carries the eye, ending on the real node exactly as
   * the camera finishes centring it.
   *
   * This is the one place anything on the map moves. `autolock` normally makes every
   * position immutable, which is what keeps ADR 0003's frozen seating honest, so it comes
   * off for the flight and goes straight back on. `autoungrabify` is untouched throughout:
   * a drag still pans, and nothing the user does can move a node.
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

    // The ghosts staying behind belong to a centre that is being left behind.
    for (const other of this.ghosts) {
      if (other.ghost === ghost) continue
      this.cy.$id(other.ghost).animate({ style: { opacity: 0 } }, { duration: 260 })
    }

    this.cy.animate({ center: { eles: this.cy.$id(target) } }, { duration, easing: EASING })
    flier
      .animate({ position: { x: node.x, y: node.y } }, { duration, easing: EASING })
      .animate({ style: { opacity: 0 } }, { duration: DISSOLVE_MS })

    // Two moments, not one. The destination takes over as the camera lands; the ghost
    // spends the next breath dissolving into it. Promoting only once the dissolve had
    // finished would leave the map insisting you were still where you set off from.
    setTimeout(() => {
      this.cy.autolock(true)
      this.flying = false
      // The flier is handed over to the flight: `setAccent` clears the others, but this
      // one is mid-dissolve and outlives them by exactly that long. Its removal is booked
      // before anything that could throw, so a ghost cannot be stranded on the map.
      this.ghosts = this.ghosts.filter((g) => g.ghost !== ghost)
      // The element, not its id. Ghosts are raised and lowered as the camera moves, so
      // walking straight back the way you came can put a *new* ghost under this same id
      // before the dissolve is out, and a removal by id would delete that one instead.
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
