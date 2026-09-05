/**
 * What the node list shows, and where a click on a neighbour leaves it.
 *
 * No document and no store. Every function here answers from its arguments, so a test can
 * ask what the page would show without building one. nodes.ts owns the elements, the reads
 * and the drawing.
 *
 * The whole list is held in memory, so these run over an array rather than over an index.
 * `readAllNodes` in the store says why no index answers them.
 */
import { normaliseLabel } from "./store/keys.js"
import type { NodeMeta, NodeRow } from "./store/index.js"

export type Order = "label" | "date" | "random"

/** What the controls are set to. */
export interface Controls {
  /** A name to match, as typed. Empty keeps every row. */
  query: string
  /** Milliseconds. Null for an open end. */
  from: number | null
  to: number | null
  order: Order
  /** Changed by the shuffle button. The random order holds still while it does not. */
  seed: number
}

/** Where the reader is: the row opened in the list, and the stack of cards over it. */
export interface Walk {
  /** The row open in the list, or null when none is. */
  open: string | null
  /** The nodes walked into, first clicked first. Empty means the list is showing. */
  trail: NodeMeta[]
}

/**
 * The rows the controls let through, in the order they ask for.
 *
 * The search matches the key rather than the label. The key is the name with case and
 * spacing normalised, so "Old  Mill" finds the node filed as "old mill".
 *
 * Both date bounds are inclusive. The caller decides what a day means: the page reads its
 * two boxes as the first and last millisecond of a day.
 */
export function select(rows: readonly NodeRow[], controls: Controls): NodeRow[] {
  const needle = normaliseLabel(controls.query)
  const kept = rows.filter((row) => {
    if (needle && !row.id.includes(needle)) return false
    if (controls.from !== null && row.created < controls.from) return false
    if (controls.to !== null && row.created > controls.to) return false
    return true
  })

  if (controls.order === "label") kept.sort((a, b) => a.label.localeCompare(b.label))
  if (controls.order === "date") {
    // The name breaks a tie. Every node a seed or a file wrote carries one date. Without the
    // tiebreak, a whole graph would sit in whatever order the read returned.
    kept.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
  }
  if (controls.order === "random") {
    const roll = new Map(kept.map((row) => [row.id, hash(`${String(controls.seed)} ${row.id}`)]))
    kept.sort((a, b) => (roll.get(a.id) ?? 0) - (roll.get(b.id) ?? 0))
  }
  return kept
}

/** How many pages `total` rows make. An empty list is one empty page. */
export const pageCount = (total: number, size: number): number =>
  Math.max(1, Math.ceil(total / size))

/** One page of rows. A page past the end is empty. */
export function pageOf<T>(rows: readonly T[], page: number, size: number): T[] {
  const start = page * size
  return rows.slice(start, start + size)
}

/** Which page holds `id`, or null when the controls have dropped it. */
export function pageHolding(rows: readonly NodeMeta[], id: string, size: number): number | null {
  const at = rows.findIndex((row) => row.id === id)
  return at < 0 ? null : Math.floor(at / size)
}

/**
 * Where a click on a neighbour leaves the page.
 *
 * From the list, a neighbour that is one of the rows on screen opens in place. The open row
 * closes and its own opens. A neighbour that is not on screen starts the stack, and the row
 * it was clicked from becomes the first card.
 *
 * From the stack, a neighbour already in the stack cuts it back to that card. Anything else
 * goes on top.
 */
export function walkTo(now: Walk, node: NodeMeta, page: readonly NodeMeta[]): Walk {
  if (now.trail.length === 0) {
    if (page.some((row) => row.id === node.id)) return { open: node.id, trail: [] }
    const from = page.find((row) => row.id === now.open)
    return { open: now.open, trail: from ? [from, node] : [node] }
  }

  const at = now.trail.findIndex((card) => card.id === node.id)
  const trail = at >= 0 ? now.trail.slice(0, at + 1) : [...now.trail, node]
  return { open: now.open, trail }
}

/**
 * Where a click on a card leaves the page.
 *
 * The first card goes back to the list, with that node as the open row. A card in the middle
 * cuts the stack back to itself. The top card is where the reader already is, so it does
 * nothing.
 */
export function backTo(now: Walk, depth: number): Walk {
  const card = now.trail[depth]
  if (!card || depth === now.trail.length - 1) return now
  if (depth === 0) return { open: card.id, trail: [] }
  return { open: now.open, trail: now.trail.slice(0, depth + 1) }
}

/** The node whose neighbours belong on screen: the top card, or the open row. */
export function owner(now: Walk, rows: readonly NodeMeta[]): NodeMeta | null {
  if (now.trail.length) return now.trail[now.trail.length - 1] ?? null
  return rows.find((row) => row.id === now.open) ?? null
}

/**
 * FNV-1a, 32 bit.
 *
 * The random order needs a roll per name that survives paging. `Math.random` per row would
 * reshuffle the list on every render, so page two could repeat a row from page one.
 */
export function hash(text: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value >>> 0
}
