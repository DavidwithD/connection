# 0010 — Writing to the graph from the browser

**Status:** 🔵 Proposed
**Date:** 2026-08-02
**Deciders:** David HL

## Context
[0009](0009-the-first-write-outside-the-seed.md) kept the write at the terminal, and set
its reopening trigger at the arrival of a writer that is not a person there. This is that.
It also takes the last piece of [0008](0008-finding-a-node-by-name.md): creating a node
outside the seed needs the conditional write the label reservation item allows.

The search box already resolves a typed prefix to real nodes, which is what makes this safe
to offer: a prefix returns up to twenty hits, so a *name* cannot identify a node. Every
write is addressed by an id somebody picked.

## Decision
The page writes on Enter. Two routes, each one transaction, each calling what the terminal
calls.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| When an edge is written | The moment a node is picked | A queue buys a review the store cannot honour: a batch is not atomic either. |
| Undo | None, until [0011](0011-taking-a-write-back.md) | Nothing removed an edge, and a queue was declined knowing that. |
| What a route takes | Ids, never labels | Resolving a name here restores the ambiguity the search box removes. |
| A refused write | 409, carrying the sentence | A taken name is an answer to show; only a fault is a 500. |
| Writes in flight | One at a time, per client | Edges from one source all meet on its meta item and the totals. |
| A new node's id | Random | The seed's counter needs a read that still races. |

## Alternatives considered
- **A queue, reviewed then submitted.** The only shape offering an undo. Rejected for a
  two-step commit, a locked source, per-item state, and a half-applied batch to explain,
  on a graph where reseeding is the recovery.
- **One batch route.** Fewer round trips, and a partial-failure contract to define at the
  boundary. The per-route transaction already says what happens.
- **Deriving an id from `nodeCount`.** Free, and wrong the moment two writers read it.

## Consequences
A mistaken edge cannot be taken back; the recovery is reseeding, which destroys the graph.

Creating a node and joining it are two transactions, so a create landing before a refused
join leaves a real node with no edges, findable by name and attached to nothing.

The client now maintains a `degree` it used to only read. Because `missing` is degree minus
edges loaded, an edge drawn without raising both degrees makes an unfinished node look
finished. `World.bumpDegree` exists for that, and is never called alone.

The starting point and the totals go stale faster, because anyone with the page open can
move them.

## Assumptions and unknowns
- **Assumed one person writes at a time.** Serialising is per-client, so two browsers still
  collide; cancelled transactions would say so.
- **Assumed an orphaned node is acceptable.** It is reachable by name and joinable after.
  How often the join half fails is unmeasured.
- **Unknown how a held read behaves against an edge written beside it.** The page writes to
  a store it also reads ahead of.

## Revisit when
- ~~Edges can be removed.~~ Fired; answered by 0011.
- A join is cancelled because two browsers wrote at once.
- Orphaned nodes appear often enough to need cleaning up.
- Anything unauthenticated can reach these routes.
