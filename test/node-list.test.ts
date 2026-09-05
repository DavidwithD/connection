/**
 * What the node list shows, from web/src/node-list.ts.
 *
 * Two things here are worth holding down. The random order has to survive paging. A roll per
 * name keeps page two from repeating a row of page one, which `Math.random` per render would
 * not. And a click on a neighbour has two outcomes, decided by whether that neighbour is one
 * of the rows on screen. Reading the page cannot tell you which rule fired.
 */
import { describe, expect, it } from "vitest"

import { normaliseLabel } from "../web/src/store/keys.js"
import type { NodeMeta, NodeRow } from "../web/src/store/index.js"
import {
  backTo,
  owner,
  pageCount,
  pageHolding,
  pageOf,
  select,
  walkTo,
  type Controls,
  type Walk,
} from "../web/src/node-list.js"

const DAY = 86_400_000
const JAN = Date.UTC(2026, 0, 1)

/** A row as the page holds one. `day` is days after 2026-01-01. */
const row = (label: string, day = 0, degree = 0): NodeRow => ({
  id: normaliseLabel(label),
  label,
  degree,
  created: JAN + day * DAY,
})

/** Every control at rest: no search, no bounds, by name. */
const idle: Controls = { query: "", from: null, to: null, order: "label", seed: 1 }
const set = (some: Partial<Controls>): Controls => ({ ...idle, ...some })

const labels = (rows: readonly NodeMeta[]): string[] => rows.map((one) => one.label)

const THREE = [row("Kavara", 0), row("Miselin", 2), row("Thorne", 1)]

describe("what the controls select", () => {
  it("matches a name the way the store files it", () => {
    const rows = [row("Old  Mill"), row("Thorne")]
    expect(labels(select(rows, set({ query: "  OLD   mill " })))).toEqual(["Old  Mill"])
  })

  it("matches inside a name, not only at the front", () => {
    expect(labels(select(THREE, set({ query: "isel" })))).toEqual(["Miselin"])
  })

  it("keeps every row for a query that normalises to nothing", () => {
    expect(select(THREE, set({ query: "   " }))).toHaveLength(3)
  })

  it("keeps a row made on the bound, at either end", () => {
    const on = select(THREE, set({ from: JAN + DAY, to: JAN + DAY }))
    expect(labels(on)).toEqual(["Thorne"])
  })

  it("drops a row made a millisecond before the from bound", () => {
    expect(select(THREE, set({ from: JAN + DAY + 1 }))).toHaveLength(1)
  })

  it("leaves an end open when its bound is null", () => {
    expect(select(THREE, set({ from: JAN + DAY }))).toHaveLength(2)
    expect(select(THREE, set({ to: JAN + DAY }))).toHaveLength(2)
  })

  it("orders by name, and by date newest first", () => {
    expect(labels(select(THREE, idle))).toEqual(["Kavara", "Miselin", "Thorne"])
    // Kavara is the oldest and sorts first by name, so the two orders disagree here.
    expect(labels(select(THREE, set({ order: "date" })))).toEqual([
      "Miselin",
      "Thorne",
      "Kavara",
    ])
  })

  it("breaks a tie on the date with the name", () => {
    // Every node a file or a seed wrote shares one date, so this is the ordinary case.
    const same = [row("Thorne"), row("Kavara"), row("Miselin")]
    expect(labels(select(same, set({ order: "date" })))).toEqual([
      "Kavara",
      "Miselin",
      "Thorne",
    ])
  })

  it("gives the same random order for the same seed, and another for the next", () => {
    const once = labels(select(THREE, set({ order: "random", seed: 7 })))
    expect(labels(select(THREE, set({ order: "random", seed: 7 })))).toEqual(once)
    const twenty = [...Array(20)].map((_, i) => row(`Node ${String(i)}`))
    const rolled = labels(select(twenty, set({ order: "random", seed: 1 })))
    const rerolled = labels(select(twenty, set({ order: "random", seed: 2 })))
    expect(rerolled).not.toEqual(rolled)
  })

  it("puts every row on exactly one page of the random order", () => {
    const many = [...Array(25)].map((_, i) => row(`Node ${String(i).padStart(2, "0")}`))
    const rolled = select(many, set({ order: "random", seed: 3 }))
    const paged = [pageOf(rolled, 0, 10), pageOf(rolled, 1, 10), pageOf(rolled, 2, 10)]
    expect(labels(paged.flat()).sort()).toEqual(labels(many).sort())
  })

  it("leaves the rows it was handed in the order they came", () => {
    const given = [...THREE]
    select(given, set({ order: "date" }))
    expect(given).toEqual(THREE)
  })
})

