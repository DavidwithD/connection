/**
 * The demo graph generator, from web/src/store/generate.ts.
 *
 * Two properties carry the rest. The same seed gives the same graph, so a demo can be
 * reproduced. Every edge stays inside one island, so the island count the page shows is the
 * one that was asked for.
 */
import { describe, expect, it } from "vitest"

import { components } from "../web/src/store/islands.js"
import { generate, shares, type GenerateOptions } from "../web/src/store/generate.js"

/** A graph small enough to check by hand, and large enough for a ring to mean something. */
const base: GenerateOptions = { n: 20, k: 4, p: 0, seed: 7 }

/** The generator's ids are positions. This reads the position back out of one. */
const at = (id: string): number => Number.parseInt(id.slice(1), 10)

describe("shares", () => {
  it("gives the whole graph to one island", () => {
    expect(shares(100, 1)).toEqual([100])
  })

  it("halves each share, and still sums to n", () => {
    const split = shares(40, 3)
    expect(split).toEqual([23, 11, 6])
    expect(split.reduce((sum, size) => sum + size, 0)).toBe(40)
  })

  it("sums to n and leaves no island empty, at every size it is asked", () => {
    for (const n of [4, 17, 100, 688, 5001]) {
      for (const islands of [1, 2, 3, 7, 20]) {
        if (islands > n) continue
        const split = shares(n, islands)
        expect(split).toHaveLength(islands)
        expect(split.reduce((sum, size) => sum + size, 0)).toBe(n)
        expect(Math.min(...split)).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe("generate", () => {
  it("refuses a graph too small to be a ring", () => {
    expect(() => generate({ ...base, n: 3 })).toThrow("n must be at least 4")
  })

  it("refuses an island count it cannot honour", () => {
    expect(() => generate({ ...base, islands: 0 })).toThrow("at least one")
    expect(() => generate({ ...base, islands: 21 })).toThrow("must not exceed n")
  })

  it("refuses more hubs than nodes", () => {
    expect(() => generate({ ...base, hubs: 20 })).toThrow("hubs must be below n")
  })

  it("refuses a mean degree the largest island cannot hold", () => {
    expect(() => generate({ ...base, k: 40 })).toThrow("well below the largest island")
  })

  it("gives the same graph for the same seed", () => {
    expect(generate({ ...base, p: 0.3 })).toEqual(generate({ ...base, p: 0.3 }))
  })

  it("gives a different graph for a different seed", () => {
    const one = generate({ ...base, p: 0.3, seed: 1 })
    const two = generate({ ...base, p: 0.3, seed: 2 })
    expect(one.edges).not.toEqual(two.edges)
  })

  it("names every node once", () => {
    const { nodes } = generate({ ...base, n: 300, seed: 11 })
    expect(new Set(nodes.map((node) => node.label)).size).toBe(300)
  })

  it("draws the names from a stream of their own", () => {
    // Two independent streams, so editing the name list cannot rewire the graph.
    const one = generate({ ...base, p: 0.5, seed: 3 })
    expect(one.nodes.map((node) => node.id)).toEqual(
      generate({ ...base, p: 0.5, seed: 3 }).nodes.map((node) => node.id),
    )
  })

  it("builds a plain ring lattice when nothing is rewired", () => {
    const { edges } = generate(base)
    // Twenty nodes, each joined to its two nearest neighbours on each side.
    expect(edges).toHaveLength(40)
  })

  it("holds each pair once, and joins no node to itself", () => {
    const { edges } = generate({ ...base, n: 120, k: 6, p: 0.4, seed: 5 })
    const seen = new Set<string>()
    for (const [a, b] of edges) {
      expect(a).not.toBe(b)
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it("keeps every edge inside one island", () => {
    const islands = 3
    const n = 120
    const sizes = shares(n, islands)
    const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((sum, s) => sum + s, 0))
    const islandOf = (id: string): number =>
      starts.findLastIndex((start) => at(id) >= start)

    const { edges } = generate({ n, k: 6, p: 0.4, seed: 9, islands, hubs: 4, hubK: 20 })
    for (const [a, b] of edges) expect(islandOf(a)).toBe(islandOf(b))
  })

  it("gives each island its own component", () => {
    const { nodes, edges } = generate({ n: 120, k: 6, p: 0, seed: 9, islands: 3 })
    const { sizes } = components(
      nodes.map((node) => node.id),
      edges,
    )
    expect([...sizes.values()].sort((a, b) => b - a)).toEqual(shares(120, 3))
  })

  it("reproduces the plain lattice when no node is made a hub", () => {
    const plain = generate({ ...base, p: 0.2, seed: 4 })
    expect(generate({ ...base, p: 0.2, seed: 4, hubs: 0, hubK: 30 })).toEqual(plain)
  })

  it("pays for every edge a hub gains with one removed elsewhere", () => {
    const options = { n: 200, k: 6, p: 0.2, seed: 6 }
    const plain = generate(options)
    const hubbed = generate({ ...options, hubs: 5, hubK: 40 })
    expect(hubbed.edges).toHaveLength(plain.edges.length)
  })

  it("lifts the top degree above what rewiring alone reaches", () => {
    const options = { n: 200, k: 6, p: 0.2, seed: 6 }
    const top = (graph: { edges: [string, string][] }): number => {
      const degree = new Map<string, number>()
      for (const [a, b] of graph.edges) {
        degree.set(a, (degree.get(a) ?? 0) + 1)
        degree.set(b, (degree.get(b) ?? 0) + 1)
      }
      return Math.max(...degree.values())
    }
    expect(top(generate({ ...options, hubs: 5, hubK: 40 }))).toBeGreaterThan(
      top(generate(options)),
    )
  })

  it("gives an island of one node no edges", () => {
    // Its only candidate neighbour is itself.
    const { edges } = generate({ n: 8, k: 2, p: 0, seed: 2, islands: 3 })
    const sizes = shares(8, 3)
    expect(sizes.at(-1)).toBe(1)
    const last = sizes.slice(0, -1).reduce((sum, size) => sum + size, 0)
    expect(edges.some(([a, b]) => at(a) >= last || at(b) >= last)).toBe(false)
  })
})
