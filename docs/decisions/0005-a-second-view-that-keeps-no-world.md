# 0005 — A second view that keeps no world

**Status:** ♻️ Superseded by [0017](0017-the-second-view-goes.md)
**Date:** 2026-08-01
**Deciders:** David HL

## Context
The map in [ADR 0003](0003-graph-exploration-demo-stack.md) places every node once and never
moves it. Exploring means panning a camera over a map that keeps growing. [ADR
0004](0004-the-centre-and-its-neighbourhood.md) then added off-screen markers, a dimmed-node
tier and a squeeze pass to keep one node's neighbours readable. ADR 0004 is still Proposed,
on untested assumptions.

A page that answers "what is this node next to?" may need none of those parts.
[The requirement](../requirements/exploring-a-graph.md) does not say the two questions share
a view. A view without them is the cheap way to learn which are needed.

## Decision
Build a second page that draws one node, its neighbours, and nothing else.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Positions | Recomputed every hop | Nothing is frozen, so nothing needs room found for it. |
| Placing | Concentric circles, filled proportionally | A full inner circle beside a sparse outer one looks like a mistake. |
| Renderer | Hand-written SVG | ~120 marks on straight spokes need no layout engine. |
| Nodes present on both sides of a hop | Slide to the new slot | A node that fades out and back in looks like a fault. |
| Off-screen markers, connector lines, dimmed nodes, nodes with unread edges | Absent | This is the experiment. |
| "More graph behind this" | Node radius from `degree` | Keeps the validated colour ramp out of a second page. |

## Alternatives considered
- **A mode on the existing map.** Reuses everything. The map rests on fixed positions, and
  this mode breaks them. One renderer would then hold two contradicting contracts.
- **Fade all, redraw all.** Fewer moving parts. The node you came from is usually a
  neighbour of the node you arrive at. It would fade out and back in, which this page avoids.
- **Cytoscape with a concentric layout.** Adds a layout engine and a spatial index to do
  one line of trigonometry.
- **Reusing [placement.ts](../../web/src/placement.ts).** Its occupancy grid protects
  positions that must never move. On this page every position changes on a hop.

## Consequences
Two demos now answer overlapping questions, and both have to keep working. When one wins,
delete the other rather than leaving a stale answer on disk.

A hop clears the path you took. You can loop back without noticing. The only way back to a
node is to recognise its label. That is the cost of keeping no fixed positions, paid by anyone
past a few hops.

This page shows degree as size, and the map shows it as colour. One fact has two encodings.

## Assumptions and unknowns
- **One hop at a time is enough to explore.** Wrong if people get lost inside ten hops and
  ask for a back button.
- **A node that slides reads as the same node.** Untested on anyone.
- Five circles hold 120 neighbours in an ordinary window — unmeasured below 700px tall.
- We chose not to decide whether hops should be undoable until someone has walked some.

## Revisit when
- Anyone more than ten hops in cannot say where they came from.
- A circle holds more than fits in a 700px-tall window.
- The same fix needs making in both demos.
- Someone reads a slid node as a newly arrived one.
