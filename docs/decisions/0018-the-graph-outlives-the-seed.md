# 0018 — The graph outlives the seed

**Status:** ♻️ Superseded by [0030](0030-the-graph-moves-into-the-browser.md)
**Date:** 2026-08-08
**Deciders:** David HL

## Context
[0007](0007-a-table-for-the-graph.md) gave the graph its own table, which is what lets the
seed clear it by dropping it — free, while the seed was the only writer.

[0010](0010-writing-to-the-graph-from-the-browser.md) ended that. Nodes are made from the
page now, and 688 had accumulated beside 600 seeded ones. Re-seeding would take both, and
nothing said so.

Deleting the seed in place is the obvious alternative, and the store makes it expensive.
`deleteNode` will not touch a node that still has edges
([0011](0011-taking-a-write-back.md)), so 600 nodes means parting 3001 edges first, one
transaction each.

## Decision
The graph comes out to a file, and the table is rebuilt from it.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Telling the two apart | Id shape alone — a UUID against the seed's `n0000` | Nothing else records where an item came from. |
| An id of neither shape | Refused, not sorted | Guessing would delete somebody's work. |
| Getting it out | A read-only export to JSON | The destructive half then reads a file, not a table. |
| Putting it back | Drop the table, write it again | DynamoDB has no rename and no copy onto a live name. |
| Order | Every check before the drop | Once the table goes, the file is the only copy. |
| The index item | Rebuilt, never restored | `rootId` names a node the export usually leaves behind. |

## Alternatives considered
- **Deleting the seed in place.** 3601 transactions, each one an interruption the graph must
  survive, to reach what a rebuild reaches in one pass.
- **Copying into a second table and renaming it.** There is no rename. Pointing the app at
  the new name instead turns the table into a variable every command has to remember.
- **A backup restored under a new name.** The same ending by a longer road, on APIs the
  emulator supports unevenly.

## Consequences
The id shape is now load-bearing. It was free — `nodeId` only slices a prefix — and is now
the sole mark of whose work an item is, so both shapes live in `keys.ts` where neither can
move alone.

A subset of a graph is not a graph. So the export corrects on the way out: edges with one
end outside it go, claims on absent names stay behind, `degree` is rewritten to match.

`bulk.ts` shares the batched write and the drop with the seed rather than copying them.

Writes landing between an export and its restore are lost. Nothing guards that window.

## Assumptions and unknowns
- **Assumed the id shape is the only mark.** Holds while `freshId` and `generate` are the
  only two minting ids. A third would be invisible, which is why neither shape is inferred
  from the other.
- **Assumed a graph fits in one process.** 688 nodes is 2220 items; a real one would not.
- **Unknown what an interrupted restore leaves.** The index lands last, so the API refuses
  to serve it — but the table is then neither graph.

## Revisit when
- A third thing mints node ids, or an id of neither shape reaches the table.
- The graph outgrows one Scan, or the file outgrows one process's memory.
- Somebody needs the seed and their own work in one table.
