/**
 * The node list page: every node in the store, with search, a date filter, three orders and
 * paging. Open a row to see its neighbours, and click a neighbour to walk to it.
 *
 * Walking is what this page has that the map does not. A neighbour on the page opens in
 * place. A neighbour that is not on the page opens as a card over the row it came from. The
 * cards stack, so the way back stays on screen. The map travels instead: it moves the camera,
 * and where you were leaves the screen.
 *
 * Each row can rename, delete or join its node too. Search, order and paging still only
 * read. ADR 0047 is why this page took writes it used to leave to the map.
 */
import {
  MAX_LIST_NODES,
  Missing,
  deleteNodeWithEdges,
  fetchNeighbourhood,
  joinNodes,
  persist,
  readAllNodes,
  renameNode,
  whenEvicted,
} from "./store/index.js"
import type { NodeMeta, NodeRow } from "./store/index.js"
import { priced, deleted } from "./labels.js"
import { RenameBox } from "./rename-box.js"
import { normaliseLabel } from "./store/keys.js"
import { MAX_EDGES_PER_NODE } from "./store/read.js"
import {
  backTo as backFrom,
  owner as ownerOf,
  pageCount as countPages,
  pageHolding,
  pageOf,
  select,
  walkTo,
  type Controls,
  type Order,
  type Walk,
} from "./node-list.js"

/** One hue per depth of the stack, so each card is its own colour. */
const HUES = [24, 190, 265, 95, 330, 45]

/** How long typing has to stop before the search runs. */
const TYPING_MS = 150

interface State extends Controls, Walk {
  /** Every node, read once at boot. */
  all: NodeRow[]
  size: number
  page: number
  /** Neighbours of whatever is expanded now: the open row, or the last card in the stack. */
  sub: NodeMeta[]
  /** Which node `sub` belongs to. A sublist is never drawn under another node's name. */
  subOf: string | null
  reading: boolean
  note: string
  /** The row showing an inline edit or join box, or null when no row is. */
  action: { id: string; kind: "edit" | "join" } | null
}

const state: State = {
  all: [],
  query: "",
  from: null,
  to: null,
  order: "label",
  seed: 1,
  size: 50,
  page: 0,
  open: null,
  trail: [],
  sub: [],
  subOf: null,
  reading: false,
  note: "",
  action: null,
}

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element: #${id}`)
  return found as T
}

const view = el<HTMLElement>("list-view")
const status = el<HTMLElement>("list-status")
const readout = el<HTMLElement>("list-read")
const pageLabel = el<HTMLElement>("list-page")
const search = el<HTMLInputElement>("list-search")
const from = el<HTMLInputElement>("list-from")
const to = el<HTMLInputElement>("list-to")
const order = el<HTMLSelectElement>("list-order")
const size = el<HTMLSelectElement>("list-size")
const shuffle = el<HTMLButtonElement>("list-shuffle")
const clear = el<HTMLButtonElement>("list-clear")
const prev = el<HTMLButtonElement>("list-prev")
const next = el<HTMLButtonElement>("list-next")

// ----------------------------------------------------------------- what to show

const DAY = 86_400_000

/**
 * The rows the controls let through, kept until a control changes.
 *
 * `select` walks the whole list, and a render asks for the rows several times. The key is
 * every control that feeds it.
 */
let cache: { key: string; rows: NodeRow[] } | null = null

function matched(): NodeRow[] {
  const key = [state.query, state.from, state.to, state.order, state.seed].join(" ")
  if (cache && cache.key === key) return cache.rows
  const rows = select(state.all, state)
  cache = { key, rows }
  return rows
}

const pageCount = (): number => countPages(matched().length, state.size)

/** The rows on the page you are looking at. */
const shown = (): NodeRow[] => pageOf(matched(), state.page, state.size)

