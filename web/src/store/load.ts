/**
 * Compare a parsed file against the store, then apply it one write at a time.
 *
 * Additive only, and sequential. A later line may join to a name an earlier line created, so
 * each write has to see the one before it.
 */
import { open } from "./db.js"
import { edgeEnds, normaliseLabel } from "./keys.js"
import { ALREADY_JOINED, NAME_TAKEN, Refused } from "./refused.js"
import type { NodeMeta } from "./shapes.js"
import { spelledPair, type Reading } from "./text.js"
import { addEdge, createNode } from "./write.js"

export interface Plan {
  /** Names the store does not hold yet, in the file's order. */
  fresh: string[]
  /** The nodes the store does hold, keyed by normalised name. */
  known: Map<string, NodeMeta>
  /** Pairs that are not joined yet. */
  joins: [string, string][]
  /** How many pairs are already joined. */
  joined: number
}

/**
 * Read what the file would change, before anything is written.
 *
 * One read per name, and one per pair whose ends both exist. A pair with an end that does not
 * exist yet cannot already be joined, because `createNode` makes a node with no edges. That
 * keeps a first load into an empty store to one pass over the names.
 *
 * Each pass runs in one read transaction, so the plan describes one state of the graph rather
 * than a graph changing under it.
 */
export async function survey(reading: Reading): Promise<Plan> {
  const db = await open()
  const known = new Map<string, NodeMeta>()

  const nodes = db.transaction("nodes", "readonly")
  for (const name of reading.names) {
    const key = normaliseLabel(name)
    if (!key || known.has(key)) continue
    const node = await nodes.store.get(key)
    if (node) known.set(key, { id: node.labelKey, label: node.label, degree: node.degree })
  }
  await nodes.done

  const fresh = reading.names.filter((name) => !known.has(normaliseLabel(name)))

  const already = new Set<string>()
  const edges = db.transaction("edges", "readonly")
  for (const [a, b] of reading.pairs) {
    const one = known.get(normaliseLabel(a))
    const two = known.get(normaliseLabel(b))
    if (!one || !two) continue
    if (await edges.store.get(edgeEnds(one.id, two.id))) already.add(spelledPair(a, b))
  }
  await edges.done

  const joins = reading.pairs.filter(([a, b]) => !already.has(spelledPair(a, b)))
  return { fresh, known, joins, joined: already.size }
}

/**
 * Progress callback for a load, for a caller that displays it.
 *
 * The caller throttles it, not this file. Reporting every write costs real time, and how
 * often to report is a property of whatever shows it.
 */
export type Progress = (done: number, total: number, what: "name" | "pair") => void

/**
 * Write the plan. Nodes first, because an edge needs both its ends.
 *
 * The two refusals that mean "this already exists" are counted, not thrown. That is what
 * makes a file editable: the second run of an edited file meets everything the first run
 * wrote. Every other refusal is real and stops the run where it is, leaving what came before
 * it written. There is no transaction over the whole file, and there could not be one.
 */
export async function apply(
  plan: Plan,
  onProgress: Progress = () => undefined,
): Promise<{ created: number; joined: number }> {
  const nodes = new Map(plan.known)
  let created = 0

  for (const [index, name] of plan.fresh.entries()) {
    try {
      const node = await createNode(name)
      nodes.set(normaliseLabel(name), node)
      created++
    } catch (err) {
      if (!(err instanceof Refused) || err.message !== NAME_TAKEN) throw err
      // The name was taken between the survey and now. One tab cannot do this to itself, but
      // a second tab can. The node exists either way, and this line's edges still need it.
      const key = normaliseLabel(name)
      const db = await open()
      const found = await db.get("nodes", key)
      if (found) nodes.set(key, { id: found.labelKey, label: found.label, degree: found.degree })
    }
    // Report the position, not `created`. A name taken by another tab would otherwise leave
    // the progress count short of its own total. The created count is returned at the end.
    onProgress(index + 1, plan.fresh.length, "name")
  }

  let joined = 0
  for (const [index, [a, b]] of plan.joins.entries()) {
    const one = nodes.get(normaliseLabel(a))
    const two = nodes.get(normaliseLabel(b))
    // Only reachable when a name was refused above and then could not be found either. That
    // means the store changed under the run, not that anything is wrong with the file.
    if (!one || !two) throw new Error(`"${one ? b : a}" is not in the graph — nothing joins it`)

    try {
      await addEdge(one.id, two.id)
      joined++
    } catch (err) {
      if (!(err instanceof Refused) || err.message !== ALREADY_JOINED) throw err
    }
    onProgress(index + 1, plan.joins.length, "pair")
  }

  return { created, joined }
}
