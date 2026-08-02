/**
 * Wiring: seed the world, let the camera roam, keep the HUD honest.
 *
 *   drag            pan the map
 *   wheel           zoom toward the cursor
 *   click a node    glide it to the middle, drawing its ring on the click
 *   arrows          nudge the camera
 *
 * The accent is whatever node is nearest the middle of the screen, recomputed at most
 * once per frame. It uses hysteresis — a rival has to be clearly closer before it takes
 * over — because a bare nearest-wins test flickers between two nodes when the midpoint
 * passes between them.
 *
 * Whichever node holds the accent once the camera stops is the only one drawn from, and
 * every node arrives because somebody walked to its neighbour. The reading runs a hop
 * further than that: the ring around the accent is read on arrival and held undrawn, so
 * the next step is already paid for — see docs/decisions/0006-only-the-centre-reads.md.
 *
 * How long "stopped" takes depends on what moved the camera. Naming a node — a click, a
 * ghost — skips the wait entirely, because the destination is not in doubt. Drift waits,
 * and waits longest for the inputs that carry inertia.
 *
 * See docs/decisions/0003-graph-exploration-demo-stack.md.
 */
import { Cancelled, fetchIndex, fetchNeighbourhood, searchLabels } from "./api.js"
import type { NodeMeta } from "./api.js"
import { Explorer, debounce, perFrame } from "./explore.js"
import { MapView, ghostTarget } from "./map-view.js"
import { currentPalette, onThemeChange } from "./palette.js"
import { distance } from "./placement.js"
import { World } from "./world.js"

/**
 * Camera stillness before the centre is drawn from.
 *
 * The wait is not about the read — that is usually already held — but about *drift*. A
 * drag or a wheel sweeps the middle of the screen across whatever lies between here and
 * there, and a ring drawn for each would seat those nodes permanently: `World` never
 * reassigns a position, so a place panned past is a place that stays on the map. The
 * settle is what keeps the picture to the route.
 */
const SETTLE_MS = 190

/**
 * The same wait, for an input that stops dead.
 *
 * Most of the 190 is inertia — a drag's fling, a wheel's momentum. An arrow has none: the
 * camera moves its 120px and is still. What is left to wait for is only whether another
 * key is coming, and a held arrow repeats faster than this on a stock keyboard, so a run
 * across six nodes still coalesces into the one draw at the end of it.
 */
const NUDGE_SETTLE_MS = 110

/** A rival must be this much closer to the middle before it takes the accent. */
const ACCENT_HYSTERESIS = 0.78

/** Keyboard pan step, in screen pixels. */
const NUDGE = 120

/**
 * How long the search box waits before asking.
 *
 * Shorter than either settle: nothing is being drawn and no seat is at stake, so the only
 * cost of being early is a request, and the only cost of being late is a box that feels
 * slow. Roughly the gap between keystrokes at a normal typing speed.
 */
const SEARCH_DEBOUNCE_MS = 140

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element: #${id}`)
  return found as T
}

const stage = el<HTMLDivElement>("stage")
const searchInput = el<HTMLInputElement>("search-input")
const results = el<HTMLUListElement>("results")
const statCentre = el<HTMLSpanElement>("stat-centre")
const statDegree = el<HTMLSpanElement>("stat-degree")
const statNodes = el<HTMLSpanElement>("stat-nodes")
const statEdges = el<HTMLSpanElement>("stat-edges")
const statPending = el<HTMLSpanElement>("stat-pending")
const statReady = el<HTMLSpanElement>("stat-ready")
const statTotal = el<HTMLSpanElement>("stat-total")
const status = el<HTMLParagraphElement>("status")

const world = new World()
const view = new MapView(stage, world)

function setStatus(text: string, tone: "idle" | "busy" | "error"): void {
  status.textContent = text
  status.dataset["tone"] = tone
}

const explorer = new Explorer(world, view, {
  onChange: () => render(),
  onError: (message) => setStatus(`⚠ ${message}`, "error"),
})

function render(): void {
  const accent = view.accent ? world.get(view.accent) : null
  statCentre.textContent = accent?.label ?? "—"
  statDegree.textContent = accent ? String(accent.degree) : "0"
  statNodes.textContent = String(world.size)
  statEdges.textContent = String(world.edgeCount)
  statPending.textContent = String(explorer.pending)
  // Reported apart from `loading`: nothing on screen is waiting on these, and rolling them
  // into the same count would make an idle map look busy for reads nobody asked for.
  statReady.textContent = String(explorer.ready)

  if (status.dataset["tone"] === "error") return
  if (explorer.pending > 0) setStatus(`loading ${explorer.pending}…`, "busy")
  else setStatus("drag to pan · wheel to zoom · click to centre", "idle")
}

