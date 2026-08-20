# 0038 — A node under a new name

**Status:** 🔵 Proposed
**Date:** 2026-08-20
**Deciders:** David HL

## Context
A typo in a name could only be fixed by deleting the node and rebuilding every edge by hand.
That delete is [0024](0024-taking-a-node-out-with-its-edges.md), the one write with no undo.

The name is the key ([finding-a-node.md](../design/finding-a-node.md)), and IndexedDB keys
cannot be mutated. So a rename is a delete, a re-add, a rewrite of every incident edge, and a
rewrite of every `parent` naming the old key. That page said none was planned.

The obvious shape is create the new node, re-join the neighbours, then delete the old. That is
three kinds of write, and as many transactions as the node has edges.

## Decision
One transaction, and a box of its own.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The write | One `readwrite` over both stores | A failure between transactions leaves two names, each holding some edges. |
| Degrees | Untouched | Each neighbour loses an edge and gains one. |
| Components | Not recounted | Same edges, so nothing splits or merges. |
| The edge read | Uncapped | `MAX_EDGES_PER_NODE` bounds what is drawn, not what is moved. |
| Case-only | One record | `label` and `labelKey` differ only in case. |
| The box | Its own, in the menu | One exact match is the only question asked. |

## Alternatives considered
- **Create, re-join, delete from the page.** N+2 transactions, and a stopped run leaves both
  names holding part of the graph.
- **Reusing `Combobox`.** Its prefix search, highlight and create row all go unused, and
  fitting it would mean changing the class [0013](0013-one-box-that-grows-into-an-edge.md)
  settled for the join panel.
- **Editing over the pill.** Closest to the name. Cytoscape draws it on a canvas, so an HTML
  input has to be held over it through every pan and zoom.
- **A surrogate id, so keys never move.** A version bump rewriting every record. Still open,
  but rename is no longer the reason to take it.

## Consequences
The store gains its first write that changes a key. `reparent` in
[islands.ts](../../web/src/store/islands.ts) exports what `adopt` already did.

A second place on the page now takes a typed name. A verdict row is different enough from a
picker to be worth that. `↻ update` is modelled on `+ create “…”`, so `↵` means what it meant
already.

Renaming a hub costs one stall, at the per-record rate measured in
[islands.ts](../../web/src/store/islands.ts). The reader cannot pan during it.

## Assumptions and unknowns
- **A rename is rare enough that one uncapped read is affordable.** Untested past the seeded
  graph's largest hub, which has 24 edges.
- **The verdict is advice, and the store checks again.** Another tab can claim the name between
  the read and the write, so `renameNode` tests it inside the transaction.
- `reparent` is allowed to fail, like every index update. **Recount the islands** repairs it.
- Whether anyone reads `is taken` as a row they should click is untested.

## Revisit when
- A rename is wanted on something other than the centre.
- Merging two nodes is asked for, which this refuses.
- A node's edge count makes the write stall visibly.
- A third place on the page needs a name typed into it.
