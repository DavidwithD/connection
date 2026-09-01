# 0043 — Off screen becomes an angle

**Status:** 🔵 Proposed
**Date:** 2026-08-26
**Deciders:** DavidwithD

## Context
[ADR 0025](0025-when-a-ghost-stands.md) raises a doorway once a neighbour's drawn box has
cleared the screen by a margin. It measures both against `cy.extent()`, a rectangle in world
units.

[ADR 0042](0042-the-map-draws-on-a-sphere.md) put the map on a projected sphere. A node past
the limb has no drawn box to compare. The margin is a length in screen pixels, and that
length is a different angle on every window.

## Decision
A doorway stands while its neighbour's box sits past the horizon by a margin. The horizon and
the margin are both angles from the middle of the screen.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The test | The angle to the box's nearest corner | A rectangle has no meaning on a disc |
| The horizon | The nearer of limb and corner | Above curvature 1 the window sits inside the disc |
| The margin | `GHOST_MARGIN` in screen pixels, as radians | The keyboard nudge is a screen length |
| The reach | The flat half-span, in world units | An arc reaches into the compressed band |

The rest of 0025 holds: the box rather than the seat, two thresholds, slots cut once a
visit, and the ranking under the cap.

## Alternatives considered
- **The rectangle, against drawn positions** — a node past the limb draws nowhere. The test
  then has nothing to read at the nodes a doorway is for.
- **The limb alone as the horizon** — right at curvature 1 and below. Above it a node inside
  the limb can be off the side of the window, with nothing standing for it
  ([projection.ts](../../web/src/projection.ts)).
- **The nearest edge rather than the corner** — raises a doorway for a node still drawn in a
  corner.
- **A fixed angle for the margin** — `NUDGE` is 34 degrees of arc on a short window, and 5 on
  a tall one at curvature 3. No one angle stays wider than it.
- **The arc as the reach** — a claim on the centre would reach into the band where a node is a
  pixel and a half wide.

## Consequences
A zoom no longer raises a doorway. `GHOST_MARGIN` is 22 degrees at curvature 1 in a 1200 by
820 window. A ring of seven neighbours never crosses it, however far the reader zooms in. Panning
raises one instead, and three drive-script legs pan where they used to zoom
([probe.mjs](../../scripts/probe.mjs)).

A flatter surface reaches over less of the world. A neighbour legible at its own seat can
need a doorway after the reader moves the curvature slider. `curve` in
[globe-view.ts](../../web/src/globe-view.ts) settles the map as a pan does.

## Assumptions and unknowns
- **A keyboard nudge stays a length in screen pixels.** `NUDGE` in
  [main.ts](../../web/src/main.ts) is one of them. A nudge in world units breaks the relation.
- **The canvas is the whole window.** A neighbour under the island drawer clears the horizon
  test and is hidden all the same ([0041](0041-the-chrome-comes-off-the-map.md)).
- **Unknown whether a reader misses the doorways a zoom used to raise.** Nobody has been asked.

## Revisit when
- A doorway check in [drive-globe.mjs](../../scripts/drive-globe.mjs) or
  [drive-map.mjs](../../scripts/drive-map.mjs) fails.
- Somebody asks for a doorway that a zoom raises.
- The keyboard pan step stops being a length in screen pixels.
