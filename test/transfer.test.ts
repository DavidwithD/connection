/**
 * The whole-graph operations, from web/src/store/transfer.ts.
 *
 * `verify` is the one that matters most. It is what the transfer page's **Check the graph**
 * runs, and it is the only thing that reads a record's `label` against its own key. A record
 * failing that check is a node found under one name and shown under another.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { emptyGraph, seed } from "./graph.js"
import type { StoredEdge, StoredNode } from "../web/src/store/db.js"
import { readIslandCount, readNode } from "../web/src/store/read.js"
import {
  EXPORT_VERSION,
  buildGraph,
  buildSeed,
  checkGraph,
  exportGraph,
  pairsOf,
  readExport,
  recountIslands,
  replaceGraph,
  verify,
} from "../web/src/store/transfer.js"

/** The date every record in this file carries, where the test does not set its own. */
const MADE = Date.UTC(2026, 0, 1)

/** A consistent two-node graph: one edge, both degrees at one, one component of two. */
const pair = (): { nodes: StoredNode[]; edges: StoredEdge[] } => ({
  nodes: [
    { labelKey: "kavara", label: "Kavara", degree: 1, parent: "kavara", islandSize: 2,
      created: MADE },
    { labelKey: "miselin", label: "Miselin", degree: 1, parent: "kavara", created: MADE },
  ],
  edges: [{ a: "kavara", b: "miselin", ends: ["kavara", "miselin"] }],
})

describe("verify", () => {
  it("finds no fault in a consistent graph", () => {
    const { nodes, edges } = pair()
    expect(verify(nodes, edges)).toEqual([])
  })

  it("finds no fault in a graph the generator built", () => {
    const built = buildSeed({ n: 200, k: 6, p: 0.3, seed: 4, hubs: 4, hubK: 30, islands: 3 })
    expect(built.faults).toEqual([])
    expect(verify(built.nodes, built.edges)).toEqual([])
  })

  it("catches a record filed under a key its own name does not make", () => {
    const { nodes, edges } = pair()
    nodes[0]!.label = "Ashanlin"
    expect(verify(nodes, edges)).toContainEqual(expect.stringContaining("is filed under a key"))
  })

  it("catches a stated degree the edges do not support", () => {
    const { nodes, edges } = pair()
    nodes[0]!.degree = 5
    expect(verify(nodes, edges)).toContainEqual(expect.stringContaining("states degree 5"))
  })

  it("catches an edge naming a node that is not there", () => {
    const { nodes } = pair()
    const edges: StoredEdge[] = [{ a: "kavara", b: "nobody", ends: ["kavara", "nobody"] }]
    expect(verify(nodes, edges)).toContainEqual(expect.stringContaining("which is not here"))
  })

  it("catches an edge whose ends disagree with its own key", () => {
    const { nodes, edges } = pair()
    edges[0]!.ends = ["miselin", "kavara"]
    expect(verify(nodes, edges)).toContainEqual(
      expect.stringContaining("ends that are not its key"),
    )
  })

  it("catches an edge stored out of canonical order", () => {
    const { nodes } = pair()
    const edges: StoredEdge[] = [{ a: "miselin", b: "kavara", ends: ["miselin", "kavara"] }]
    expect(verify(nodes, edges)).toContainEqual(
      expect.stringContaining("not in canonical order"),
    )
  })

  it("catches a root that counts the wrong number of nodes", () => {
    const { nodes, edges } = pair()
    nodes[0]!.islandSize = 9
    expect(verify(nodes, edges)).toContainEqual(expect.stringContaining("a root counts 9"))
  })

  it("catches a node that is not a root and still counts an island", () => {
    const { nodes, edges } = pair()
    nodes[1]!.islandSize = 1
    expect(verify(nodes, edges)).toContainEqual(
      expect.stringContaining("is not a root and still counts"),
    )
  })

  it("catches a pointer leading to a node the graph has lost", () => {
    const { nodes, edges } = pair()
    nodes[1]!.parent = "nobody"
    expect(verify(nodes, edges)).toContainEqual(expect.stringContaining("which is not here"))
  })

  it("collects every fault rather than stopping at the first", () => {
    const { nodes, edges } = pair()
    nodes[0]!.degree = 7
    nodes[1]!.label = "Ashanlin"
    expect(verify(nodes, edges).length).toBeGreaterThan(1)
  })
})

describe("pairsOf", () => {
  it("reduces each edge record to its two ends", () => {
    expect(pairsOf(pair().edges)).toEqual([["kavara", "miselin"]])
  })
})

describe("buildGraph", () => {
  it("stamps the components of the graph it was given", () => {
    const built = buildGraph(
      [{ label: "Kavara" }, { label: "Miselin" }, { label: "Thorne" }],
      [["kavara", "miselin"]],
    )
    expect(built.faults).toEqual([])
    expect(verify(built.nodes, built.edges)).toEqual([])
    const roots = built.nodes.filter((node) => node.islandSize !== undefined)
    expect(roots.map((node) => node.islandSize).sort()).toEqual([1, 2])
  })

  it("counts the degrees from the edges it kept, never from the file", () => {
    const built = buildGraph([{ label: "Kavara" }], [["kavara", "nobody"]])
    expect(built.edges).toEqual([])
    expect(built.nodes[0]?.degree).toBe(0)
  })

  it("reports two nodes under one name", () => {
    const built = buildGraph([{ label: "Kavara" }, { label: "KAVARA" }], [])
    expect(built.faults).toEqual(['two nodes are called "KAVARA"'])
  })

  it("reports a node with no usable name", () => {
    expect(buildGraph([{ label: "   " }], []).faults).toEqual(["a node has no usable name"])
  })

  it("gives every node in one file the same date", () => {
    const built = buildGraph(
      [{ label: "Kavara" }, { label: "Miselin" }],
      [["kavara", "miselin"]],
    )
    expect(typeof built.nodes[0]?.created).toBe("number")
    expect(new Set(built.nodes.map((node) => node.created)).size).toBe(1)
  })
})