/** Whatever is nearest the middle becomes the accent, with a bias toward the incumbent. */
const trackAccent = perFrame(() => {
  // A flight pans the camera across everything between here and there. Letting the
  // accent follow would hand it to each node in turn and tear down the ghost being
  // flown, which is the one thing the journey is about.
  if (view.inFlight) return

  const centre = view.centre()
  const candidate = world.nearestTo(centre, view.reach())
  if (!candidate) return

  const current = view.accent ? world.get(view.accent) : null
  if (current && current.id !== candidate.id) {
    const rival = distance(candidate, centre)
    const incumbent = distance(current, centre)
    if (rival > incumbent * ACCENT_HYSTERESIS) return
  }
  // Only touch the DOM when the accent actually moved: this runs every frame of a pan.
  if (view.setAccent(candidate.id)) {
    // Room is a property of the map at one moment. Arriving is the moment to ask again
    // whether the neighbours this node never had space for can be fitted now.
    const late = world.seatPending(candidate.id)
    if (late.nodes.length || late.edges.length) view.add(late.nodes, late.edges)
    render()
  }
})

/**
 * Everything that waits for the camera to stop.
 *
 * Cytoscape emits `viewport` on every frame of an animated pan, and it emits it whether or
 * not the pan moved — so a Recentre with the centre already centred still arrives here.
 * That is harmless precisely because the only read this schedules is the centre's, and the
 * centre asks once: a second settle over the same node finds it already claimed.
 */
const settle = debounce(() => {
  explorer.loadCentre()
  // Ghosts wait for a settled camera. Tiers are data writes and cheap to redo mid-pan;
  // elements arriving and leaving on every accent change would strobe.
  view.showGhosts()
  render()
}, SETTLE_MS)

/** Set by an input that stops dead, and read by the one `viewport` it provokes. */
let nudged = false

view.cy.on("viewport", () => {
  trackAccent()
  settle(nudged ? NUDGE_SETTLE_MS : SETTLE_MS)
  nudged = false
})

view.cy.on("tap", "node", (event) => {
  const id = String(event.target.id())

  // A ghost is a doorway. Clicking one flies to the node it stands in for — and the
  // fetch goes out now rather than on the settle at the far end, because the
  // destination is already known and the journey is otherwise idle.
  const target = ghostTarget(id)
  if (target) {
    explorer.prefetch(target)
    if (view.flyTo(id, () => render())) render()
    return
  }

  if (!world.has(id)) return

  // Naming a node is not drifting past it. There is no ambiguity left about where this
  // is going, so its ring is drawn on the click rather than on the settle at the far end
  // of the flight — the same bargain the ghost above makes, and for the same reason. With
  // the reply usually already held it costs nothing, and the camera lands on a finished
  // picture instead of completing one a beat after it stops.
  explorer.prefetch(id)
  view.focus(id)
})

/**
 * Arriving somewhere by name.
 *
 * Every other node on the map got here because somebody walked to its neighbour, and its
 * seat came from the node it neighbours. A searched node has neither: it is joined to
 * nothing on screen, and the only thing its position can answer to is where the camera
 * happens to be. That is the cost of the box, and it is paid once — from the moment it
 * lands it is an ordinary node, and what draws around it is its own neighbourhood, read on
 * the settle at the end of the flight like anywhere else. The centre still draws; this only
 * changes how a node becomes the centre.
 */
function goTo(node: NodeMeta): void {
  results.replaceChildren()
  searchInput.value = ""
  searchInput.blur()

  if (!world.has(node.id)) {
    view.add([world.place(node, world.landing(view.centre(), node.id))], [])
    view.setAccent(node.id)
  }
  // From here on this is the click path: name a destination, read it now rather than on
  // the settle at the far end, and glide.
  explorer.prefetch(node.id)
  view.focus(node.id)
  render()
}

