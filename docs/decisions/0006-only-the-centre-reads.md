# 0006 — Only the centre reads

**Status:** 🔵 Proposed
**Date:** 2026-08-02
**Deciders:** David HL

## Context
[ADR 0003](0003-graph-exploration-demo-stack.md) reads every incomplete node the viewport
comes near, on each settle. [ADR 0004](0004-the-centre-and-its-neighbourhood.md) then lifted
the zoom ceiling that had bounded it, for the middle of the screen.

Together they load faster than anyone walks. Cytoscape re-emits its viewport event for an
animated pan that does not move
([step.mjs](https://github.com/cytoscape/cytoscape.js/blob/master/src/core/animation/step.mjs)),
so pressing Recentre on an already-centred node counted as a settle and bought two
neighbourhoods. Driven headlessly, boot seated 17 nodes and five presses of that button took
the map to 51, not one of them a place anyone chose.

So the picture was mostly nodes nobody asked for, not the route walked that
[the requirements](../requirements/exploring-a-graph.md) describe.

## Decision
The node in the middle is the only node that reads. Everything else reaches the map as
somebody's neighbour, and stays unread until someone walks to it.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What triggers a read | The centre, once the camera stops | Attention is one node, not a rectangle. |
| The first frame | The root and its ring, nothing further | The smallest picture that answers a request. |
| Zoom ceiling, batch cap, queue | Deleted | One read per settle needs no bounding. |
| A read the camera outruns | Abandoned, its claim handed back | A cancel must not fake a complete node. |
| Field, frontier, tether | Derived from what is held | They report on reads; they cause none. |

## Alternatives considered
- **The same sweep, one node per settle.** Slows the drift without turning it: the map still
  fills with places nobody chose.
- **Reading the ring as well**, so a step never lands on an unread node. It multiplies every
  step by the degree — this same problem, one hop out.
- **Reading on arrival with no flight prefetch.**
  [0004](0004-the-centre-and-its-neighbourhood.md) turned that down to avoid an empty ring on
  landing, and nothing here argues with it.
- **Evicting far nodes instead of not reading them.** `World` keeps their positions
  regardless, so it buys back drawing and no reads.

## Consequences
Walking costs a round trip per step: land on a ring node and its own ring appears after the
read, which the old sweep had usually pre-empted. The ghost prefetch is the only lookahead
left.

Nearly every drawn node carries the dashed "more here" border: a neighbour is seated one hop
before it is read. A mark almost everything wears says less.

The demo also looks smaller: the node count is the route, so only the HUD shows a store of
600 nodes.

## Assumptions and unknowns
- The bet: one wait per step beats a screen of unchosen nodes. Untested beyond the author.
- Unknown whether the settle delay plus a read reads as a pause or as loading.
- Unknown whether the dashed border keeps meaning once nearly everything has one.
- Assumed the flight prefetch is lookahead enough for the one long gesture.

## Revisit when
- A step onto a ring node is slow enough that anyone asks for lookahead.
- The dashed border stops being read, because it is on everything.
- Something other than the centre needs a read: a search box, or an overview.
- Store latency climbs past the settle delay, making every step visibly two-stage.
