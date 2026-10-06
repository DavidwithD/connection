# 0047 — The list page writes too

**Status:** 🔵 Proposed
**Date:** 2026-10-02
**Deciders:** David HL

## Context
[nodes.ts](../../web/src/nodes.ts) said every write happens on the map or the transfer
page. The store already held `deleteNodeWithEdges`, `renameNode` and `joinNodes`
([write.ts](../../web/src/store/write.ts)). The map already called all three from its
right-click menu. Nothing on the list page called any of them. Renaming, deleting or
joining a node meant leaving the list to find it again on the map.

[0024](0024-taking-a-node-out-with-its-edges.md) settled delete's own shape: one
question, no undo. [0036](0036-a-click-that-writes-nothing.md) settled that a write
follows a deliberate key or click, not an incidental one. Both carry over here rather
than being reopened.

## Decision
Each row gets edit, join and delete, calling the same store functions the map already
calls.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Reveal | Hover/focus-within icons | Three actions on a dense list, no new page chrome |
| Join's target | An inline name box, matched locally | `state.all` already holds every node read at boot |
| Delete | Arms on the first click, fires on the second | No modal exists anywhere in this app |
| Undo | None, for any of the three | Delete already has none; one story beats two |
| Labels | `priced`/`deleted` moved to `labels.ts` | The map had already written the cost text once |

## Alternatives considered
- **A `…` menu per row**, like the map's right-click menu. Needs a popover positioned
  against a scrolling list rather than a fixed point; three icons said the same thing
  more directly.
- **A two-click pair for join** — click one row, then a second to complete it. Needs a
  visible "armed" row that survives paging and search, with nothing to compare it to.
- **A shared join panel**, like the map's. A second piece of page chrome for something a
  row can already name itself.
- **The map's undo strip (`writes.ts`) on this page too.** Rename and join would gain
  undo while delete still would not. The page would then tell two different stories
  about whether a write here can be taken back.

## Consequences
A reader with no pointer and no keyboard focus cannot reach a row's icons at all.
`:focus-within` is the only way in without a hover, and it was not tested against a
screen reader. No action on this page can be undone. A stray click on rename or join
now costs more here than the same click costs on the map. `labels.ts` is a second file
the map and the list both depend on for button wording. That centralises one thing, but
adds a file either page's change has to consider.

## Assumptions and unknowns
- **Assumed one extra click is enough friction for delete without a modal.** Untested —
  nobody has mis-clicked it yet, armed or not.
- **Unknown whether the join suggestion list needs arrow-key navigation.** Enter only
  commits when exactly one match remains; a reader who expects ↑/↓ gets neither.

## Revisit when
- A touch-only or keyboard-only reader reports they cannot reach a row's actions.
- Someone fires a delete they did not mean to, through the two-click arm.
- The join box is asked for arrow-key navigation over its suggestions.
