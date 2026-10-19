# 0025 — When an off-screen marker stands

**Status:** 🔵 Proposed — one row amended by [0043](0043-off-screen-becomes-an-angle.md)
**Date:** 2026-08-11
**Deciders:** David HL

## Context
[ADR 0004](0004-the-centre-and-its-neighbourhood.md) gave the selected node a hollow
stand-in for a neighbour too far to draw a line to, chosen by edge span. The span is fixed
when the node is placed. Visibility depends on the camera, which moves. So the rule failed
both ways. Zoomed in, a neighbour well inside `LONG_EDGE` leaves the screen with no marker.
Zoomed out, the stand-in sits beside the node it replaces. 0004 allowed it only if that
duplicate never happened.

## Decision
An off-screen marker stands while its neighbour's label box is off screen.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What is measured | The label box, not the position | A neighbour draws as its name. Half a label reads. |
| Coming down | Any part of it shows | The duplicate should go early. |
| Going up | Clear by `MARKER_MARGIN` | Two thresholds, so a nudge and the nudge back agree. |
| Slots | Cut once a visit, only added to | `freeSpots` spreads what it gets. A second call moves them. |
| Ranked under the cap | Unlined first, then nearest | A line gives a direction; two stubs give almost none. |
| Selected node's reach | Half the viewport's smaller span | A selected node out of view hides its markers. |

## Alternatives considered
- **The span alone**, as 0004 had it. One threshold, no camera read. It draws the duplicate.
- **One threshold both ways.** Simplest. A node on the screen edge flips at every nudge.
- **The position, not the label box.** Cheaper. It gives a marker to a name still half legible.
- **Per frame, not when idle.** Never stale. Elements appear and disappear throughout a pan.
- **Limiting the markers to what can be seen.** Fixes the stand-in left off screen. It adds a
  second camera-dependent predicate that needs its own hysteresis margin.

## Consequences
The off-screen marker becomes the one thing the camera changes. The idle handler measures
each candidate every time the camera stops. Two visits at different zooms show different
markers. The cap keeps its value and changes its meaning. It was a limit for hubs. It became
the limit any close zoom reaches, until [0027](0027-a-ring-holds-what-it-holds.md).

This change also corrects the selected node's reach. Under a pan, the selected node changes
sooner and more often.

The rule holds only when the camera goes idle. After a zoom-out, a marker stays over a
legible node until the idle handler runs.

## Assumptions and unknowns
- **Assumed an off-screen marker is itself on screen.** Slots come from `freeSpots`, which
  ignores the camera. A crowded hub can leave the stand-in off screen too. The reach
  correction held this until [0033](0033-a-click-takes-no-camera.md).
- **Assumed the canvas is what the reader sees.** A neighbour under a panel passes this test
  and is hidden in fact.
- **`MARKER_MARGIN` outruns a keyboard nudge.** Untested against a flick that stops on it.
- Unknown whether a marker that changes with the zoom reads as one rule.

## Revisit when
- [drive-map.mjs](../../scripts/drive-map.mjs) fails its off-screen check.
- Anyone but the author sees the duplicate before the camera goes idle.
- Somebody needs an off-screen marker for a neighbour under a panel.
- The neighbours reach the cap at a zoom with no room for that many.
