# 0033 — A click takes no camera

**Status:** 🔵 Proposed
**Date:** 2026-08-17
**Deciders:** David HL

## Context
[0032](0032-the-centre-is-named.md) put the camera under the reader's control. A drag only
changes what is on screen. A selected node scrolled out of view is what the reader asked for.
A click on a node still selected it and moved the camera to put it in the middle.

The camera move did a second job. `reach` limits an off-screen marker's circle to half the
smaller viewport span, measured from the selected node. That limit keeps a slot visible only
while the selected node is at the middle. The camera move put it there.

## Decision
A click on a node selects it where it stands, and the camera stays still.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| A click on the map | Selects a node, camera stays still | The reader chose where the camera is. |
| Its neighbours | Around the node, including off screen | They are placed around the node. |
| A name asked for | Camera move: search, component, marker, arming | The reader asked to go there. |
| Markers placed off screen | Allowed | Preventing it needs a geometry change. |
| Both modes | The same | **Walk by pan** applies to a drag only. |
| The way to the middle | **Go to selected** | Already on the page. Now the only camera move. |

## Alternatives considered
- **Limit the slots to the viewport** instead of a radius. Markers stay on screen wherever the
  selected node is, and so does 0027's slot. It rewrites `circleSlots` and
  `slotsAround` for a fault nobody has hit.
- **Draw a marker only when its slot is on screen.** No geometry change, and every marker is
  reachable. A neighbour can then get none while usable slots stay unclaimed.
- **Tie it to the checkbox**, so only the unticked setting stops the camera move. One click,
  two meanings.
- **Leave it.** The click keeps moving the camera 0032 gave the reader.

## Consequences
A node selected near an edge plans some of its markers outside the viewport. The
reader cannot reach those without panning. **Go to selected** keeps a plan already cut. A node
clicked near a corner can sit under a panel, which covers its right-click menu.

The click path had no idle step of its own. The camera move's `viewport` events scheduled the
marker pass. A node already read asks the store for nothing. Selecting
a node now schedules that pass itself.

Clicking the same node twice moves nothing. [0036](0036-a-click-that-writes-nothing.md) took
the arming write off that click, and the camera with it.

## Assumptions and unknowns
- **Assumed a reader who clicks a node wants to read it, not travel to it.** The two were never
  separable before, so nobody has been watched choosing.
- **Assumed Go to selected is enough** when a node's markers fell outside the viewport.
- Unknown how often a click puts the neighbours under the panels.
- Unknown whether a still map reads as a click that failed.

## Revisit when
- Somebody clicks a node and reports that nothing happened.
- Go to selected stops helping with markers the viewport cut off.
- The right-click menu is reported missing on a selected node under a panel.
- Someone asks again for a click to move the camera.
