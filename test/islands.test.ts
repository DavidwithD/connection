/**
 * Connected components, from web/src/store/islands.ts. The two pure functions only.
 *
 * `components` and `stampIslands` derive the whole index from the nodes and edges. They are
 * the repair the incremental path is measured against, so they are the part that has to be
 * right. `settle` and `recount` touch the store and are covered in test/write.test.ts.
 */
import { describe, expect, it } from "vitest"

import type { StoredNode } from "../web/src/store/db.js"
import { components, pickRoot, stampIslands } from "../web/src/store/islands.js"

/** The date every record in this file carries. Nothing here reads it. */
const MADE = Date.UTC(2026, 0, 1)

/** A node record, as a graph written before this index existed would hold it. */
const rec = (id: string, parent: string = id): StoredNode => ({
  labelKey: id,
  label: id,
  degree: 0,
  parent,
  created: MADE,
})

const ids = (nodes: StoredNode[]): string[] => nodes.map((node) => node.labelKey)

describe("components", () => {
  it("puts a lone node in a component of one", () => {
    const { parent, sizes } = components(["a"], [])
    expect(parent.get("a")).toBe("a")
    expect([...sizes.values()]).toEqual([1])
  })

  it("finds two components in two triangles", () => {
    const { parent, sizes } = components(
      ["a", "b", "c", "d", "e", "f"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["d", "e"],
        ["e", "f"],
        ["f", "d"],
      ],
    )
    expect([...sizes.values()].sort()).toEqual([3, 3])
    expect(parent.get("a")).toBe(parent.get("c"))
    expect(parent.get("d")).toBe(parent.get("f"))
    expect(parent.get("a")).not.toBe(parent.get("d"))
  })

  it("flattens every pointer onto a root", () => {
    const chain: [string, string][] = [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "e"],
    ]
    const { parent } = components(["a", "b", "c", "d", "e"], chain)
    for (const id of ["a", "b", "c", "d", "e"]) {
      const root = parent.get(id)!
      expect(parent.get(root)).toBe(root)
    }
  })

  it("ignores an edge naming a node it was not given", () => {
    const { sizes } = components(["a", "b"], [["a", "elsewhere"]])
    expect([...sizes.values()].sort()).toEqual([1, 1])
  })

  it("counts one component for a pair joined twice", () => {
    const { sizes } = components(
      ["a", "b"],
      [
        ["a", "b"],
        ["b", "a"],
      ],
    )
    expect([...sizes.values()]).toEqual([2])
  })
})

describe("pickRoot", () => {
  it("takes the smallest key, so a repeated repair picks the same root", () => {
    expect(pickRoot(["miselin", "kavara", "vessarin"])).toBe("kavara")
    expect(pickRoot(["kavara"])).toBe("kavara")
  })

  it("answers with an empty string for no nodes at all", () => {
    expect(pickRoot([])).toBe("")
  })
})

describe("stampIslands", () => {
  it("gives one root an island size, and takes it off everything else", () => {
    const nodes = [rec("b"), rec("a"), rec("c")]
    const { islands, changed } = stampIslands(nodes, [
      ["a", "b"],
      ["b", "c"],
    ])

    expect(islands).toBe(1)
    expect(changed.length).toBeGreaterThan(0)
    const roots = nodes.filter((node) => node.islandSize !== undefined)
    expect(ids(roots)).toEqual(["a"])
    expect(roots[0]!.islandSize).toBe(3)
    for (const node of nodes) expect(node.parent).toBe("a")
  })

  it("reports no change on a second run over the same graph", () => {
    const nodes = [rec("b"), rec("a"), rec("c")]
    const edges: [string, string][] = [
      ["a", "b"],
      ["b", "c"],
    ]
    stampIslands(nodes, edges)
    expect(stampIslands(nodes, edges).changed).toEqual([])
  })

  it("stamps each component separately", () => {
    const nodes = [rec("a"), rec("b"), rec("c"), rec("d"), rec("e")]
    const { islands } = stampIslands(nodes, [
      ["a", "b"],
      ["d", "e"],
    ])

    expect(islands).toBe(3)
    const sizes = nodes
      .filter((node) => node.islandSize !== undefined)
      .map((node) => node.islandSize)
      .sort()
    expect(sizes).toEqual([1, 2, 2])
  })

  it("takes an island size off a node that is not a root", () => {
    const nodes = [rec("a"), { ...rec("b", "a"), islandSize: 9 }]
    stampIslands(nodes, [["a", "b"]])
    expect(nodes[1]!.islandSize).toBeUndefined()
    expect(nodes[0]!.islandSize).toBe(2)
  })

  it("gives a new root to a subset whose pointers lead outside it", () => {
    // A pointer to a node outside the set leads nowhere. `stored` stops there rather than
    // following it, so the group needs a root of its own.
    const nodes = [rec("b", "elsewhere"), rec("c", "elsewhere")]
    const { islands } = stampIslands(nodes, [["b", "c"]])

    expect(islands).toBe(1)
    const roots = nodes.filter((node) => node.islandSize !== undefined)
    expect(ids(roots)).toEqual(["b"])
    expect(roots[0]!.islandSize).toBe(2)
    expect(nodes[1]!.parent).toBe("b")
  })

  it("keeps a chain that already reaches the right root", () => {
    // `settle` re-points a losing root and leaves the nodes behind it alone. A repair that
    // flattened the chain would report a change after every join.
    const nodes = [
      { ...rec("a"), islandSize: 3 },
      rec("b", "a"),
      rec("c", "b"),
    ]
    const { changed } = stampIslands(nodes, [
      ["a", "b"],
      ["b", "c"],
    ])
    expect(changed).toEqual([])
    expect(nodes[2]!.parent).toBe("b")
  })

  it("reads a graph with no nodes as no islands", () => {
    expect(stampIslands([], [])).toEqual({ islands: 0, changed: [] })
  })
})
