# 0004 — Showing the centre all of its neighbours

**Status:** 🔵 Proposed
**Date:** 2026-08-01
**Deciders:** David HL

## Context
[ADR 0003](0003-graph-exploration-demo-stack.md) made the node nearest the middle of the
screen the centre, and froze every position. Under those rules a node could be the centre
and still hide neighbours, for three reasons. The zoom gate refused to load
below 0.34. `seat` discarded neighbours it could not fit. And anything seated past ring
four exceeded `LONG_EDGE`, so it drew as a grey stub.

Only the third is about drawing. The first two were losses, leaving a dashed "more here"
border nothing could discharge. Each option below was drawn and animated first, in
[names-and-options.html](../design/names-and-options.html).

## Decision
The centre shows every neighbour it has. Nothing on the map moves except a ghost.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Unfittable neighbours | Kept, retried at `SQUEEZE_SEP` | Room is a fact about now, not about the graph. |
| The centre's own fetch | Exempt from the zoom gate | The gate bounds the viewport, not one named node. |
| Far neighbours | A **ghost** in the ring | 0003's stub is true and unreadable. |
| Clicking a ghost | It flies to the real node, and dissolves | Resolves the duplicate rather than leaving two. |
| Flight duration | Constant screen speed, clamped | One duration cannot fit a tenfold spread. |
| Nodes crowding the centre | Dimmed to a **backdrop** tier | The ring needs the room more than they do. |

## Alternatives considered
- **A named tether** — the stub, plus the neighbour's name. Cheapest and honest, but it
  leaves the ring incomplete, the whole complaint.
- **Drawing the long edge anyway** — correct and unreadable: a starburst over unrelated
  nodes, edges changing shape as you pan.
- **A tether on each ghost**, aimed home. Buys direction back, at the price of the tidy
  ring the ghost was chosen for.
- **Fetching on arrival** — the obvious reading, and wrong: it lands you on a bare centre.

## Consequences
This reverses one line of 0003, which turned down a second copy of a far neighbour: a name
twice over stops the map being a drawing of the graph. A ghost is admitted because it is
hollow, transient, seats nothing, and dissolves into the original.

The cost is that a ring slot no longer says where its node is. Two neighbours 110 and 700
units away sit at one radius, in whatever direction was free, so distance is learned by
travelling now, not by looking.

`autolock` comes off for a flight, so frozen seating rests on `World` having no method
that moves a node, not on Cytoscape refusing.

## Assumptions and unknowns
- **A hollow ring reads as "not the real node".** Untested on anyone. If it fails, ghosts
  get taken for nodes and the map lies.
- **0.75 px/ms suits every distance**, picked against one 543px flight.
- Unknown whether a prefetch usually beats the flight — unmeasured against latency.
- Unknown how a ghost should behave for a node with neighbours also awaiting a seat.

## Revisit when
- Anyone mistakes a ghost for a node.
- `MAX_GHOSTS` clamps for real: a hub reached eight undrawable neighbours.
- Anything other than a flight needs to move something.
- Someone has to compare two neighbours' distances from the ring alone.
- The backdrop dims more of the screen than the ring needs.
