# 0033 — A click takes no camera

**Status:** 🔵 Proposed
**Date:** 2026-08-17
**Deciders:** David HL

## Context
[0032](0032-the-centre-is-named.md) put the camera under the reader's control. A drag only
changes what is on screen, and a centre scrolled out of view is what the reader asked for.
Clicking a node still glided it to the middle, so one gesture named a centre and moved the map.

The glide was doing a second job. `reach` bounds a doorway's ring at half the smaller viewport
span, measured from the centre node. That bound only describes a slot the reader can see while
the centre sits at the middle. The glide is what put it there.

## Decision
Clicking a node names it where it stands. The camera does not move.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| A click on the map | Names a centre, moves no camera | The reader chose where the camera is. |
| Its ring | Around the node, including off screen | The ring follows the node, not the frame. |
| A name asked for | Still travels — box, island, doorway, arming | The reader asked to be taken there. |
| Doorways off screen | Allowed | Preventing this needs a geometry change. |
| Both modes | The same | **Walk by pan** governs a drag, not a click. |
| The way to the middle | **Recentre** | Already on the page, and now the only mover. |

## Alternatives considered
- **Bound the slots to the viewport** rather than to a radius. Doorways stay reachable wherever
  the centre sits, and 0027's stranded slot goes with it. It rewrites `ringSlots` and
  `slotsAround` for a fault nobody has hit.
- **Raise a doorway only when its slot is on screen.** No geometry change, and none unreachable.
  A neighbour can then get none while usable slots sit unclaimed.
- **Tie it to the box**, so only the unticked side stops gliding. One click, two meanings.
- **Leave it.** The click keeps moving the camera that 0032 handed to the reader.

## Consequences
A centre named near an edge plans some of its doorways outside the viewport. The reader cannot
reach those without panning, and Recentre does not repair a plan already cut. A node clicked
near a corner can land under a panel, which covers its right-click menu.

The click path had no settle of its own. The glide's `viewport` events scheduled the pass that
raises doorways, and a node already read asks the store for nothing. Naming a node now
schedules that pass itself.

Clicking the same node twice moves nothing. [0036](0036-a-click-that-writes-nothing.md) took
the arming write off that click, and the camera with it.

## Assumptions and unknowns
- **Assumed a reader who clicks a node wants to read it, not travel to it.** The two were never
  separable before, so nobody has been watched choosing.
- **Assumed Recentre is enough** for a centre whose doorways landed outside the viewport.
- Unknown how often a ring is clicked into the panels.
- Unknown whether a still map reads as a click that failed.

## Revisit when
- Somebody clicks a node and reports that nothing happened.
- A doorway the viewport cut off is wanted often enough that Recentre stops answering.
- The right-click menu is reported missing on a centre under a panel.
- The glide is asked for again.
