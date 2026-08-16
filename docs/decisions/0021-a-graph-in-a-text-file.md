# 0021 — A graph in a text file

**Status:** 🔵 Proposed
**Date:** 2026-08-09
**Deciders:** David HL

## Context
[0009](0009-the-first-write-outside-the-seed.md) and
[0010](0010-writing-to-the-graph-from-the-browser.md) write one thing at a time: a node by
name, an edge between two names. Any graph is then a command per edge, or a dialogue per
edge in the page.

[0018](0018-the-graph-outlives-the-seed.md) already moves a whole graph, in a file that is a
table dump — ids, degrees, index stamps, both halves of every edge — read back by dropping
the table. Nobody types that.

So there is no way to write a graph down.

## Decision
A line names a node and whoever it joins. The file is a patch, applied through the writes
that already exist (`load.ts`).

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| A line | Its first name joins each of the rest | A hub is one line. |
| A lone name | That node, no edges | The island [0019](0019-every-island-has-an-address.md) is for. |
| Identity | The label, no ids | A node is its name — [0012](0012-the-name-is-the-node.md). |
| Applying it | `createNode` and `addEdge`, unchanged | Per-write invariants need no file-wide ones. |
| A second run | Both "already there" refusals counted | What makes the file editable. |
| Taking something out | Nothing does | A patch, not a picture. |

## Alternatives considered
- **`a | b | c` as a path through `b`.** Equal for a path, worse for a hub, and a lone name
  then means nothing. Neither reading is visible in the file, so `--dry-run` prints the pairs
  it read.
- **A file the graph is made to match.** A line removed would part an edge, and a misspelling
  would delete rather than add. Refused until somebody asks for it.
- **Ids in the file.** A third thing minting them, which
  [0018](0018-the-graph-outlives-the-seed.md) made load-bearing — or a lookup, which is the
  label.
- **One batched write.** `bulk.ts` writes whole items, after dropping the table — the one
  thing a loader must not do.

## Consequences
Sequential: every write carries a conditional update on the single index item, and parallel
ones contend. Roughly a round trip per new name and four per new pair (`load.ts`).

A misspelling is a new node rather than an error — the format's real cost. The plan lists
every name it would create; nothing matches one against a near miss.

Two refusals are read by code as well as by people now, so each is a named constant where it
is worded (`node.ts`, `edge.ts`). `rootId` is left where it was, as by every write. A name
here can hold neither `|` nor `#`.

## Assumptions and unknowns
- **Assumed a file worth typing fits in one process.** What
  [0018](0018-the-graph-outlives-the-seed.md) already rests on.
- **Assumed nobody wants the file to be the truth.** Wrong when a deleted line is expected to
  part its edge.
- **Unknown what an interrupted load leaves.** A subset of the file, which is a graph;
  running it again finishes it. Untested against a table that fails halfway.
- **Unknown whether the star reading survives use.** Nothing long has been typed by hand yet.

## Revisit when
- Somebody keeps a graph a line was read the wrong way into.
- Loading a file costs more than writing it did.
- Anyone needs a line removed to part the edge it named.
- A load is wanted from the page, which has neither file nor dry run.
