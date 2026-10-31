# 0006 — Read ahead of what is drawn

**Status:** ♻️ Superseded by [0030](0030-the-graph-moves-into-the-browser.md)
**Date:** 2026-08-02
**Deciders:** David HL

## Context
[ADR 0003](0003-graph-exploration-demo-stack.md) read every incomplete node near the viewport,
each time the camera went idle. [ADR 0004](0004-the-centre-and-its-neighbourhood.md) then
removed its zoom ceiling.

Together they loaded faster than anyone walks. Cytoscape re-emits its viewport event for an
animated pan that does not move
([step.mjs](https://github.com/cytoscape/cytoscape.js/blob/master/src/core/animation/step.mjs)).
So pressing **Go to selected** on a node already in the middle counted as idle, and read two
neighbourhoods. Headless, five presses took a boot of 17 placed nodes to 51.

So the map showed mostly nodes nobody asked for, off the route
[the requirements](../requirements/exploring-a-graph.md) describe. Reading only for the
selected node fixed that, and added a wait: a 190ms idle delay, then a read the API floors at
120ms.

## Decision
Reading and drawing follow different rules. The map draws the selected node's neighbours.
Reading runs a hop further, and the result waits undrawn for a walk.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What is drawn | The selected node's neighbours | A place is permanent, even after a pan. |
| What is read | That, and their neighbours | The next step comes from the neighbours. |
| An unspent reply | Held whole, absorbed when walked to | Places depend on the occupancy then. |
| How long the draw waits | Whatever moved the camera decides | Only a pan crosses unchosen nodes. |
| A read nobody waits on | Best effort, never marked failed | It leaves the node as it was. |
| A read the camera outruns | Abandoned, its claim handed back | A cancel must not fake a complete node. |

## Alternatives considered
- **Reading the neighbours' neighbours and drawing them too.** The degree lands on the map.
  That is the sweep this record began by removing, one hop out.
- **Absorbing an unspent reply as it arrives.** Cheaper to write, and it fixes places against
  a map nobody ever saw.
- **Drawing on a change of selected node, not on an idle camera.** A held reply costs nothing,
  so only the place is left to pay, and `World` never hands one back.

## Consequences
A walk step costs up to one read per neighbour, where it cost one. It falls to between none
and three once the held replies overlap the nodes with unread edges.
Somebody pays for walks nobody takes.

Reads no longer showed as waiting. The HUD needed a second counter: counting them in
`loading` made an idle map look busy.

Nearly every drawn node still carries the dashed "more here" border, because a neighbour is
placed a hop before the map draws from it. A mark almost every node carries says less.

## Assumptions and unknowns
- Assumed a walk is slower than a read. Measured against DynamoDB Local only.
- Unknown whether anyone objects to a speculative read per neighbour, per step.
- The bet: drawing, not reading, makes a map feel unchosen. Untested beyond the
  author.
- Unknown whether 110ms reads as instant after a key nudge.

## Revisit when
- Reads rather than draws are what limit the demo.
- The store stops being read-only, so a held reply can be stale.
- Latency climbs past the walk, so the reply arrives late.
- Something other than the selected node needs to draw: a search box, or an overview.
