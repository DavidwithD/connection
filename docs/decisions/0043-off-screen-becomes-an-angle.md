# 0043 — Off screen becomes an angle

**Status:** 🔵 Proposed
**Date:** 2026-08-26
**Deciders:** DavidwithD

## Context
[ADR 0025](0025-when-an-off-screen-marker-stands.md) draws an off-screen marker once a
neighbour's label box is off the screen by a margin. It measures both against `cy.extent()`,
a rectangle in world units.

[ADR 0042](0042-the-map-draws-on-a-sphere.md) put the map on a projected sphere. A node past
the sphere's edge has no drawn box to compare. The margin is a length in screen pixels, and that
length is a different angle on every window.

## Decision
A marker shows once its neighbour's box is a margin past the visible limit. The limit and
the margin are both angles from the middle of the screen.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The test | The angle to the box's nearest corner | A rectangle has no meaning on a disc |
| The visible limit | Nearer of sphere edge and corner | Above curvature 1 the window is inside the disc |
| The margin | `MARKER_MARGIN` in screen pixels, as radians | The keyboard nudge is a screen length |
| The reach | The flat half-span, in world units | An arc reaches into the compressed range |

The rest of 0025 holds: the box rather than the position, two thresholds, slots cut once a
visit, and the ranking under the cap.

## Alternatives considered
- **The rectangle, against drawn positions** — a node past the sphere's edge is not drawn,
  so the test has nothing to read for it.
- **The sphere's edge alone as the visible limit** — right at curvature 1 and below. Above it,
  a node inside the sphere's edge can be off the side of the window, with no marker
  ([projection.ts](../../web/src/projection.ts)).
- **The nearest edge rather than the corner** — draws a marker for a node still drawn in a
  corner.
- **A fixed angle for the margin** — `NUDGE` is 34 degrees of arc on a short window, and 5 on
  a tall one at curvature 3. No one angle stays wider than it.
- **The arc as the reach** — a claim would reach the range where a node is a pixel and a
  half wide.

## Consequences
A zoom no longer draws a marker. `MARKER_MARGIN` is 22 degrees at curvature 1 in a
1200 by 820 window. Seven neighbours never cross it, however far the reader zooms in. A pan
draws one instead, and three drive-script legs pan where they used to zoom
([probe.mjs](../../scripts/probe.mjs)).

A flatter surface shows less of the world. A neighbour legible at its own position can
need a marker after the reader moves the curvature slider. `curve` in
[sphere-view.ts](../../web/src/sphere-view.ts) runs the idle update, as a pan does.

## Assumptions and unknowns
- **A keyboard nudge stays a length in screen pixels.** `NUDGE` in
  [main.ts](../../web/src/main.ts) is one of them. A nudge in world units breaks the relation.
- **The canvas is the whole window.** A neighbour under the side panel passes the visible
  limit test and is hidden all the same ([0041](0041-the-controls-come-off-the-map.md)).
- **Unknown whether a reader misses the markers a zoom used to draw.** Nobody has been asked.

## Revisit when
- A marker check in [drive-sphere.mjs](../../scripts/drive-sphere.mjs) or
  [drive-map.mjs](../../scripts/drive-map.mjs) fails.
- Somebody asks for a zoom to draw a marker.
- The keyboard pan step stops being a length in screen pixels.
