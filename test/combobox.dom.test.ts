/**
 * The box that returns nodes, from web/src/combobox.ts.
 *
 * Five keys, and each one has a rule a typecheck cannot see. ⇧↵ picks the existing node when
 * the typed name is taken. Esc closes the list first and empties the box second. ⌘ modifies
 * both forms of Enter, so the box reads it before either.
 *
 * The store is real here. `searchLabels` is a key range over IndexedDB, so a test that
 * replaced it would stop covering what the box asks for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { emptyGraph, seed } from "./graph.js"
import { clearPage, clickRow, comboboxElements, highlighted, press, rowsIn, type } from "./widgets.js"
import { Combobox, type ComboboxHooks, type Picked } from "../web/src/combobox.js"

/** What a test saw come out of the box. */
interface Picks {
  picked: [Picked, boolean][]
  errors: string[]
  emptied: number
}

/** Build a box over an empty page, and a record of what it hands back. */
function openBox(hooks: Partial<ComboboxHooks> = {}): {
  box: Combobox
  input: HTMLInputElement
  list: HTMLUListElement
  saw: Picks
} {
  const { input, list } = comboboxElements()
  const saw: Picks = { picked: [], errors: [], emptied: 0 }
  const box = new Combobox(input, list, {
    onPick: (picked, chain) => saw.picked.push([picked, chain]),
    onError: (message) => saw.errors.push(message),
    onEmptied: () => (saw.emptied += 1),
    ...hooks,
  })
  return { box, input, list, saw }
}

/** Wait for the search the box started to come back and paint. */
const painted = (list: HTMLUListElement, rows: number): Promise<void> =>
  vi.waitFor(() => {
    expect(list.querySelectorAll("li")).toHaveLength(rows)
  })

beforeEach(async () => {
  await emptyGraph()
  await seed(["Kavara | Miselin", "Kavarel", "Vessarin"])
})

afterEach(() => {
  clearPage()
})

describe("typing", () => {
  it("paints a row for every node whose name starts with the text", async () => {
    const { list, input } = openBox()
    type(input, "kav")
    await painted(list, 2)
    // Each row is the name and the node's degree.
    expect(rowsIn(list)).toEqual(["Kavara1", "Kavarel0"])
  })

  it("says so when no node starts with the text", async () => {
    const { list, input } = openBox()
    type(input, "zzz")
    await painted(list, 1)
    expect(rowsIn(list)[0]).toContain("nothing starts with")
  })

  it("closes the list when the box is emptied", async () => {
    const { box, list, input } = openBox()
    type(input, "kav")
    await painted(list, 2)
    type(input, "")
    await vi.waitFor(() => {
      expect(box.open).toBe(false)
    })
    expect(rowsIn(list)).toEqual([])
  })

  it("puts the highlight on the first row", async () => {
    const { list, input } = openBox()
    type(input, "kav")
    await painted(list, 2)
    expect(highlighted(list)).toBe(0)
  })
})

describe("the arrows", () => {
  it("move the highlight, and wrap at both ends", async () => {
    const { list, input } = openBox()
    type(input, "kav")
    await painted(list, 2)

    press(input, "ArrowDown")
    expect(highlighted(list)).toBe(1)
    press(input, "ArrowDown")
    expect(highlighted(list)).toBe(0)
    press(input, "ArrowUp")
    expect(highlighted(list)).toBe(1)
  })

  it("do nothing while the list is closed", () => {
    const { list, input } = openBox()
    press(input, "ArrowDown")
    expect(highlighted(list)).toBe(-1)
  })
})

describe("Enter", () => {
  it("takes the highlighted row", async () => {
    const { list, input, saw } = openBox()
    type(input, "kav")
    await painted(list, 2)
    press(input, "Enter")

    await vi.waitFor(() => {
      expect(saw.picked).toHaveLength(1)
    })
    expect(saw.picked[0]?.[0]).toEqual({
      kind: "node",
      node: { id: "kavara", label: "Kavara", degree: 1 },
    })
    expect(saw.picked[0]?.[1]).toBe(false)
  })

  it("runs a search first when the box has no rows yet", async () => {
    const { input, saw } = openBox()
    // No `input` event, so nothing has been searched for. This is the state after Esc.
    input.value = "Vessarin"
    press(input, "Enter")

    await vi.waitFor(() => {
      expect(saw.picked).toHaveLength(1)
    })
    expect(saw.picked[0]?.[0]).toEqual({
      kind: "node",
      node: { id: "vessarin", label: "Vessarin", degree: 0 },
    })
  })

  it("closes the list once a row is taken", async () => {
    const { box, list, input } = openBox()
    type(input, "kav")
    await painted(list, 2)
    press(input, "Enter")
    await vi.waitFor(() => {
      expect(box.open).toBe(false)
    })
  })

  it("does nothing on an empty box", async () => {
    const { input, saw } = openBox()
    press(input, "Enter")
    await new Promise((done) => setTimeout(done, 20))
    expect(saw.picked).toEqual([])
  })

  it("ignores the Enter an IME fires to confirm a conversion", async () => {
    const { list, input, saw } = openBox()
    type(input, "kav")
    await painted(list, 2)
    press(input, "Enter", { isComposing: true })
    await new Promise((done) => setTimeout(done, 20))
    expect(saw.picked).toEqual([])
  })

  it("passes ⌘ out as a request to continue from the node", async () => {
    const { list, input, saw } = openBox()
    type(input, "kav")
    await painted(list, 2)
    press(input, "Enter", { metaKey: true })

    await vi.waitFor(() => {
      expect(saw.picked).toHaveLength(1)
    })
    expect(saw.picked[0]?.[1]).toBe(true)
  })

  it("takes Ctrl for the same thing, for a keyboard with no ⌘", async () => {
    const { list, input, saw } = openBox()
    type(input, "kav")
    await painted(list, 2)
    press(input, "Enter", { ctrlKey: true })

    await vi.waitFor(() => {
      expect(saw.picked).toHaveLength(1)
    })
    expect(saw.picked[0]?.[1]).toBe(true)
  })
})

