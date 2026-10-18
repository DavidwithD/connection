/**
 * Placement geometry and the spatial index, from web/src/placement.ts.
 *
 * The invariants here are the ones a reader cannot check by looking. Two nodes a pixel apart
 * look wrong; two nodes four pixels inside the separation look fine and are still a bug.
 */
import { describe, expect, it } from "vitest"

import {
  NODE_SIZE,
  Occupancy,
  NODE_SEP,
  SQUEEZE_SEP,
  distance,
  minSpacing,
  boxesAround,
  circleSlots,
  rotationFor,
  freeSpots,
  touches,
  type Point,
  type Slot,
} from "../web/src/placement.js"

/** A name box, at the size the renderer measures for an average label. */
const SLOT: Slot = { w: 120, h: 34 }

const origin: Point = { x: 0, y: 0 }

describe("Occupancy", () => {
  it("reports a spot taken while another node is inside the separation", () => {
    const grid = new Occupancy()
    grid.add({ id: "a", x: 0, y: 0 })
    expect(grid.isClear(NODE_SEP - 1, 0)).toBe(false)
    expect(grid.isClear(NODE_SEP + 1, 0)).toBe(true)
  })

  it("finds a neighbour across a cell boundary", () => {
    // The grid is keyed by cell, so a node just over a boundary is in a different bucket.
    const grid = new Occupancy(10)
    grid.add({ id: "a", x: 9, y: 9 })
    expect(grid.isClear(11, 11, 20)).toBe(false)
  })

  it("frees the spot when a node is removed", () => {
    const grid = new Occupancy()
    grid.add({ id: "a", x: 0, y: 0 })
    expect(grid.isClear(10, 10)).toBe(false)
    grid.remove("a")
    expect(grid.isClear(10, 10)).toBe(true)
  })

  it("ignores a removal of a node it never held", () => {
    const grid = new Occupancy()
    grid.add({ id: "a", x: 0, y: 0 })
    grid.remove("nobody")
    expect(grid.isClear(10, 10)).toBe(false)
  })

  it("returns the nodes inside a circle, not the square it scanned", () => {
    const grid = new Occupancy(50)
    grid.add({ id: "near", x: 40, y: 0 })
    // Inside the scanned square of side 100, and outside the circle of radius 50.
    grid.add({ id: "corner", x: 45, y: 45 })
    const found = grid.within(0, 0, 50).map((p) => p.id)
    expect(found).toEqual(["near"])
  })

  it("finds the closest node, not the first one in a bucket", () => {
    const grid = new Occupancy(50)
    grid.add({ id: "far", x: 300, y: 0 })
    grid.add({ id: "close", x: 120, y: 0 })
    expect(grid.nearest(0, 0, 1000)?.id).toBe("close")
  })

  it("answers null when nothing is within reach", () => {
    const grid = new Occupancy(50)
    grid.add({ id: "far", x: 5000, y: 0 })
    expect(grid.nearest(0, 0, 200)).toBeNull()
  })
})

describe("rotationFor", () => {
  it("gives one angle per id, every time", () => {
    expect(rotationFor("kavara")).toBe(rotationFor("kavara"))
    expect(rotationFor("kavara")).not.toBe(rotationFor("miselin"))
  })

  it("stays inside one turn", () => {
    for (const id of ["", "a", "kavara", "n0042", "Zoë"]) {
      expect(rotationFor(id)).toBeGreaterThanOrEqual(0)
      expect(rotationFor(id)).toBeLessThan(Math.PI * 2)
    }
  })
})

describe("freeSpots", () => {
  it("returns nothing for a count of zero or less", () => {
    expect(freeSpots(origin, 0, new Occupancy(), "a")).toEqual([])
    expect(freeSpots(origin, -3, new Occupancy(), "a")).toEqual([])
  })

  it("spots every node it was asked for, in open space", () => {
    expect(freeSpots(origin, 8, new Occupancy(), "kavara")).toHaveLength(8)
    expect(freeSpots(origin, 40, new Occupancy(), "kavara")).toHaveLength(40)
  })

  it("never spots two nodes closer than the separation", () => {
    for (const count of [2, 5, 12, 40]) {
      const placed = freeSpots(origin, count, new Occupancy(), `seed-${String(count)}`)
      expect(minSpacing(placed)).toBeGreaterThanOrEqual(NODE_SEP)
    }
  })

  it("clears the nodes already in the index", () => {
    const grid = new Occupancy()
    const placed = freeSpots(origin, 6, grid, "first")
    for (const [i, point] of placed.entries()) {
      grid.add({ id: `first-${String(i)}`, ...point })
    }

    const second = freeSpots(origin, 6, grid, "second")
    for (const point of second) {
      expect(grid.isClear(point.x, point.y)).toBe(true)
    }
    expect(minSpacing([...placed, ...second])).toBeGreaterThanOrEqual(NODE_SEP)
  })

  it("takes the same spots for the same seed", () => {
    expect(freeSpots(origin, 7, new Occupancy(), "kavara")).toEqual(
      freeSpots(origin, 7, new Occupancy(), "kavara"),
    )
  })

  it("honours a smaller separation, which is what the second pass asks for", () => {
    const squeezed = freeSpots(origin, 30, new Occupancy(), "hub", SQUEEZE_SEP)
    expect(squeezed).toHaveLength(30)
    expect(minSpacing(squeezed)).toBeGreaterThanOrEqual(SQUEEZE_SEP)
    // A tighter separation fits more nodes on the first ring, so the last free spot is nearer.
    const roomy = freeSpots(origin, 30, new Occupancy(), "hub")
    const reach = (points: Point[]): number =>
      Math.max(...points.map((p) => distance(origin, p)))
    expect(reach(squeezed)).toBeLessThan(reach(roomy))
  })
})

