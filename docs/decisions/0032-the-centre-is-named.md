# 0032 — The centre is named

**Status:** 🔵 Proposed
**Date:** 2026-08-12
**Deciders:** David HL

## Context
[ADR 0003](0003-graph-exploration-demo-stack.md) made the centre whichever node lay nearest the
middle of the screen. So the mark followed the camera: `focus` animates without promoting
anything and an arrow key is a pan, which left click, keystroke and drag one rule wearing three
hats.

Drift was the cost. A seat is permanent, so every node a gesture swept the middle across had its
ring seated for keeps. [ADR 0006](0006-only-the-centre-reads.md) narrowed the reading to the
centre and bought a wait, which slowed that without ending it.

[ADR 0027](0027-a-ring-holds-what-it-holds.md) then let a doorway's claim answer to the camera, a
granted claim never being revoked. That pays only if the camera travels while the centre stays
behind. It could not. Clearing the margin takes half a viewport of panning, by which point the
mark had changed hands and the plan was gone.

## Decision
The centre is named. Panning and zooming are looking.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What names one | A click, a doorway, a search hit, a crossing | Each is somebody choosing. |
| A camera that moved | Nothing | Drift is not a choice. |
| A centre off screen | Still the centre | The reader put it there. |
| The way back | **Recentre**, already on the page | Built for the old rule, kept. |
| A centre taken off the map | Nearest on screen claims the mark | Something has to hold it. |
| Arrow keys | Pan, like a drag | Every gesture that only looks. |

## Alternatives considered
- **Leash the pan** so the centre cannot leave the viewport. Every doorway stays reachable, at
  the price of the rest of their own map.
- **Hand the mark over once the centre leaves the screen.** No new control, and 0025's guarantee
  survives — but drift goes on seating, at a longer stride.
- **Doorways pinned to the viewport** rather than to the rings. 0027 is the record of why a ring
  is what holds them.

## Consequences
A pan raises doorways instead of spending them: 0027's claim rule is exercised by a gesture at
last, not the zoom alone.

A visit lasts as long as the reader stays put, and its reach was read at the start. Zoom in far
enough and the outer rings fall outside the frame. Taken on the pan's terms: a doorway out of
view is not a doorway lost.

This reverses the last row of [0025](0025-when-a-ghost-stands.md) — an unseen centre hides the
doorways it raised, and nothing prevents one. The hysteresis and the per-frame tracker go too.

## Assumptions and unknowns
- **Assumed a still map does not read as a broken one.** No stranger has been watched panning
  away from the centre.
- **Assumed Recentre is findable**, having gone unused under a rule that never needed it.
- Unknown whether an off-screen centre wants saying in the HUD.
- Unknown how far anyone pans before wanting the mark to follow.

## Revisit when
- Anybody pans away and reports the map as stuck.
- Somebody needs a doorway the zoom dropped outside the frame mid-visit.
- The HUD's name starts being read as whatever is under the middle.
- Keyboard walking is asked for, once the arrows no longer offer it.
