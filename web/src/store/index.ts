/** The public interface of the store. Every page reads and writes the graph through this. */
export type {
  IslandMeta,
  IslandPage,
  LoadPlan,
  Neighbourhood,
  NodeMeta,
  Opening,
} from "./shapes.js"
export { Missing, Refused } from "./refused.js"
export { Unavailable, persist, whenEvicted } from "./db.js"

export { fetchIslands, readNeighbourhood as fetchNeighbourhood, readOpening as fetchOpening,
  searchLabels } from "./read.js"
export { createNode, deleteNode, deleteNodeWithEdges } from "./write.js"

import { addEdge, removeEdge } from "./write.js"
import { apply, survey } from "./load.js"
import { parse } from "./text.js"
import type { LoadPlan } from "./shapes.js"

/** Join two nodes. Throws `Refused` if they are already joined or one is missing. */
export const joinNodes = async (a: string, b: string): Promise<{ a: string; b: string }> => {
  await addEdge(a, b)
  return { a, b }
}

/** Part two nodes. Throws `Refused` if they were not joined. */
export const unjoinNodes = async (a: string, b: string): Promise<{ a: string; b: string }> => {
  await removeEdge(a, b)
  return { a, b }
}

/**
 * The largest file this will read.
 *
 * There were two limits before. The other one capped how many writes one load could make,
 * because a long-running HTTP request cannot be resumed if the browser gives up on it. There
 * is no request now. This limit stays as a guard against a pasted novel. It is not a limit on
 * the size of the graph.
 */
export const MAX_CHARS = 1_000_000

/** What a file would add to the graph. Read from the store, and written nowhere. */
export async function previewGraphText(text: string): Promise<LoadPlan> {
  const reading = parse(overlong(text))
  // A file with any fault is refused whole, so there is no plan to build and no reason to
  // read the store.
  const plan = reading.faults.length ? null : await survey(reading)
  return {
    lines: reading.lines,
    faults: reading.faults,
    fresh: plan?.fresh ?? [],
    // The pairs as they were read, because a line's meaning is not obvious from the line.
    joins: plan?.joins ?? [],
    joined: plan?.joined ?? 0,
  }
}

/**
 * Apply the file. Throws `Refused` if the graph refuses a write it has to make.
 *
 * The text is parsed and surveyed again rather than taking the plan back from the page. It
 * costs one more pass over the store, and it means what is written is what the file says.
 */
export async function loadGraphText(text: string): Promise<{ created: number; joined: number }> {
  const reading = parse(overlong(text))
  if (reading.faults.length) {
    throw new Error(`${String(reading.faults.length)} fault(s) — nothing written`)
  }
  return apply(await survey(reading))
}

function overlong(text: string): string {
  if (text.length > MAX_CHARS) {
    throw new Error(`that file is over ${String(MAX_CHARS)} characters`)
  }
  return text
}
