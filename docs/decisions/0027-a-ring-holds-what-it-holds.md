# 0027 — A ring holds what it holds

**Status:** 🔵 Proposed
**Date:** 2026-08-12
**Deciders:** David HL

## Context
[ADR 0025](0025-when-a-ghost-stands.md) raises a doorway for a neighbour the camera has taken
off screen. [ADR 0004](0004-the-centre-and-its-neighbourhood.md) allows a centre eight of them.
Measured against the pills the ring draws, eight is near what one ring holds: the limit was
that arithmetic, by hand.

Freezing it cost two things. Once the slots run out, `slotsFor`
([map-view.ts](../../web/src/map-view.ts)) assigns nothing, silently. And `ringSlots`
([placement.ts](../../web/src/placement.ts)) built candidates at one radius only, so supply dried
up near two dozen whatever the limit said — an invisible ceiling behind a documented one.

An unserved neighbour falls back on its tether, and the tether is going. A wide neighbourhood
would then draw fewer edges than it has, which [the-centre.md](../design/the-centre.md) forbids.

## Decision
A ring offers as many doorways as it has room for; a wider neighbourhood uses the next ring.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Per ring | Circumference over the widest name | The old limit already was this, uncomputed. |
| Wider than that | Step outward, on `seat`'s stride | Circumference is what more of them needs. |
| How far out | Rings within half the viewport's shorter side | A door off screen opens for nobody. |
| Two that would touch | Refused; the ring gives up early | The buried one loses its click, not its name. |
| Claiming one | Only a neighbour already past the margin | The pool must not go to names in view. |
| Paint order | Degree, as the ring is ranked | A tie must follow from something visible. |

## Alternatives considered
- **A larger literal.** Moves the line without removing it, and leaves `ringSlots`' ceiling.
- **No bound at all.** Lands on that ceiling instead, so the limit is learned by watching
  doorways fail to appear.
- **Overlap, settled by paint order.** What the ring does with colliding names. Wrong here: an
  unreadable name is a loss, an unclickable doorway is a dead end.
- **One ring, further out.** Buys circumference by pushing the first ring until a neighbour
  stops looking like one.

## Consequences
At the closest zoom a long-named neighbourhood gets about six doorways where eight were allowed.
The eight were nominal: `seat` walks outward with no idea where the screen ends, so some stood
off screen and others sat on each other.

Placement now depends on type: a font change moves every doorway. A name arriving late can
overhang its slot. And every settle measures a box per neighbour, not per slot held, because the
claim reads the camera.

## Assumptions and unknowns
- **Assumed a 2D context's advance width matches Cytoscape's.** Untested across font fallbacks.
- **The reach is read once a visit, and measured from the centre.** Seen at 320×280: the first
  ring is offered whatever the reach, so its slot can fall outside. Also
  [0033](0033-a-click-takes-no-camera.md).
- Unknown whether a doorway three rings out still reads as the centre's.
- Unknown how many doorways help before more stop helping.

## Revisit when
- A neighbour past the margin has no doorway at a zoom with visible room to spare.
- Anyone takes an outer-ring doorway for an ordinary node.
- A pill overhangs its slot by more than the slack allows.
- Changing the type moves every doorway, and somebody minds.
