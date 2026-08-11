/**
 * Wiring: seed the world, let the camera roam, keep the HUD honest.
 *
 *   drag            pan the map
 *   wheel           zoom toward the cursor
 *   click a node    glide it to the middle, drawing its ring on the click
 *   right-click     take the middle off the map, edges and all
 *   arrows          nudge the camera
 *   click an island cross to it, or go back to one already crossed to
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
import { Missing, deleteNodeWithEdges, fetchIndex, fetchNeighbourhood } from "./api.js"
import type { GraphIndex, Neighbourhood, NodeMeta } from "./api.js"
import { Explorer, debounce, perFrame } from "./explore.js"
import { IslandsPanel } from "./islands.js"
import { JoinPanel } from "./join.js"
import { MapView, ghostTarget } from "./map-view.js"
import { currentPalette, onThemeChange } from "./palette.js"
import { distance, type Point } from "./placement.js"
import { World } from "./world.js"
import { Writes } from "./writes.js"

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
const statReady = el<HTMLSpanElement>("stat-ready")
const statTotal = el<HTMLSpanElement>("stat-total")
const status = el<HTMLParagraphElement>("status")
const hudToggle = el<HTMLButtonElement>("hud-toggle")

const world = new World()
const view = new MapView(stage, world)

/**
 * The one line every write to the graph stands in.
 *
 * Built here because two things write now — the panel below, and the map itself. Either one
 * holding the queue would be the one the other could not reach.
 */
const writes = new Writes(el<HTMLDivElement>("receipts"), setStatus)

/**
 * Every island in the graph, as an index of places.
 *
 * Built here rather than in `boot` because a table with no root at all still has islands in
 * it, and the list is the only way into any of them — see the `rootId` branch below.
 */
const islands = new IslandsPanel(
  el<HTMLElement>("islands"),
  el<HTMLUListElement>("islands-list"),
  el<HTMLSpanElement>("islands-count"),
  {
    onCross: (island, seated) => {
      // Somewhere already on the map: go to the node that is on it, never the island's own
      // name. They are usually not the same node, and berthing one already drawn would set a
      // second copy of it down in open water.
      const known = seated === null ? null : world.get(seated)
      if (known) {
        goTo(known)
        return
      }
      // Water, not the nearest gap. An island grows as it is walked, and seating its first
      // node beside the camera would grow it through whatever is already there.
      goTo(island, world.berth(island.id))
    },
    placed: (id) => world.has(id),
  },
)

function setStatus(text: string, tone: "idle" | "busy" | "error"): void {
  status.textContent = text
  status.dataset["tone"] = tone
  // The HUD folds away to a chevron, and the status line folds away with it. The tone rides
  // on the chevron so a failed read is still *something* on screen — a colour is not the
  // message, but it is the difference between quiet and silent.
  hudToggle.dataset["tone"] = tone
}

const explorer = new Explorer(world, view, {
  onChange: () => {
    render()
    // A reply draws neighbours the settle that asked for it could not have seen: the read is
    // not awaited there, so the ghost pass ran before any of this arrived. Scheduling another
    // settle is what covers them, and it keeps ghosts on the settled camera rather than
    // raising elements from inside `add`, which a pan also reaches.
    settle()
  },
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
  // Which islands are on the map changes without the store changing at all — walking across
  // a bridge seats one — so the dim is repainted here rather than only after a write.
  islands.paint()

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
  // Ghosts wait for a settled camera, going up and coming down. Tiers are data writes and
  // cheap to redo mid-pan; elements arriving and leaving on every frame of one would strobe.
  view.reviseGhosts()
  render()
}, SETTLE_MS)

/** Set by an input that stops dead, and read by the one `viewport` it provokes. */
let nudged = false

