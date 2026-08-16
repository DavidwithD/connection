# 0030 — The graph moves into the browser

**Status:** 🔵 Proposed
**Date:** 2026-08-16
**Deciders:** David HL

## Context
The graph sat in a DynamoDB table behind a Hono API. Four layers, a Java process and an HTTP
hop stood between a click and a record, for a demo one person runs alone.

It also priced the client. The read-ahead ring hides network latency
([0006](0006-only-the-centre-reads.md)); the write queue exists because two transactions
reaching for the totals item cancel each other
([0010](0010-writing-to-the-graph-from-the-browser.md)).

IndexedDB exists only in the browser, so adopting it is not a driver swap — the server goes
with it. What size the store must serve had never been written down, and is now
[storing-a-graph.md](../requirements/storing-a-graph.md).

## Decision
Store the graph in the browser's IndexedDB. Delete the server, the table and the Node data
layer, and rewrite the graph logic against it natively.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The store | Two object stores, written natively | An adapter would keep the old table's costs. |
| Identity | The normalised name is the key | A surrogate id would store the name twice. |
| Edges | One record, reached from either end | A `multiEntry` index does what the second copy did. |
| Totals | Memoised in the module | The item every write contended on holds nothing now. |
| A merge | Inside the write | Two record updates at any size. |
| A split | After the write, and may lag | It walks, so it must not hold the stores. |

## Alternatives considered
- **Keep the API, swap the driver.** The client is untouched. It keeps the layers, the Java
  process, the hop, and every piece of client machinery paying for latency that would be gone.
- **An adapter shaped like the table.** The smallest diff. It writes every edge twice and keeps
  the singleton, buying reversibility nobody asked for.
- **`localStorage`, or a file the page reads.** No schema to version. Neither indexes, so
  reading a neighbourhood becomes a scan of the graph.
- **A store somewhere real.** The only option that survives a cleared browser, and it is an
  account, a deployment and a bill for one reader.

## Consequences
The graph lives in one browser profile. Clearing site data destroys it, another profile is a
different graph, and the export button is the only backup. Nothing here mitigates it.

The read-ahead ring goes, and [0006](0006-only-the-centre-reads.md) with it.

`npm test` loses its only behavioural check with the smoke commands, and CI its
getting-started job.

Two tabs stop agreeing. Both write safely, neither is told, and each drifts until a reload.

Against that: no account, no server, no seeding command. A merge is now exact, and taking a
node out with its edges costs one recount, not one per edge.

## Assumptions and unknowns
- **Assumed one reader, in one tab.** Nothing enforces it.
- **Assumed the ceiling holds.** Measured on one seeded graph, in one browser.
- **Unknown whether a reader loses a graph before learning to export one.**
- **Unknown how eviction behaves under real pressure.** Persistence is a request, not a grant.

## Revisit when
- Somebody loses a graph they cared about to a cleared profile.
- Two people need to look at one graph.
- A recount is reported as slow on a graph inside the stated ceiling.
- The drift between two tabs is noticed.
