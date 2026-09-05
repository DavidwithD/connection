# 0044 — The node record carries a date

**Status:** 🔵 Proposed
**Date:** 2026-09-05
**Deciders:** DavidwithD

## Context
The node list at `/nodes.html` orders nodes by date and filters on a date range. Version 1
of [db.ts](../../web/src/store/db.ts) held the key, the name, the degree, the parent, and
`islandSize` on a root. None of them records when a node was written.

The page was first built against dates derived from each name. A shipped page cannot show an
invented number as a fact.

## Decision
`StoredNode` carries `created`: milliseconds since the epoch, written once. The database goes
to version 2, and the version change gives every node already stored the moment of the
upgrade.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The type | A number, not a `Date` | IndexedDB stores either; a number sorts and subtracts |
| Old nodes | One shared stamp, at the upgrade | Version 1 recorded nothing truer |
| A rename | Keeps the date | A renamed node is the same node |
| A file load | One stamp for the whole file | Those nodes did arrive together |
| An old backup | Stamped at the load | `stampUndated` in transfer.ts |
| An index | None | It would be maintained by every write to serve one page |

Two places build a node record: `createNode` in [write.ts](../../web/src/store/write.ts) and
`buildGraph` in [transfer.ts](../../web/src/store/transfer.ts). Every other write spreads a
record it has read, so the date crosses on its own.

## Alternatives considered
- **Leave the field out, drop the two controls** — the smaller change. The page keeps search,
  name order and the shuffle.
- **An index over `created`** — every write would maintain it, to serve one order on one
  page. The list already holds every node in memory for substring search.
- **The order records went in, instead of a date** — IndexedDB returns records in key order.
  Nothing in the engine reports when a record was written.
- **A second store holding dates** — two records per node, and a way for them to disagree.
- **Refuse a backup with no dates** — a file written last week would stop loading.

## Consequences
The upgrade is one way. A browser that has opened version 2 refuses version 1. Older code
cannot read that database, so moving between branches needs a backup first.

Every node in an existing graph reads as one day. The date order sorts those by name, and says
nothing about them until newer nodes arrive.

The backup file grows by one number per node. An older file still loads, and takes the date
of the load.

## Assumptions and unknowns
- **The version change finishes on a large graph.** It walks every node in one transaction.
  Measured on hundreds, not on 50,000.
- **Nobody wants a modified date.** The record dates one event.
- **Unknown whether one shared date on old nodes reads as a fault.** Nobody has been asked.

## Revisit when
- A reader asks what a node's date means and the shared stamp misleads them.
- The list has to page by date from the store rather than sort in memory. That is when
  `created` earns an index.
- A second timestamp is wanted, which makes this field one of a pair.
