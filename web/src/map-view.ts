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
 * the backdrop it crowds — recomputed only when the accent changes, which is O(degree)
 * rather than per frame. A continuous falloff would mean restyling every node per frame.
 *
 * Ghosts are the one exception to all of the above, and the exception is deliberate. See
 * docs/decisions/0004-the-centre-and-its-neighbourhood.md, and
 * docs/decisions/0003-graph-exploration-demo-stack.md for the world model underneath.
 */
import cytoscape, {
  type Core,
  type Css,
  type ElementDefinition,
  type NodeSingular,
  type StylesheetJson,
} from "cytoscape"
import { LONG_EDGE, NODE_SIZE, seat, type Point } from "./placement.js"
import { currentPalette, type Palette } from "./palette.js"
import type { World, WorldNode } from "./world.js"

/** How far a stub reaches from its node, toward the far end of a hidden long edge. */
const STUB_REACH = 44

/**
 * Most ghosts a centre will show. Past this the ring stops being readable, and the
 * remainder keep the stub they would have had. At mean degree 6 this should never fire;
 * it is here so a hub cannot produce a wheel of hollow circles.
 */
const MAX_GHOSTS = 8

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
 * The same curve the timing was judged against in the figure.
 *
 * Cytoscape parses a parameterised `cubic-bezier(...)` at runtime — see its
 * `core/animation/step.mjs`, which hands the string to the style parser — but its
 * typings only model the bare keyword. The cast describes the library, rather than
 * working around it.
 */
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)" as Css.TransitionTimingFunction

const pairKey = (a: string, b: string): string => (a < b ? `${a} ${b}` : `${b} ${a}`)

/** A ghost belongs to the centre that raised it, and names the node it stands in for. */
const ghostId = (centre: string, target: string): string => `g:${centre}:${target}`

/** The node a ghost stands in for, or null if this is not a ghost. */
export function ghostTarget(id: string): string | null {
  if (!id.startsWith("g:")) return null
  const cut = id.indexOf(":", 2)
  return cut < 0 ? null : id.slice(cut + 1)
}

