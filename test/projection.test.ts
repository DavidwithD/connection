/**
 * The surface the map draws on, from web/src/projection.ts.
 *
 * Pure arithmetic. Every claim in that file's header is a number this can check.
 */
import { describe, expect, it } from "vitest"

import {
  CURVATURE,
  LIMB,
  bounds,
  horizon,
  marginAngle,
  project,
  radius,
  unproject,
} from "../web/src/projection.js"

/** A radius in screen pixels. Any value works; this one keeps the arithmetic readable. */
const R = 600

describe("radius", () => {
  it("takes the shorter half-span, so the limb stays inside a wide window", () => {
    expect(radius(800, 400, 1)).toBe(400)
    expect(radius(300, 900, 1)).toBe(300)
  })

  it("scales with the curvature", () => {
    expect(radius(400, 400, CURVATURE.max)).toBe(400 * CURVATURE.max)
    expect(radius(400, 400, CURVATURE.min)).toBeCloseTo(400 * CURVATURE.min, 10)
  })
})

describe("project", () => {
  it("leaves the middle of the screen alone", () => {
    expect(project(0, 0, R)).toEqual({ x: 0, y: 0, k: 1 })
  })

  it("moves a node inward, and shrinks it, as it nears the limb", () => {
    const near = project(60, 0, R)
    const far = project(500, 0, R)
    expect(near).not.toBeNull()
    expect(far).not.toBeNull()
    // The drawn position is R·sin(t), which is below the flat offset everywhere but the
    // middle.
    expect(near!.x).toBeLessThan(60)
    expect(far!.x).toBeLessThan(500)
    expect(far!.k).toBeLessThan(near!.k)
    expect(near!.k).toBeLessThan(1)
  })

  it("refuses an offset at or past the limb", () => {
    expect(project(R * LIMB, 0, R)).toBeNull()
    expect(project(R * Math.PI, 0, R)).toBeNull()
    // A hair inside it still projects.
    expect(project(R * LIMB - 1, 0, R)).not.toBeNull()
  })

  it("keeps the bearing, so nothing rotates", () => {
    const p = project(300, 400, R)
    expect(p).not.toBeNull()
    expect(p!.y / p!.x).toBeCloseTo(400 / 300, 10)
  })

  it("reports k as the cosine of the angle", () => {
    const p = project(200, 0, R)
    expect(p!.k).toBeCloseTo(Math.cos(200 / R), 10)
  })
})

describe("unproject", () => {
  it("runs project backwards for every offset inside the limb", () => {
    for (const [sx, sy] of [
      [0, 0],
      [1, 0],
      [120, 0],
      [0, -240],
      [300, 400],
      [-500, 120],
    ] as const) {
      const p = project(sx, sy, R)
      expect(p).not.toBeNull()
      const back = unproject(p!.x, p!.y, R)
      expect(back.x).toBeCloseTo(sx, 8)
      expect(back.y).toBeCloseTo(sy, 8)
    }
  })

  it("clamps a cursor outside the disc to the limb, rather than refusing it", () => {
    const far = unproject(R * 5, 0, R)
    expect(far.x).toBeCloseTo(R * (Math.PI / 2), 8)
    expect(far.y).toBe(0)
  })
})

describe("bounds", () => {
  it("is the flat offset at which project starts refusing", () => {
    expect(bounds(R)).toBe(R * LIMB)
    expect(project(bounds(R), 0, R)).toBeNull()
    expect(project(bounds(R) - 1e-6, 0, R)).not.toBeNull()
  })

  it("is a box, so it passes a few nodes project then refuses", () => {
    const corner = bounds(R)
    // The corner of the box is further from the middle than the disc's own edge.
    expect(Math.hypot(corner, corner)).toBeGreaterThan(bounds(R))
    expect(project(corner, corner, R)).toBeNull()
  })
})

describe("horizon", () => {
  it("is the limb while the disc is drawn inside the window", () => {
    const halfW = 800
    const halfH = 400
    expect(horizon(halfW, halfH, radius(halfW, halfH, 1))).toBe(LIMB)
    expect(horizon(halfW, halfH, radius(halfW, halfH, CURVATURE.min))).toBe(LIMB)
  })

  it("falls below the limb once the disc is drawn wider than the window", () => {
    const halfW = 500
    const halfH = 500
    const wide = radius(halfW, halfH, CURVATURE.max)
    const angle = horizon(halfW, halfH, wide)
    expect(angle).toBeLessThan(LIMB)
    // The corner is the last part of the window a node leaves.
    expect(angle).toBeCloseTo(Math.asin(Math.hypot(halfW, halfH) / wide), 10)
  })
})

describe("marginAngle", () => {
  it("turns a length in screen pixels into an angle", () => {
    expect(marginAngle(120, R)).toBeCloseTo(120 / R, 10)
  })

  it("gives the same length different angles on different windows", () => {
    // marginAngle exists because a fixed angle cannot stay wider than a pan step. The same
    // 120px is a different arc on each window.
    const short = marginAngle(120, radius(600, 200, 1))
    const tall = marginAngle(120, radius(600, 900, CURVATURE.max))
    expect(short).toBeGreaterThan(tall * 3)
  })
})
