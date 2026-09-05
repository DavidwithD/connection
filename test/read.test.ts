/**
 * Every read the three pages make, from web/src/store/read.ts.
 *
 * The paging is the part worth testing. `byIsland` is keyed by size and then by name, so no
 * two rows share a key. A page that repeated or skipped a component would be hard to notice
 * on a graph of 267 of them.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { emptyGraph, seed } from "./graph.js"
import { Missing } from "../web/src/store/refused.js"
import {
  decodeCursor,
  fetchIslands,
  readIslandCount,
  readIslandPage,
  readAllNodes,
  readNeighbourhood,
  readNode,
  readOpening,
  searchLabels,
} from "../web/src/store/read.js"

/** Five components, each a different size, so a page order can be checked. */
const FIVE_ISLANDS = [
  "N1 | N2 | N3 | N4 | N5",
  "M1 | M2 | M3 | M4",
  "L1 | L2 | L3",
  "K1 | K2",
  "J1",
]

beforeEach(async () => {
  await emptyGraph()
})

describe("readOpening", () => {
  it("describes an empty graph as having nowhere to start", async () => {
    expect(await readOpening()).toEqual({
      nodeCount: 0,
      edgeCount: 0,
      islands: [],
      islandCursor: null,
      islandCount: 0,
    })
  })

  it("counts the nodes and edges the graph holds", async () => {
    await seed(FIVE_ISLANDS)
    const opening = await readOpening()
    expect(opening.nodeCount).toBe(15)
    expect(opening.edgeCount).toBe(10)
    expect(opening.islandCount).toBe(5)
  })

  it("opens on the largest component", async () => {
    await seed(FIVE_ISLANDS)
    const opening = await readOpening()
    expect(opening.islands[0]?.size).toBe(5)
    expect(opening.islands.map((island) => island.size)).toEqual([5, 4, 3, 2, 1])
  })

  it("returns no cursor while one page holds every component", async () => {
    await seed(FIVE_ISLANDS)
    expect((await readOpening()).islandCursor).toBeNull()
  })
})

describe("readNeighbourhood", () => {
  beforeEach(async () => {
    await seed(["Kavara | Miselin | Vessarin", "Miselin | Thorne"])
  })

  it("returns the node and its neighbours", async () => {
    const found = await readNeighbourhood("kavara")
    expect(found.node).toEqual({ id: "kavara", label: "Kavara", degree: 2 })
    expect(found.neighbours.map((node) => node.id).sort()).toEqual(["miselin", "vessarin"])
  })

  it("gives each neighbour its real degree, not the number loaded", async () => {
    const found = await readNeighbourhood("kavara")
    const miselin = found.neighbours.find((node) => node.id === "miselin")
    // Miselin holds Kavara and Thorne, and only one of the two is in this read.
    expect(miselin?.degree).toBe(2)
  })

  it("reports a node the graph does not hold", async () => {
    await expect(readNeighbourhood("nobody")).rejects.toBeInstanceOf(Missing)
  })

  it("returns a node with no edges and no neighbours", async () => {
    await seed(["Alone"])
    expect((await readNeighbourhood("alone")).neighbours).toEqual([])
  })
})

describe("readNode", () => {
  it("answers with the node", async () => {
    await seed(["Kavara | Miselin"])
    expect(await readNode("kavara")).toEqual({ id: "kavara", label: "Kavara", degree: 1 })
  })

  it("answers with null for a name the graph does not hold", async () => {
    // The one read whose good answer is nothing. It is how the rename box asks if a name
    // is free.
    expect(await readNode("nobody")).toBeNull()
  })
})

