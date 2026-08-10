# 0023 — The graph moves through the page

**Status:** 🔵 Proposed
**Date:** 2026-08-10
**Deciders:** David HL

## Context
Every way a whole graph moves is a terminal command. Whoever built one in the browser
cannot get it out of there, and cannot put one in.
[0021](0021-a-graph-in-a-text-file.md) ends by reopening on exactly that, and on what the
browser lacks for it: somewhere to get a file, and the survey that stands between a typo
and a node.

[0017](0017-the-second-view-goes.md) deleted the last second page, and named the duplication
as the condition that reopens it. What it deleted was another *view of the graph* — its own
seating, its own renderer, a stylesheet copied and left to drift.

## Decision
[transfer.html](../../web/transfer.html), its own Vite entry, sharing the stylesheet and the
API client and importing none of the map. Three routes carry the files
([index.ts](../../src/server/index.ts)).

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Text in | Two calls: survey, then write | `--dry-run` is what a page needs more, not less. |
| The preview | Faults, new names, and the pairs | Nothing in a file says star or chain. |
| The file on the wire | A `text/plain` body | One thing, no metadata, no multipart parser. |
| The plan | Re-surveyed on the write | One that made the round trip could have been edited. |
| Size | Capped, and said before the button | A load is sequential and cannot resume. |
| JSON restore | Stays a command | Its guard is an env var and a file on your disk. |

## Alternatives considered
- **A panel in the map.** The rail is four panels deep and a preview wants the room.
- **One call that writes unless told not to.** The safe path becomes the flag.
- **Restore behind a typed confirmation.** Invents a second guard for a route that drops
  the table, and writes the rescue file to the server rather than to whoever clicked.
- **Streaming progress.** More than the size cap buys, until a file needs it.

## Consequences
Two entries, two boot scripts, one stylesheet: the duplication 0017 warned about, minus the
part that made it expensive. Nothing here draws a graph, so a fix to the map is not a fix
here as well, and no renderer reaches this bundle.

Both downloads Scan the whole table, which [bulk.ts](../../src/graph/bulk.ts) permits and
nothing else served does. A click now costs what a command cost.

A load past the cap is refused with the command that has no cap, so the page has a floor
rather than a ceiling.

## Assumptions and unknowns
- **Assumed the cap is in the right place.** Read off the round-trip arithmetic in
  [0021](0021-a-graph-in-a-text-file.md), never measured against AWS.
- **Assumed people read the preview.** It is a screen between two clicks, and clicks go
  through screens.
- **Unknown what a half-applied load feels like here.** A refusal mid-file leaves what came
  before it written; the page says so, where the command could leave it to the scrollback.
- Nobody was asked what shape they wanted this in.

## Revisit when
- Somebody restores a JSON export by hand often enough to want the button.
- A file people actually keep is over the cap.
- The map and this page need the same fix twice.