function showResults(nodes: NodeMeta[], query: string): void {
  results.replaceChildren()
  if (!query) return

  if (!nodes.length) {
    const empty = document.createElement("li")
    empty.className = "empty"
    empty.textContent = `nothing starts with “${query}”`
    results.append(empty)
    return
  }

  for (const node of nodes) {
    const name = document.createElement("span")
    name.textContent = node.label
    const degree = document.createElement("span")
    degree.className = "degree"
    degree.textContent = String(node.degree)
    // Says which of these is already on the map, so picking one is a known quantity.
    degree.title = world.has(node.id) ? "already placed" : `${String(node.degree)} edges`

    const button = document.createElement("button")
    button.type = "button"
    button.append(name, degree)
    button.addEventListener("click", () => goTo(node))

    const row = document.createElement("li")
    row.append(button)
    results.append(row)
  }
}

/** The query in the air, so a slower earlier reply cannot overwrite a later one. */
let searching: AbortController | null = null

const runSearch = debounce(() => {
  const query = searchInput.value.trim()
  searching?.abort()
  if (!query) {
    showResults([], "")
    return
  }

  const control = new AbortController()
  searching = control
  searchLabels(query, control.signal)
    .then((found) => {
      if (!control.signal.aborted) showResults(found, query)
    })
    .catch((err: unknown) => {
      if (err instanceof Cancelled) return
      setStatus(`⚠ ${err instanceof Error ? err.message : String(err)}`, "error")
    })
}, SEARCH_DEBOUNCE_MS)

searchInput.addEventListener("input", () => runSearch())
searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return
  searchInput.value = ""
  results.replaceChildren()
  searchInput.blur()
})

window.addEventListener("keydown", (event) => {
  // The arrows below pan the camera. Inside the search box they belong to the text.
  if (event.target instanceof HTMLInputElement) return

  const pan: Record<string, [number, number]> = {
    ArrowLeft: [NUDGE, 0],
    ArrowRight: [-NUDGE, 0],
    ArrowUp: [0, NUDGE],
    ArrowDown: [0, -NUDGE],
  }
  const step = pan[event.key]
  if (!step) return
  event.preventDefault()
  nudged = true
  view.cy.panBy({ x: step[0], y: step[1] })
})

el<HTMLButtonElement>("zoom-in").addEventListener("click", () =>
  view.cy.zoom({ level: view.cy.zoom() * 1.35, renderedPosition: renderedCentre() }),
)
el<HTMLButtonElement>("zoom-out").addEventListener("click", () =>
  view.cy.zoom({ level: view.cy.zoom() / 1.35, renderedPosition: renderedCentre() }),
)
el<HTMLButtonElement>("home").addEventListener("click", () => {
  if (view.accent) view.focus(view.accent)
})

function renderedCentre(): { x: number; y: number } {
  return { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }
}

onThemeChange((palette) => view.restyle(palette))

window.addEventListener("resize", () => {
  view.resize()
  trackAccent()
  settle()
})

// The legend's swatches are built from the same tokens the map draws with.
;(() => {
  const ramp = el<HTMLDivElement>("ramp")
  const paint = (palette = currentPalette()): void => {
    ramp.replaceChildren()
    ;[
      [palette.hop[0]!, 13, "neighbour of the centre"],
      [palette.hop[2]!, 9, "further away"],
    ].forEach(([colour, size, title]) => {
      const dot = document.createElement("span")
      dot.className = "dot"
      dot.style.background = String(colour)
      dot.style.width = `${String(size)}px`
      dot.style.height = dot.style.width
      dot.title = String(title)
      ramp.append(dot)
    })
  }
  paint()
  onThemeChange(paint)
})()

async function boot(): Promise<void> {
  setStatus("loading graph…", "busy")
  const index = await fetchIndex()
  statTotal.textContent = `${index.nodeCount} nodes · ${index.edgeCount} edges`

  const root = await fetchNeighbourhood(index.rootId)
  world.place(root.node, { x: 0, y: 0 })
  const absorbed = world.absorb(root.node.id, root.neighbours)

  view.add([world.get(root.node.id)!], [])
  view.add(absorbed.nodes, absorbed.edges)
  view.focus(root.node.id, false)
  view.setAccent(root.node.id)

  // The root and its ring, and that is the whole first frame. Nothing beyond it is drawn
  // until somebody walks there; the first settle reads the ring without drawing any of
  // what comes back. Ghosts are raised here rather than left to that settle, because a
  // neighbour seated too far to draw is still one of these neighbours, and the first
  // frame is the one place with nothing else on screen to stand in for it.
  view.showGhosts()
  render()
}

boot().catch((err: unknown) => {
  setStatus(`⚠ ${err instanceof Error ? err.message : String(err)}`, "error")
})