describe("readAllNodes", () => {
  it("answers with every node, and the date on each one", async () => {
    await seed(["Kavara | Miselin", "Thorne"])
    const rows = await readAllNodes()
    expect(rows.map((row) => row.id).sort()).toEqual(["kavara", "miselin", "thorne"])
    expect(rows.every((row) => typeof row.created === "number")).toBe(true)
  })

  it("carries the label and the stored degree, as the other reads do", async () => {
    await seed(["Kavara | Miselin"])
    const kavara = (await readAllNodes()).find((row) => row.id === "kavara")
    expect(kavara?.label).toBe("Kavara")
    expect(kavara?.degree).toBe(1)
  })

  it("stops at the limit it is given", async () => {
    await seed(["Kavara", "Miselin", "Thorne"])
    expect(await readAllNodes(2)).toHaveLength(2)
  })

  it("answers with nothing for a graph with no nodes", async () => {
    expect(await readAllNodes()).toEqual([])
  })
})

describe("searchLabels", () => {
  beforeEach(async () => {
    await seed(["Kavara", "Kavarel", "Kavan", "Miselin", "Vessarin"])
  })

  it("finds every name starting with the prefix, in alphabetical order", async () => {
    expect((await searchLabels("kav")).map((node) => node.label)).toEqual([
      "Kavan",
      "Kavara",
      "Kavarel",
    ])
  })

  it("matches whatever case the reader types", async () => {
    expect((await searchLabels("KAVAR")).map((node) => node.label)).toEqual([
      "Kavara",
      "Kavarel",
    ])
  })

  it("matches a whole name as well as a prefix", async () => {
    expect((await searchLabels("Miselin")).map((node) => node.id)).toEqual(["miselin"])
  })

  it("returns nothing for a prefix that normalises to nothing", async () => {
    expect(await searchLabels("   ")).toEqual([])
  })

  it("stops at the limit it is given", async () => {
    expect(await searchLabels("kav", 2)).toHaveLength(2)
  })

  it("returns nothing when no name starts with the prefix", async () => {
    expect(await searchLabels("zzz")).toEqual([])
  })
})

describe("paging the islands", () => {
  beforeEach(async () => {
    await seed(FIVE_ISLANDS)
  })

  it("hands back one page and somewhere to continue from", async () => {
    const page = await readIslandPage(2)
    expect(page.islands.map((island) => island.size)).toEqual([5, 4])
    expect(page.cursor).not.toBeNull()
  })

  it("walks every component once, and no component twice", async () => {
    const seen: string[] = []
    let page = await readIslandPage(2)
    seen.push(...page.islands.map((island) => island.id))

    while (page.cursor) {
      page = await fetchIslands(page.cursor)
      seen.push(...page.islands.map((island) => island.id))
    }

    expect(seen).toHaveLength(await readIslandCount())
    expect(new Set(seen).size).toBe(seen.length)
  })

  it("keeps the pages in descending order of size", async () => {
    const sizes: number[] = []
    let page = await readIslandPage(2)
    sizes.push(...page.islands.map((island) => island.size))
    while (page.cursor) {
      page = await fetchIslands(page.cursor)
      sizes.push(...page.islands.map((island) => island.size))
    }
    expect(sizes).toEqual([5, 4, 3, 2, 1])
  })

  it("closes the cursor on the last page", async () => {
    const page = await readIslandPage(20)
    expect(page.islands).toHaveLength(5)
    expect(page.cursor).toBeNull()
  })
})

describe("the island cursor", () => {
  it("refuses anything readIslandPage did not produce", () => {
    expect(decodeCursor("not base64 at all")).toBeNull()
    expect(decodeCursor(btoa("[1]"))).toBeNull()
    expect(decodeCursor(btoa('["five","kavara"]'))).toBeNull()
  })

  it("carries a name a browser cannot base64 on its own", async () => {
    // `btoa` throws on any character above 255. Names here are not all Latin, so the
    // cursor is encoded through UTF-8 first.
    await seed(["Zoë | Zoé", "Kavara"])
    const page = await readIslandPage(1)
    expect(page.cursor).not.toBeNull()
    expect(decodeCursor(page.cursor!)).not.toBeNull()
  })

  it("returns an empty page for a cursor it cannot read", async () => {
    expect(await fetchIslands("nonsense")).toEqual({ islands: [], cursor: null })
  })
})
