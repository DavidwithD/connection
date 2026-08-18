# 0036 — A click that writes nothing

**Status:** 🔵 Proposed
**Date:** 2026-08-18
**Deciders:** David HL

## Context
[0029](0029-a-click-that-joins.md) gave the centre click a second job. One click armed a name
in the [panel](0013-one-box-that-grows-into-an-edge.md), and the click after it wrote an edge.

A click is a cheap gesture, and this one spends a write. Nothing states the pair before it
lands, and the receipt reports it afterwards. A typed name is different: the reader reads it
back before `↵` fires it.

## Decision
Clicking the centre puts its name in the near end of the panel. Nothing reaches the graph.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Where the name lands | The near end, and the far end is emptied | One landing place, and one name held after a click. |
| The edge | `↵` in the far end writes it | A write follows a key, not a second click. |
| `⌘` on the click | Nothing | It carried an anchor onto a write that has gone. |
| The caret | Into the far end | The name to join to is typed there. |
| The camera | Stays | The reader clicked a node in front of them — [0033](0033-a-click-takes-no-camera.md). |

## Alternatives considered
- **The write behind `⌘`.** One click loads and `⌘`-click joins. The gesture survives for
  whoever learned it, and a modifier nothing else on the map uses is a poor place for a write.
- **Ask before it lands**, as the delete menu does. The reader then answers a dialog on every
  second click, which is slower than typing the name was.
- **Leave 0029 alone.** Two clicks go on writing, and the undo goes on being the way back.
- **Load into the free end**, which is where 0029 put it. With no write to complete, both ends
  can hold a name and nobody is told that a pair is armed.

## Consequences
An edge needs the keyboard again. A path along a walk is one name typed per node, and the
click only moves the anchor. That lands on whoever built pairs by clicking.

Clicking the centre no longer recentres it. The arming click used to move the camera, and
**Recentre** is what does it now.

The caret still leaves the map on the click, so the arrows stop panning until `Esc`.

Two clicks on the centre are harmless now, so the self-join refusal cannot be reached from the
map.

## Assumptions and unknowns
- **Assumed the joins made by clicking were not wanted.** Only the author has used the
  gesture, and nobody else has been watched with it.
- **Unknown whether a still map and a changed box read as a click that failed.** The box is at
  the top of the page, and the click is at the middle.

## Revisit when
- A path is built by hand, and the typing is reported as the slow part.
- A writing click is asked for again, behind a modifier or a mode.
- A third way into the panel arrives, and the near end stops being the obvious place to land.
