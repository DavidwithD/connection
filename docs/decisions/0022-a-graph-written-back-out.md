# 0022 — A graph written back out as text

**Status:** 🔵 Proposed
**Date:** 2026-08-10
**Deciders:** David HL

## Context
[0021](0021-a-graph-in-a-text-file.md) defined a file anybody can type and nothing can
produce. A graph built in the browser leaves only as
[0018](0018-the-graph-outlives-the-seed.md)'s table dump. The dump holds ids, degrees and
both halves of every edge. Nobody reads it, and only `graph:restore` accepts it.

So the format has a reader and no writer. One property would make it trustworthy: a graph
written down is the graph you started with. Nothing can check that property.

## Decision
`graph:export` learns `--text` and `--names`. The format's two directions move into
`text.ts` and sit together.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Which end writes a pair | The busier node; ties by name | A hub is one line, as typed. |
| A node with no edges | A line of its own | The [0019](0019-every-component-has-an-address.md) component of one. |
| Order | Component, then name, never id | Ids change across a reload; labels do not. |
| A date in the file | None | It is committed and diffed, not archived. |
| What is exported | The whole graph, always | 0018's split is about backups, not graphs. |
| A name holding `|` or `#` | Refuse the export | No escape exists to write one with. |

The ordering rules make export, load into an empty table and export again give back the
same bytes. `diff` can check that round trip, rather than a reader.

## Alternatives considered
- **A second command.** A second answer to "which items are the graph", which could stop
  matching `select` in `export.ts`.
- **Both ends of every edge, as stored.** Twice the file, and `a | b` beside `b | a` reads
  as two facts.
- **`--all` meaning something here.** It cannot: a text file is the whole graph. Refused
  rather than accepted as a flag that changes nothing.
- **Escaping `|` in a name.** Changes what every file already written means.

## Consequences
The format's rules now live in one file. So a writer cannot quietly stop agreeing with its
reader. That failure produces files that load as a *different* graph rather than as an
error. `load.ts` keeps only what touches a table.

A text export is lossy on purpose: no ids, no degrees, no `rootId`, no `graph#index`. The JSON
export is still the backup.

## Assumptions and unknowns
- **The round trip has been run on one graph.** A seeded 60-node one, out and back with every
  id changed. Nothing has yet exported a graph that grew by hand.
- **Assumed the star reading is what people want back.** Untested on a file anybody typed.
- **Assumed a graph fits in one string.** Everything the export already does assumes it.
- **Unknown whether refusing `|` and `#` is the right end to fix.** `createNode` accepts
  both (`node.ts`), so an unwritable name is reachable from the map.
  Rejecting them at the write is a behaviour change to a path live since 0009.
- We chose not to make the names shape describe the edges it drops.

## Revisit when
- A name a person wanted is refused by the writer rather than by the graph.
- Two exports of one unchanged graph differ.
- The blank line between components stops being what a reader finds their place by.
