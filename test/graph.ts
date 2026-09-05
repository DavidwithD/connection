/**
 * A graph in memory, for the tests that read and write one.
 *
 * `fake-indexeddb/auto` puts an IndexedDB implementation on `globalThis` before anything
 * opens the database. It is imported for that side effect, so it must come first.
 *
 * Vitest gives each test file its own module registry. So the connection db.ts caches, and
 * the database behind it, belong to one file. Tests inside a file share both, and
 * `emptyGraph` is what separates them.
 */
import "fake-indexeddb/auto"

import { forget, open } from "../web/src/store/db.js"
import { loadGraphText } from "../web/src/store/index.js"

/** Clear both object stores and drop the cached totals. Call this before each test. */
export async function emptyGraph(): Promise<void> {
  const db = await open()
  const tx = db.transaction(["nodes", "edges"], "readwrite")
  await tx.objectStore("nodes").clear()
  await tx.objectStore("edges").clear()
  await tx.done
  // The totals are cached in memory and survive the clear. See db.ts.
  forget()
}

/**
 * Fill the graph from lines of names, in the text format.
 *
 * This goes through `loadGraphText`, which is the path the transfer page uses. A seeder that
 * wrote records directly would be a second definition of what a graph is.
 */
export async function seed(lines: string[]): Promise<void> {
  await loadGraphText(lines.join("\n"))
}
