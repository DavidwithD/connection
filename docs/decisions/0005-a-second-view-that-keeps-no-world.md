# 0005 — A second view that keeps no world

**Status:** ♻️ Superseded by [0017](0017-the-second-view-goes.md)
**Date:** 2026-08-01
**Deciders:** David HL

## Context
The map in [ADR 0003](0003-graph-exploration-demo-stack.md) seats every node once and never
moves it, so exploring means panning a camera over an accumulating world. [ADR
0004](0004-the-centre-and-its-neighbourhood.md) then spent ghosts, a backdrop tier and a
squeeze pass making one node's full ring readable inside that world — still Proposed,
resting on untested assumptions.

None of that machinery is obviously needed to answer "what is this node next to?".
[The requirement](../requirements/exploring-a-graph.md) does not say the two questions share
a view. The cheap way to learn which parts earn their keep is a view without them.

## Decision
Build a second page that draws one node, its neighbours, and nothing else.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Positions | Recomputed every hop | Nothing is frozen, so nothing needs room found for it. |
| Seating | Concentric rings, filled proportionally | A packed inner ring beside a sparse outer one reads as a mistake. |
| Renderer | Hand-written SVG | ~120 marks on straight spokes need no layout engine. |
| Nodes present on both sides of a hop | Slide to the new slot | Fading one out and back in reads as a fault, not a move. |
| Ghosts, tethers, backdrops, frontiers | Absent | This is the experiment. |
| "More graph behind this" | Node radius from `degree` | Keeps the validated colour ramp out of a second page. |

## Alternatives considered
- **A mode on the existing map.** Reuses everything, but frozen seating is the map's
  foundation and this breaks it. One renderer would then hold two contradicting contracts.
- **Fade all, redraw all.** Fewer moving parts. The node you came from is usually a
  neighbour of the node you arrive at, so it blinks out and back in — the artifact worth
  avoiding.
- **Cytoscape with a concentric layout.** Drags a layout engine and a spatial index into
  one line of trigonometry.
- **Reusing [placement.ts](../../web/src/placement.ts).** Its occupancy grid exists to
  protect seats that must never move. Nothing here holds still.

## Consequences
Two demos now answer overlapping questions, and both have to keep working. When one wins,
delete the other rather than leaving a stale answer on disk.

A hop erases the trail. You can circle back without noticing, and the only way home is
recognising a label. That is the cost of keeping no world, and anyone exploring past a few
hops pays it.

Degree reaches the eye as size here and as colour on the map, so the same fact is encoded
two ways across two pages.

## Assumptions and unknowns
- **One hop at a time is enough to explore.** Wrong if people get lost inside ten hops and
  ask for a back button.
- **A node that slides reads as the same node.** Untested on anyone.
- Five rings hold 120 neighbours in an ordinary window — unmeasured below 700px tall.
- We chose not to settle whether hops should be undoable until someone has walked some.

## Revisit when
- Anyone more than ten hops in cannot say where they came from.
- A ring exceeds what fits in a 700px-tall window.
- The same fix needs making in both demos.
- Someone reads a slid node as a newly arrived one.
