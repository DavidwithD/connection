# 0025 — When a ghost stands

**Status:** 🔵 Proposed
**Date:** 2026-08-11
**Deciders:** David HL

## Context
[ADR 0004](0004-the-centre-and-its-neighbourhood.md) gave the centre a hollow stand-in for a
neighbour too far to draw a line to, chosen by span. A span is settled when the node is
seated; visibility is settled by the camera, which moves. So the rule missed both ways.
Zoomed in, a neighbour well inside `LONG_EDGE` leaves the screen unrepresented. Zoomed out,
the stand-in sits beside the node it replaces — the duplicate 0004 admitted it on condition
it would never be.

## Decision
A ghost stands while the box its neighbour draws is off screen.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What is measured | The drawn box, not the seat | A ring node draws as its name; half a label reads. |
| Coming down | Any part of it shows | The duplicate is worth being eager about. |
| Going up | Clear by `GHOST_MARGIN` | Two thresholds, so a nudge and the nudge back agree. |
| Slots | Cut once a visit, only added to | `seat` spreads what it is given; asking again walks them. |
| Ranked under the cap | Unlined first, then nearest | A line gives a direction; two stubs give almost none. |
| The accent's reach | Half the viewport's smaller span | An unseen accent hides its own ghosts. |

## Alternatives considered
- **The span alone**, as 0004 had it — one threshold, no camera read, and it draws the
  duplicate that ruled it out.
- **One threshold both ways** — simplest, and a node on the edge flips at every nudge.
- **The seat, not the box** — cheaper, and it ghosts a name still half legible.
- **Per frame, not on the settle** — never stale, but elements arrive and leave throughout
  a pan.
- **Bounding the ring by what can be seen** — fixes the stranded stand-in, but adds a second
  camera-dependent predicate needing its own hysteresis.

## Consequences
The ghost becomes the one thing the camera changes, so every stopped camera costs a
measurement per candidate, and two visits at different zooms show different rings. The cap
changes meaning, not value: a hub backstop became the bound any close zoom reaches, until
[0027](0027-a-ring-holds-what-it-holds.md) let the ring decide.

The accent's reach is corrected with it, so the centre changes hands sooner and varies more
under a pan.

The rule holds at settle boundaries, not continuously: a zoom-out leaves a ghost over a
legible node until the settle fires.

## Assumptions and unknowns
- **Assumed a ghost is itself on screen.** Slots come from `seat`, which knows nothing about
  the camera, so a crowded hub can strand the stand-in too. Not seen since the reach
  correction, in [drive-map.mjs](../../scripts/drive-map.mjs).
- **Assumed the canvas is what the reader sees.** The panels float over it, so a neighbour
  under one passes this test and is hidden in fact.
- **`GHOST_MARGIN` outruns a keyboard nudge.** Untested against a flick that stops on it.
- Unknown whether a doorway coming and going with the zoom reads as one rule or two.

## Revisit when
- [drive-map.mjs](../../scripts/drive-map.mjs) fails its off-screen check.
- Once the settle window's duplicate is visible to anyone but its author.
- Somebody needs a doorway for the neighbour sitting under a panel.
- A ring hits the cap at a zoom with no room for that many.