describe("boxesAround", () => {
  it("counts the boxes that fit around a circle", () => {
    expect(boxesAround(1000, 100)).toBe(62)
    expect(boxesAround(104, SLOT.w)).toBe(5)
  })

  it("offers one slot even on a ring too small for a box", () => {
    expect(boxesAround(1, 500)).toBe(1)
  })
})

describe("touches", () => {
  it("compares two boxes, not two points", () => {
    expect(touches({ x: 0, y: 0 }, { x: SLOT.w - 1, y: 0 }, SLOT)).toBe(true)
    expect(touches({ x: 0, y: 0 }, { x: SLOT.w, y: 0 }, SLOT)).toBe(false)
    // Clear on one axis is clear. A box is wider than it is tall, so the axes differ.
    expect(touches({ x: 0, y: 0 }, { x: 10, y: SLOT.h }, SLOT)).toBe(false)
  })
})

describe("circleSlots", () => {
  it("returns nothing for a count of zero or less", () => {
    expect(circleSlots(origin, 0, "a", [], SLOT, 1000)).toEqual([])
  })

  it("hands out slots that do not touch each other", () => {
    for (const count of [2, 4, 9, 18]) {
      const slots = circleSlots(origin, count, `seed-${String(count)}`, [], SLOT, 1200)
      expect(slots.length).toBeGreaterThan(0)
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          expect(touches(slots[i]!, slots[j]!, SLOT)).toBe(false)
        }
      }
    }
  })

  it("clears the slots it was told to avoid", () => {
    // Place one plan's slots, then ask for a second plan around the same parent.
    const first = circleSlots(origin, 6, "first", [], SLOT, 1200)
    const second = circleSlots(origin, 6, "second", first, SLOT, 1200)
    for (const a of second) {
      for (const b of first) expect(touches(a, b, SLOT)).toBe(false)
    }
  })

  it("still offers the first ring when maxRadius is smaller than it", () => {
    // A viewport too small for the first ring is one where every neighbour is off screen.
    // No slot at all would be worse than a slot outside the viewport.
    const slots = circleSlots(origin, 40, "tight", [], SLOT, 0)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.length).toBeLessThanOrEqual(boxesAround(104, SLOT.w))
  })

  it("steps outward for a plan too wide for one ring", () => {
    const many = circleSlots(origin, 30, "wide", [], SLOT, 5000)
    const reach = many.map((p) => distance(origin, p))
    expect(Math.max(...reach)).toBeGreaterThan(Math.min(...reach) + 1)
  })

  it("places a marker in a region freeSpots would refuse", () => {
    // `freeSpots` returns nothing when there is no room. An off-screen marker has to be placeable anyway.
    const crowded = new Occupancy()
    for (let i = 0; i < 400; i++) {
      crowded.add({ id: `n${String(i)}`, x: (i % 20) * 30, y: Math.floor(i / 20) * 30 })
    }
    expect(circleSlots(origin, 3, "marker", [], SLOT, 600).length).toBeGreaterThan(0)
  })
})

describe("minSpacing", () => {
  it("is infinite for fewer than two points", () => {
    expect(minSpacing([])).toBe(Infinity)
    expect(minSpacing([origin])).toBe(Infinity)
  })

  it("finds the closest pair, wherever it sits in the list", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 503, y: 4 },
      { x: 1000, y: 0 },
    ]
    expect(minSpacing(points)).toBeCloseTo(5, 10)
  })
})

describe("the sizes the separations are built from", () => {
  it("keeps NODE_SEP wide enough for two selectedNodes", () => {
    expect(NODE_SEP).toBeGreaterThan(NODE_SIZE.selected)
  })

  it("keeps SQUEEZE_SEP wide enough for an selected beside a neighbour", () => {
    // The worst case is an accent radius against a neighbour radius: 25 + 17 = 42.
    expect(SQUEEZE_SEP).toBeGreaterThan(NODE_SIZE.selected / 2 + NODE_SIZE.neighbour / 2)
    expect(SQUEEZE_SEP).toBeLessThan(NODE_SEP)
  })
})
