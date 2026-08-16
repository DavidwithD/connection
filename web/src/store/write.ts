/**
 * Every write to the graph. Each uses one `readwrite` transaction.
 *
 * IMPORTANT: a refusal is thrown after the transaction, never inside it. Throwing inside
 * leaves `tx.done` rejecting with no handler, which shows up as an unhandled rejection rather
 * than as the refusal it is. So each write decides, finishes the transaction, and then
 * throws. Nothing has been written on those paths, so there is nothing to undo.
 *
 * Nothing here awaits a promise that is not an IndexedDB request. A transaction commits as
 * soon as the microtask queue drains with nothing pending. See db.ts.
 */
import { counted, open, unavailable, type StoredNode } from "./db.js"
import { edgeEnds, naming } from "./keys.js"
import { find, recount, settle, type Island } from "./islands.js"
import { MAX_EDGES_PER_NODE } from "./read.js"
import { ALREADY_JOINED, Missing, NAME_TAKEN, Refused } from "./refused.js"
import type { NodeMeta } from "./shapes.js"

const meta = (node: StoredNode): NodeMeta => ({
  id: node.labelKey,
  label: node.label,
  degree: node.degree,
})

/**
 * Update the component index after a write that changed it.
 *
 * Run outside the transaction on purpose, and allowed to fail on purpose. The nodes and edges
 * are the graph. This is an index over them, and a failed reindex must not undo a write that
 * already landed. When it fails, the index over-lists components or reports a size that is
 * too large. **Recount the islands** on the transfer page rebuilds both from the nodes and
 * edges.
 */
