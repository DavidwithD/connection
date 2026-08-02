# 0006 — Read ahead of what is drawn

**Status:** 🔵 Proposed
**Date:** 2026-08-02
**Deciders:** David HL

## Context
[ADR 0003](0003-graph-exploration-demo-stack.md) read every incomplete node the viewport
came near, on each settle. [ADR 0004](0004-the-centre-and-its-neighbourhood.md) then lifted
the zoom ceiling that had bounded it.

Together they loaded faster than anyone walks. Cytoscape re-emits its viewport event for an
animated pan that does not move
([step.mjs](https://github.com/cytoscape/cytoscape.js/blob/master/src/core/animation/step.mjs)),
so pressing Recentre on an already-centred node counted as a settle and bought two
neighbourhoods. Driven headlessly, five presses took a boot of 17 seated nodes to 51.

So the picture was mostly nodes nobody asked for, not the route
[the requirements](../requirements/exploring-a-graph.md) describe. Narrowing to the centre
fixed that and bought a wait: a 190ms settle, then a read
[the API](../../src/server/index.ts) floors at 120ms.

## Decision
Reading and drawing answer to different rules. Drawing is the centre's neighbourhood.
Reading runs a hop further and waits, undrawn, for somebody to arrive.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What is drawn | The centre's neighbourhood | A seat is permanent; a place panned past stays. |
| What is read | That, and the ring around it | The next step comes from the ring. |
| An unspent reply | Held whole, absorbed on arrival | Seats depend on the occupancy of the moment. |
| How long the draw waits | Whatever moved the camera decides | Only drift crosses nodes nobody chose. |
| A read nobody waits on | Best effort, never marked failed | It leaves the node as it was. |
| A read the camera outruns | Abandoned, its claim handed back | A cancel must not fake a complete node. |

## Alternatives considered
- **Reading the ring and drawing it too.** The degree lands on the map, which is the sweep
  this record began by removing, one hop out.
- **Absorbing an unspent reply as it arrives.** Cheaper to write, and it freezes seats
  against a map nobody ever saw.
- **Drawing on the accent change rather than on a settle.** A held reply costs nothing, so
  only the seat is left to pay — and `World` never hands one back.

## Consequences
An arrival costs up to a ring of reads where it cost one, falling to between none and
three per step once what is held overlaps the frontier. Somebody pays for walks nobody
takes.

Reads stopped being visible as waiting. The HUD needed a second counter, because folding
them into `loading` made an idle map read as busy.

Nearly every drawn node still carries the dashed "more here" border: a neighbour is seated
one hop before it is drawn from. A mark almost everything wears says less.

## Assumptions and unknowns
- Assumed a walk is slower than a read. Measured against DynamoDB Local and nothing else.
- Unknown whether a ring of speculative reads per arrival is a cost anyone objects to.
- The bet: drawing, not reading, is what makes a map feel unchosen. Untested beyond the
  author.
- Unknown whether 110ms reads as instant after a key nudge.

## Revisit when
- Reads rather than draws are what limit the demo.
- The store stops being read-only, so a held reply can be stale.
- Latency climbs past the walk, and the reply is not there on arrival.
- Something other than the centre needs to draw: a search box, or an overview.
