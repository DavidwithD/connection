# 0038 — A drag that joins two nodes

**Status:** 🔵 Proposed
**Date:** 2026-08-18
**Deciders:** David HL

## Context
[0036](0036-a-click-that-writes-nothing.md) took the write off the centre click, and the
keyboard has been the only way to an edge since. The map already writes: it deletes a node, and
it parts a pair ([0031](0031-parting-an-edge-from-the-map.md)). An edge is the write it has no
gesture for.

[building-a-graph.md](../requirements/building-a-graph.md) asks that two nodes a reader can see
be joined. Both names are typed into the panel instead, while one sits under the pointer.

`boxSelectionEnabled` is off in [map-view.ts](../../web/src/map-view.ts). Shift with a drag is
free.

## Decision
Hold shift, drag from one node to another, and the two are joined.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What holds the state | The mouse button | Press, drag, release. No mode is left. |
| Either end | Any node drawn, or a ghost as the node it names | The rule [`ended`](../../web/src/main.ts) already follows. |
| A release over nothing | Writes nothing | The reader let go over no node. |
| The write | On the release, carrying an undo | Nothing is destroyed, so an undo is enough. |
| The arrow | Over the map, not an element on it | No position on the map may change. |
| The panel | Untouched | The gesture shows its own pair. |

## Alternatives considered
- **A menu row that arms the next click.** Right-click, take `join to`, then click the second
  node. It announces itself, and the panel could hold the first name while it waits. The cost
  is a mode: a second row in a menu built for one, and a rule for every click while it is
  armed.
- **A menu row that fills the panel.** The first name lands in an end and the second is typed.
  That is the click 0036 already gives, reached by a longer route.
- **Leaving 0036 as it stands.** A mouse then walks the graph without ever building it.

## Consequences
Nothing on screen offers this gesture. The row in the keys panel is the only announcement of
it, and a touch screen has no key to hold at all.

Panning is off while the button is held, so both nodes have to be on screen when the drag
starts. A node off screen is joined from the panel, as before.

Shift with a drag is spent, and box selection cannot have it later.

The arrow draws over the canvas rather than on it, so nothing in
[map-view.ts](../../web/src/map-view.ts) owns it. Every position on the map stays fixed, and one
drawing surface sits outside the renderer.

## Assumptions and unknowns
- **Assumed the pan can be called off at `tapstart`.** Cytoscape has begun one by then, and a
  restore that is missed leaves the map unable to pan at all.
- **Assumed nothing else will want shift with a drag.** Box selection is the only other
  claimant.
- **Unknown whether a release over empty space reads as a cancel or as a failure.** Only the
  author has let go of one.

## Revisit when
- Box selection needs shift with a drag, or another gesture does.
- An edge nobody meant is reported, once a drag has written one.
- The gesture is asked for on a touch screen, where no key can be held.
