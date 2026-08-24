/**
 * The map page: wiring, the centre and the panels around it.
 *
 * The centre is the node somebody named: a click, a search hit, a doorway, a crossing. Under
 * **walk by pan** the camera names one too, whatever it stops nearest. A click never takes the
 * camera. A clicked node becomes the centre where it stands, ring and all, so the centre can
 * end up off screen, and Recentre is the way back. The search box, the islands list and a
 * doorway do still travel to their node. How long the camera must be still before it counts as
 * stopped depends on what moved it. A drag waits longest.
 */
import {
  Missing,
  deleteNodeWithEdges,
  fetchNeighbourhood,
  fetchOpening,
  joinNodes,
  persist,
  renameNode as storeRename,
  unjoinNodes,
  whenEvicted,
} from "./store/index.js"
import type { Neighbourhood, NodeMeta, Opening } from "./store/index.js"
import { DragJoin } from "./drag-join.js"
import { Explorer, debounce, perFrame } from "./explore.js"
import { IslandsPanel } from "./islands.js"
import { JoinPanel } from "./join.js"
import { MapView, ghostTarget } from "./map-view.js"
import { currentPalette, onThemeChange } from "./palette.js"
import { RenameBox } from "./rename-box.js"
import { distance, type Point } from "./placement.js"
import { railOut, setRailOut, walkByPan, setWalkByPan } from "./settings.js"
import { World, type WorldNode } from "./world.js"
import { Writes, type Receipt } from "./writes.js"

/**
 * Camera stillness before the doorways are revised.
 *
 * A pan no longer changes the centre, so nothing here is about what a gesture drifts across
 * any more. What is left answers to the viewport: a doorway stands while its neighbour is off
 * screen, and a doorway is an element, so raising and lowering them through the frames of a
 * fling would strobe. The wait is for the picture the camera finished on, not for any of the
 * ones it passed through.
 */
const SETTLE_MS = 190

/**
 * The same wait, for an input that stops at once.
 *
 * Most of the 190 is inertia — a drag's fling, a wheel's momentum. An arrow has none: the
 * camera moves its 120px and is still. What is left to wait for is only whether another key
 * is coming, and a held arrow repeats faster than this on a stock keyboard, so a run of them
 * still costs the one revision at the end of it.
 */
const NUDGE_SETTLE_MS = 110

/**
 * How much closer to the middle a rival must be before it takes the centre from the incumbent.
 *
 * Only **walk by pan** reads this. It is a ratio rather than a length, because it compares two
 * distances to the same point. It prevents the flicker a bare nearest-wins test gives when the
 * middle passes between two nodes.
 */
const ACCENT_HYSTERESIS = 0.78

/** Keyboard pan step, in screen pixels. */
const NUDGE = 120

// `querySelector` rather than `getElementById`, because it is generic over `Element` and this
// looks up an SVG line as well as HTML. The id it is given is a literal in this file.
const el = <T extends Element>(id: string): T => {
  const found = document.querySelector<T>(`#${id}`)
  if (!found) throw new Error(`missing element: #${id}`)
  return found
}

const stage = el<HTMLDivElement>("stage")
const statCentre = el<HTMLSpanElement>("stat-centre")
const statDegree = el<HTMLSpanElement>("stat-degree")
const statNodes = el<HTMLSpanElement>("stat-nodes")
const statEdges = el<HTMLSpanElement>("stat-edges")
const statPending = el<HTMLSpanElement>("stat-pending")
const statTotal = el<HTMLSpanElement>("stat-total")
const status = el<HTMLParagraphElement>("status")
const railTab = el<HTMLButtonElement>("rail-tab")
const guide = el<HTMLDivElement>("guide")
const guideToggle = el<HTMLButtonElement>("guide-toggle")
const walkToggle = el<HTMLInputElement>("walk-by-pan")
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
  // The pill is drawn only when the tone is not idle, and it is narrow. Put the tone on the
  // guide's button as well, which is in the same corner and always there.
  guideToggle.dataset["tone"] = tone
}

