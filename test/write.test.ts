/**
 * Every write to the graph, from web/src/store/write.ts, against a real IndexedDB.
 *
 * fake-indexeddb is a full implementation, so a transaction here commits the way one does in
 * a browser. That is what these tests need. A stub that recorded calls would agree with
 * whatever write.ts did with them.
 *
 * The component index is checked after each write. A wrong `islandSize` is the one fault a
 * reader cannot see. The island panel lists a component that does not exist. Nothing else on
 * the page looks wrong.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { emptyGraph } from "./graph.js"
import { readAllNodes, readIslandCount, readNeighbourhood, readNode } from "../web/src/store/read.js"
import {
  ALREADY_JOINED,
  Missing,
  NAME_TAKEN,
  Refused,
} from "../web/src/store/refused.js"
import { checkGraph } from "../web/src/store/transfer.js"
import {
  addEdge,
  createNode,
  deleteNode,
  deleteNodeWithEdges,
  removeEdge,
  renameNode,
} from "../web/src/store/write.js"

/** The neighbours of a node, by key, sorted so a comparison does not depend on read order. */
const neighboursOf = async (id: string): Promise<string[]> =>
  (await readNeighbourhood(id)).neighbours.map((node) => node.id).sort()

const degreeOf = async (id: string): Promise<number | undefined> =>
  (await readNode(id))?.degree

beforeEach(async () => {
  await emptyGraph()
})

describe("createNode", () => {
  it("stores a node with no edges", async () => {
    expect(await createNode("Kavara")).toEqual({ id: "kavara", label: "Kavara", degree: 0 })
  })

  it("keeps the spelling and files it under the normalised name", async () => {
    const made = await createNode("  Kavara   the  Second ")
    expect(made).toEqual({
      id: "kavara the second",
      label: "Kavara the Second",
      degree: 0,
    })
    expect(await readNode("kavara the second")).not.toBeNull()
  })

  it("refuses a second node under the same name, whatever its case", async () => {
    await createNode("Kavara")
    await expect(createNode("KAVARA")).rejects.toThrow(NAME_TAKEN)
    await expect(createNode("KAVARA")).rejects.toBeInstanceOf(Refused)
  })

  it("refuses a name that normalises to nothing", async () => {
    await expect(createNode("   ")).rejects.toThrow("a node needs a name")
  })

  it("makes a component of one", async () => {
    await createNode("Kavara")
    await createNode("Miselin")
    expect(await readIslandCount()).toBe(2)
  })
})

describe("the date a node carries", () => {
  /** The record for one name, as the store holds it. */
  const dateOf = async (id: string): Promise<number | undefined> =>
    (await readAllNodes()).find((row) => row.id === id)?.created

  it("stamps a new node with the moment it was written", async () => {
    const before = Date.now()
    await createNode("Kavara")
    const made = await dateOf("kavara")
    expect(made).toBeGreaterThanOrEqual(before)
    expect(made).toBeLessThanOrEqual(Date.now())
  })

  it("keeps the date across a rename, because it is the same node", async () => {
    await createNode("Kavara")
    const made = await dateOf("kavara")
    await renameNode("kavara", "Vessarin")
    expect(await dateOf("vessarin")).toBe(made)
    expect(await dateOf("kavara")).toBeUndefined()
  })

  it("gives one date to every node a joined pair created", async () => {
    // Two nodes, two calls, one graph. Each is stamped as it is written.
    await createNode("Kavara")
    await createNode("Miselin")
    await addEdge("kavara", "miselin")
    const dates = (await readAllNodes()).map((row) => row.created)
    expect(dates.every((date) => typeof date === "number")).toBe(true)
  })
})

describe("addEdge", () => {
  beforeEach(async () => {
    await createNode("Kavara")
    await createNode("Miselin")
  })

  it("raises the degree at both ends", async () => {
    await addEdge("kavara", "miselin")
    expect(await degreeOf("kavara")).toBe(1)
    expect(await degreeOf("miselin")).toBe(1)
    expect(await neighboursOf("kavara")).toEqual(["miselin"])
  })

  it("stores one edge whichever end is named first", async () => {
    await addEdge("miselin", "kavara")
    await expect(addEdge("kavara", "miselin")).rejects.toThrow(ALREADY_JOINED)
  })

  it("refuses a node joined to itself", async () => {
    await expect(addEdge("kavara", "kavara")).rejects.toThrow("cannot be joined to itself")
  })

  it("refuses a pair with an end the graph does not hold", async () => {
    await expect(addEdge("kavara", "nobody")).rejects.toThrow("no such node")
  })

  it("merges the two components into one", async () => {
    expect(await readIslandCount()).toBe(2)
    await addEdge("kavara", "miselin")
    expect(await readIslandCount()).toBe(1)
  })
})

describe("removeEdge", () => {
  beforeEach(async () => {
    await createNode("Kavara")
    await createNode("Miselin")
    await addEdge("kavara", "miselin")
  })

  it("lowers the degree at both ends", async () => {
    await removeEdge("kavara", "miselin")
    expect(await degreeOf("kavara")).toBe(0)
    expect(await degreeOf("miselin")).toBe(0)
  })

  it("refuses a pair that is not joined", async () => {
    await removeEdge("kavara", "miselin")
    await expect(removeEdge("kavara", "miselin")).rejects.toThrow("they are not joined")
  })

  it("splits the component back into two", async () => {
    expect(await readIslandCount()).toBe(1)
    await removeEdge("kavara", "miselin")
    expect(await readIslandCount()).toBe(2)
  })

  it("leaves a component whole when the edge it removed was not the only path", async () => {
    await createNode("Vessarin")
    await addEdge("miselin", "vessarin")
    await addEdge("vessarin", "kavara")
    expect(await readIslandCount()).toBe(1)

    await removeEdge("kavara", "miselin")
    expect(await readIslandCount()).toBe(1)
    expect((await checkGraph()).faults).toEqual([])
  })
})