function buildStyle(p: Palette): StylesheetJson {
  const font = 'system-ui, -apple-system, "Segoe UI", sans-serif'
  return [
    {
      selector: "node",
      style: {
        "background-color": p.hop[2]!,
        width: NODE_SIZE.resting,
        height: NODE_SIZE.resting,
        label: "",
        "font-family": font,
        "font-size": 11,
        // Ink tokens, never the node's own colour.
        color: p.textSecondary,
        "text-valign": "center",
        "text-halign": "right",
        "text-margin-x": 5,
        "text-background-color": p.surface,
        "text-background-opacity": 0.72,
        "text-background-padding": "2px",
        "border-width": 0,
        "transition-property": "background-color, width, height",
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
    {
      selector: "node[tier = 1]",
      style: {
        "background-color": p.hop[0]!,
        width: NODE_SIZE.neighbour,
        height: NODE_SIZE.neighbour,
        label: "data(label)",
        "font-size": 12,
        "font-weight": 500,
        // A halo in the surface colour, so a ring node reads as being *over* the
        // backdrop rather than colliding with it. It is an outline rather than a
        // border because the border is already spoken for: a ring node that is also
        // a frontier has to keep its dashed edge.
        "outline-width": 3,
        "outline-color": p.surface,
        "z-index": 20,
      },
    },
    // The backdrop: close to the centre, but connected to something else. It gives up
    // its label and most of its contrast so the ring can be read across it.
    {
      selector: "node[tier = 3]",
      style: { opacity: 0.22, label: "", "z-index": 0 },
    },
    { selector: "edge[dim = 1]", style: { opacity: 0.12 } },
    {
      selector: "node[tier = 0]",
      style: {
        "background-color": p.accent,
        width: NODE_SIZE.accent,
        height: NODE_SIZE.accent,
        label: "data(label)",
        "text-halign": "center",
        "text-valign": "bottom",
        "text-margin-x": 0,
        "text-margin-y": 6,
        "font-size": 14,
        "font-weight": 600,
        color: p.textPrimary,
        "border-width": 3,
        "border-color": p.accentRing,
        "z-index": 30,
      },
    },
    { selector: "edge[accent = 1]", style: { "line-color": p.edgeActive, opacity: 0.9, width: 2 } },
    // "More this way" is a border style, not a hue — it still reads for someone who
    // cannot separate the two ramp steps.
    {
      selector: "node[?more]",
      style: {
        "border-width": 2,
        "border-color": p.frontierRing,
        "border-style": "dashed",
        "border-opacity": 0.8,
      },
    },
    // A ghost: a neighbour of the centre whose real seat is too far away to draw. Hollow
    // and dashed, because it must never be mistaken for the node itself — there is only
    // ever one of those, somewhere else on the map.
    {
      selector: "node[?ghost]",
      style: {
        "background-opacity": 0,
        width: NODE_SIZE.neighbour,
        height: NODE_SIZE.neighbour,
        "border-width": 2,
        "border-color": p.hop[0]!,
        "border-style": "dashed",
        "border-opacity": 1,
        "outline-width": 3,
        "outline-color": p.surface,
        label: "data(label)",
        color: p.textSecondary,
        "font-size": 12,
        "font-weight": 500,
        "z-index": 25,
      },
    },
    { selector: "edge[?ghost]", style: { "line-color": p.edgeActive, opacity: 0.9, width: 2 } },
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
  /** The ghosts the current centre has raised, and the stubs each one stands in for. */
  private ghosts: { ghost: string; centre: string; target: string }[] = []

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
      pixelRatio: 1,
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

  /** Half the viewport's smaller span, in world units — the search reach for the accent. */
  reach(): number {
    const box = this.cy.extent()
    return Math.max(box.w, box.h)
  }

  /** Nodes whose position falls inside the viewport, grown by a margin. */
  visible(margin: number): WorldNode[] {
    const box = this.cy.extent()
    return this.world.incompleteNodes().filter(
      (node) =>
        node.x >= box.x1 - margin &&
        node.x <= box.x2 + margin &&
        node.y >= box.y1 - margin &&
        node.y <= box.y2 + margin,
    )
  }

  zoom(): number {
    return this.cy.zoom()
  }

  /** Only ever additive: existing elements are never touched. */
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
      if (accent) this.cy.$id(accent).connectedEdges().data("accent", 1)
    })
  }

  /**
   * How far out the centre's own ring reaches, which is how far the backdrop extends.
   *
   * Measured from the neighbours that are actually drawn as a ring: a neighbour seated
   * half a screen away is represented by a ghost, not by a node out there, so letting it
   * set the radius would dim half the map to make room for something already in the ring.
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

  /** Neighbours seated too far away to draw a line to. Nearest first, so a cap keeps
   *  the ones most likely to be worth walking to. */
  private farNeighbours(id: string): string[] {
    return this.world
      .neighbours(id)
      .filter((other) => this.world.span(id, other) > LONG_EDGE)
      .sort((a, b) => this.world.span(id, a) - this.world.span(id, b))
      .slice(0, MAX_GHOSTS)
  }

  /** A long edge's stub at one end, with its lead. */
  private stubAt(owner: string, other: string) {
    const stub = `s:${pairKey(owner, other)}:${owner}`
    return this.cy.$id(stub).union(this.cy.$id(`e:${stub}`))
  }

  /**
   * Stand a ghost in the ring for every neighbour too far away to draw.
   *
   * Slots come from `World.slotsAround`, which dodges every placed node and is seeded so
   * that a node raises its ghosts in the same places on every visit. Nothing is written
   * to the occupancy grid — a ghost holds no ground, which is also what stops
   * `nearestTo` ever returning one and making a ghost the centre.
   *
   * Raised on a settled camera rather than on every accent change: tiers are data writes
   * and cheap, but elements coming and going during a fast pan would strobe.
   */
  showGhosts(): void {
    const id = this.accentId
    if (!id || this.flying || this.ghosts.length) return
    const targets = this.farNeighbours(id)
    if (!targets.length) return

    const slots = this.world.slotsAround(id, targets.length)
    const elements: ElementDefinition[] = []
    targets.forEach((target, i) => {
      const at = slots[i]
      const node = this.world.get(target)
      if (!at || !node) return
      const ghost = ghostId(id, target)
      this.ghosts.push({ ghost, centre: id, target })
      elements.push({
        group: "nodes",
        data: { id: ghost, label: node.label, ghost: true },
        position: { x: at.x, y: at.y },
      })
      elements.push({
        group: "edges",
        data: { id: `e:${ghost}`, source: id, target: ghost, ghost: true },
      })
      // The stub at this end was saying the same thing, less clearly.
      this.stubAt(id, target).addClass("hidden")
    })
    this.cy.add(elements)
  }

  /** Take the ghosts down and give each replaced stub its meaning back. */
  private clearGhosts(): void {
    if (!this.ghosts.length) return
    for (const { ghost, centre, target } of this.ghosts) {
      this.stubAt(centre, target).removeClass("hidden")
      this.cy.$id(ghost).remove()
    }
    this.ghosts = []
  }

  private setTiers(id: string, active: boolean): void {
    const node = this.cy.$id(id)
    node.data("tier", active ? 0 : 2)
    for (const other of this.world.neighbours(id)) {
      this.cy.$id(other).data("tier", active ? 1 : 2)
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
   */
  private flightTime(from: Point, to: Point): number {
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
      setTimeout(() => this.cy.$id(ghost).remove(), DISSOLVE_MS)
      if (from) this.stubAt(from, target).removeClass("hidden")
      this.setAccent(target)
      this.showGhosts()
      onArrive(target)
    }, duration)
    return true
  }

  resize(): void {
    this.cy.resize()
  }
}