/** Set once a copy has been turned down. The refusal is reported on that first one only. */
let clipboardRefused = false

/**
 * Put a name on the clipboard. Every click on a node copies the name it carries.
 *
 * Silent when it works, because the name the reader clicked is the name they get. A denied
 * permission stops it. So does an insecure origin: `navigator.clipboard` is undefined there,
 * and the property lookup throws before any write.
 *
 * A refusal is reported once and not again. A browser that turns one copy down turns them all
 * down, and every node click reaches here. Repeating it would put an error on the status line
 * at every step of a walk, where `render` leaves one standing.
 */
async function copyLabel(label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(label)
  } catch {
    if (clipboardRefused) return
    clipboardRefused = true
    setStatus(`⚠ could not copy ${label}. Later copies fail silently.`, "error")
  }
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

/**
 * Repaint the HUD numbers and the island rows.
 *
 * The last thing it does is write the idle hint over the status line, unless that line
 * already holds an error. So a caller with something to say calls this first and
 * `setStatus` after.
 */
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

/**
 * Name a node the centre, and take whatever its arrival makes possible.
 *
 * Every way in comes through here: a click, a search, an island, the claim below for a map
 * that has just lost its centre, and the tracker below that when the reader has handed the
 * centre back to the camera. `flyTo` is the one exception, promoting its own destination on
 * landing so that the ghost has something to dissolve into.
 *
 * The early return is load-bearing, not tidiness. `setAccent` reports whether the mark
 * actually moved, and the tracker calls this on every frame of a pan — so a frame that finds
 * the same node nearest costs one comparison and touches neither the DOM nor the store.
 */
function becomeCentre(id: string): void {
  if (!view.setAccent(id)) return
  // Room is a property of the map at one moment. Arriving is the moment to ask again
  // whether the neighbours this node never had space for can be fitted now.
  const late = world.seatPending(id)
  if (late.nodes.length || late.edges.length) view.add(late.nodes, late.edges)
  render()
  // `setAccent` has just taken down the doorways the last centre raised, and nothing else here
  // puts them back. A click moves no camera, so there is no `viewport` to schedule this on, and
  // a node whose ring was already read asks `Explorer` for nothing either — the centre would
  // stand with no way out of it until the reader happened to pan. The early return above is
  // what keeps this off a naming that changed nothing.
  settle()
}

/**
 * A centre for a map that has just lost one, or that has just been told to find its own.
 *
 * Called on a loss — a centre deleted, a join undone that took its node with it — and when
 * **walk by pan** is switched on, which is the reader asking the camera to name one now. A
 * camera that has merely moved leaves the centre exactly where it is.
 *
 * Nearest the middle, bounded by `reach` so a map with nothing on screen is left without a
 * centre rather than given one nobody can see. No hysteresis, in either case: on a loss there
 * is no incumbent left to be biased toward, and on a switch the bias would sometimes leave the
 * mark where it was and read as a control that did nothing.
 *
 * Never during a flight. `setAccent` clears the ghosts, so a claim landing mid-journey would
 * take down the one in the air — and the flight names its own destination anyway.
 */
function claimCentre(): void {
  if (view.inFlight) return
  const candidate = world.nearestTo(view.centre(), view.reach())
  if (candidate) becomeCentre(candidate.id)
}

/**
 * The centre, handed back to the camera: whatever is nearest the middle takes it.
 *
 * Off by default, and the whole of 0032 is why. On, a seat is still permanent, so every node
 * the middle crosses has its ring read and placed for good — the drift is the cost the reader
 * is choosing, not a bug to be fixed here.
 *
 * Hysteresis because this runs against an incumbent: a bare nearest-wins test flickers between
 * two nodes as the midpoint passes between them, which `claimCentre` never has to deal with.
 */
const trackCentre = perFrame(() => {
  // A flight pans the camera over every node between the start and the target. Letting the
  // centre follow would give it to each in turn, and would take down the ghost being flown to.
  if (view.inFlight) return

  const middle = view.centre()
  const candidate = world.nearestTo(middle, view.reach())
  if (!candidate) return

  const current = view.accent ? world.get(view.accent) : null
  if (current && current.id !== candidate.id) {
    const rival = distance(candidate, middle)
    const incumbent = distance(current, middle)
    if (rival > incumbent * ACCENT_HYSTERESIS) return
  }
  becomeCentre(candidate.id)
})

