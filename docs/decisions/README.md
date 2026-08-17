# Decisions (ADRs)

Architecture Decision Records — each captures *one* significant choice, the context,
and the reasoning, so the "why" survives even after the code changes.

| # | Decision | Status |
|---|----------|--------|
| [0002](0002-single-table-layout.md) | Single-table layout for an undefined domain | ♻️ Superseded |
| [0003](0003-graph-exploration-demo-stack.md) | Rendering stack for the graph demo | 🔵 Proposed |
| [0004](0004-the-centre-and-its-neighbourhood.md) | Showing the centre all of its neighbours | 🔵 Proposed |
| [0005](0005-a-second-view-that-keeps-no-world.md) | A second view that keeps no world | ♻️ Superseded |
| [0006](0006-only-the-centre-reads.md) | Read ahead of what is drawn | ♻️ Superseded |
| [0007](0007-a-table-for-the-graph.md) | A table for the graph | ♻️ Superseded |
| [0008](0008-finding-a-node-by-name.md) | Finding a node by name | ♻️ Superseded |
| [0009](0009-the-first-write-outside-the-seed.md) | The first write outside the seed | ♻️ Superseded |
| [0010](0010-writing-to-the-graph-from-the-browser.md) | Writing to the graph from the browser | 🔵 Proposed |
| [0011](0011-taking-a-write-back.md) | Taking a write back | 🔵 Proposed |
| [0012](0012-the-name-is-the-node.md) | The name is the node | 🔵 Proposed |
| [0013](0013-one-box-that-grows-into-an-edge.md) | One box that grows into an edge | 🔵 Proposed |
| [0014](0014-binding-the-docs-to-the-code.md) | Binding the living docs to the code | 🔵 Proposed |
| [0015](0015-bash-as-the-script-shell.md) | Bash as the npm script shell | 🔵 Proposed |
| [0016](0016-the-gates-run-in-ci.md) | The gates run in CI | 🔵 Proposed |
| [0017](0017-the-second-view-goes.md) | The second view goes | 🔵 Proposed |
| [0018](0018-the-graph-outlives-the-seed.md) | The graph outlives the seed | ♻️ Superseded |
| [0019](0019-every-island-has-an-address.md) | Every island has an address | 🔵 Proposed |
| [0020](0020-the-islands-list-is-an-index.md) | The islands list is an index | 🔵 Proposed |
| [0021](0021-a-graph-in-a-text-file.md) | A graph in a text file | 🔵 Proposed |
| [0022](0022-a-graph-written-back-out.md) | A graph written back out as text | 🔵 Proposed |
| [0023](0023-the-graph-moves-through-the-page.md) | The graph moves through the page | 🔵 Proposed |
| [0024](0024-taking-a-node-out-with-its-edges.md) | Taking a node out with its edges | 🔵 Proposed |
| [0025](0025-when-a-ghost-stands.md) | When a ghost stands | 🔵 Proposed |
| [0026](0026-a-fourth-kind-of-document.md) | A fourth kind of document | 🔵 Proposed |
| [0027](0027-a-ring-holds-what-it-holds.md) | A ring holds what it holds | 🔵 Proposed |
| [0028](0028-where-a-chained-name-lands.md) | Where a chained name lands | 🔵 Proposed |
| [0029](0029-a-click-that-joins.md) | A click that joins | 🔵 Proposed |
| [0030](0030-the-graph-moves-into-the-browser.md) | The graph moves into the browser | 🔵 Proposed |
| [0031](0031-parting-an-edge-from-the-map.md) | Parting an edge from the map | 🔵 Proposed |
| [0032](0032-the-centre-is-named.md) | The centre is named | 🔵 Proposed |
| [0033](0033-a-click-takes-no-camera.md) | A click takes no camera | 🔵 Proposed |
| [0034](0034-what-reading-cannot-check.md) | What reading cannot check | 🔵 Proposed |

**Status legend:** 🔵 Proposed · ✅ Accepted · ❌ Rejected · ♻️ Superseded

## How to add one

1. Take the next unused number (zero-padded to 4 digits). Numbers are spent once and
   never reused, so records start at 0002 — 0001 was withdrawn before it was decided.
2. Copy [template.md](template.md) to `NNNN-<kebab-case-title>.md` — that file is the
   one copy of the shape, so it does not get restated here.
3. Add a row to the table above **in the same change** — the index is the map.
4. Link the record from the code or spec that carries the constraint. A record nothing
   points at is unreachable at the moment it was needed.
5. Never renumber or delete a *decided* ADR. A reversal gets a *new* ADR, and the old
   one flips to ♻️ Superseded with a link forward. A record whose Decision was never
   made is a note, not a decision, and may be withdrawn — its number stays spent.

Run `npm run adr` before it lands — or `npm run hooks:install` once, and the pre-commit
hook runs it for you. [GATE.md](GATE.md) documents the required shape, the budgets, and
the checks a reader still has to make themselves.