/** Move to the page holding `node`, or say that the controls have hidden it. */
function reveal(node: NodeMeta): void {
  const at = pageHolding(matched(), node.id, state.size)
  if (at === null) {
    state.open = null
    state.note = `${node.label} is not in what the controls let through`
    return
  }
  state.page = at
  state.open = node.id
}

/** Close a row the current page no longer holds. */
function dropOpen(): void {
  if (state.open && !shown().some((row) => row.id === state.open)) {
    state.open = null
    state.sub = []
  }
}

/** After a control changes: back to the first page, and close a row that has gone. */
function refilter(): void {
  cache = null
  state.page = 0
  owed = 0
  dropOpen()
  render()
}

// ------------------------------------------------------------------- the scroll

/**
 * Where the list was when the stack took the view over.
 *
 * The page scrolls the document, and the stack is one line tall. The browser clamps the
 * scroll when the list leaves, so the offset is gone before the list comes back. This holds
 * it.
 *
 * The page number is held with it. `reveal` can come back on another page, and an offset
 * from one page means nothing on another.
 */
let parked: { page: number; y: number } | null = null

/**
 * A scroll the next render owes the reader. Nothing else here moves the page.
 *
 * An offset is where the list left off. `"open"` is a row to bring into view, and the render
 * finds it. A row the reader opened may be anywhere on the page, including off the screen.
 */
let owed: number | "open" | null = null

/** The open row's item, as the last render drew it. What `"open"` brings into view. */
let openItem: HTMLElement | null = null

function park(): void {
  parked = { page: state.page, y: window.scrollY }
}

/** Ask the next render for the offset the list left on, or the top if the page moved. */
function resume(): void {
  owed = parked && parked.page === state.page ? parked.y : 0
  parked = null
}

// ------------------------------------------------------------------ reading one

/**
 * Read the neighbours of `node` and show them.
 *
 * The sublist is drawn twice. The first drawing holds one placeholder per neighbour, counted
 * from the node's stored degree. The second holds the names. A placeholder reserves one line,
 * so a sublist of one-line names opens at the height it will keep. A name that wraps takes
 * more, and the rows below it move down by the difference when the read lands.
 *
 * The second drawing replaces the sublist alone. A full render would rebuild every row around
 * it for one list that changed.
 *
 * A ticket guards it. Two clicks in a row start two reads, and the second one owns the screen
 * even if the first one answers last.
 */
let ticket = 0

async function expand(node: NodeMeta): Promise<void> {
  const mine = ++ticket
  state.reading = true
  state.subOf = node.id
  state.sub = []
  state.note = ""
  render()

  try {
    const hood = await fetchNeighbourhood(node.id)
    if (mine !== ticket) return
    state.sub = hood.neighbours
  } catch (err) {
    if (mine !== ticket) return
    state.note =
      err instanceof Missing ? `${node.label} is not in the graph any more` : String(err)
  }
  state.reading = false
  // A note belongs in the status line, and only a full render writes that.
  if (state.note) render()
  else paintSub()
}

// -------------------------------------------------------------- what a click does

/** Click a row. The open row closes; any other row opens. */
async function toggle(node: NodeRow): Promise<void> {
  if (state.open === node.id) {
    state.open = null
    state.sub = []
    render()
    return
  }
  state.open = node.id
  owed = "open"
  await expand(node)
}

/** Click a neighbour. `walkTo` decides where that leaves the page. */
async function step(node: NodeMeta): Promise<void> {
  const wasList = state.trail.length === 0
  Object.assign(state, walkTo(state, node, shown()))
  // The list is about to leave the view. Hold the place the reader had in it.
  if (wasList && state.trail.length) park()
  // The walk stayed in the list. The row it opened can be a screen or two below the one it
  // came from. A walk the reader cannot see reads as a click that did nothing.
  else owed = "open"
  await expand(node)
}

/** Click a card. The first card goes back to the list, on the page that holds it. */
async function backTo(depth: number): Promise<void> {
  const card = state.trail[depth]
  const next = backFrom(state, depth)
  if (!card || next === state) return
  state.trail = next.trail
  if (!next.trail.length) {
    reveal(card)
    resume()
  }
  await expand(card)
}