/**
 * The tracker and the switch it answers to.
 *
 * Tested here rather than inside `trackCentre`, because `perFrame` schedules a frame before the
 * body can decline it. Guarding within would have a map with the setting off pay a callback on
 * every frame of every pan for a feature it is not using. A frame already queued when the
 * reader unticks still lands, which matches having flipped the box one frame later.
 */
const walk = (): void => {
  if (walkByPan()) trackCentre()
}

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
  walk()
  settle(nudged ? NUDGE_SETTLE_MS : SETTLE_MS)
  nudged = false
})

// A disc under the pointer draws as its name. The flag goes on whatever node the pointer
// enters, and the style rule in map-view.ts is what scopes the mark to the discs.
//
// `mouseover` and `mouseout`, not `tapdragover` and `tapdragout`. The touch handlers emit only
// the second pair, so a finger dragging across the map would light every disc it crossed.
view.cy.on("mouseover", "node", (event) => {
  view.hover(String(event.target.id()))
})
view.cy.on("mouseout", "node", () => {
  view.hover(null)
})

view.cy.on("tap", "node", (event) => {
  const id = String(event.target.id())

  // A ghost stands in for an off-screen node. Clicking one flies to that node. The read
  // starts now rather than on the settle at the far end, because the destination is already
  // known and the flight is otherwise idle time.
  const target = ghostTarget(id)
  if (target) {
    // The name before the journey. A ghost carries it on screen long before the node it
    // stands for arrives, and the reader may have wanted the one without the other.
    const named = world.get(target)
    if (named) void copyLabel(named.label)
    explorer.prefetch(target)
    if (view.flyTo(id, () => render())) render()
    return
  }

  const node = world.get(id)
  if (!node) return

  // Every click on a node takes its name. Nothing is written to the graph and the camera does
  // not move for it.
  void copyLabel(node.label)

  // The centre's click reaches the panel as well, and no other click does. `take` in
  // web/src/join.ts puts the caret in the far input. A walk that called it at every step would
  // keep taking the arrow keys off the map.
  if (id === view.accent) {
    panel.take(node)
    return
  }

  // Named where it stands. This handler was the last place the page moved the camera on its
  // own: a click drew the node to the middle whether or not anyone wanted to be moved. The
  // node's ring now draws around it wherever it sits, off the edge of the screen included.
  // **Recentre** is how the middle is asked for.
  explorer.prefetch(id)
  becomeCentre(id)
})

/**
 * The menu that takes something out of the graph.
 *
 * Right-click, and only at the centre: the centre node itself, or one of the lines that
 * reaches it. The centre is what the reader walked to, and it is the only node whose degree
 * is shown on the page, so it is the only one whose cost the menu can state. A ghost is never
 * the centre.
 *
 * The writes are not alike, and the menu says so. A node taken out cannot be put back,
 * because its edges cannot come with it. So the button names how much is going, and the
 * question is asked before the write. Parting two nodes leaves both where they are. That one
 * writes on the click and carries an undo after, like every write from the box above. A
 * rename is reversible in the same way, so it does the same.
 *
 * Edit opens in the menu rather than beside the node. The pointer is already here, and the
 * box would otherwise have to be held over a Cytoscape node through every pan and zoom.
 */
const menu = el<HTMLDivElement>("map-menu")
const menuButton = el<HTMLButtonElement>("map-remove")
const editRow = el<HTMLButtonElement>("map-rename")
const editBox = el<HTMLDivElement>("map-edit")

/** What the menu would take out, or null when the menu is closed. */
type Doomed = { kind: "node"; id: string } | { kind: "edge"; a: string; b: string }

let doomed: Doomed | null = null

/** The node the edit row would rename, or null when the menu is closed or on a line. */
let editing: NodeMeta | null = null