describe("readExport", () => {
  it("reads a file of the version it writes", () => {
    const { nodes, edges } = pair()
    const read = readExport({ version: EXPORT_VERSION, nodes, edges })
    expect(read.faults).toEqual([])
    expect(read.nodes).toHaveLength(2)
    expect(read.edges).toHaveLength(1)
  })

  it("refuses a file of another version whole", () => {
    const read = readExport({ version: 1, nodes: [], edges: [] })
    expect(read.faults).toHaveLength(1)
    expect(read.faults[0]).toContain("that file says 1")
    expect(read.nodes).toEqual([])
  })

  it("refuses anything that is not a graph", () => {
    expect(readExport(null).faults).toHaveLength(1)
    expect(readExport("a string").faults).toHaveLength(1)
  })

  it("dates a file written before the record carried a date", () => {
    const { nodes, edges } = pair()
    const undated = nodes.map(({ created: _gone, ...rest }) => rest)
    const read = readExport({ version: EXPORT_VERSION, nodes: undated, edges })
    expect(read.faults).toEqual([])
    expect(read.nodes.every((node) => typeof node.created === "number")).toBe(true)
    // They arrive together, so they take one date: the moment of the load.
    expect(new Set(read.nodes.map((node) => node.created)).size).toBe(1)
  })

  it("refuses a file whose date is not a number", () => {
    const { nodes, edges } = pair()
    const wrong = nodes.map((node) => ({ ...node, created: "yesterday" }))
    const read = readExport({ version: EXPORT_VERSION, nodes: wrong, edges })
    expect(read.faults[0]).toContain("created that is not a number")
    expect(read.nodes).toEqual([])
  })

  it("checks the shape before asking whether the graph is consistent", () => {
    // `verify` reads fields such as `edge.ends[0]`, and a hand-edited file may not have them.
    const read = readExport({
      version: EXPORT_VERSION,
      nodes: [{ labelKey: "kavara" }],
      edges: [],
    })
    expect(read.faults.length).toBeGreaterThan(0)
    expect(read.nodes).toEqual([])
  })
})

describe("against the store", () => {
  beforeEach(async () => {
    await emptyGraph()
  })

  it("exports what the graph holds, and nothing about when it was written", async () => {
    await seed(["Kavara | Miselin", "Thorne"])
    const file = await exportGraph()
    expect(file.version).toBe(EXPORT_VERSION)
    expect(file.counts).toEqual({ nodes: 3, edges: 1 })
    expect(verify(file.nodes, file.edges)).toEqual([])
  })

  it("takes a graph back in as the graph that went out", async () => {
    await seed(["Kavara | Miselin | Vessarin", "Thorne"])
    const file = await exportGraph()

    await emptyGraph()
    expect((await checkGraph()).nodes).toBe(0)

    const read = readExport(JSON.parse(JSON.stringify(file)) as unknown)
    expect(read.faults).toEqual([])
    await replaceGraph(read.nodes, read.edges)

    const checked = await checkGraph()
    expect(checked.faults).toEqual([])
    expect(checked.nodes).toBe(4)
    expect(checked.edges).toBe(2)
    expect(checked.islands).toBe(2)
  })

  it("replaces the whole graph rather than adding to it", async () => {
    await seed(["Kavara | Miselin"])
    const { nodes, edges } = pair()
    await replaceGraph(
      [
        { labelKey: "thorne", label: "Thorne", degree: 0, parent: "thorne", islandSize: 1,
          created: MADE },
      ],
      [],
    )
    expect(await readNode("kavara")).toBeNull()
    expect(await readNode("thorne")).not.toBeNull()
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
  })

  it("rebuilds an island index somebody has broken", async () => {
    await seed(["Kavara | Miselin | Vessarin", "Thorne"])
    const file = await exportGraph()

    // Two components, and every record claiming to be a root of one node.
    await replaceGraph(
      file.nodes.map((node) => ({ ...node, parent: node.labelKey, islandSize: 1 })),
      file.edges,
    )
    expect((await checkGraph()).faults.length).toBeGreaterThan(0)

    const repair = await recountIslands()
    expect(repair.islands).toBe(2)
    expect(repair.changed).toBeGreaterThan(0)
    expect((await checkGraph()).faults).toEqual([])
    expect(await readIslandCount()).toBe(2)
  })

  it("writes nothing on a recount of a graph that is already right", async () => {
    await seed(["Kavara | Miselin", "Thorne"])
    expect(await recountIslands()).toEqual({ islands: 2, changed: 0 })
  })

  it("counts a graph with no nodes as no islands", async () => {
    expect(await checkGraph()).toEqual({ faults: [], nodes: 0, edges: 0, islands: 0 })
  })
})