// ------------------------------------------------------------------ what a write does

/**
 * Rename a row from its inline edit box.
 *
 * A rename can change the node's id. Every place that holds the old id — `state.all`,
 * `state.sub`, `state.trail`, `state.subOf` — is patched to the new one.
 */
async function rename(node: NodeMeta, next: string): Promise<void> {
  try {
    const renamed = await renameNode(node.id, next)
    state.all = state.all.map((row) => (row.id === node.id ? { ...row, ...renamed } : row))
    state.sub = state.sub.map((n) => (n.id === node.id ? { ...n, ...renamed } : n))
    state.trail = state.trail.map((n) => (n.id === node.id ? { ...n, ...renamed } : n))
    if (state.subOf === node.id) state.subOf = renamed.id
    state.action = null
    cache = null
    // `reveal` only moves the page and the open row when the row renamed is the open one.
    // A closed row's rename leaves paging alone, even if the new label moves it off screen.
    state.note = `renamed ${node.label} to ${renamed.label}`
    if (state.open === node.id) reveal(renamed)
    render()
  } catch (err) {
    // A full render would rebuild the box and lose whatever is still typed in it.
    status.textContent = err instanceof Error ? err.message : String(err)
  }
}

/**
 * Delete a row from its armed delete icon.
 *
 * Every place that could hold this id is cleared: the open row, the card trail, the
 * current sublist, and the list itself.
 */
async function remove(node: NodeMeta): Promise<void> {
  const prune = (): void => {
    state.all = state.all.filter((row) => row.id !== node.id)
    state.sub = state.sub.filter((n) => n.id !== node.id)
    if (state.open === node.id) {
      state.open = null
      state.sub = []
    }
    const at = state.trail.findIndex((n) => n.id === node.id)
    if (at >= 0) {
      state.trail = state.trail.slice(0, at)
      if (!state.trail.length) state.open = null
    }
    if (state.action?.id === node.id) state.action = null
    cache = null
  }

  try {
    const { parted } = await deleteNodeWithEdges(node.id)
    const lost = new Set(parted)
    state.all = state.all.map((row) => (lost.has(row.id) ? { ...row, degree: row.degree - 1 } : row))
    prune()
    state.note = deleted(node)
  } catch (err) {
    if (!(err instanceof Missing)) {
      status.textContent = err instanceof Error ? err.message : String(err)
      return
    }
    prune()
    state.note = `${node.label} is not in the graph any more`
  }
  render()
}

/** Join a row to a node picked from its inline name box. */
async function join(node: NodeMeta, target: NodeMeta): Promise<void> {
  try {
    await joinNodes(node.id, target.id)
    const gained = new Set([node.id, target.id])
    state.all = state.all.map((row) => (gained.has(row.id) ? { ...row, degree: row.degree + 1 } : row))
    state.action = null
    state.note = `joined ${node.label} and ${target.label}`
    render()
  } catch (err) {
    // A full render would rebuild the box and lose whatever is still typed in it.
    status.textContent = err instanceof Error ? err.message : String(err)
  }
}

/** Previous page, or next. A new page starts at the top. */
function turn(by: number): void {
  const at = state.page + by
  if (at < 0 || at >= pageCount()) return
  state.page = at
  owed = 0
  dropOpen()
  render()
}

// --------------------------------------------------------------------- drawing

