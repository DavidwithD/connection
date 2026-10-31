# 0042 — The map draws on a sphere

**Status:** 🔵 Proposed — one row amended by [0043](0043-off-screen-becomes-an-angle.md)
**Date:** 2026-08-25
**Deciders:** DavidwithD

## Context
The map is a flat plane under one pan and one zoom. A node panned past the left edge is
gone until the reader pans back.
[ADR 0003](0003-graph-exploration-demo-stack.md) chose Cytoscape, which supplies that camera,
hit-testing, label boxes and the draw.

A curved surface compresses a node toward the edge, so more of the graph stays on
screen. Cytoscape applies one affine transform to the whole canvas. No stylesheet of its own
can express a per-node projection. So we chose the surface and the library together.

## Decision
The map draws on a sphere. `project` runs at draw time, and the positions in
[world.ts](../../web/src/world.ts) never change.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Surface | Sphere, seen head on, visible limit at 90° | Undistorted at the middle, gone at the edge |
| Renderer | One new one; Cytoscape goes at parity | Nothing needs a flat path |
| Curvature | A reader setting, 0.7 to 3.0 | Its top end already reads as flat |
| Marks | Shrink by `cos(t)`, uniformly | A fade and a squash both measured redundant |
| Marker slots | Stay world positions | Measured to need no change |
| Off screen | `t >= 90°` | The visible limit bounds the view, not the viewport rectangle |

Nothing wraps: a node leaving the left of the screen returns only by panning right.

## Alternatives considered
- **Feed Cytoscape projected positions each frame** — 20 fps against 60, on 2015 nodes. That
  benchmark drew no labels and set no per-node size, so 20 is a ceiling.
- **Two renderers, Cytoscape keeping a flat map** — the slider's top end already reads as flat,
  and every later feature would be written twice.
- **Curve the world when nodes are placed** — precomputable, and it draws a different map,
  curved on the graph instead of the screen.
- **Precompute the projection into the positions** — a projected position depends on the
  camera, so the next frame invalidates every one.
- **Warp the rendered canvas as a texture** — cheapest to write, and it blurs every name.
- **Curve only the far nodes** — every name stays readable, and two scales share one screen.

## Consequences
A node near the visible limit cannot be clicked: the target is smaller than the pointer. The
corners are empty at curvature 1. A name shrinks near the limit. All three are accepted.

The new renderer owns hit-testing, label measurement, draw order and the camera. Five drive
scripts reach nodes through Cytoscape and need another handle.

Off-screen markers matter more. Panning back is the only other way to a node past the limit.

## Assumptions and unknowns
- **A name stays world-sized** — every slot pair `touches` cleared in world space also cleared
  on screen, from zoom 0.30 to 2.00.
- **60 fps holds at 2000 nodes** — measured without markers or names. We chose not to find the
  ceiling first.
- **A reader accepts an unreadable outer range** — untested with anybody.

## Revisit when
- A graph the store can hold drops below 60 fps on the new renderer
- A reader reports losing a node at the visible limit
- Somebody asks for a flat map

## TODO
- [ ] Weigh the three accepted costs against a reader, then set the status
- [x] Point at this record from the page describing the new renderer
