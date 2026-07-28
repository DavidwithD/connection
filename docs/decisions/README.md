# Decisions (ADRs)

Architecture Decision Records — each captures *one* significant choice, the context,
and the reasoning, so the "why" survives even after the code changes.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-product-name.md) | Product name | 🔵 Proposed (open) |
| [0002](0002-dynamodb-as-datastore.md) | DynamoDB as the data store | ✅ Accepted |

**Status legend:** 🔵 Proposed · ✅ Accepted · ❌ Rejected · ♻️ Superseded

## How to add one

1. Take the next free number (zero-padded to 4 digits).
2. Copy [template.md](template.md) to `NNNN-<kebab-case-title>.md`.
3. Add a row to the table above **in the same change** — the index is the map.
4. Never renumber or delete an ADR. A reversed decision gets a *new* ADR, and the
   old one flips to ♻️ Superseded with a link forward.

## Template
```
# NNNN — <title>
Status: Proposed | Accepted | Rejected | Superseded
Context: what forces are at play
Decision: what we chose
Consequences: trade-offs, what this enables/precludes
```
