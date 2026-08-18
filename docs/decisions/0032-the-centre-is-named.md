# 0032 — The centre is named

**Status:** 🔵 Proposed
**Date:** 2026-08-17
**Deciders:** David HL

## Context
[ADR 0003](0003-graph-exploration-demo-stack.md) made the centre whichever node lay nearest the
middle of the screen. The mark followed the camera, so a click, a keystroke and a drag were all
one rule.

Drift was the cost. A seat is permanent, so every node the middle swept across had its ring
seated for keeps. [ADR 0006](0006-only-the-centre-reads.md) slowed that without ending it, and
[ADR 0027](0027-a-ring-holds-what-it-holds.md) let a doorway's claim answer to the camera. That
pays only while the centre stays behind, and it never did.

The same drift was also the only way to explore without choosing a route. Nobody argued for it.

## Decision
The centre is named. Panning and zooming are looking. The reader hands the mark back to the
camera by ticking the box below.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What names one | A click, a doorway, a search hit, a crossing | Each is somebody choosing. |
| A camera moved | Nothing, bar the box below | Drift is not a choice. |
| Asking for the drift | **Walk by pan**: off, remembered per browser | It changes what a drag means. |
| A centre off screen | Still the centre | The reader put it there. |
| A centre deleted | Nearest on screen claims the mark | Something has to hold it. |
| The way back | **Recentre** | Built for the old rule. |

## Alternatives considered
- **Leash the pan** so the centre cannot leave the viewport. Every doorway stays reachable, at
  the price of the map beyond it.
- **Hand the mark over once the centre leaves the screen**, with no box. Drift goes on seating,
  at a longer stride.
- **Leave the box out and wait.** One behaviour to reason about, but nobody has been watched.
- **The box on by default.** Matches every version before this one, and hands a stranger the
  drift before explaining it.

## Consequences
Under the default a pan raises doorways instead of spending them, and a visit lasts as long as
the reader stays put. This reverses the last row of [0025](0025-when-a-ghost-stands.md): an
unseen centre hides the doorways it raised, and nothing prevents one.

Every claim above is now a claim about a mode, and a fault can reproduce under one tick only.

Whoever ticks the box takes the drift's full cost, and keeps paying after unticking. The nodes a
pan seated stay seated, because nothing reassigns a position. The page also keeps something
outside the graph, and clearing site data takes it.

## Assumptions and unknowns
- **Assumed a still map does not read as a broken one.** No stranger has been watched panning
  away from the centre.
- **Assumed a reader who wants the drift will find the box.** It sits under the numbers, and
  the panel folds.
- **Assumed remembering the box is wanted.** Nobody has come back to a second session.
- Unknown whether the hysteresis suits a reader who chose the drift.

## Revisit when
- Anybody pans with the box unticked and reports the map as stuck.
- The same reader finds the box and unticks it more than once.
- Somebody ticks it, pans, and reports the seated nodes as a fault.
- A third mode is asked for, or anything else wants remembering.
