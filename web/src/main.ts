/**
 * The map page: wiring, accent tracking and the HUD.
 *
 * The accent is the node nearest the middle of the screen. It is recomputed at most once per
 * frame, with hysteresis so it does not flicker between two close nodes. How long the camera
 * must be still before it counts as stopped depends on what moved it. Naming a node skips
 * the wait. A drag waits longest.
 */
import {
  Missing,
  deleteNodeWithEdges,
  fetchNeighbourhood,
  fetchOpening,
  persist,
  whenEvicted,
} from "./store/index.js"
import type { Neighbourhood, NodeMeta, Opening } from "./store/index.js"
import { Explorer, debounce, perFrame } from "./explore.js"
import { IslandsPanel } from "./islands.js"
import { JoinPanel } from "./join.js"
import { MapView, ghostTarget } from "./map-view.js"
import { currentPalette, onThemeChange } from "./palette.js"
import { distance, type Point } from "./placement.js"
import { World } from "./world.js"
import { Writes } from "./writes.js"

/**
 * How long the camera must be still before the centre node is read.
 *
 * The wait is not for the read, which is usually fast. It is for drift. A drag or a wheel
 * sweeps the middle of the screen over every node between the start and the end. Reading
 * each one would place its neighbours on the map for good, because World never reassigns a
 * position. The wait keeps the map to what the reader stopped on.
 */
const SETTLE_MS = 190

/**
 * The same wait, for an input that stops at once.
 *
 * Most of the 190 covers inertia: a drag's fling, a wheel's momentum. An arrow key has
 * none. The camera moves 120px and stops. All that is left to wait for is another key, and
 * a held arrow repeats faster than this, so a run across six nodes still ends in one read.
 */
const NUDGE_SETTLE_MS = 110

/** A node must be this much closer to the middle than the accent before it takes over. */
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
const hudToggle = el<HTMLButtonElement>("hud-toggle")
/** Shown only when the store holds no graph at all. Raised and lowered by `showTotals`. */
const empty = el<HTMLDivElement>("empty")

const world = new World()
const view = new MapView(stage, world)

/**
 * The queue every write to the graph goes through.
 *
 * Built here because two things write: the join panel below, and the map itself. Putting the
 * queue inside either one would leave it out of reach of the other.
 */
const writes = new Writes(el<HTMLDivElement>("receipts"), setStatus)

/**
 * The island panel: every component of the graph, as a place to go.
 *
 * Built here rather than in `boot`, because a graph the map cannot open on still has islands
 * in it, and this list is the only way to reach them. See the `home` branch in `boot`.
 */
const islands = new IslandsPanel(
  el<HTMLElement>("islands"),
  el<HTMLUListElement>("islands-list"),
  el<HTMLSpanElement>("islands-count"),
  {
    onCross: (island, seated) => {
      // If a node of this island is already on the map, go to that node, not to the island's
      // naming node. They are usually different, and placing a node that is already drawn
      // would put a second copy of it somewhere else.
      const known = seated === null ? null : world.get(seated)
      if (known) {
        goTo(known)
        return
      }
      // Use `berth`, not the nearest gap. An island grows as it is walked, and starting it
      // beside the camera would grow it through whatever is already there.
      goTo(island, world.berth(island.id))
    },
    placed: (id) => world.has(id),
  },
)

function setStatus(text: string, tone: "idle" | "busy" | "error"): void {
  status.textContent = text
  status.dataset["tone"] = tone
  // Folding the HUD hides the status line with it, so put the tone on the chevron too. A
  // failed read is then still visible as colour while the HUD is folded.
  hudToggle.dataset["tone"] = tone
}