function render(): void {
  view.replaceChildren(state.trail.length ? stack() : rows())

  const total = matched().length
  const counted =
    total === state.all.length
      ? `${String(total)} nodes`
      : `${String(total)} of ${String(state.all.length)} nodes`
  status.textContent = state.note || counted

  pageLabel.textContent = `page ${String(state.page + 1)} of ${String(pageCount())}`
  prev.disabled = state.page === 0
  next.disabled = state.page + 1 >= pageCount()
  shuffle.disabled = state.order !== "random"

  // Last, with the new list in the page. The browser has the height it needs to scroll to.
  // `nearest` leaves a row that already fits on the screen where it is, so a walk to the row
  // below moves nothing. It is the item rather than the row, so the neighbours come with it.
  if (owed === "open") openItem?.scrollIntoView({ block: "nearest" })
  else if (owed !== null) window.scrollTo(0, owed)
  owed = null

  // An inline box is built detached, so its own focus call lands on nothing. Once it is
  // in the page, this is what actually puts the caret in it.
  if (state.action) {
    const input = view.querySelector<HTMLInputElement>(".row-inline input")
    input?.focus()
    input?.select()
  }
}

/** The list. The open row carries its sublist underneath it. */
function rows(): HTMLElement {
  const list = document.createElement("ul")
  list.className = "rows"
  openItem = null

  const page = shown()
  if (!page.length) {
    const empty = document.createElement("li")
    empty.className = "empty"
    empty.textContent = state.all.length ? "nothing matches" : "this browser holds no graph"
    list.append(empty)
    return list
  }

  for (const node of page) {
    const item = document.createElement("li")
    const open = node.id === state.open
    const line = row(node, open ? "▾" : "▸", () => void toggle(node))
    // The date is not drawn. It is here so a drive script can check the date order.
    line.dataset["created"] = new Date(node.created).toISOString().slice(0, 10)
    item.append(line, actions(node))
    if (state.action?.id === node.id) item.append(inline(node))
    if (open) {
      item.append(mount())
      openItem = item
    }
    list.append(item)
  }
  return list
}

/**
 * The stack of cards, on one line.
 *
 * Each card sits further right than the one under it and covers the width to its right. So
 * every card below the top shows as a strip on the left, and that strip is what goes back.
 */
function stack(): DocumentFragment {
  const frame = document.createDocumentFragment()
  const bar = document.createElement("div")
  bar.className = "stack"
  // No rows here, so there is nothing to bring into view.
  openItem = null

  state.trail.forEach((node, depth) => {
    const top = depth === state.trail.length - 1
    const card = document.createElement("button")
    card.type = "button"
    card.className = `card${top ? " top" : ""}`
    card.style.setProperty("--depth", String(depth))
    card.style.setProperty("--hue", String(HUES[depth % HUES.length]))
    card.title = top ? node.label : `back to ${node.label}`
    card.append(text("name", node.label))
    card.addEventListener("click", () => void backTo(depth))
    bar.append(card)
  })

  frame.append(bar, mount())
  return frame
}

/** The sublist on the page now, so a finished read can replace that one and nothing else. */
let mounted: HTMLElement | null = null

function mount(): HTMLElement {
  mounted = sublist()
  return mounted
}

function paintSub(): void {
  if (!mounted?.isConnected) {
    render()
    return
  }
  const fresh = sublist()
  mounted.replaceWith(fresh)
  mounted = fresh
}

/**
 * One placeholder per neighbour the node is about to show.
 *
 * The count is the stored degree, capped the way the store caps the read. It is the height
 * the names will need. A node whose degree disagrees with its edges moves the page by the
 * difference, and that is a fault the transfer page's check reports.
 */
function waiting(list: HTMLElement, holder: NodeMeta | null): HTMLElement {
  const count = Math.max(Math.min(holder?.degree ?? 1, MAX_EDGES_PER_NODE), 1)
  for (let i = 0; i < count; i++) {
    const item = document.createElement("li")
    item.className = "skel"
    const bar = document.createElement("span")
    bar.className = "bar"
    item.append(bar)
    list.append(item)
  }
  list.setAttribute("aria-busy", "true")
  return list
}