describe("paging", () => {
  it("counts an empty list as one page", () => {
    expect(pageCount(0, 25)).toBe(1)
  })

  it("counts a part page as a page", () => {
    expect(pageCount(50, 25)).toBe(2)
    expect(pageCount(51, 25)).toBe(3)
  })

  it("gives back a short last page, and nothing past the end", () => {
    expect(pageOf(THREE, 1, 2)).toHaveLength(1)
    expect(pageOf(THREE, 4, 2)).toEqual([])
  })

  it("says which page holds a row, and null for one the controls dropped", () => {
    expect(pageHolding(THREE, "thorne", 2)).toBe(1)
    expect(pageHolding(THREE, "kavara", 2)).toBe(0)
    expect(pageHolding(THREE, "vessarin", 2)).toBeNull()
  })
})

describe("where a click on a neighbour leaves the page", () => {
  const list: Walk = { open: "kavara", trail: [] }
  const away: NodeMeta = { id: "vessarin", label: "Vessarin", degree: 3 }

  it("opens a neighbour that is on this page, in place", () => {
    const next = walkTo(list, THREE[1]!, THREE)
    expect(next).toEqual({ open: "miselin", trail: [] })
  })

  it("starts the stack under a neighbour that is not on this page", () => {
    const next = walkTo(list, away, THREE)
    expect(labels(next.trail)).toEqual(["Kavara", "Vessarin"])
  })

  it("starts the stack with the neighbour alone when no row is open", () => {
    const next = walkTo({ open: null, trail: [] }, away, THREE)
    expect(labels(next.trail)).toEqual(["Vessarin"])
  })

  it("puts an unseen neighbour on top of the stack", () => {
    const deep: Walk = { open: "kavara", trail: [THREE[0]!, away] }
    expect(labels(walkTo(deep, THREE[2]!, []).trail)).toEqual([
      "Kavara",
      "Vessarin",
      "Thorne",
    ])
  })

  it("cuts the stack back to a neighbour already in it", () => {
    const deep: Walk = { open: "kavara", trail: [THREE[0]!, away, THREE[2]!] }
    expect(labels(walkTo(deep, away, []).trail)).toEqual(["Kavara", "Vessarin"])
  })
})

describe("where a click on a card leaves the page", () => {
  const deep: Walk = {
    open: "kavara",
    trail: [THREE[0]!, { id: "vessarin", label: "Vessarin", degree: 3 }, THREE[2]!],
  }

  it("goes back to the list on the first card, with that node open", () => {
    expect(backTo(deep, 0)).toEqual({ open: "kavara", trail: [] })
  })

  it("cuts to a card in the middle", () => {
    expect(labels(backTo(deep, 1).trail)).toEqual(["Kavara", "Vessarin"])
  })

  it("does nothing on the top card, which is where the reader is", () => {
    expect(backTo(deep, 2)).toBe(deep)
    expect(backTo(deep, 9)).toBe(deep)
  })
})

describe("whose neighbours belong on screen", () => {
  it("names the top card while the stack is showing", () => {
    const deep: Walk = { open: "kavara", trail: [THREE[0]!, THREE[2]!] }
    expect(owner(deep, THREE)?.label).toBe("Thorne")
  })

  it("names the open row while the list is showing", () => {
    expect(owner({ open: "miselin", trail: [] }, THREE)?.label).toBe("Miselin")
  })

  it("names nothing when no row is open", () => {
    expect(owner({ open: null, trail: [] }, THREE)).toBeNull()
  })
})
