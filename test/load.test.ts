/**
 * A text file against the store, from web/src/store/load.ts and the seam in index.ts.
 *
 * The property that makes a file editable is the second run. Someone loads a file, edits a
 * line, and loads it again. Every name and pair the first run wrote is met again by the
 * second, and counted as skipped rather than refused.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { emptyGraph } from "./graph.js"
import { MAX_CHARS, loadGraphText, previewGraphText } from "../web/src/store/index.js"
import { apply, survey, type Progress } from "../web/src/store/load.js"
import { readNode } from "../web/src/store/read.js"
import { parse } from "../web/src/store/text.js"

const FILE = ["# a small graph", "Kavara | Miselin | Vessarin", "Thorne"].join("\n")

beforeEach(async () => {
  await emptyGraph()
})

describe("previewGraphText", () => {
  it("reads a file into an empty graph as all new", async () => {
    const plan = await previewGraphText(FILE)
    expect(plan.lines).toBe(2)
    expect(plan.faults).toEqual([])
    expect(plan.fresh).toEqual(["Kavara", "Miselin", "Vessarin", "Thorne"])
    expect(plan.joins).toEqual([
      ["Kavara", "Miselin"],
      ["Kavara", "Vessarin"],
    ])
    expect(plan.joined).toBe(0)
  })

  it("writes nothing", async () => {
    await previewGraphText(FILE)
    expect(await readNode("kavara")).toBeNull()
  })

  it("reports the faults and plans nothing at all", async () => {
    const plan = await previewGraphText("Kavara | Kavara")
    expect(plan.faults).toHaveLength(1)
    expect(plan.fresh).toEqual([])
    expect(plan.joins).toEqual([])
  })

  it("counts what a second load would skip", async () => {
    await loadGraphText(FILE)
    const plan = await previewGraphText(FILE)
    expect(plan.fresh).toEqual([])
    expect(plan.joins).toEqual([])
    expect(plan.joined).toBe(2)
  })

  it("sees the names the graph already holds, whatever case the file spells them", async () => {
    await loadGraphText("Kavara")
    const plan = await previewGraphText("KAVARA | Miselin")
    expect(plan.fresh).toEqual(["Miselin"])
  })
})

describe("loadGraphText", () => {
  it("creates the nodes and joins the pairs", async () => {
    expect(await loadGraphText(FILE)).toEqual({ created: 4, joined: 2 })
    expect(await readNode("kavara")).toEqual({ id: "kavara", label: "Kavara", degree: 2 })
    expect(await readNode("thorne")).toEqual({ id: "thorne", label: "Thorne", degree: 0 })
  })

  it("writes nothing on the second run of the same file", async () => {
    await loadGraphText(FILE)
    expect(await loadGraphText(FILE)).toEqual({ created: 0, joined: 0 })
  })

  it("adds only what an edited file changed", async () => {
    await loadGraphText(FILE)
    const edited = [FILE, "Thorne | Ashanlin"].join("\n")
    expect(await loadGraphText(edited)).toEqual({ created: 1, joined: 1 })
    expect((await readNode("thorne"))?.degree).toBe(1)
  })

  it("keeps the spelling the graph already has", async () => {
    await loadGraphText("Kavara")
    await loadGraphText("kavara | Miselin")
    expect((await readNode("kavara"))?.label).toBe("Kavara")
  })

  it("refuses a file with a fault, and writes none of it", async () => {
    await expect(loadGraphText("Kavara | Miselin\nVessarin | Vessarin")).rejects.toThrow(
      "1 fault(s)",
    )
    expect(await readNode("kavara")).toBeNull()
  })

  it("refuses a file past the character limit", async () => {
    await expect(loadGraphText("a".repeat(MAX_CHARS + 1))).rejects.toThrow(
      `over ${String(MAX_CHARS)} characters`,
    )
  })

  it("reads a file at the character limit", async () => {
    const padding = "#".repeat(MAX_CHARS - "Kavara\n".length)
    expect(await loadGraphText(`Kavara\n${padding}`)).toEqual({ created: 1, joined: 0 })
  })
})

describe("apply", () => {
  it("reports its position through every name and every pair", async () => {
    const steps: [number, number, string][] = []
    const progress: Progress = (done, total, what) => steps.push([done, total, what])

    await apply(await survey(parse(FILE)), progress)

    expect(steps.filter(([, , what]) => what === "name")).toEqual([
      [1, 4, "name"],
      [2, 4, "name"],
      [3, 4, "name"],
      [4, 4, "name"],
    ])
    expect(steps.filter(([, , what]) => what === "pair")).toEqual([
      [1, 2, "pair"],
      [2, 2, "pair"],
    ])
  })

  it("writes the nodes before the pairs, so an edge always has both ends", async () => {
    const order: string[] = []
    await apply(await survey(parse(FILE)), (_done, _total, what) => order.push(what))
    expect(order).toEqual(["name", "name", "name", "name", "pair", "pair"])
  })
})

describe("survey", () => {
  it("describes one state of the graph, before anything is written", async () => {
    await loadGraphText("Kavara | Miselin")
    const plan = await survey(parse("Kavara | Miselin | Vessarin"))
    expect(plan.fresh).toEqual(["Vessarin"])
    expect(plan.joined).toBe(1)
    expect(plan.joins).toEqual([["Kavara", "Vessarin"]])
    expect(plan.known.get("kavara")?.label).toBe("Kavara")
  })

  it("plans nothing for an empty file", async () => {
    const plan = await survey(parse(""))
    expect(plan).toEqual({ fresh: [], known: new Map(), joins: [], joined: 0 })
  })
})
