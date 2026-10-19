# 0017 — The second view goes

**Status:** 🔵 Proposed
**Date:** 2026-08-06
**Deciders:** David HL

## Context
[ADR 0005](0005-a-second-view-that-keeps-no-world.md) built a page that keeps nothing
between hops, to find out how much of [ADR 0003](0003-graph-exploration-demo-stack.md)'s
frozen placement was worth its cost. It named its own exit: when the same fix lands in both
demos, one of them should go.

Two such fixes are queued. Neither page survives a narrow window, and the panel that
writes to the graph is due to be rebuilt on a virtual DOM. Each would be done twice, over
stylesheets and boot helpers that were copied and have since diverged. Nobody has used the
second view far enough to report anything back.

## Decision
Delete the page, its sources, and the design document drawn around it. The map is the only
view. 0005 flips to Superseded and stays on disk as the record of what was tried.

## Alternatives considered
- **Keep both, and make each fix twice.** Honest while the experiment is live. But the
  experiment has produced no reading, so the duplicate pays for evidence nobody collects.
- **Freeze it: leave it unfixed at narrow widths.** A page broken on a laptop and still
  linked from the README is worse than an absent one.
- **Fold the second view into the map as a mode.** 0005 turned this down because frozen
  placement and per-hop positions contradict each other, and that has not changed.
- **Delete the map instead.** It holds the write path, the validated palette, and the
  records the browser work depends on.

## Consequences
The hop-based read of a neighbourhood is gone, and with it the only evidence about whether
frozen placement was necessary. Whoever asks the question next pays that cost, and starts
again from nothing.

A whole rendering approach goes out with the page: hand-written SVG driven by CSS
transitions, which was the cheaper answer for a drawing that small. What is left is a
Cytoscape page, so a future view starts from the heavier default.

The deletion pays for the rest. Every later change is smaller, and there is one stylesheet
to keep correct, in place of two that nobody was reconciling.

## Assumptions and unknowns
- **The second view was answering a question nobody is asking.** Wrong if a reader wants to
  know what one node sits next to and the map turns out to be the wrong shape for it.
- Git holds the page well enough to bring it back. Restoring it against a changed `api.ts`
  is untested, and gets harder the longer it sits.
- We chose not to put the page in front of anyone before removing it.

## Revisit when
- Someone needs one node and all its neighbours without the world around it.
- Frozen placement is questioned once more and no cheap comparison is left to make.
- A second page is proposed, which starts the duplication over.
