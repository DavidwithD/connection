# Decisions (ADRs)

Architecture Decision Records — each captures *one* significant choice, the context,
and the reasoning, so the "why" survives even after the code changes.

| # | Decision | Status |
|---|----------|--------|
| [0002](0002-single-table-layout.md) | Single-table layout for an undefined domain | ✅ Accepted |
| [0003](0003-graph-exploration-demo-stack.md) | Rendering stack for the graph demo | 🔵 Proposed |
| [0004](0004-the-centre-and-its-neighbourhood.md) | Showing the centre all of its neighbours | 🔵 Proposed |
| [0005](0005-a-second-view-that-keeps-no-world.md) | A second view that keeps no world | 🔵 Proposed |

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

Run `scripts/adr-gate.py` before it lands — or `npm run hooks:install` once, and the
pre-commit hook runs it for you. [GATE.md](GATE.md) documents the required shape, the
budgets, and the checks a reader still has to make themselves.
