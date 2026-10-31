# 0048 — A long name is cut to fit

**Status:** 🔵 Proposed
**Date:** 2026-10-03
**Deciders:** David HL

## Context
A name draws as one line in a label box ([0012](0012-the-name-is-the-node.md)). A long name runs
under its neighbours. A very long name leaves the screen.

`slotBox` in [sphere-view.ts](../../web/src/sphere-view.ts) sizes every neighbour's slot from the
widest name. One long name widens all the slots and pushes the circle outward.

[map-view.ts](../../web/src/map-view.ts) is Cytoscape and is due to go
([0042](0042-the-map-draws-on-a-sphere.md)). This record covers the sphere view only.

## Decision
A neighbour's name and the selected node's name are cut to a short label box. The name under
the pointer opens in full.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Neighbour and marker names | At most 150 px wide and 2 lines, then `…` | A slot stays small, and so does the circle. |
| The name under the pointer | 260 px wide, every line | The reader asked for this name. |
| The selected node | At rest as a neighbour. Under the pointer 300 px, every line | The largest mark stays small until the reader asks. |
| Slot size | Widest cut name by tallest cut name | A graph of short names lays out as before. |
| Line breaks | At spaces, or between characters in a word too wide | Chinese and Japanese have no spaces. |
| Touch | No change | A tap moves the camera there. The selected node shows its full name. |

## Alternatives considered
- **A side panel with the hovered name.** It covers nothing. It moves the eye off the map.
- **A tooltip on hover.** The canvas has no element to hang one on.
- **A smaller font for long names.** The names get harder to read, and sizes differ with no meaning.
- **One line with `…`.** It cuts a 30-character name that two lines show whole.

## Consequences
The trade-off: a name over about 45 to 50 characters shows a prefix until the pointer opens
it. That is the price of a small circle.

A touch reader has no hover, so a cut name stays cut. A long press that opens a name would
fix this.

An opened label box covers its neighbours while the pointer is on it.

A two-line label box is taller than a one-line box. Neighbour positions are spaced for discs.
Two neighbours' label boxes can overlap more than before. The better-connected name draws on
top, as [the-centre.md](../design/the-centre.md) says. Placing by label box height is not part
of this record.

The selected node shows a prefix at rest. A click copies its full name
([0039](0039-any-nodes-name-on-the-clipboard.md)).

[map-view.ts](../../web/src/map-view.ts) keeps one-line names until it is removed.

## Assumptions and unknowns
- **150 px and 2 lines suit the names in use.** Checked against a mockup, not a real graph.
- **An off-screen marker needs no hover.** Its node opens once the camera move ends.
- **An opened label box does not flicker under the pointer.** The opened box contains the
  closed one. [drive-long-names.mjs](../../scripts/drive-long-names.mjs) holds the pointer
  near the far edge and finds it open. It ran once, in Chrome.

## Revisit when
- A reader reports two neighbour names they could not tell apart after the cut.
- A reader cannot tell which long-named selected node they are on without hovering it.
- Cytoscape is removed. This record then covers the only renderer.
