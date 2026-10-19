/**
 * The side panel setting in web/src/settings.ts, and the key it had before the rename.
 *
 * The setting lives in localStorage. This test puts a small in-memory copy on `globalThis`.
 * Node has a `localStorage` of its own. Without a backing file, it has no `clear` method.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { setSidePanelOpen, sidePanelOpen } from "../web/src/settings.js"

const KEY = "connection:side-panel-open"
const OLD_KEY = "connection:rail-out"

/** The four Storage methods settings.ts calls, over a Map. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> {
  const held = new Map<string, string>()
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage())
})

describe("sidePanelOpen", () => {
  it("is false in a fresh browser", () => {
    expect(sidePanelOpen()).toBe(false)
  })

  it("reads what setSidePanelOpen wrote", () => {
    setSidePanelOpen(true)
    expect(sidePanelOpen()).toBe(true)
    setSidePanelOpen(false)
    expect(sidePanelOpen()).toBe(false)
  })

  it("moves the old key's value to the new key, once", () => {
    localStorage.setItem(OLD_KEY, "on")
    expect(sidePanelOpen()).toBe(true)
    expect(localStorage.getItem(KEY)).toBe("on")
    expect(localStorage.getItem(OLD_KEY)).toBeNull()
  })

  it("reads the new key first when both are set", () => {
    localStorage.setItem(KEY, "")
    localStorage.setItem(OLD_KEY, "on")
    expect(sidePanelOpen()).toBe(false)
  })
})