/** The neighbours of whatever is expanded. */
function sublist(): HTMLElement {
  const list = document.createElement("ul")
  list.className = "subrows"

  const holder = ownerOf(state, state.all)
  // A stale list belongs to the node clicked before this one. Never draw it under this name.
  if (state.reading || state.subOf !== holder?.id) return waiting(list, holder)
  if (state.note) return one(list, state.note)
  if (!state.sub.length) return one(list, "no neighbours")

  for (const node of state.sub) {
    const item = document.createElement("li")
    item.append(row(node, "·", () => void step(node)), actions(node))
    if (state.action?.id === node.id) item.append(inline(node))
    list.append(item)
  }
  return list
}

function row(node: NodeMeta, mark: string, onClick: () => void): HTMLElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "row"
  button.append(text("mark", mark), text("name", node.label))
  button.addEventListener("click", onClick)
  return button
}

/**
 * Edit, join and delete, for one row. Hidden until the row is hovered or focused
 * (`nodes.css`), so a row at rest shows only its name.
 */
function actions(node: NodeMeta): HTMLElement {
  const box = document.createElement("div")
  box.className = "row-actions"
  box.append(
    iconButton("✎", `edit ${node.label}`, () => {
      state.action = { id: node.id, kind: "edit" }
      render()
    }),
    iconButton("🔗", `join ${node.label} to…`, () => {
      state.action = { id: node.id, kind: "join" }
      render()
    }),
    deleteButton(node),
  )
  return box
}

function iconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "icon"
  button.textContent = glyph
  button.title = label
  button.setAttribute("aria-label", label)
  button.addEventListener("click", onClick)
  return button
}

/**
 * The delete icon. The first click arms it. Its own text becomes the cost `priced` would
 * put in a menu row — this icon has no menu to open first. The second click, within a few
 * seconds, fires the delete. Losing focus cancels the arm.
 *
 * No modal, no undo. This is the single extra click ADR 0024 and ADR 0036 ask for in place
 * of either.
 */
function deleteButton(node: NodeMeta): HTMLButtonElement {
  const ARM_MS = 4000
  const button = document.createElement("button")
  button.type = "button"
  button.className = "icon delete"
  button.textContent = "×"
  button.title = `delete ${node.label}`
  button.setAttribute("aria-label", `delete ${node.label}`)

  let armed = false
  let timer = 0

  const disarm = (): void => {
    armed = false
    window.clearTimeout(timer)
    button.textContent = "×"
    button.title = `delete ${node.label}`
    delete button.dataset["armed"]
  }

  button.addEventListener("click", () => {
    if (!armed) {
      armed = true
      button.textContent = priced(node)
      button.title = "click again to delete"
      button.dataset["armed"] = "true"
      timer = window.setTimeout(disarm, ARM_MS)
      return
    }
    window.clearTimeout(timer)
    void remove(node).finally(disarm)
  })
  button.addEventListener("blur", disarm)
  return button
}

/** The inline box a row's edit or join icon opens. */
function inline(node: NodeMeta): HTMLElement {
  return state.action?.kind === "edit" ? editBox(node) : joinBox(node)
}

/** The rename box. `RenameBox` (`rename-box.ts`) owns the verdict; this just wires it up. */
function editBox(node: NodeMeta): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "row-inline"

  const input = document.createElement("input")
  input.type = "text"
  input.autocomplete = "off"
  input.spellcheck = false
  input.setAttribute("aria-label", `a new name for ${node.label}`)

  const verdict = document.createElement("button")
  verdict.type = "button"
  verdict.className = "verdict"

  const box = new RenameBox(input, verdict, {
    onRename: (next) => void rename(node, next),
    onError: (message) => {
      status.textContent = message
    },
  })
  box.open(node)

  wrap.append(input, verdict)
  return wrap
}

/**
 * The join box: a name typed against the nodes already read at boot, not a store query.
 * `state.all` already holds every node. Matching by prefix in memory is enough here. It
 * does not reuse `Combobox` (`combobox.ts`), which exists for a search that can resolve
 * late.
 */