describe("the create row", () => {
  it("is offered when no node has the typed name", async () => {
    const { list, input } = openBox({ allowCreate: true })
    type(input, "kav")
    await painted(list, 3)
    expect(rowsIn(list).at(-1)).toContain("+ create")
  })

  it("is withheld when a node already has that exact name", async () => {
    const { list, input } = openBox({ allowCreate: true })
    type(input, "Kavara")
    await painted(list, 1)
    expect(rowsIn(list)[0]).not.toContain("+ create")
  })

  it("is never offered to a box that cannot create", async () => {
    const { list, input } = openBox()
    type(input, "kav")
    await painted(list, 2)
    expect(rowsIn(list).join("")).not.toContain("+ create")
  })

  it("takes the highlight when nothing was found, so ↵ and ⇧↵ do the same thing", async () => {
    const { list, input, saw } = openBox({ allowCreate: true })
    type(input, "Ashanlin")
    await painted(list, 1)
    expect(highlighted(list)).toBe(0)

    press(input, "Enter")
    await vi.waitFor(() => {
      expect(saw.picked).toHaveLength(1)
    })
    expect(saw.picked[0]?.[0]).toEqual({ kind: "create", label: "Ashanlin" })
  })
})

describe("⇧↵", () => {
  it("creates the typed name", async () => {
    const { list, input, saw } = openBox({ allowCreate: true })
    type(input, "kav")
    await painted(list, 3)
    press(input, "Enter", { shiftKey: true })

    await vi.waitFor(() => {
      expect(saw.picked).toHaveLength(1)
    })
    expect(saw.picked[0]?.[0]).toEqual({ kind: "create", label: "kav" })
  })

  it("picks the existing node when one already has that name", async () => {
    // The store holds one node per name and refuses the second, so creating is not offered.
    const { list, input, saw } = openBox({ allowCreate: true })
    type(input, "KAVARA")
    await painted(list, 1)
    press(input, "Enter", { shiftKey: true })

    await vi.waitFor(() => {
      expect(saw.picked).toHaveLength(1)
    })
    expect(saw.picked[0]?.[0]).toEqual({
      kind: "node",
      node: { id: "kavara", label: "Kavara", degree: 1 },
    })
  })

  it("does nothing in a box that cannot create", async () => {
    const { list, input, saw } = openBox()
    type(input, "Ashanlin")
    await painted(list, 1)
    press(input, "Enter", { shiftKey: true })
    await new Promise((done) => setTimeout(done, 20))
    expect(saw.picked).toEqual([])
  })

  it("carries ⌘ as well, because ⌘ modifies both branches", async () => {
    const { list, input, saw } = openBox({ allowCreate: true })
    type(input, "Ashanlin")
    await painted(list, 1)
    press(input, "Enter", { shiftKey: true, metaKey: true })

    await vi.waitFor(() => {
      expect(saw.picked).toHaveLength(1)
    })
    expect(saw.picked[0]).toEqual([{ kind: "create", label: "Ashanlin" }, true])
  })
})

describe("Escape", () => {
  it("closes the list and leaves the text alone", async () => {
    const { box, list, input } = openBox()
    type(input, "kav")
    await painted(list, 2)

    press(input, "Escape")
    expect(box.open).toBe(false)
    expect(input.value).toBe("kav")
  })

  it("empties the box on the second press", async () => {
    const { list, input, saw } = openBox()
    type(input, "kav")
    await painted(list, 2)

    press(input, "Escape")
    press(input, "Escape")
    expect(input.value).toBe("")
    expect(saw.emptied).toBe(1)
  })
})

describe("clicking a row", () => {
  it("takes that row, whichever one it is", async () => {
    const { list, input, saw } = openBox()
    type(input, "kav")
    await painted(list, 2)
    clickRow(list, 1)

    expect(saw.picked).toHaveLength(1)
    expect(saw.picked[0]?.[0]).toEqual({
      kind: "node",
      node: { id: "kavarel", label: "Kavarel", degree: 0 },
    })
  })

  it("reads ⌘ from the mouse too", async () => {
    const { list, input, saw } = openBox()
    type(input, "kav")
    await painted(list, 2)
    clickRow(list, 0, true)
    expect(saw.picked[0]?.[1]).toBe(true)
  })
})

describe("clear", () => {
  it("empties the box, closes the list, and reports nothing", async () => {
    const { box, list, input, saw } = openBox()
    type(input, "kav")
    await painted(list, 2)

    box.clear()
    expect(input.value).toBe("")
    expect(box.open).toBe(false)
    expect(saw.picked).toEqual([])
    expect(saw.emptied).toBe(0)
  })

  it("discards a reply still in flight", async () => {
    const { box, list, input } = openBox()
    type(input, "kav")
    box.clear()
    await new Promise((done) => setTimeout(done, 50))
    expect(box.open).toBe(false)
    expect(rowsIn(list)).toEqual([])
  })
})
