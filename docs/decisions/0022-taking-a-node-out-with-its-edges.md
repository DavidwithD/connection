# 0022 — Taking a node out with its edges

**Status:** 🔵 Proposed
**Date:** 2026-08-10
**Deciders:** David HL

## Context
[0011](0011-taking-a-write-back.md) refuses to delete a node holding any edge, and names the
opposite as what would reopen it. Every node the map draws was reached by walking to a
neighbour ([main.ts](../../web/src/main.ts)), so each holds one — and a gesture for taking one
off the map has nothing to call.

## Decision
A node leaves edge by edge: each edge through the write that already parts one, the node
through the delete that already refuses one holding any.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The edges | One `removeEdge` apiece, in a loop | Both halves and both degrees, already right. |
| Atomicity | None — every step leaves a graph | A transaction over a hub outgrows what one holds. |
| Recovery | Asked once, not taken back | Edges cannot return with the node they hung on. |
| The bare delete | Unchanged | An undo reads its refusal as the node staying. |
| Reach | Whatever the map has at its centre | That degree is already on the page. |

## Alternatives considered
- **One transaction, chunked.** Fewer round trips and one repair, but it wants a reason table
  of its own — and `resettle` ([islands.ts](../../src/graph/islands.ts)) answers for one edge
  parting a component, not a node scattering it.
- **Parting every edge by hand first.** Already in the panel. A chore on any real node, and
  nothing says which part makes the delete legal.
- **Taking the edges and leaving the node.** A name with nothing behind it, which a refused
  join already strands by accident ([join.ts](../../web/src/join.ts)).
- **An undo rather than a question.** What [0011](0011-taking-a-write-back.md) prefers
  elsewhere. Putting one back wants a create holding the old id and a join per edge, any of
  which can fail — the node returning with part of its graph.

## Consequences
A hub costs a round trip and a component walk per edge, since every part asks whether it was a
bridge ([edge.ts](../../src/graph/edge.ts)). The wait grows with the degree.

A run that stops partway leaves the node holding fewer edges — a graph, and asking again
finishes the job, index included, since each part repairs it in passing.

The map gains a write the panel does not own, so the line writes queue in leaves the panel
([join.ts](../../web/src/join.ts)) first.

`rootId` can now name a node that has gone ([init.ts](../../src/graph/init.ts)), and the page
reads it before drawing anything — so boot takes that absence for an answer.

## Assumptions and unknowns
- **Assumed a hub is removed seldom enough for the wait to pass.** Unmeasured; the first
  settles it.
- **Assumed a question carrying a count is read, not clicked past.** Nothing recovers it when
  it is not.
- **Unknown what the index costs over a node coming apart.** Each walk was sized for a single
  part.
- **Unknown what the page shows while the loop runs.** Totals are re-read after, not during.
- **Unknown which edges a stopped run parted.** The reply names none, so the map is told it is
  stale rather than corrected.

## Revisit when
- A removal grows slow enough that somebody says so.
- A node needs more than one request to come apart.
- Nothing but the undo calls the bare delete any more.
- Somebody asks for a removed node back.
