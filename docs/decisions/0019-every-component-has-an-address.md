# 0019 — Every component has an address

**Status:** 🔵 Proposed
**Date:** 2026-08-09
**Deciders:** David HL

## Context
[0006](0006-only-the-centre-reads.md) draws the map by walking outward from one node. No walk
reaches a component that holds no node anyone has reached. Since
[0010](0010-writing-to-the-graph-from-the-browser.md), every node made from the page starts as
one.

The store cannot answer "what components are there?". Membership depends on the whole edge
set. [0007](0007-a-table-for-the-graph.md) gives each node its own partition. That leaves only
a Scan, which that key design treats as a sign of a wrong design
(`repo.ts`).

## Decision
Every node carries a union-find `parent`. A node pointing at itself is a root, and each root
identifies one component.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Listing them | A sparse GSI, keyed on roots alone | One row per component, not per node. |
| Where the size lives | The index sort key, padded | Largest component first, in one Query. |
| Balancing | By size, never rank | A split recounts size exactly; rank only ever rises. |
| Merging | After the join, outside its transaction | An index failure must not undo a graph write. |
| Splitting | Walk both ends, stop at the first to close | Never pays for the larger half. |
| Being wrong | `graph:init` rebuilds it from the graph | Union-find cannot undo a union. |

## Alternatives considered
- **Registry items, one per component.** A join cannot retire one without knowing both ends'
  components. So it becomes a row per node ever made, and the list stops meaning anything.
- **A sparse index of degree-zero nodes.** Exact and cheap, but it misses the case that
  matters. Two made nodes joined only to each other are a component with no degree-zero node.
- **Deriving it per request.** A Scan, and an admission the layout cannot serve the question.

## Consequences
A second GSI, and every root in its single partition. Affordable: roots are as many as
components, and only a merge or a split touches one.

The index over-lists rather than under-lists. A `merge` that fails leaves two addresses for
one component. Either lands somewhere already walked, costing a wasted trip. A `resettle` that
fails leaves a half unlisted until the full recount runs.

`addEdge` and `removeEdge` now make a second write that is allowed to fail (`edge.ts`). So "a
write is one transaction" holds of the graph and no longer of the call.

The full recount compares the partition, never the pointers. Union order picks the root, so
insisting on one answer would report a change after every join.

## Assumptions and unknowns
- **Assumed over-listing is cheap.** It is, while a stale address lands on a placed node.
- **Assumed splits are rare and shallow.** True of the undo this was built for
  ([0011](0011-taking-a-write-back.md)); a general part could walk half a component.
- **Unknown what an interrupted `resettle` leaves.** It is idempotent, but nothing runs the
  full recount on a schedule, so the window lasts until somebody looks.

## Revisit when
- A component splits often enough that `graph:init` is run to repair rather than to check.
- A part's walk is measured above a second, or the component partition is throttled.
- Somebody needs the size of a component to be exact between a part and its repair.
- Two nodes are joined by anything that is not `addEdge`.