const explorer = new Explorer(world, view, {
  onChange: () => {
    render()
    // The reply adds neighbours the settle that asked for it could not see: the read is not
    // awaited there, so the ghost pass ran before the reply arrived. Schedule another settle
    // to cover them. This keeps ghosts tied to a settled camera, rather than creating
    // elements inside `add`, which a pan also calls.
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
  // Which islands are on the map changes without the store changing: walking across an edge
  // places one. So repaint the rows here, not only after a write.
  islands.paint()

  if (status.dataset["tone"] === "error") return
  if (explorer.pending > 0) setStatus(`loading ${explorer.pending}…`, "busy")
  else setStatus("drag to pan · wheel to zoom · click to centre", "idle")
}

/** Whatever is nearest the middle becomes the accent, with a bias toward the incumbent. */
const trackAccent = perFrame(() => {
  // A flight pans the camera over every node between the start and the target. Letting the
  // accent follow would give it to each in turn, and would remove the ghost being flown to.
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
  // Only touch the DOM when the accent moved. This runs on every frame of a pan.
  if (view.setAccent(candidate.id)) {
    // Free space changes as the map grows. Arriving at a node is the moment to check whether
    // the neighbours it had no room for can be placed now.
    const late = world.seatPending(candidate.id)
    if (late.nodes.length || late.edges.length) view.add(late.nodes, late.edges)
    render()
  }
})

/**
 * Everything that waits for the camera to stop.
 *
 * Cytoscape emits `viewport` on every frame of an animated pan, and emits it even when the
 * pan moved nothing. A Recentre with the centre already centred still reaches here. That is
 * harmless because the only read this schedules is the centre's, and a node is read once: a
 * second settle over the same node finds it already marked.
 */
const settle = debounce(() => {
  explorer.loadCentre()
  // Ghosts are created and removed only on a settled camera. Their colour tiers are data
  // writes and cheap to redo mid-pan, but elements appearing and disappearing on every frame
  // of a pan would flicker.
  view.reviseGhosts()
  render()
}, SETTLE_MS)

/** Set by an arrow key, and read by the `viewport` event it causes. */
let nudged = false

view.cy.on("viewport", () => {
  // The menu opened over a node at a screen position. Moving the map under it would leave it
  // pointing at whatever drifted under the pointer instead.
  closeMenu()
  trackAccent()
  settle(nudged ? NUDGE_SETTLE_MS : SETTLE_MS)
  nudged = false
})

view.cy.on("tap", "node", (event) => {
  const id = String(event.target.id())

  // A ghost stands in for an off-screen node. Clicking one flies to that node. The read
  // starts now rather than on the settle at the far end, because the destination is already
  // known and the flight is otherwise idle time.
  const target = ghostTarget(id)
  if (target) {
    explorer.prefetch(target)
    if (view.flyTo(id, () => render())) render()
    return
  }

  if (!world.has(id)) return

  // Clicking the centre cannot move the camera, because the camera is already there. So a
  // click on the centre means the other thing a node can be: a name for the join panel.
  // `take` in web/src/join.ts handles it. The camera move comes back through that path, on
  // the pick that sets the anchor.
  if (id === view.accent) {
    const node = world.get(id)
    // ⌘ only, as on a list row. See web/src/combobox.ts.
    if (node) panel.take(node, (event.originalEvent as MouseEvent | undefined)?.metaKey === true)
    return
  }

  // Clicking a node is not drifting past it: the destination is known. So read it now
  // rather than on the settle at the end of the flight, as the ghost branch above does. The
  // camera then lands on a finished picture instead of completing one after it stops.
  explorer.prefetch(id)
  view.focus(id)
})

/**
 * Delete the centre node and all its edges.
 *
 * Right-click, and only on the centre node. The centre is what the reader walked to, and it
 * is the only node whose degree is shown on the page, so it is the only one whose cost the
 * menu can state. A ghost is never the centre.
 *
 * The edge count is in the button label because this is the one write that cannot be undone.
 * Everywhere else the panel writes on `↵` and offers an undo afterwards. Here there is no
 * undo, so the question is asked first and says how much is going.
 */
const menu = el<HTMLDivElement>("node-menu")
const menuDelete = el<HTMLButtonElement>("node-delete")

/** The node the menu would delete, or null when the menu is closed. */
let doomed: string | null = null

function closeMenu(): void {
  // Return early when there is nothing to close. A pan calls this on every frame.
  if (menu.hidden) return
  doomed = null
  menu.hidden = true
}

/** The button label, with the edge count when the node has edges. */
function priced(node: NodeMeta): string {
  if (!node.degree) return `delete ${node.label}`
  const edges = node.degree === 1 ? "1 edge" : `${String(node.degree)} edges`
  return `delete ${node.label} and its ${edges}`
}

// Without this the browser's own context menu opens on top of this one.
stage.addEventListener("contextmenu", (event) => event.preventDefault())

// A click anywhere but the menu closes it. The button is inside the menu, so its own click
// is not caught here.
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

  // Through the same queue as every other write, behind whatever the panel has queued.
  const receipt = writes.open()
  receipt.el.textContent = node.label
  writes.run(receipt, async () => {
    try {
      const { parted } = await deleteNodeWithEdges(id)

      // Take the union of both lists, because neither covers the other. A capped read leaves
      // the map holding fewer edges than the node had, so `parted` names edges that were
      // never drawn. An empty `parted` means something else deleted the node between the
      // read and the write, which removed the drawn edges without this call being told. The
      // reply says the node is gone either way, and a node that is gone has no edges.
      const dropped: [string, string][] = []
      for (const other of new Set([...parted, ...world.neighbours(id)])) {
        if (world.unlink(id, other)) dropped.push([id, other])
        world.lowerDegree(other)
      }
      // Unlink before forgetting. `World.forget` refuses a node that still has edges, the
      // same rule the store's delete enforces.
      const gone = world.forget(id) ? [id] : []
      view.drop(gone, dropped)
      // `drop` clears an accent that has gone and leaves the caller to pick a new one.
      // Nothing else does until the camera moves, and the HUD would show a missing node.
      trackAccent()
      // An input in the panel may be holding this name. This write does not go through the
      // panel, so tell it. A name that no longer exists must not stay in an input.
      panel.forget(node)

      receipt.settle("ok", `removed ${node.label}`)
      void refreshTotals()
      // Set the status after `render`, never before. `render` writes the idle hint over
      // whatever the status line holds.
      render()
      setStatus(`removed ${node.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // A delete that stopped partway has removed edges the map is still drawing, and the
      // error carries no list of them. A fresh read cannot recover it either, because reads
      // are capped: an edge missing from one read is not proof it is gone. So report the
      // state rather than trying to repair it.
      receipt.settle("warn", reason)
      setStatus(`⚠ ${reason} — edges may already have gone; ask again to finish`, "error")
    }
  })
})

/**
 * Go to a node that arrived by name rather than by walking.
 *
 * Every other node on the map is here because someone walked to a neighbour, and it took its
 * position from that neighbour. A named node has no neighbour on screen, so its position can
 * only come from where the camera is. That is a one-off. Once placed it is an ordinary node,
 * and its neighbours are read on the settle at the end of the flight like anywhere else.
 *
 * `at` overrides that, and an island uses it. A searched node is one node and can follow the
 * camera. An island is the first node of a neighbourhood that grows as it is walked, so it
 * needs room around it rather than the nearest gap. See `World.berth`.
 */
function goTo(node: NodeMeta, at?: Point): void {
  if (!world.has(node.id)) {
    view.add([world.place(node, at ?? world.landing(view.centre(), node.id))], [])
    view.setAccent(node.id)
  }
  // The rest is the click path: read the destination now rather than on the settle at the
  // far end, then move the camera.
  explorer.prefetch(node.id)
  view.focus(node.id)
  render()
}

/** Hover text for a search result. Says whether the node is already on the map. */
const note = (node: NodeMeta): string =>
  world.has(node.id) ? "already placed" : `${String(node.degree)} edges`

/**
 * The join panel, and what its writes change on the map.
 *
 * A created node is placed like a searched one: it has no neighbour on screen, so its
 * position comes from the camera. The edge written a moment later links it where it stands
 * instead of moving it. That is the place-once rule holding for a node that arrived by being
 * created rather than by being walked to.
 */
const panel = new JoinPanel(
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
    // Setting the anchor is the page's other way of arriving at a node.
    onArm: goTo,
    onNode: (node) => {
      // Update the totals here, not only after the edge. A create that lands before a
      // refused join is still a node in the store, and the HUD should say so.
      void refreshTotals()
      if (world.has(node.id)) return
      view.add([world.place(node, world.landing(view.centre(), node.id))], [])
      render()
    },
    onEdge: (a, b) => {
      // Raise the degree and link, together. `missing` is degree minus the edges loaded, so
      // linking without raising the degree would make a node with unread neighbours look
      // complete. See World.bumpDegree.
      world.bumpDegree(a.id)
      world.bumpDegree(b.id)
      const drawn = world.linkExisting(a.id, b.id)
      if (drawn) view.add([], [[a.id, b.id]])
      // The HUD totals came from one read at boot and are now one write out of date.
      void refreshTotals()
      render()
    },
    onUndone: (a, b, removed) => {
      // Unlink before forgetting. `World.forget` refuses a node that still has edges, the
      // same rule the store's delete enforces.
      world.unlink(a.id, b.id)
      world.lowerDegree(a.id)
      world.lowerDegree(b.id)
      const gone = removed && world.forget(removed.id) ? [removed.id] : []
      view.drop(gone, [[a.id, b.id]])
      // The removed node may have been the accent. Nothing else picks a new one until the
      // camera moves, and until then the HUD would show a node that is gone.
      if (gone.length) trackAccent()
      void refreshTotals()
      render()
    },
  },
  writes,
)

window.addEventListener("keydown", (event) => {
  // Before the guard below. The menu opens over the map, and Escape must close it wherever
  // the focus is.
  if (event.key === "Escape") closeMenu()

  // The arrow keys below pan the camera. Inside an input they belong to the text.
  if (event.target instanceof HTMLInputElement) return

  // `/` moves focus to the name input. It is the only part of the page a hand on the
  // keyboard cannot otherwise reach. After the guard above, so a slash typed into an input
  // stays a slash. Not with a modifier held, which belongs to the browser.
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    panel.focus()
    return
  }

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
 * Fold and unfold the HUD.
 *
 * The HUD holds numbers to glance at. The island list below it is what the map is navigated
 * with, and it should not share the screen with seven rows of numbers. Folded, the left rail
 * moves the list up to the top corner on its own.
 *
 * `aria-expanded` holds the state. CSS reads it as well as a screen reader, so the state
 * lives in one place instead of also being a class.
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

// Build the legend's dots from the same palette the map draws with.
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

/**
 * The HUD's store totals, and the panel shown when there is no graph at all.
 *
 * Both come off the same read, so this owns both. The panel is not a boot state: naming the
 * first node on an empty graph is one of the two ways out that the panel itself offers, and
 * deleting the last one puts the reader back where they started.
 *
 * Keyed on the store's count, never on `world.size`. Deleting the only node on screen empties
 * the map while the store still holds every island nobody has walked to.
 */
function showTotals(opening: Opening): void {
  statTotal.textContent = `${String(opening.nodeCount)} nodes · ${String(opening.edgeCount)} edges`
  empty.hidden = opening.nodeCount > 0
}

/**
 * Re-read the graph size and the list of components.
 *
 * These two only. Everything else on the map is what someone walked to, and re-reading that
 * would place nodes nobody visited. A write is the only thing that can make either wrong
 * without the camera moving, because a join can merge two islands into one. Most writes
 * leave the components unchanged, and `setFirstPage` detects that and keeps its rows.
 */
async function refreshTotals(): Promise<void> {
  try {
    const opening = await fetchOpening()
    showTotals(opening)
    islands.setFirstPage(
      { islands: opening.islands, cursor: opening.islandCursor },
      opening.islandCount,
    )
  } catch {
    // A stale count does not deserve an error state. The next write reads again.
  }
}

/**
 * Read the node the map opens on, or null if it is no longer there.
 *
 * Only `Missing` is caught. A read that fails for any other reason has failed, and reporting
 * that as an empty graph would show a broken store as a graph that merely has no nodes.
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
  // Asked once, and nothing reads the answer. It is the only protection against the browser
  // evicting the graph under storage pressure, and it is a request, not a guarantee. Some
  // browsers decide for themselves and say nothing.
  void persist()

  const opening = await fetchOpening()
  showTotals(opening)
  islands.setFirstPage(
    { islands: opening.islands, cursor: opening.islandCursor },
    opening.islandCount,
  )
  // Where the map opens: the largest component, and the node that names it. One row gives
  // both, so the island and the first node on the map share an id.
  const home = opening.islands[0] ?? null

  // Set once, here. After this the mark follows what the reader clicks. Finding a node's
  // island takes a read, and a click on an island row is the only move the page can answer
  // for on its own.
  islands.here(home?.id ?? null)

  // A graph with nowhere to start now means one thing only. The opening node is the first row
  // of the island page, not an id stored somewhere, so it cannot be stale and cannot name a
  // node that is gone. What is left is a graph with no nodes, which a fresh browser profile
  // legitimately has.
  //
  // The join panel is built before this runs, so naming the first node works either way.
  const root = home ? await startingPoint(home.id) : null

  if (!root) {
    // Nothing to draw. The way in is the transfer page, which can seed a graph. Naming a
    // node in the box above works from here too. `showTotals` above has already raised the
    // panel that says so.
    setStatus("no graph here yet — seed one, or name a node above to start", "idle")
    return
  }

  world.place(root.node, { x: 0, y: 0 })
  const absorbed = world.absorb(root.node.id, root.neighbours)

  view.add([world.get(root.node.id)!], [])
  view.add(absorbed.nodes, absorbed.edges)
  view.focus(root.node.id, false)
  view.setAccent(root.node.id)

  // The first frame is the root node and its neighbours, and nothing else. Run the ghost pass
  // here rather than waiting for the first settle, so a window too small to show the root's
  // neighbours has a way to reach them from the first frame. On a window that fits, this adds
  // nothing.
  view.reviseGhosts()
  // `render` repaints the island list. It runs after the root is placed, so the island the
  // root belongs to is marked as visited on the first frame.
  render()
}

// Another tab is upgrading the database, or the browser closed it. Either way this connection
// is gone. Reporting it is all that can be done. A page that said nothing would keep drawing
// a graph it can no longer read.
whenEvicted((reason) => {
  setStatus(`⚠ ${reason}`, "error")
})

boot().catch((err: unknown) => {
  setStatus(`⚠ ${err instanceof Error ? err.message : String(err)}`, "error")
})
