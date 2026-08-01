/**
 * Wiring: fetch a neighbourhood, draw it, and hop when a neighbour is clicked.
 *
 * A hop starts the animation and the fetch in the same tick. The API holds a deliberate
 * floor on latency, and waiting for the response before moving anything would spend all
 * of it on a still screen. So the clicked node sets off for the middle immediately, the
 * stale ring dims, and the new ring resolves whenever the answer lands.
 *
 * There is no history and no store: the page holds one neighbourhood at a time and
 * forgets the last one. See docs/decisions/0005-a-second-view-that-keeps-no-world.md.
 */
import { Cancelled, fetchIndex, fetchNeighbourhood, type Neighbourhood } from "../api.js"
import { OrbitView } from "./orbit-view.js"

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element: #${id}`)
  return found as T
}

const stage = el<HTMLDivElement>("stage")
const statCentre = el<HTMLElement>("stat-centre")
const statRing = el<HTMLElement>("stat-ring")
const statHops = el<HTMLElement>("stat-hops")
const statTotal = el<HTMLElement>("stat-total")
const status = el<HTMLParagraphElement>("status")

const view = new OrbitView(stage)

let inFlight: AbortController | null = null
let hops = 0

function setStatus(text: string, tone: "idle" | "busy" | "error"): void {
  status.textContent = text
  status.dataset["tone"] = tone
}

function draw(place: Neighbourhood): void {
  view.show(place.node, place.neighbours)

  statCentre.textContent = place.node.label
  statCentre.title = place.node.id
  statRing.textContent = place.truncated
    ? `${String(place.neighbours.length)} of ${String(place.node.degree)}`
    : String(place.neighbours.length)
  statHops.textContent = String(hops)

  if (place.truncated) {
    setStatus(`showing the first ${String(place.neighbours.length)} of its edges`, "idle")
  } else if (place.neighbours.length === 0) {
    setStatus("nothing connects here", "idle")
  } else {
    setStatus("click a neighbour to travel there", "idle")
  }
}

async function go(id: string, hopping: boolean): Promise<void> {
  // A second click while the first is still loading wins. The view is mid-transition
  // rather than in a clean state, but every spoke is keyed by node id, so the diff lands
  // on whatever is currently on screen and no reset is needed.
  inFlight?.abort()
  const request = new AbortController()
  inFlight = request

  if (hopping) {
    hops++
    view.beginHop(id)
  }
  setStatus("loading…", "busy")

  try {
    const place = await fetchNeighbourhood(id, request.signal)
    if (request.signal.aborted) return
    draw(place)
  } catch (error) {
    if (error instanceof Cancelled) return
    setStatus(`⚠ ${error instanceof Error ? error.message : String(error)}`, "error")
  } finally {
    if (inFlight === request) inFlight = null
  }
}

view.onPick((id) => {
  void go(id, true)
})

window.addEventListener("resize", () => {
  view.resize()
})

async function boot(): Promise<void> {
  setStatus("loading graph…", "busy")
  const index = await fetchIndex()
  statTotal.textContent = `${String(index.nodeCount)} nodes · ${String(index.edgeCount)} edges`
  await go(index.rootId, false)
}

boot().catch((error: unknown) => {
  setStatus(`⚠ ${error instanceof Error ? error.message : String(error)}`, "error")
})
