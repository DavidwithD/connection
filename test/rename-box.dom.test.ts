/**
 * The box that renames a node, from web/src/rename-box.ts.
 *
 * The row is a verdict on one name. `judge` reads one key and the row reports whether the
 * graph already holds it. The case-only rename is the interesting one: typing `KAVARA` over
 * `Kavara` finds a node, and the row still has to arm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { emptyGraph, seed } from "./graph.js"
import { clearPage, press, renameElements, type } from "./widgets.js"
import { RenameBox } from "../web/src/rename-box.js"
import type { NodeMeta } from "../web/src/store/index.js"

const KAVARA: NodeMeta = { id: "kavara", label: "Kavara", degree: 1 }

/** Build a box over an empty page, and a record of what it asks for. */
function openBox(): {
  box: RenameBox
  input: HTMLInputElement
  row: HTMLButtonElement
  asked: string[]
  errors: string[]
} {
  const { input, row } = renameElements()
  const asked: string[] = []
  const errors: string[] = []
  const box = new RenameBox(input, row, {
    onRename: (next) => asked.push(next),
    onError: (message) => errors.push(message),
  })
  return { box, input, row, asked, errors }
}

/** Wait for the read the box started, and for the row to report on it. */
const settled = (row: HTMLButtonElement, state: string): Promise<void> =>
  vi.waitFor(() => {
    expect(row.dataset["state"]).toBe(state)
  })

beforeEach(async () => {
  await emptyGraph()
  await seed(["Kavara | Miselin"])
})

afterEach(() => {
  clearPage()
})

describe("open", () => {
  it("starts at the name the node already has, selected", () => {
    const { box, input } = openBox()
    box.open(KAVARA)
    expect(input.value).toBe("Kavara")
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe("Kavara".length)
  })

  it("takes the focus", () => {
    const { box, input } = openBox()
    box.open(KAVARA)
    expect(document.activeElement).toBe(input)
  })

  it("offers nothing before anything is typed", () => {
    const { box, row } = openBox()
    box.open(KAVARA)
    expect(row.hidden).toBe(true)
    expect(row.dataset["state"]).toBe("empty")
  })
})

describe("the verdict", () => {
  it("arms on a name the graph does not hold", async () => {
    const { box, input, row } = openBox()
    box.open(KAVARA)
    type(input, "Ashanlin")

    await settled(row, "armed")
    expect(row.hidden).toBe(false)
    expect(row.disabled).toBe(false)
    expect(row.textContent).toBe("↻ update")
  })

  it("refuses a name another node holds", async () => {
    const { box, input, row } = openBox()
    box.open(KAVARA)
    type(input, "Miselin")

    await settled(row, "taken")
    expect(row.textContent).toBe("is taken")
    expect(row.disabled).toBe(true)
  })

  it("arms on a new spelling of the node's own name", async () => {
    // The case-only rename, which the store accepts. A node never blocks itself.
    const { box, input, row } = openBox()
    box.open(KAVARA)
    type(input, "KAVARA")

    await settled(row, "armed")
    expect(row.disabled).toBe(false)
  })

  it("offers nothing for a name that normalises to nothing", async () => {
    const { box, input, row } = openBox()
    box.open(KAVARA)
    type(input, "Ashanlin")
    await settled(row, "armed")

    type(input, "   ")
    await settled(row, "empty")
    expect(row.hidden).toBe(true)
  })

  it("says nothing while the box is closed", async () => {
    const { input, row } = openBox()
    type(input, "Ashanlin")
    await new Promise((done) => setTimeout(done, 20))
    expect(row.dataset["state"]).toBeUndefined()
  })
})

describe("firing the rename", () => {
  it("asks for the typed name on Enter", async () => {
    const { box, input, row, asked } = openBox()
    box.open(KAVARA)
    type(input, "  Ashanlin  ")
    await settled(row, "armed")

    press(input, "Enter")
    expect(asked).toEqual(["Ashanlin"])
  })

  it("asks for it on a click as well", async () => {
    const { box, input, row, asked } = openBox()
    box.open(KAVARA)
    type(input, "Ashanlin")
    await settled(row, "armed")

    row.click()
    expect(asked).toEqual(["Ashanlin"])
  })

  it("does nothing while the name is taken", async () => {
    const { box, input, row, asked } = openBox()
    box.open(KAVARA)
    type(input, "Miselin")
    await settled(row, "taken")

    press(input, "Enter")
    row.click()
    expect(asked).toEqual([])
  })

  it("does nothing before anything is typed", () => {
    const { box, input, asked } = openBox()
    box.open(KAVARA)
    press(input, "Enter")
    expect(asked).toEqual([])
  })

  it("ignores the Enter an IME fires to confirm a conversion", async () => {
    const { box, input, row, asked } = openBox()
    box.open(KAVARA)
    type(input, "Ashanlin")
    await settled(row, "armed")

    press(input, "Enter", { isComposing: true })
    expect(asked).toEqual([])
  })
})

describe("close", () => {
  it("empties the box and takes the row away", async () => {
    const { box, input, row } = openBox()
    box.open(KAVARA)
    type(input, "Ashanlin")
    await settled(row, "armed")

    box.close()
    expect(input.value).toBe("")
    expect(row.hidden).toBe(true)
    expect(row.dataset["state"]).toBe("empty")
  })

  it("discards a verdict still in flight", async () => {
    const { box, input, row } = openBox()
    box.open(KAVARA)
    type(input, "Ashanlin")
    box.close()

    await new Promise((done) => setTimeout(done, 50))
    expect(row.dataset["state"]).toBe("empty")
  })
})
