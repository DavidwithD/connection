/**
 * The version 3 upgrade in web/src/store/db.ts, against a real IndexedDB.
 *
 * The test writes a version 2 database by hand, with the old field and the old index. Then
 * `open` upgrades it. The test reads the result through the new index.
 *
 * This file opens the database once. `open` caches its connection, so a second upgrade in the
 * same file would need a second module registry.
 */
import "fake-indexeddb/auto"

import { openDB } from "idb"
import { beforeAll, describe, expect, it } from "vitest"

import { DB_NAME, open } from "../web/src/store/db.js"
import { readComponentCount } from "../web/src/store/read.js"

const MADE = Date.UTC(2026, 0, 1)

beforeAll(async () => {
  const old = await openDB(DB_NAME, 2, {
    upgrade(db) {
      const nodes = db.createObjectStore("nodes", { keyPath: "labelKey" })
      nodes.createIndex("byIsland", ["islandSize", "labelKey"])
      nodes.createIndex("byParent", "parent")
      const edges = db.createObjectStore("edges", { keyPath: ["a", "b"] })
      edges.createIndex("byEnd", "ends", { multiEntry: true })
    },
  })
  await old.put("nodes", {
    labelKey: "kavara", label: "Kavara", degree: 1, parent: "kavara", islandSize: 2,
    created: MADE,
  })
  await old.put("nodes", {
    labelKey: "miselin", label: "Miselin", degree: 1, parent: "kavara", created: MADE,
  })
  await old.put("edges", { a: "kavara", b: "miselin", ends: ["kavara", "miselin"] })
  old.close()
})

describe("the upgrade from version 2", () => {
  it("moves islandSize to componentSize on the root", async () => {
    const db = await open()
    const root = await db.get("nodes", "kavara")
    expect(root).toMatchObject({ componentSize: 2, created: MADE })
    expect(root).not.toHaveProperty("islandSize")
    expect(await db.get("nodes", "miselin")).not.toHaveProperty("componentSize")
  })

  it("replaces the byIsland index with byComponent", async () => {
    const db = await open()
    const names = [...db.transaction("nodes").store.indexNames]
    expect(names).toContain("byComponent")
    expect(names).not.toContain("byIsland")
    expect(await readComponentCount()).toBe(1)
  })

  it("keeps the edges", async () => {
    const db = await open()
    expect(await db.count("edges")).toBe(1)
  })
})
