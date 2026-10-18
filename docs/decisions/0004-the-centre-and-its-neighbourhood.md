# 0004 — Showing the selected node all of its neighbours

**Status:** 🔵 Proposed
**Date:** 2026-08-01
**Deciders:** David HL

## Context
[ADR 0003](0003-graph-exploration-demo-stack.md) made the node nearest the middle of the
screen the selected node, and froze every position. Under those rules a selected node could
still hide neighbours, three ways. The zoom gate refused to load below 0.34. `freeSpots`
discarded neighbours it could not fit. And any node placed past the fourth circle exceeded
`LONG_EDGE`, so it drew as a grey stub.

Only the third is about drawing. The first two lost neighbours, and left a dashed "more here"
border nothing could clear. Every option below was drawn first.

## Decision
The selected node shows every neighbour it has. Only an off-screen marker moves on the map.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Unfittable neighbours | Kept, retried at `SQUEEZE_SEP` | Room changes. The graph does not. |
| The selected node's fetch | Exempt from the zoom gate | The gate limits the viewport's reads. |
| Far neighbours | An **off-screen marker** | 0003's stub is true and unreadable. |
| A click on a marker | The camera moves to the node, and it replaces the marker | One mark is left. |
| Move duration | Constant screen speed, clamped | One duration cannot fit a tenfold spread. |
| Nodes crowding it | Faded into the **dimmed node** tier | The neighbours need the room more. |

## Alternatives considered
- **A stub with the name.** Honest and cheap, but the neighbours stay incomplete.
- **Drawing the long edge anyway**: correct and unreadable. A starburst over unrelated
  nodes, with edges that change shape during a pan.
- **A connector line on each off-screen marker**, pointing home. It shows the way back, at the
  price of the tidy circle.
- **Fetching when the move ends**: the obvious choice, and wrong. The camera move ends on a
  selected node with no neighbours drawn.

## Consequences
This reverses one line of 0003, which rejected a second copy of a far neighbour. A name shown
twice stops the map being a drawing of the graph. A marker is allowed because it is hollow,
short-lived and takes no place.

The cost is that a slot on a circle no longer shows where its node is. Two neighbours 110 and
700 units away get markers at one radius, in whatever direction was free. So a reader learns
distance only by moving there.

[0025](0025-when-an-off-screen-marker-stands.md) replaced the rule for raising a marker. What
a marker is, where it stands and how it goes are as decided here.

`autolock` comes off for a camera move. So `World`, with no method that moves a node, keeps
the positions fixed.

## Assumptions and unknowns
- **A hollow outline reads as "not the real node".** Untested on anyone. If it fails, readers
  take markers for nodes, and the map misleads them.
- **0.75 px/ms suits every distance**, picked against one 543px camera move.
- Unknown whether a prefetch usually beats the move. Latency is unmeasured.
- Unknown how a marker should behave for a node whose neighbours also await a place.

## Revisit when
- Anyone mistakes an off-screen marker for a node.
- Anything other than a camera move needs to move something.
- Someone has to compare two neighbours' distances from the circle alone.
- The dimmed nodes cover more of the screen than the neighbours need.
