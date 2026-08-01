/**
 * Wiring: seed the world, let the camera roam, keep the HUD honest.
 *
 *   drag            pan the map
 *   wheel           zoom toward the cursor
 *   click a node    glide it to the middle, which makes it the accent
 *   arrows          nudge the camera
 *
 * The accent is whatever node is nearest the middle of the screen, recomputed at most
 * once per frame. It uses hysteresis — a rival has to be clearly closer before it takes
 * over — because a bare nearest-wins test flickers between two nodes when the midpoint
 * passes between them.
 *
 * See docs/decisions/0003-graph-exploration-demo-stack.md.
 */
import { fetchIndex, fetchNeighbourhood } from "./api.js"
import { Explorer, debounce, perFrame } from "./explore.js"
import { MapView, ghostTarget } from "./map-view.js"
import { currentPalette, onThemeChange } from "./palette.js"
import { distance } from "./placement.js"
import { World } from "./world.js"

/** Camera stillness before a fetch sweep. */
const SETTLE_MS = 190

/** A rival must be this much closer to the middle before it takes the accent. */
const ACCENT_HYSTERESIS = 0.78

/** Keyboard pan step, in screen pixels. */
const NUDGE = 120

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element: #${id}`)
  return found as T
}

const stage = el<HTMLDivElement>("stage")
const statCentre = el<HTMLSpanElement>("stat-centre")
const statDegree = el<HTMLSpanElement>("stat-degree")
const statNodes = el<HTMLSpanElement>("stat-nodes")
const statEdges = el<HTMLSpanElement>("stat-edges")
const statPending = el<HTMLSpanElement>("stat-pending")
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

  if (status.dataset["tone"] === "error") return
  const gate = explorer.gate()
  if (explorer.pending > 0) setStatus(`loading ${explorer.pending}…`, "busy")
  else setStatus(gate || "drag to pan · wheel to zoom · click to centre", "idle")
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

const sweep = debounce(() => {
  explorer.sweep()
  // Ghosts wait for a settled camera. Tiers are data writes and cheap to redo mid-pan;
  // elements arriving and leaving on every accent change would strobe.
  view.showGhosts()
  render()
}, SETTLE_MS)

view.cy.on("viewport", () => {
  trackAccent()
  sweep()
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

  if (world.has(id)) view.focus(id)
})

window.addEventListener("keydown", (event) => {
  const pan: Record<string, [number, number]> = {
    ArrowLeft: [NUDGE, 0],
    ArrowRight: [-NUDGE, 0],
    ArrowUp: [0, NUDGE],
    ArrowDown: [0, -NUDGE],
  }
  const step = pan[event.key]
  if (!step) return
  event.preventDefault()
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
  sweep()
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

  // One extra ring so the first frame has somewhere to go. After this the camera drives.
  await Promise.all(absorbed.nodes.slice(0, 4).map((node) => explorer.expand(node.id)))
  render()
}

boot().catch((err: unknown) => {
  setStatus(`⚠ ${err instanceof Error ? err.message : String(err)}`, "error")
})