view.cy.on("viewport", () => {
  // The menu was raised over a node at a point on the screen. Move the map underneath it and
  // it is pointing at whatever has drifted under the pointer instead.
  closeMenu()
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
 * Taking the centre off the map, edges and all.
 *
 * Right-click, and only on the node the map is already holding. That one is the centre for a
 * reason — it is what the reader walked to, and it is the only node whose degree is on the
 * page — so it is the only one the row can honestly price. A ghost is never it.
 *
 * The count is in the row because this is the one write nothing can take back
 * (docs/decisions/0024-taking-a-node-out-with-its-edges.md). Everywhere else the panel lets
 * `↵` write and offers the way back afterwards; here there is no way back, so the asking
 * happens first and says how much graph is going.
 */
const menu = el<HTMLDivElement>("node-menu")
const menuDelete = el<HTMLButtonElement>("node-delete")

/** What the row would remove, and null whenever the menu is down. */
let doomed: string | null = null

function closeMenu(): void {
  // Cheap when there is nothing to shut, because a pan calls this on every frame of itself.
  if (menu.hidden) return
  doomed = null
  menu.hidden = true
}

/** "and its 3 edges", or nothing at all for a node standing on its own. */
function priced(node: NodeMeta): string {
  if (!node.degree) return `delete ${node.label}`
  const edges = node.degree === 1 ? "1 edge" : `${String(node.degree)} edges`
  return `delete ${node.label} and its ${edges}`
}

// The browser's own menu would open on top of this one.
stage.addEventListener("contextmenu", (event) => event.preventDefault())

// Anywhere but the menu itself. The row is inside it, so this never eats its own click.
window.addEventListener("pointerdown", (event) => {
  if (!menu.hidden && !menu.contains(event.target as Node)) closeMenu()
})

view.cy.on("cxttap", "node", (event) => {
  const id = String(event.target.id())
  if (id !== view.accent) return
  const node = world.get(id)
  if (!node) return

  doomed = id
  menuDelete.textContent = priced(node)
  const at = event.originalEvent as MouseEvent | undefined
  menu.style.left = `${String(at?.clientX ?? 0)}px`
  menu.style.top = `${String(at?.clientY ?? 0)}px`
  menu.hidden = false
})

menuDelete.addEventListener("click", () => {
  const id = doomed
  closeMenu()
  if (id === null) return
  const node = world.get(id)
  if (!node) return

  // Down the same line as every other write, behind whatever the panel has already queued.
  const receipt = writes.open()
  receipt.el.textContent = node.label
  writes.run(receipt, async () => {
    try {
      const { parted } = await deleteNodeWithEdges(id)

      // The union, because neither list covers the other. A truncated read leaves the picture
      // holding fewer edges than the node had, so `parted` names some that were never drawn;
      // an empty `parted` is somebody else having removed the node between the read and the
      // write, which parts the drawn ones without this call hearing which. Either way the
      // reply says the node is gone, and a node that is gone holds no edges.
      const dropped: [string, string][] = []
      for (const other of new Set([...parted, ...world.neighbours(id)])) {
        if (world.unlink(id, other)) dropped.push([id, other])
        world.lowerDegree(other)
      }
      // Unlink before forgetting: a node may only leave once nothing is joined to it, which
      // is the rule the store's own delete enforces.
      const gone = world.forget(id) ? [id] : []
      view.drop(gone, dropped)
      // `drop` clears an accent that has gone and leaves the caller to re-pick. Nothing else
      // asks until the camera next moves, and until then the HUD would name a gap.
      trackAccent()

      receipt.settle("ok", `removed ${node.label}`)
      void refreshTotals()
      // After the repaint, never before: `render` writes the idle hint over whatever the
      // status line is holding, so a message set ahead of it is one nobody reads.
      render()
      setStatus(`removed ${node.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // A run that stopped partway has parted edges the map is still drawing, and the reply
      // carries no list of them. Nor can a fresh read recover it: reads stop at a ceiling, so
      // an edge missing from one is not proof it has gone. The state is said, not repaired.
      receipt.settle("warn", reason)
      setStatus(`⚠ ${reason} — edges may already have gone; ask again to finish`, "error")
    }
  })
})

/**
 * Arriving somewhere by name.
 *
 * Every other node on the map got here because somebody walked to its neighbour, and its
 * seat came from the node it neighbours. A named node has neither: it is joined to nothing
 * on screen, and the only thing its position can answer to is where the camera happens to
 * be. That is the cost of the box, and it is paid once — from the moment it lands it is an
 * ordinary node, and what draws around it is its own neighbourhood, read on the settle at
 * the end of the flight like anywhere else. The centre still draws; this only changes how a
 * node becomes the centre.
 *
 * `at` is what an island arrives on instead. A searched node is one node and answers to the
 * camera; an island is the first of a neighbourhood that will grow as it is walked, and it
 * needs water around it rather than the nearest gap — see `World.berth`.
 */
function goTo(node: NodeMeta, at?: Point): void {
  if (!world.has(node.id)) {
    view.add([world.place(node, at ?? world.landing(view.centre(), node.id))], [])
    view.setAccent(node.id)
  }
  // From here on this is the click path: name a destination, read it now rather than on
  // the settle at the far end, and glide.
  explorer.prefetch(node.id)
  view.focus(node.id)
  render()
}

/** Says which of these is already on the map, so picking one is a known quantity. */
const note = (node: NodeMeta): string =>
  world.has(node.id) ? "already placed" : `${String(node.degree)} edges`

/**
 * What the panel changes on the map.
 *
 * A created node lands like a named one: joined to nothing on screen yet, so the only thing
 * its position can answer to is the camera. The edge that follows a moment later links it
 * where it sits rather than re-seating it, which is the seated-once rule holding for a node
 * that arrived by being made rather than by being walked to.
 */
new JoinPanel(
  {
    near: {
      field: el<HTMLDivElement>("near-end"),
      input: el<HTMLInputElement>("near"),
      list: el<HTMLUListElement>("near-list"),
      clear: el<HTMLButtonElement>("near-clear"),
    },
    far: {
      field: el<HTMLDivElement>("far-end"),
      input: el<HTMLInputElement>("far"),
      list: el<HTMLUListElement>("far-list"),
      clear: el<HTMLButtonElement>("far-clear"),
    },
    link: el<HTMLSpanElement>("link"),
  },
  {
    note,
    onStatus: setStatus,
    // Arming an end is the page's other way of arriving somewhere.
    onArm: goTo,
    onNode: (node) => {
      // Counted here rather than only after the edge: a create that lands before a refused
      // join is still a node in the store, and the HUD should say so.
      void refreshTotals()
      if (world.has(node.id)) return
      view.add([world.place(node, world.landing(view.centre(), node.id))], [])
      render()
    },
    onEdge: (a, b) => {
      // Both, together. `missing` is degree minus the edges loaded, so linking without
      // raising the degree would make a node with more graph behind it look finished —
      // see World.bumpDegree.
      world.bumpDegree(a.id)
      world.bumpDegree(b.id)
      const drawn = world.linkExisting(a.id, b.id)
      if (drawn) view.add([], [[a.id, b.id]])
      // The totals in the HUD came from one read at boot and are now a write out of date.
      void refreshTotals()
      render()
    },
    onUndone: (a, b, removed) => {
      // Unlink before forgetting: a node is only allowed to leave once nothing is joined
      // to it, which is the same rule the store's delete enforces.
      world.unlink(a.id, b.id)
      world.lowerDegree(a.id)
      world.lowerDegree(b.id)
      const gone = removed && world.forget(removed.id) ? [removed.id] : []
      view.drop(gone, [[a.id, b.id]])
      // A removed node may have been the one nearest the middle. Nothing else asks until
      // the camera next moves, and until then the HUD would name something that is gone.
      if (gone.length) trackAccent()
      void refreshTotals()
      render()
    },
  },
  writes,
)

window.addEventListener("keydown", (event) => {
  // Above the guard below: the menu is raised over the map, and Escape shuts it wherever the
  // focus happens to be sitting.
  if (event.key === "Escape") closeMenu()

  // The arrows below pan the camera. Inside an end of the panel they belong to the text.
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

/**
 * The HUD folds away.
 *
 * Everything in it is a number to glance at; the islands below it are what the map is
 * navigated with, and they should not have to share a panel with seven rows of arithmetic.
 * Folded, the rail lifts the list to the top corner on its own — which is the whole reason
 * the left column is one flow rather than three fixed boxes.
 *
 * `aria-expanded` is the state, read by CSS as well as by a screen reader, so there is one
 * place it lives rather than a class saying the same thing a second time.
 */
hudToggle.addEventListener("click", () => {
  const open = hudToggle.getAttribute("aria-expanded") === "true"
  hudToggle.setAttribute("aria-expanded", String(!open))
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

function showTotals(index: GraphIndex): void {
  statTotal.textContent = `${String(index.nodeCount)} nodes · ${String(index.edgeCount)} edges`
}

/**
 * Re-read how big the graph is, and what its components are.
 *
 * Only these: everything else on the map is what somebody walked to, and re-reading that
 * would seat nodes nobody went to. A write is the one thing that can make either wrong
 * without the camera moving — a join can merge two islands into one — so it is the only
 * thing that asks again. Most writes leave the components exactly as they were, and
 * `setFirstPage` is what notices that and keeps the rows it already has.
 */
async function refreshTotals(): Promise<void> {
  try {
    const index = await fetchIndex()
    showTotals(index)
    islands.setFirstPage({ islands: index.islands, cursor: index.islandCursor }, index.islandCount)
  } catch {
    // A stale count is not worth an error state over. The next write asks again.
  }
}

/**
 * The node the map opens on, or null if it is not there any more.
 *
 * Only `Missing` is swallowed. A read that fails for any other reason is a read that failed,
 * and reporting it as an empty graph would turn a broken API into a table that merely looks
 * unprepared — the one wrong answer this could give.
 */
async function startingPoint(id: string): Promise<Neighbourhood | null> {
  try {
    return await fetchNeighbourhood(id)
  } catch (err) {
    if (err instanceof Missing) return null
    throw err
  }
}

async function boot(): Promise<void> {
  setStatus("loading graph…", "busy")
  const index = await fetchIndex()
  showTotals(index)
  islands.setFirstPage({ islands: index.islands, cursor: index.islandCursor }, index.islandCount)
  // Only here. After this the mark follows what the reader clicks: an island is knowable from
  // a node only by asking the store, and a crossing is the one move the page can answer for
  // on its own. `rootId` goes with it because it is the node of that island the map will be
  // holding, and the island's own name is a node nothing has seated.
  islands.here(index.homeIslandId, index.rootId)

  // A graph with nowhere to start. Three ways in now, and only one of them is a fault.
  //
  // A table prepared and not yet written to is exactly what it should be, and reading its
  // absent root would report `no such node:` for a node nobody has made yet. A `rootId`
  // naming a node that has gone is the same picture from the other end: nothing maintains it
  // through a removal (src/graph/init.ts), and taking a node off the map is the quickest way
  // there is to make it stale — so this is a state the page reaches by being used, not one
  // anybody has to have damaged the table to see. Either way the reckoning is `graph:init`
  // and the islands below are the way back in.
  //
  // The panel is built before this runs, so naming the first node is available either way.
  const root = index.rootId ? await startingPoint(index.rootId) : null

  if (!root) {
    // Nothing is placed, so every island is off the map — and on a table with no root at all
    // this list is the only way into any of them.
    setStatus(
      index.nodeCount > 0
        ? `⚠ ${String(index.nodeCount)} nodes and no starting point — run npm run graph:init`
        : "no nodes yet — name one above to start",
      index.nodeCount > 0 ? "error" : "idle",
    )
    return
  }

  world.place(root.node, { x: 0, y: 0 })
  const absorbed = world.absorb(root.node.id, root.neighbours)

  view.add([world.get(root.node.id)!], [])
  view.add(absorbed.nodes, absorbed.edges)
  view.focus(root.node.id, false)
  view.setAccent(root.node.id)

  // The root and its ring, and that is the whole first frame. Nothing beyond it is drawn
  // until somebody walks there; the first settle reads the ring without drawing any of
  // what comes back. The pass runs here rather than waiting for that settle, so a window too
  // small to hold the root's ring shows a door to what it cut off on the first frame. On a
  // window that fits, this raises nothing.
  view.reviseGhosts()
  // `render` repaints the list, and it runs after the root is placed, so the island holding
  // it is drawn as somewhere you have been on the first frame rather than a beat later.
  render()
}

boot().catch((err: unknown) => {
  setStatus(`⚠ ${err instanceof Error ? err.message : String(err)}`, "error")
})
