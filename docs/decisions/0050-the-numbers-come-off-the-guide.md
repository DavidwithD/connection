# 0050 — The numbers come off the guide

**Status:** 🔵 Proposed
**Date:** 2026-09-03
**Deciders:** DavidwithD

## Context
[0041](0041-the-chrome-comes-off-the-map.md) moved the HUD into the guide popover, beside the
legend and the key list. Six rows survived: the centre's name and degree, nodes placed, edges
drawn, reads in flight, and the store's totals.

0041's first condition for reopening itself was somebody needing a count while panning. Nobody
has asked. A row inside a shut popover is read after the write it reports, or not at all.

Five rows repeat what the map draws. The sixth reads a count
[db.ts](../../web/src/store/db.ts) memoises so a write need not rescan
([architecture.md](../design/architecture.md)).

## Decision
The six rows go, and so does every operation whose only reader was one of them.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The rows | All six, not the four counts alone | The map marks the centre already |
| The counts cache | `counts`, `counted` and `forget` go | Nothing else needs a node or edge total |
| `Opening` | Drops `nodeCount` and `edgeCount` | `readOpening` drops one of three reads |
| The empty panel | Keys on `islands` | Both came off the same read |
| `World` | Drops `size` and `edgeCount` | The deleted rows were their only readers |
| The drive scripts | Eleven `ok()` calls deleted | The renderer cannot answer for the store |

## Alternatives considered
- **Keep "at centre" and "its degree".** The accent marks the centre and a click copies its name
  ([0039](0039-any-nodes-name-on-the-clipboard.md)). Nobody has asked for a degree.
- **Keep "in store" alone.** It is the one row the map cannot show, and the whole counts cache
  stays with it.
- **Answer the drive-script assertions from the renderer probe.** It reports what the map drew,
  so a store check written against it would pass on a write that never committed.
- **Delete the rows and keep the cache.** Six write paths would then adjust a number nothing
  reads.

## Consequences
Eleven of the repo's 108 `ok()` calls go.
[drive-part-edge.mjs](../../scripts/drive-part-edge.mjs) and
[drive-drag-join.mjs](../../scripts/drive-drag-join.mjs) now check neither that a write reached
IndexedDB nor that it survived a reload. A join that never committed passes both.
The two helpers in [drive-rename.mjs](../../scripts/drive-rename.mjs) would give them that
check from [probe.mjs](../../scripts/probe.mjs).

The empty panel now reads the island index rather than a scan of the `nodes` store. A graph that
lost every root stamp shows the panel with nodes still stored, which `test/read.test.ts` pins.
**Recount the islands** on the transfer page repairs it.

The panel's link leads to that page, where `confirmThen` in
[transfer.ts](../../web/src/transfer.ts) opens the Seed and Import confirmation with a live
scan. A wrong panel is contradicted there before anything is lost.

[0037](0037-the-centres-name-on-the-clipboard.md) rejected doing nothing because a pointer could
select the HUD's line. That line is gone.

## Assumptions and unknowns
- **Nobody watches a count while the camera moves.** 0041 named that on 2026-08-24; nobody has
  asked since.
- **The island index is right whenever the empty panel reads it.** A failed repair leaves it
  stale, and the panel then calls a graph with nodes empty.
- **Unknown whether anyone read "in store" to tell a write had landed.** Nobody has been asked.

## Revisit when
- Somebody needs a count while the camera moves.
- A drive script passes a join that never reached IndexedDB.
- The empty panel shows on a graph that still holds nodes.
