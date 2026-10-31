# 0027 — A ring holds what it holds

**Status:** 🔵 Proposed
**Date:** 2026-08-12
**Deciders:** David HL

## Context
[ADR 0025](0025-when-an-off-screen-marker-stands.md) draws an off-screen marker for a
neighbour the camera has moved off screen.
[ADR 0004](0004-the-centre-and-its-neighbourhood.md) allows a selected node eight of them.
Eight label boxes nearly fill one circle. The limit was that arithmetic, done by hand.

Keeping the limit fixed had two costs. Once the slots run out, `slotsFor`
([map-view.ts](../../web/src/map-view.ts)) assigns nothing, with no warning. And `circleSlots`
([placement.ts](../../web/src/placement.ts)) built candidates at one radius only. It ran out
near two dozen, whatever the documented limit said.

A neighbour with no slot falls back on its connector line, which is going. A wide
neighbourhood would then draw fewer edges than it has, which
[the-centre.md](../design/the-centre.md) forbids.

## Decision
A circle offers as many off-screen markers as it has room for. More neighbours use the next circle.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Per circle | Circumference over the widest name | The old limit was this, worked out by hand. |
| More than that | Step outward, on `freeSpots`'s stride | More markers need more circumference. |
| How far out | Within half the viewport's shorter side | A marker off screen helps nobody. |
| Touching pair | Refused. The circle stops early | A covered one is readable, not clickable. |
| Claiming one | Only a neighbour already past the margin | The pool must not go to names in view. |
| Paint order | Degree, as the neighbours are ranked | A tie must follow from something visible. |

## Alternatives considered
- **A larger literal.** Moves the line without removing it, and leaves `circleSlots`' ceiling.
- **No limit at all.** Reaches that ceiling instead. A reader learns the limit by watching
  off-screen markers fail to appear.
- **Overlap, ordered by paint order.** The neighbours do this with colliding names. Wrong
  here. An unreadable name is a loss. A marker nobody can click is no use.
- **One circle, further out.** Gains circumference by moving the first circle out. Past some
  radius a neighbour stops looking like a neighbour.

## Consequences
At the closest zoom, neighbours with long names get about six markers where eight were
allowed. The eight were only on paper. `freeSpots` steps outward and ignores where the
screen ends. So some markers stood off screen and others overlapped.

Marker positions now depend on the font. A font change moves every marker. A name that loads
late can overhang its slot. And each idle pass measures a box per neighbour, not per slot
held, because the claim reads the camera.

## Assumptions and unknowns
- **Assumed a 2D context's advance width matches Cytoscape's.** Untested across font fallbacks.
- **The reach is read once a visit, and measured from the selected node.** Seen at 320×280:
  the first circle is offered whatever the reach, so its slot can fall outside. Also
  [0033](0033-a-click-takes-no-camera.md).
- Unknown whether a marker three circles out still reads as the selected node's.
- Unknown how many markers help before more stop helping.

## Revisit when
- A neighbour past the margin has no marker at a zoom with visible room to spare.
- Anyone takes an outer-circle marker for an ordinary node.
- A label box overhangs its slot by more than the slack allows.
- Changing the font moves every marker, and somebody minds.
