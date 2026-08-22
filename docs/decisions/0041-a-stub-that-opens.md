# 0041 — A stub that opens

**Status:** 🔵 Proposed — _decision pending_
**Date:** 2026-08-20
**Deciders:** David HL

## Context
An edge longer than `LONG_EDGE` is not drawn. Each end gets a stub instead: a 7 pixel dot
and a dashed lead ([the centre](../design/the-centre.md)). The stub gives a direction and
nothing else. It does not name the far end, and it cannot be parted.
[main.ts](../../web/src/main.ts) resolves an edge's two ends through `ended`, and that
returns nothing for a stub.

[ADR 0004](0004-the-centre-and-its-neighbourhood.md) turned down drawing the long edge, on
the grounds that it is "correct and unreadable". That was about drawing it always. Nobody
asked what a reader who wants one line should get.

## Decision
Resting the pointer on a stub draws the whole line. Moving the pointer away takes it down.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The trigger | The stub, its lead, or the open line | One edge, the one pointed at. |
| The line | Solid, in the active ink | An open line is an edge, not a stand-in. |
| The two stubs | Stop drawing while it is open | Two marks for one edge says the pair is still hidden. |
| The element | Built hidden by `add` | `drop` stays the only removal. |
| Parting it | Allowed, from the centre | Same rule every other line follows. |
| Hiding a stub | A second class, `eclipsed` | A ghost owns `hidden`; neither path tests the other. |

## Alternatives considered
- **Hovering the node** — opens every long edge that node owns. That is 0004's starburst
  on a hub.
- **Adding the line on the hover** — saves the hidden element. It also makes the pointer
  remove elements, and `drop` is meant to be the only removal.
- **Dashed, like the stub** — reads as a stand-in for something, which it no longer is.
- **`display: none` on the eclipsed stub** — a stub that stops taking the pointer reports
  the pointer leaving. The line then shuts under a pointer that never moved.

## Consequences
One extra edge element per long edge, hidden, for the life of the map.

The shut is deferred a frame. Cytoscape reports the element left before the element entered.
The reader also has to walk off a 7 pixel stub onto the line to right-click it.

A stub now takes the pointer. Every rule that would draw a node as something else has to
exclude it. `node[?hover]` needed `[!stub]`, to stop a pill sizing itself from an empty label.
That guard is the standing cost. A new node rule that forgets it draws on a dot.

## Assumptions and unknowns
- **A 7 pixel dot is a target a reader can hit.** At zoom 1 it draws at 7 pixels, and at the
  0.14 floor at 1. The 44 pixel lead helps. If it is unhittable, the fallback is a second
  trigger on the node.
- **One open line is enough.** Nobody has asked to compare two long edges at once.
- **Unknown: how often a reader meets a long edge.** `drive-stub-open.mjs` walks seven steps
  from the seed before one is drawn.

## Revisit when
- A reader reports pointing at a stub and getting nothing.
- The map draws more than about ten long edges at once, so hidden lines outnumber drawn ones.
- `LONG_EDGE` changes, which changes how many stubs exist.
