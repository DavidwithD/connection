# 0036 — A click that writes nothing

**Status:** 🔵 Proposed — panel and caret amended by [0049](0049-a-click-leaves-the-panel-alone.md)
**Date:** 2026-08-18
**Deciders:** David HL

## Context
[0029](0029-a-click-that-joins.md) gave a click on the selected node a second job. One
click armed a name in the [panel](0013-one-box-that-grows-into-an-edge.md), and the click
after it wrote an edge.

A click is a cheap gesture, and this one spends a write. Nothing states the pair before the
write, and the write log entry reports it afterwards. A typed name is different: the reader
reads it back before `↵` fires it.

## Decision
Clicking the selected node puts its name in the near end of the panel. The click writes
nothing to the graph.

[0049](0049-a-click-leaves-the-panel-alone.md) amends this. The click no longer fills the
panel, and the caret stays on the map.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Where the name goes | The near end, and the far end is emptied | One place, and one name held after a click. |
| The edge | `↵` in the far end writes it | A key writes, and a second click does not. |
| `⌘` on the click | Nothing | It carried a start name onto a write that has gone. |
| The caret | Into the far end | The name to join to is typed there. |
| The camera | Stays | The reader clicked a node in front of them — [0033](0033-a-click-takes-no-camera.md). |

## Alternatives considered
- **The write behind `⌘`.** One click loads and `⌘`-click joins. The gesture stays for
  whoever learned it. But a modifier nothing else on the map uses is a poor place for a write.
- **Ask before it writes**, as the delete menu does. The reader then answers a dialog on every
  second click, which is slower than typing the name was.
- **Leave 0029 alone.** Two clicks go on writing, and the undo goes on being the way back.
- **Load into the free end**, which is where 0029 put it. With no write to complete, both ends
  can hold a name and nobody is told that a pair is armed.

## Consequences
An edge needs the keyboard again. A path along a walk is one name typed per node, and the
click only moves the start name. Whoever built pairs by clicking pays.

Clicking the selected node no longer moves the camera to it. The arming click used to move
the camera. **Go to selected** does that now.

The caret still leaves the map on the click, so the arrows stop panning until `Esc`. 0049
keeps the caret on the map.

Two clicks on the selected node are harmless now. The map cannot reach the self-join refusal.

## Assumptions and unknowns
- **Assumed the joins made by clicking were not wanted.** Only the author has used the
  gesture, and nobody else has been watched with it.
- **Unknown whether a still map and a changed box read as a click that failed.** The box is at
  the top of the page, and the click is at the middle.

## Revisit when
- A path is built by hand, and the typing is reported as the slow part.
- A writing click is asked for again, behind a modifier or a mode.
- A third way into the panel arrives, and the near end stops being the obvious place for a
  name.
