# 0003 — Rendering stack for the graph demo

**Status:** 🔵 Proposed
**Date:** 2026-07-30
**Deciders:** David HL

## Context
A demo page has to draw an undirected cyclic graph and let someone explore it. The repo
has no frontend — [package.json](../../package.json) declares a Node service and
[ADR 0002](0002-single-table-layout.md) fixed the store as one table — so this puts a
browser build into a backend repo.

Three requirements decide the rest. Nothing may drift once drawn. Exploring means panning
continuously, the way a map does. And the node under the middle of the screen is the one
being looked at.

## Decision
Place nodes in one shared world space and pan a camera over it. A node is seated once,
keeps that position, and is never moved or duplicated. More graph is fetched as the
viewport approaches nodes that are still incomplete.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Model and renderer | Cytoscape | Canvas, hit-testing and labels without writing them. |
| World | One frozen position per node | Panning a map needs somewhere fixed to pan over. |
| Camera | Free drag-pan, wheel zoom to cursor | The view moves; the graph never does. |
| Accent | Whichever node is nearest the centre | The centre is a place, not a selection. |
| Long edges | A stub at each end, not a line | Keeps one-position honest without tangling. |
| Loading | Incomplete nodes near the viewport, on settle | Fetching follows attention. |

## Alternatives considered
- **A force layout (cola, fcose)** — the usual answer here, and where this record started.
  Ruled out by the first requirement: a simulation and frozen positions are one
  contradiction said twice.
- **Rebuilding the view around each new centre** — tried, and wrong. Discarding the view
  per step costs a fetch and a crossfade per gesture, so panning could never be smooth.
- **Duplicate placements** — a second copy beside a distant neighbour avoids long edges
  entirely. Rejected: the same label twice stops the picture being a drawing of the graph.
  Revisited in [0004](0004-the-centre-and-its-neighbourhood.md).
- **Sigma, or hand-rolled SVG** — both viable with no layout engine. Kept Cytoscape for
  hit-testing, labels and camera, the parts nobody enjoys writing twice.

## Consequences
Seating is order-dependent: the route walked decides where nodes land, so two people
exploring the same graph get different maps, neither wrong. In a crowded region the
placement search pushes outward for room, so nearness stops meaning much locally. Stubs
must be learned before they read as "this continues elsewhere".

The cost lands on anyone comparing one session to another. A browser build splits the repo
into two runtimes, so `npm test` stops covering everything.

## Assumptions and unknowns
- The bet: geometric nearness stays a good enough proxy for graph nearness once seating is
  local. Untested on anyone but the author.
- The placement search is assumed to find room quickly. Dense regions are unmeasured.
- Unknown whether a stub reads as a continuation or as damage.
- Degree decides which neighbours wait when a hub overflows, because it is the only
  signal the store has.

## Revisit when
- Panning stutters, or the placement search shows up in a profile.
- Stubs get read as anything other than "more this way".
- Two people need to compare maps, which order-dependent seating cannot support.
- Any question needs the whole graph at once, which this shape cannot answer.