async function reindex(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (err) {
    console.warn(
      `island list lagging — run Recount the islands on the transfer page: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Create a node with no edges.
 *
 * The narrowest transaction here: there is no counter to update and no edge to touch, so it
 * holds one store. The name is checked inside the transaction, which is what produces the
 * refusal message. The unique key is the backstop underneath, and its `ConstraintError` maps
 * to the same message.
 */
export async function createNode(label: string): Promise<NodeMeta> {
  const named = naming(label)
  // A name that normalises to nothing has no key, so a node under it could never be found.
  if (!named) throw new Refused("a node needs a name")

  const made: StoredNode = {
    labelKey: named.labelKey,
    label: named.label,
    degree: 0,
    parent: named.labelKey,
    // A node with no edges is a component of one. That is known, not guessed, so it is
    // written here in the record the transaction is already writing. Every other component
    // update happens after the write. This is the only place the answer is known first.
    islandSize: 1,
  }

  let taken = false
  try {
    const db = await open()
    const tx = db.transaction("nodes", "readwrite")
    taken = Boolean(await tx.store.get(named.labelKey))
    if (!taken) await tx.store.add(made)
    await tx.done
  } catch (err) {
    if (err instanceof DOMException && err.name === "ConstraintError") {
      throw new Refused(NAME_TAKEN)
    }
    throw unavailable(err) ?? err
  }

  if (taken) throw new Refused(NAME_TAKEN)
  counted(1, 0)
  return meta(made)
}

/**
 * Join two nodes.
 *
 * `settle` runs inside this transaction. A merge is two record updates at any graph size, so
 * a join can never leave the island list stale. The degrees are written before it, so what it
 * reads is the graph this write leaves behind.
 */
export async function addEdge(aId: string, bId: string): Promise<void> {
  // The graph has no self-edges. Checked here rather than in each caller, so both are
  // covered.
  if (aId === bId) throw new Refused("a node cannot be joined to itself")

  let refusal: string | null = null

  try {
    const db = await open()
    const tx = db.transaction(["nodes", "edges"], "readwrite")
    const nodes = tx.objectStore("nodes")
    const edges = tx.objectStore("edges")

    const a = await nodes.get(aId)
    const b = await nodes.get(bId)
    const [x, y] = edgeEnds(aId, bId)

    if (!a || !b) refusal = "no such node"
    else if (await edges.get([x, y])) refusal = ALREADY_JOINED
    else {
      await edges.add({ a: x, b: y, ends: [x, y] })
      await nodes.put({ ...a, degree: a.degree + 1 })
      await nodes.put({ ...b, degree: b.degree + 1 })
      // After the degrees, so the records `settle` reads are the ones this write leaves.
      await settle(nodes, aId, bId)
    }

    await tx.done
  } catch (err) {
    if (err instanceof DOMException && err.name === "ConstraintError") {
      throw new Refused(ALREADY_JOINED)
    }
    throw unavailable(err) ?? err
  }

  if (refusal) throw new Refused(refusal)
  counted(0, 1)
}

/**
 * Remove an edge. This is `addEdge` in reverse.
 *
 * The degrees matter most. A degree lower than the node's real edge count is the one state
 * the reader cannot see: the node just stops asking for graph that exists. So a degree is
 * never lowered without removing the edge, and neither goes below zero.
 *
 * The component is read inside the transaction, before the recount that needs it runs
 * outside. The walk is the slow part and must not hold the stores open.
 */
export async function removeEdge(aId: string, bId: string): Promise<void> {
  if (aId === bId) throw new Refused("a node cannot be joined to itself")

  let refusal: string | null = null
  let was: Island | null = null

  try {
    const db = await open()
    const tx = db.transaction(["nodes", "edges"], "readwrite")
    const nodes = tx.objectStore("nodes")
    const edges = tx.objectStore("edges")

    const [x, y] = edgeEnds(aId, bId)
    const edge = await edges.get([x, y])
    const a = await nodes.get(aId)
    const b = await nodes.get(bId)

    if (!edge) refusal = "they are not joined"
    else if (!a || !b) refusal = "no such node"
    else {
      was = await find(nodes, aId)
      await edges.delete([x, y])
      await nodes.put({ ...a, degree: Math.max(0, a.degree - 1) })
      await nodes.put({ ...b, degree: Math.max(0, b.degree - 1) })
    }

    await tx.done
  } catch (err) {
    throw unavailable(err) ?? err
  }

  if (refusal) throw new Refused(refusal)
  counted(0, -1)
  // The edge is gone. Whether it was the only path between its two ends can only be answered
  // by walking the graph, so walk it here, after the write and never inside it.
  await reindex(() => recount([aId, bId], was))
}

/**
 * Delete a node. Refused unless it has no edges.
 *
 * The `degree = 0` rule is no longer needed for consistency: an edge is one record now, so
 * there is no half of an edge to strand. It stays because the join panel's undo depends on
 * it. A node that something else has been joined to since is not only that write's doing, and
 * the refusal is what says so.
 */
export async function deleteNode(id: string): Promise<void> {
  let gone = false
  let refusal: string | null = null

  try {
    const db = await open()
    const tx = db.transaction("nodes", "readwrite")
    const node = await tx.store.get(id)

    if (!node) gone = true
    else if (node.degree > 0) refusal = "no such node, or it still has edges"
    else await tx.store.delete(id)

    await tx.done
  } catch (err) {
    throw unavailable(err) ?? err
  }

  if (gone) throw new Missing(`no such node: ${id}`)
  if (refusal) throw new Refused(refusal)
  counted(-1, 0)
}

/**
 * Delete a node and every edge on it. One recount at the end, not one per edge.
 *
 * The previous version ran a resettle per removed edge, so deleting a hub ran up to
 * MAX_EDGES_PER_NODE of them. Nearly all of that work found that nothing had split. This
 * removes every edge without resettling, deletes the node, and recounts once. The index is
 * knowingly stale in between. ADR 0024 accepts that: the operation is not atomic, and running
 * it again finishes the job.
 *
 * The edges are read again on each round rather than once at the top, because the edge read
 * is capped at MAX_EDGES_PER_NODE. A node past that cap returns one batch and the rest are
 * still there. The loop ends because every round removes at least one edge and adds none.
 *
 * The component is captured on the first round, while the node still exists. Read afterwards,
 * a deleted root leaves every union-find chain ending at a missing record, `find` returns
 * null, and the size needed to re-stamp a new root is gone with it.
 */
export async function deleteNodeWithEdges(id: string): Promise<{ id: string; parted: string[] }> {
  const parted: string[] = []
  let was: Island | null = null
  let found = false
  let dropped = 0
  let removed = false

  try {
    const db = await open()

    for (;;) {
      const tx = db.transaction(["nodes", "edges"], "readwrite")
      const nodes = tx.objectStore("nodes")
      const edges = tx.objectStore("edges")

      const node = await nodes.get(id)
      if (!node) {
        // On the first round this means the node was never here. On a later round it means
        // another tab deleted it while this ran. The edges already removed still happened.
        await tx.done
        break
      }
      if (!found) {
        found = true
        was = await find(nodes, id)
      }

      const mine = await edges.index("byEnd").getAll(IDBKeyRange.only(id), MAX_EDGES_PER_NODE)
      const round: string[] = []

      for (const edge of mine) {
        const other = edge.a === id ? edge.b : edge.a
        await edges.delete([edge.a, edge.b])
        const neighbour = await nodes.get(other)
        if (neighbour) {
          await nodes.put({ ...neighbour, degree: Math.max(0, neighbour.degree - 1) })
        }
        round.push(other)
      }

      // Fewer than the cap proves there were no more edges, so delete the node in the same
      // transaction rather than spending another round on it.
      const last = mine.length < MAX_EDGES_PER_NODE
      if (last) await nodes.delete(id)
      else await nodes.put({ ...node, degree: Math.max(0, node.degree - mine.length) })

      // Count only after the round has committed, so a failed transaction does not leave the
      // cached totals describing edges the store still holds.
      await tx.done
      parted.push(...round)
      dropped += round.length
      removed ||= last
      if (last) break
    }
  } catch (err) {
    counted(removed ? -1 : 0, -dropped)
    throw unavailable(err) ?? err
  }

  if (!found) throw new Missing(`no such node: ${id}`)
  counted(removed ? -1 : 0, -dropped)

  // Not a resettle: the node is gone, so there is no second end to walk from. The question is
  // which components its former neighbours are in now, which `recount` answers from k seeds.
  await reindex(() => recount([...new Set(parted)], was, id))

  return { id, parted }
}