function closeMenu(): void {
  // Return early when there is nothing to close. A pan calls this on every frame.
  if (menu.hidden) return
  doomed = null
  editing = null
  menu.hidden = true
  // Put the box away and the row back, so the next node opens on the row rather than on the
  // name of the last one.
  editBox.hidden = true
  editRow.hidden = false
  rename.close()
}

/**
 * Put the menu under the pointer, with the rows it is offering.
 *
 * `named` is the node an edit would rename, and null for a line. Only a node can be renamed,
 * so the edit row is hidden for the other target rather than opening on nothing.
 */
function openMenu(
  target: Doomed,
  label: string,
  at: MouseEvent | undefined,
  named: NodeMeta | null,
): void {
  doomed = target
  editing = named
  menuButton.textContent = label
  editRow.textContent = named ? `edit ${named.label}` : ""
  editRow.hidden = !named
  editBox.hidden = true
  menu.style.left = `${String(at?.clientX ?? 0)}px`
  menu.style.top = `${String(at?.clientY ?? 0)}px`
  menu.hidden = false

  // Then pulled back inside the window. The menu opens where the pointer is, so a click near
  // the right or bottom edge would otherwise leave half of it off screen.
  //
  // Measured after it is shown, because a hidden box has no size. Its rows are `nowrap`, so
  // the width it reports at the pointer is the width it has anywhere.
  const box = menu.getBoundingClientRect()
  const room = (want: number, size: number, limit: number): number =>
    Math.max(8, Math.min(want, limit - size - 8))
  menu.style.left = `${String(room(box.left, box.width, window.innerWidth))}px`
  menu.style.top = `${String(room(box.top, box.height, window.innerHeight))}px`
}

/** Swap the edit row for the box it opens. The menu stays where the pointer put it. */
editRow.addEventListener("click", () => {
  if (!editing) return
  editRow.hidden = true
  editBox.hidden = false
  rename.open(editing)
})

/** The button label, with the edge count when the node has edges. */
function priced(node: NodeMeta): string {
  if (!node.degree) return `delete ${node.label}`
  const edges = node.degree === 1 ? "1 edge" : `${String(node.degree)} edges`
  return `delete ${node.label} and its ${edges}`
}

/**
 * The node at one end of a drawn line, or null if that end is not one.
 *
 * A ghost is not a node on the map, but it names one, and its dashed lead stands for that
 * node's edge to the centre. A stub names nothing, so a stub's lead ends here and the line
 * it draws cannot be parted.
 */
function ended(id: string): WorldNode | null {
  return world.get(ghostTarget(id) ?? id) ?? null
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

  openMenu({ kind: "node", id }, priced(node), event.originalEvent as MouseEvent | undefined, node)
})

view.cy.on("cxttap", "edge", (event) => {
  const a = ended(String(event.target.source().id()))
  const b = ended(String(event.target.target().id()))
  if (!a || !b) return
  // One end has to be the centre, the same rule the node above follows. A ghost's lead
  // already meets it: a ghost belongs to the centre that created it.
  if (a.id !== view.accent && b.id !== view.accent) return

  // The centre first, so the row reads out from where the reader is standing.
  const [near, far] = a.id === view.accent ? [a, b] : [b, a]
  openMenu(
    { kind: "edge", a: near.id, b: far.id },
    `part ${near.label} and ${far.label}`,
    event.originalEvent as MouseEvent | undefined,
    // A line is not a node, so there is nothing here to rename.
    null,
  )
})

menuButton.addEventListener("click", () => {
  const target = doomed
  closeMenu()
  if (!target) return
  if (target.kind === "node") removeNode(target.id)
  else partEdge(target.a, target.b)
})

const rename = new RenameBox(el<HTMLInputElement>("map-name"), el<HTMLButtonElement>("map-update"), {
  onRename: (next) => {
    const node = editing
    closeMenu()
    if (node) renameNode(node, next)
  },
  onError: (message) => setStatus(`⚠ ${message}`, "error"),
})

