# 0011 — Taking a write back

**Status:** 🔵 Proposed
**Date:** 2026-08-02
**Deciders:** David HL

## Context
[0010](0010-writing-to-the-graph-from-the-browser.md) shipped writes from the browser with
no way back, and said so: *a mistaken edge cannot be taken back*. It listed the removal of
edges as what would reopen it. So did
[0009](0009-the-first-write-outside-the-seed.md), from the other side.

What reopened it was the keyboard. Making `↵` write is only worth it if `↵` is not final.
Every guard proposed instead — burying the create row, asking twice — taxed the common act
to protect against the rare one. Recovery is the honest fix.

## Decision
Every write can be reversed, by the operation that mirrors it.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Parting two nodes | `removeEdge`, mirroring the join item for item | Same five positions, so the reason tables line up. |
| Deleting a node | Refused unless `degree = 0` | Each edge is stored twice; the other half would be unreachable. |
| A degree, parting | Refused below zero | A degree short of its edges is the one state a reader cannot detect. |
| Undoing a create-and-join | Edge first, then node | The store will not delete a node that still has edges. |
| A node since joined to something else | Edge parts, node stays | It is no longer only this write's doing. |
| Creating | `↵` when nothing matches, `⇧↵` always | Creating is a distinct act and gets a distinct key. |

## Alternatives considered
- **Deleting a node with its edges.** One call rather than two. The transaction's size would
  then track the degree, and a hub would exceed what one can hold — a different decision,
  made silently.
- **A five-second window.** What was asked for. At the rate the panel is built for, it is
  gone before the next name is typed; thirty is long enough to notice.
- **Guarding creation more heavily instead.** Cheaper, and it slows the common act to guard
  the rare one.

## Consequences
`World` can now forget a node, which it could not before. Seated-once survives because
forgetting is not moving — but the id must never return at a different spot, so only a node
genuinely gone from the store may be forgotten.

`MapView` gains its first subtraction, and it must undo whichever shape `add` chose: a short
edge is one element, a long one is two stubs and two leads.

An undo is two more writes on the same hot items, so undoing costs what doing did.

The source of a run is never undone, even when the panel created it, so undoing the first
write can leave it behind with no edges.

## Assumptions and unknowns
- **Assumed thirty seconds is enough.** Unmeasured. A receipt dropped by the cap goes
  sooner, and nothing records that it did.
- **Assumed nobody undoes what somebody else is reading.** A held neighbourhood can now
  describe a parted edge, not only miss an added one.
- **Unknown what a partly-undone write leaves.** The edge parts and the delete is refused;
  how often has not been watched.

## Revisit when
- A node needs deleting along with its edges, or a hub cannot be removed at all.
- Receipts are lost to the cap often enough that an undo is missed.
- Two browsers undo the same write and one is cancelled.
