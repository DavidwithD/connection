/**
 * The node list page: every node in the store, with search, a date filter, three orders and
 * paging. Open a row to see its neighbours, and click a neighbour to walk to it.
 *
 * Walking is what this page has that the map does not. A neighbour on the page opens in
 * place. A neighbour that is not on the page opens as a card over the row it came from. The
 * cards stack, so the way back stays on screen. The map travels instead: it moves the camera,
 * and where you were leaves the screen.
 *
 * The page only reads. Every write to the graph happens on the map or the transfer page.
 */
import {
  MAX_LIST_NODES,
  Missing,
  fetchNeighbourhood,
  persist,
  readAllNodes,
  whenEvicted,
} from "./store/index.js"
import type { NodeMeta, NodeRow } from "./store/index.js"
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
  dropOpen()
  render()
}

// ------------------------------------------------------------------ reading one

/**
 * Read the neighbours of `node` and show them.
 *
 * The sublist is drawn twice, and both drawings are the same height. The first holds one
 * placeholder per neighbour, counted from the node's stored degree. The second holds the
 * names. So the sublist opens at the height it will keep, and nothing below it moves when the
 * read lands.
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
  await expand(node)
}

/** Click a neighbour. `walkTo` decides where that leaves the page. */
async function step(node: NodeMeta): Promise<void> {
  Object.assign(state, walkTo(state, node, shown()))
  await expand(node)
}

/** Click a card. The first card goes back to the list, on the page that holds it. */
async function backTo(depth: number): Promise<void> {
  const card = state.trail[depth]
  const next = backFrom(state, depth)
  if (!card || next === state) return
  state.trail = next.trail
  if (!next.trail.length) reveal(card)
  await expand(card)
}

/** Previous page, or next. */
function turn(by: number): void {
  const at = state.page + by
  if (at < 0 || at >= pageCount()) return
  state.page = at
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
}

/** The list. The open row carries its sublist underneath it. */
function rows(): HTMLElement {
  const list = document.createElement("ul")
  list.className = "rows"

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
    item.append(line)
    if (open) item.append(mount())
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
    item.append(row(node, "·", () => void step(node)))
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