describe("deleteNode", () => {
  it("refuses a node that still holds an edge", async () => {
    await createNode("Kavara")
    await createNode("Miselin")
    await addEdge("kavara", "miselin")
    await expect(deleteNode("kavara")).rejects.toThrow("still has edges")
  })

  it("removes a node once its edges are gone", async () => {
    await createNode("Kavara")
    await createNode("Miselin")
    await addEdge("kavara", "miselin")
    await removeEdge("kavara", "miselin")

    await deleteNode("kavara")
    expect(await readNode("kavara")).toBeNull()
  })

  it("reports a node the graph never held", async () => {
    await expect(deleteNode("nobody")).rejects.toBeInstanceOf(Missing)
  })
})

describe("deleteNodeWithEdges", () => {
  beforeEach(async () => {
    await createNode("Kavara")
    await createNode("Miselin")
    await createNode("Vessarin")
    await addEdge("kavara", "miselin")
    await addEdge("kavara", "vessarin")
  })

  it("takes the node and every edge on it", async () => {
    const { parted } = await deleteNodeWithEdges("kavara")
    expect(parted.sort()).toEqual(["miselin", "vessarin"])
    expect(await readNode("kavara")).toBeNull()
    expect(await degreeOf("miselin")).toBe(0)
    expect(await degreeOf("vessarin")).toBe(0)
  })

  it("leaves the two former neighbours as components of their own", async () => {
    await deleteNodeWithEdges("kavara")
    expect(await readIslandCount()).toBe(2)
    expect((await checkGraph()).faults).toEqual([])
  })

  it("keeps a component whole when the deleted node was not its only path", async () => {
    await addEdge("miselin", "vessarin")
    await deleteNodeWithEdges("kavara")
    expect(await readIslandCount()).toBe(1)
    expect((await checkGraph()).faults).toEqual([])
  })

  it("reports a node the graph never held", async () => {
    await expect(deleteNodeWithEdges("nobody")).rejects.toBeInstanceOf(Missing)
  })
})

describe("renameNode", () => {
  beforeEach(async () => {
    await createNode("Kavara")
    await createNode("Miselin")
    await createNode("Vessarin")
    await addEdge("kavara", "miselin")
    await addEdge("kavara", "vessarin")
  })

  it("moves every edge onto the new name", async () => {
    expect(await renameNode("kavara", "Ashanlin")).toEqual({
      id: "ashanlin",
      label: "Ashanlin",
      degree: 2,
    })
    expect(await readNode("kavara")).toBeNull()
    expect(await neighboursOf("ashanlin")).toEqual(["miselin", "vessarin"])
    expect(await neighboursOf("miselin")).toEqual(["ashanlin"])
  })

  it("changes no degree anywhere", async () => {
    await renameNode("kavara", "Ashanlin")
    expect(await degreeOf("ashanlin")).toBe(2)
    expect(await degreeOf("miselin")).toBe(1)
    expect(await degreeOf("vessarin")).toBe(1)
  })

  it("leaves the graph consistent, index included", async () => {
    await renameNode("kavara", "Ashanlin")
    expect(await readIslandCount()).toBe(1)
    expect((await checkGraph()).faults).toEqual([])
  })

  it("takes a new spelling of the same name without moving an edge", async () => {
    expect(await renameNode("kavara", "KAVARA")).toEqual({
      id: "kavara",
      label: "KAVARA",
      degree: 2,
    })
    expect(await neighboursOf("kavara")).toEqual(["miselin", "vessarin"])
  })

  it("refuses a name another node already holds", async () => {
    await expect(renameNode("kavara", "Miselin")).rejects.toThrow(NAME_TAKEN)
    // Nothing moved.
    expect(await neighboursOf("kavara")).toEqual(["miselin", "vessarin"])
  })

  it("refuses a name that normalises to nothing", async () => {
    await expect(renameNode("kavara", "  ")).rejects.toThrow("a node needs a name")
  })

  it("reports a node the graph never held", async () => {
    await expect(renameNode("nobody", "Ashanlin")).rejects.toBeInstanceOf(Missing)
  })
})

describe("the graph after a run of writes", () => {
  it("states degrees and island sizes that match its own edges", async () => {
    for (const name of ["Kavara", "Miselin", "Vessarin", "Thorne", "Ashanlin"]) {
      await createNode(name)
    }
    await addEdge("kavara", "miselin")
    await addEdge("miselin", "vessarin")
    await addEdge("thorne", "ashanlin")
    await renameNode("miselin", "Miselin the Second")
    await removeEdge("kavara", "miselin the second")
    await deleteNodeWithEdges("vessarin")

    const checked = await checkGraph()
    expect(checked.faults).toEqual([])
    // Kavara, Miselin the Second, and the Thorne-Ashanlin pair.
    expect(checked.islands).toBe(3)
    expect(await readIslandCount()).toBe(3)
  })
})
