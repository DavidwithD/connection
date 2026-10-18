# 0034 — What reading cannot check

**Status:** 🔵 Proposed
**Date:** 2026-08-18
**Deciders:** David HL

## Context
This repo has no behavioural test. `npm test` is a typecheck and two documentation gates, and
none of it executes a line of `web/src/`. Only reading the code checks the rules the map obeys.

Three browser drivers sit in `scripts/`, and no record says why. They arrived one at a time
with the features they photographed. Playwright is deliberately not a dependency, so nothing
automated has ever run them, and nothing ever will.

That gap showed. `drive-map.mjs` reported a pass against a blank page for an unknown stretch.
Playwright opens a fresh profile, and the graph has lived in that profile since
[0030](0030-the-graph-moves-into-the-browser.md), so every check passed by having nothing to
check. A second fault sat behind the first, and the first fault hid it.

## Decision
The drivers stay, as instruments a person runs. No gate runs them.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What they are for | Measuring what a reader cannot | Slot overlap, placed counts, a marker shown while its node is on screen. |
| What runs one | A person, mid-change | Playwright is not a dependency. |
| `npm test` and CI | Neither, ever | A hundred megabytes to drive a demo. |
| The screenshots | Kept, and not the point | Anyone can open the page and look. |
| Reaching into the app | Allowed | The alternative is a seam in the renderer. |

## Alternatives considered
- **Delete all three.** They are 1106 lines against 7129 of app, with no record and nothing
  running them. The placement invariants would then have no check at all, and reading is what let
  `circleSlots` ship the collision `9d41f4e` had to fix.
- **Strip them to screenshots**, which is what `drive-map.mjs` claims in its own header to be.
  Anyone can open the page and look; nobody can count eighteen bounding boxes pairwise.
- **Add Playwright and run them in CI.** The header already refused that price, and a demo does
  not earn it.
- **Export a test seam** from `map-view.ts` so nothing re-derives geometry. That puts test
  shape into the one file [0003](0003-graph-exploration-demo-stack.md) keeps the renderer in.

## Consequences
Each driver re-derives what it measures, such as `reach` and the split in an off-screen
marker's id. That is the ongoing cost, accepted and left unfixed. One of those copies already
differs from the app, and nothing catches the next one.

A driver reports only when somebody runs it, so a fault one would have caught can still land.
Seeding through the transfer page closes the worst version of that: an empty profile now throws
rather than printing zeroes and a tick.

## Assumptions and unknowns
- **Assumed whoever changes placement runs the driver.** The blank-page fault suggests it goes
  unrun for long stretches.
- **Assumed a hundred megabytes is still the wrong price** for a demo's CI.
- Unknown whether the screenshots are ever looked at.
- Unknown how many of the invariants a person would catch by eye anyway.

## Revisit when
- A driver goes stale again and nobody notices.
- A second re-derived value stops matching the app.
- Playwright arrives as a dependency for some other reason.
- The invariants stop being geometric, and reading could check them.
