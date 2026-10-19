# 0032 — A person selects the node

**Status:** 🔵 Proposed
**Date:** 2026-08-17
**Deciders:** David HL

## Context
[ADR 0003](0003-graph-exploration-demo-stack.md) made the selected node the one nearest the
middle of the screen. The selection followed the camera, so a click, a keystroke and a drag
were one rule.

Walk by pan was the cost. A place is permanent, so every node the middle passed over had its
neighbours placed for good. [ADR 0006](0006-only-the-centre-reads.md) slowed that
without ending it. [ADR 0027](0027-a-ring-holds-what-it-holds.md) let an off-screen marker's
claim follow the camera. That helps only while the selected node stays put during a
pan, and it never did.

Walk by pan was also the only way to explore without choosing a route. Nobody argued for it.

## Decision
A person selects the node. A pan or a zoom changes only the view. Ticking the
box below hands the selection to the camera.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What selects one | A click, a marker, a search hit, a component row | Each is a choice. |
| A camera move | Nothing, except the box below | Nobody chooses what a pan crosses. |
| Asking for the old rule | **Walk by pan**: off, remembered per browser | It changes what a drag means. |
| A selected node off screen | Still the selected node | The reader put it there. |
| A selected node deleted | The nearest node on screen is selected | Something has to be selected. |
| The way back | **Go to selected** | Built for the old rule. |

## Alternatives considered
- **Limit the pan** so the selected node cannot leave the viewport. Every marker stays
  reachable, at the price of the map beyond it.
- **Move the selection once the selected node is off screen**, with no box. Pans go on
  placing nodes, less often.
- **Leave the box out and wait.** One behaviour to reason about, but nobody has been watched.
- **The box on by default.** Matches every earlier version, and gives a stranger walk by pan
  unexplained.

## Consequences
Under the default, a pan raises off-screen markers and keeps them usable. A visit lasts as
long as the reader stays put. This reverses the last row of
[0025](0025-when-an-off-screen-marker-stands.md): a selected node off screen hides its
markers, and nothing prevents that.

Every claim above now holds for one mode, and a fault can reproduce under one only.

Whoever ticks the box pays its full cost, even after unticking. Nodes a pan placed stay placed:
nothing reassigns a position. The page also stores a
setting outside the graph, and clearing site data deletes it.

## Assumptions and unknowns
- **Assumed a still map does not read as a broken one.** No stranger has been watched panning
  away.
- **Assumed a reader who wants walk by pan will find the box.** It sits under the numbers, and
  the panel folds.
- **Assumed remembering the box is wanted.** Nobody has come back to a second session.
- Unknown whether the hysteresis margin suits walk by pan.

## Revisit when
- Anybody pans with the box unticked and reports the map as stuck.
- The same reader finds the box and unticks it more than once.
- Somebody ticks it, pans, and reports the placed nodes as a fault.
- A third mode is asked for, or anything else wants remembering.