/**
 * Give a node a new name, keeping its edges and its place on the map.
 *
 * The store does the hard half in one transaction. What is left here is the drawn map, where
 * a Cytoscape id cannot be changed. The node is dropped with its edges, then added again
 * under the new name, at the position `World.rename` kept for it. A rename that kept its key
 * moves nothing, and only the pill is redrawn.
 *
 * This offers an undo where removing a node cannot, because a rename is exactly reversible.
 * The way back is a rename back, and it is refused if something claimed the old name in
 * between.
 */
function renameNode(node: NodeMeta, next: string): void {
  const receipt = writes.open()
  receipt.el.textContent = node.label
  writes.run(receipt, async () => {
    try {
      const renamed = await applyRename(node, next)
      receipt.settle("ok", `renamed ${node.label} to ${renamed.label}`)
      receipt.offerUndo("put the old name back", () => {
        writes.run(receipt, () => renameBack(receipt, renamed, node.label))
      })
      void refreshTotals()
      // Set the status after `render`, never before. `render` writes the idle hint over
      // whatever the status line holds.
      render()
      setStatus(`renamed ${node.label} to ${renamed.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      receipt.settle("warn", reason)
      setStatus(`⚠ ${reason}`, "error")
    }
  })
}

/** Undo one. It is the same write in the other direction, so it settles as undone. */
async function renameBack(receipt: Receipt, node: NodeMeta, was: string): Promise<void> {
  try {
    const back = await applyRename(node, was)
    receipt.settle("undone", `${back.label} has its old name back`)
    void refreshTotals()
    render()
    setStatus(`undid renaming ${node.label}`, "idle")
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    receipt.settle("warn", reason)
    setStatus(`⚠ ${reason}`, "error")
  }
}

/**
 * The store, the map and the view, in that order. Both directions of a rename run through it.
 *
 * The drawn edges are read before the write, because `World.rename` files them under the new
 * name and there would be nothing left here to ask.
 */
async function applyRename(node: NodeMeta, next: string): Promise<NodeMeta> {
  const drawn = world.neighbours(node.id)
  const pairs = (id: string): [string, string][] =>
    drawn.map((other) => [id, other] as [string, string])

  const renamed = await storeRename(node.id, next)

  if (world.rename(node.id, renamed.id, renamed.label)) {
    if (renamed.id === node.id) view.relabel(node.id, renamed.label)
    else {
      const moved = world.get(renamed.id)
      view.drop([node.id], pairs(node.id))
      if (moved) view.add([moved], pairs(renamed.id))
    }
  }

  // `setAccent` and not `becomeCentre`, which every other path here uses. That one is for
  // arriving at a node: it seats whatever was waiting for room and schedules a read. A rename
  // arrives nowhere, and `World.rename` carried the expanded mark and the pending list across.
  // Its `settle` would also repaint the status line a moment after this write set it.
  view.setAccent(renamed.id)
  // A ghost stands for a node by name, so the ones this node owns are stale. `rejoin` revises
  // them here for the same reason, rather than leaving them to the next settle.
  view.reviseGhosts()
  // An input in the panel may be holding the old name, which now names nothing.
  panel.forget(node)
  return renamed
}

/**
 * Shift and drag between two nodes to join them.
 *
 * The gesture and its arrow are drag-join.ts. What reaches the graph is `joinPair` below.
 * `ended` is the same resolver the menu above parts an edge with. So a ghost stands for its node
 * at either end of a drag, as it does under a right-click.
 */
new DragJoin(view.cy, el<SVGPathElement>("aim-arrow"), el<SVGLinearGradientElement>("aim-ink"), {
  ended,
  join: joinPair,
  aim: (id) => view.aim(id),
  // The menu opens at a point on screen, and a drag is about to change what is under it.
  onStart: closeMenu,
})

/** Take a node out of the graph, with every edge that reaches it. */
function removeNode(id: string): void {
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
      // `drop` clears an accent that has gone and leaves the caller to re-pick. This is the
      // only thing that will: the camera no longer hands the mark around, so without the
      // claim the map would sit with no centre and the HUD would name a gap.
      claimCentre()
      // An input in the panel may be holding this name. This write does not go through the
      // panel, so tell it. A name that no longer exists must not stay in an input.
      panel.forget(node)

      receipt.settle("ok", `removed ${node.label}`)
      void refreshTotals()
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
}

/** Part two nodes: the store write, then the map, then a receipt carrying the way back. */
function partEdge(aId: string, bId: string): void {
  const a = world.get(aId)
  const b = world.get(bId)
  if (!a || !b) return

  const receipt = writes.open()
  receipt.el.textContent = `${a.label} — ${b.label}`
  writes.run(receipt, async () => {
    try {
      await unjoinNodes(aId, bId)
      partOnMap(aId, bId)

      receipt.settle("ok", `parted ${a.label} and ${b.label}`)
      receipt.offerUndo("join them again", () => {
        writes.run(receipt, () => rejoin(receipt, a, b))
      })
      void refreshTotals()
      render()
      setStatus(`parted ${a.label} and ${b.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      receipt.settle("warn", reason)
      setStatus(`⚠ ${reason}`, "error")
    }
  })
}

/** Take a parted edge off the map. The store has already dropped it. */
function partOnMap(a: string, b: string): void {
  // Unlink and lower the degrees together. `missing` is degree minus the edges loaded, so
  // unlinking without both decrements makes a finished node claim graph that is gone. See
  // World.unlink.
  world.unlink(a, b)
  world.lowerDegree(a)
  world.lowerDegree(b)
  view.drop([], [[a, b]])
  // `drop` does not run this, and it is the only thing that takes down a ghost whose target
  // has stopped being a neighbour. Without it the ghost and its dashed lead stand until the
  // next camera settle, naming an edge this write has just removed.
  view.reviseGhosts()
}

/** Draw a join the store has taken. The mirror of `partOnMap`, and shared with the drag. */
function joinOnMap(a: string, b: string): void {
  // Raise the degrees and link together, the mirror of parting above. See World.bumpDegree.
  world.bumpDegree(a)
  world.bumpDegree(b)
  if (world.linkExisting(a, b)) view.add([], [[a, b]])
  // The mirror of the ghost pass in `partOnMap`. The far end is a neighbour again, and an
  // off-screen one gets its ghost back now instead of on the next settle.
  view.reviseGhosts()
}

/** Join the pair again, from the receipt's undo. */
async function rejoin(receipt: Receipt, a: NodeMeta, b: NodeMeta): Promise<void> {
  try {
    await joinNodes(a.id, b.id)
    joinOnMap(a.id, b.id)

    receipt.settle("undone", `joined ${a.label} and ${b.label} again`)
    void refreshTotals()
    render()
    setStatus(`undid parting ${a.label} and ${b.label}`, "idle")
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    receipt.settle("warn", reason)
    setStatus(`⚠ ${reason}`, "error")
  }
}

/**
 * Join two nodes named by a drag on the map: the store write, then the map, then the way back.
 *
 * Nothing is checked here first. A pair the graph already holds is the store's to refuse, and
 * the receipt is where its sentence lands. A node aimed at itself never reaches here. The
 * gesture reads a release on its own source as naming one node, not a pair.
 */
function joinPair(a: WorldNode, b: WorldNode): void {
  const receipt = writes.open()
  receipt.el.textContent = `${a.label} — ${b.label}`
  writes.run(receipt, async () => {
    try {
      await joinNodes(a.id, b.id)
      joinOnMap(a.id, b.id)

      receipt.settle("ok", `joined ${a.label} and ${b.label}`)
      receipt.offerUndo("part them again", () => {
        writes.run(receipt, () => unjoin(receipt, a, b))
      })
      void refreshTotals()
      render()
      setStatus(`joined ${a.label} and ${b.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      receipt.settle("warn", reason)
      setStatus(`⚠ ${reason}`, "error")
    }
  })
}

/** Part the pair again, from the receipt's undo. The mirror of `rejoin`. */
async function unjoin(receipt: Receipt, a: NodeMeta, b: NodeMeta): Promise<void> {
  try {
    await unjoinNodes(a.id, b.id)
    partOnMap(a.id, b.id)

    receipt.settle("undone", `parted ${a.label} and ${b.label} again`)
    void refreshTotals()
    render()
    setStatus(`undid joining ${a.label} and ${b.label}`, "idle")
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    receipt.settle("warn", reason)
    setStatus(`⚠ ${reason}`, "error")
  }
}

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
  }
  // From here on this is the named-destination path, and the glide separates it from a click.
  // Somebody who names a node is asking to be taken there; somebody who clicks one can already
  // see it. Read it now rather than on the settle at the far end. Named whether or not it had to
  // be placed — a hit already on the map is still being arrived at, and the glide alone would
  // leave the centre behind on the node the reader came from. `becomeCentre` is what repaints,
  // so nothing here needs to: a destination that is already the centre has nothing to repaint.
  explorer.prefetch(node.id)
  becomeCentre(node.id)
  view.focus(node.id)
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
      // A removed node may have been the centre, and nothing else will ask. Without this the
      // HUD would go on naming something that is gone.
      if (gone.length) claimCentre()
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

  // The arrow keys below pan the camera. Inside an input they belong to the text — but a
  // checkbox holds no text, and the one in the HUD keeps the focus after it is ticked, so
  // catching every input here would cost the keyboard the map for the rest of the session.
  if (event.target instanceof HTMLInputElement && event.target.type !== "checkbox") return

  // `/` moves focus to the name input. It is the only part of the page a hand on the
  // keyboard cannot otherwise reach. After the guard above, so a slash typed into an input
  // stays a slash. Not with a modifier held, which belongs to the browser.
  if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    panel.focus()
    return
  }

  // The guide holds the list of keys, so it needs one way in that is not that list. Every
  // other way out of a popover — Escape, a click outside — is the browser's.
  if (event.key === "?") {
    event.preventDefault()
    guide.togglePopover()
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
 * Pull the island drawer out, and push it back.
 *
 * `aria-expanded` holds the state. CSS reads it as well as a screen reader, so the state lives
 * in one place instead of also being a class. app.css slides the panel; nothing here measures
 * or positions it.
 */
railTab.addEventListener("click", () => {
  const out = railTab.getAttribute("aria-expanded") === "true"
  railTab.setAttribute("aria-expanded", String(!out))
  setRailOut(!out)
})

// The markup ships shut, so this only ever opens it. Same shape as `walkToggle.checked` below:
// the attribute is the state, and storage only says what an earlier session left.
if (railOut()) railTab.setAttribute("aria-expanded", "true")

/**
 * The switch that hands the centre to the camera, and back.
 *
 * The box's own checkedness is the state, as `aria-expanded` is above — CSS reads it for the
 * two captions that stop being true, and storage only mirrors it. The markup ships unticked,
 * so this is also what applies a setting left on in an earlier session.
 */
walkToggle.checked = walkByPan()

walkToggle.addEventListener("change", () => {
  setWalkByPan(walkToggle.checked)

  // Nothing to undo going the other way, and that is the honest answer rather than an
  // oversight: a seat is permanent, so what the panning placed stays placed, and the centre
  // keeps whatever the last frame gave it. Off means the camera stops naming one, not that an
  // earlier centre comes back — nothing recorded one.
  if (!walkToggle.checked) return

  // Applied now rather than on the next pan. The box says the middle names the centre, and a
  // HUD still naming the node that was clicked would be the control appearing to do nothing.
  // `claimCentre` rather than the tracker: one application has no flicker to bias against.
  claimCentre()
})

function renderedCentre(): { x: number; y: number } {
  return { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }
}

onThemeChange((palette) => view.restyle(palette))

// A window that changed shape is not a loss: the centre is wherever it was, whether or not the
// new viewport still shows it. The doorways answer to the shape, and the settle revises those.
// The middle of the screen moves in world coordinates too, so the walk runs here as well for a
// reader who has handed the centre to the camera.
window.addEventListener("resize", () => {
  view.resize()
  walk()
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