function joinBox(node: NodeMeta): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "row-inline"

  const input = document.createElement("input")
  input.type = "text"
  input.autocomplete = "off"
  input.spellcheck = false
  input.placeholder = "join to…"
  input.setAttribute("aria-label", `join ${node.label} to`)

  const list = document.createElement("ul")
  list.className = "suggestions"

  let matches: NodeRow[] = []

  const paint = (): void => {
    const needle = normaliseLabel(input.value)
    list.replaceChildren()
    matches = needle
      ? state.all.filter((row) => row.id !== node.id && row.id.startsWith(needle)).slice(0, 6)
      : []
    for (const match of matches) {
      const item = document.createElement("li")
      const pick = document.createElement("button")
      pick.type = "button"
      pick.textContent = match.label
      pick.addEventListener("click", () => void join(node, match))
      item.append(pick)
      list.append(item)
    }
  }

  input.addEventListener("input", paint)
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return
    if (event.key === "Escape") {
      event.preventDefault()
      state.action = null
      render()
    } else if (event.key === "Enter" && matches.length === 1) {
      event.preventDefault()
      const [only] = matches
      if (only) void join(node, only)
    }
  })

  wrap.append(input, list)
  return wrap
}

function text(cls: string, body: string): HTMLElement {
  const span = document.createElement("span")
  span.className = cls
  span.textContent = body
  return span
}

function one(list: HTMLElement, body: string): HTMLElement {
  const item = document.createElement("li")
  item.className = "empty"
  item.textContent = body
  list.append(item)
  return list
}

// -------------------------------------------------------------------- the controls

/** Wait until the typing stops, so a search does not sort the whole list on every key. */
function debounce(run: () => void, ms: number): () => void {
  let timer = 0
  return () => {
    clearTimeout(timer)
    timer = window.setTimeout(run, ms)
  }
}

/** A date box holds "2026-09-01" or nothing. Read it as UTC midnight. */
function dateValue(box: HTMLInputElement, endOfDay: boolean): number | null {
  if (!box.value) return null
  const ms = Date.parse(box.value)
  if (Number.isNaN(ms)) return null
  return endOfDay ? ms + DAY - 1 : ms
}

function wire(): void {
  search.addEventListener(
    "input",
    debounce(() => {
      state.query = search.value
      refilter()
    }, TYPING_MS),
  )

  const dates = (): void => {
    state.from = dateValue(from, false)
    state.to = dateValue(to, true)
    refilter()
  }
  from.addEventListener("change", dates)
  to.addEventListener("change", dates)

  order.addEventListener("change", () => {
    state.order = order.value as Order
    refilter()
  })

  size.addEventListener("change", () => {
    state.size = Number(size.value)
    refilter()
  })

  shuffle.addEventListener("click", () => {
    state.seed = (state.seed + 1) >>> 0
    refilter()
  })

  clear.addEventListener("click", () => {
    search.value = ""
    from.value = ""
    to.value = ""
    order.value = "label"
    state.query = ""
    state.from = null
    state.to = null
    state.order = "label"
    state.trail = []
    state.sub = []
    refilter()
  })

  prev.addEventListener("click", () => {
    turn(-1)
  })
  next.addEventListener("click", () => {
    turn(1)
  })
}

// ------------------------------------------------------------------------- boot

// Ask for persistent storage, as the other two pages do. This page only reads, but a reader
// can arrive here first, and the request costs one call.
void persist()

whenEvicted((reason) => {
  state.note = reason
  render()
})

async function boot(): Promise<void> {
  wire()
  const started = performance.now()
  try {
    state.all = await readAllNodes()
    const took = Math.round(performance.now() - started)
    readout.textContent = state.all.length
      ? `read ${String(state.all.length)} nodes in ${String(took)} ms`
      : ""
    if (state.all.length === MAX_LIST_NODES) {
      state.note = `stopped at ${String(MAX_LIST_NODES)} nodes. The rest are not on this page`
    }
  } catch (err) {
    state.note = err instanceof Error ? err.message : String(err)
  }
  render()
}

void boot()
