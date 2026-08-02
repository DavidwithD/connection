# 0007 — A table for the graph

**Status:** 🔵 Proposed
**Date:** 2026-08-02
**Deciders:** David HL

## Context
[ADR 0002](0002-single-table-layout.md) put every item in one overloaded table, reasoning
from a product nobody could describe. It was written alongside the table rather than
argued, so this is the first time the layout has been weighed.

What one table buys is reading unlike items in a single request. Nothing does that. A node
and its edges come back together, but they share a *partition*, which any table gives them;
the starting point and each label claim are read alone. Meanwhile the graph is no longer
hypothetical — [the seed](../../src/graph/seed.ts) writes a known shape.

## Decision
The graph gets a table to itself. The overloaded one stays for entities that do not exist
yet, and the smoke test keeps exercising it.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Where the graph lives | Its own table | No read pairs it with a non-graph item. |
| The general table | Kept as it was | The product's entities are still unnamed. |
| Clearing the graph | Drop the table, build it again | Deleting items left strays behind. |
| Language and runtime | TypeScript on Node | Carried unchanged from 0002. |
| The local database | The vendored JAR | Carried unchanged from 0002. |

## Alternatives considered
- **One overloaded table.** What 0002 chose. It wins when unlike items are fetched
  together, and would win here the day a node has to arrive beside something that is not
  graph. That day has not come.
- **A table for every kind of item.** Nodes, labels, and the index are one domain read
  through one set of keys. Splitting them would buy separate metrics and cost joins.
- **Clearing by deleting items.** Survivable against real data, unlike a drop. It is also
  what let a half-finished run strand rows nothing could find again.

## Consequences
Two tables to create, watch, and restore, and a second name in the environment. The cost
lands on whoever operates this rather than on whoever writes queries against it.

Reseeding is destructive at table granularity, so a guard stands between it and any
endpoint that is not the local emulator. Someone will meet that guard and have to decide
whether they meant it.

The graph written under 0002 is still sitting in the general table. Nothing deletes it, and
the code that could no longer exists — `ddb:reset` is the remaining cure.

## Assumptions and unknowns
- The bet: nothing will need a node and a non-graph item in one request. Wrong the first
  time a read has to reach across the two tables.
- Assumed the general table earns its place once entities exist. Only the smoke test writes
  to it, so it may prove to be a table kept for a product that never asks for it.
- Dropping and rebuilding is verified against the emulator alone. Timing and cost against
  real DynamoDB are unmeasured.

## Revisit when
- A read needs a node and something that is not part of the graph, in one request.
- The product names its entities, so the general table gains a second writer.
- Reseeding needs to run somewhere a table cannot be lost.
- The graph grows past what one table's throughput or index budget allows.
