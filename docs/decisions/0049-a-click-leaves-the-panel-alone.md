# 0049 — A click leaves the panel alone

**Status:** 🔵 Proposed
**Date:** 2026-10-04
**Deciders:** David HL

## Context
[0036](0036-a-click-that-writes-nothing.md) let a click on the centre fill the
[panel](0013-one-box-that-grows-into-an-edge.md). The name went into the near input. The caret
went into the far input.

The next name typed there joined to the clicked node. The reader did not ask for that pair.
The caret also left the map, so the arrow keys stopped panning.

## Decision
A click on a node fills no input in the panel.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The centre's click | Copies the name, and nothing else | [0039](0039-any-nodes-name-on-the-clipboard.md) keeps the clipboard. |
| The caret | Stays on the map | The arrow keys keep panning. |
| A name in the panel | Typed, or `/` then typed | A pair comes from keys the reader pressed. |
| A join by mouse | Shift-drag | [0038](0038-a-drag-that-joins-two-nodes.md) covers it. |

`JoinPanel.take` in [join.ts](../../web/src/join.ts) is deleted. It had no other caller.

## Alternatives considered
- **Keep 0036.** The click goes on arming a pair the reader may not see.
- **Fill the panel only with a held key.** A second gesture to learn, and shift-drag already joins.

## Consequences
A name reaches the panel by typing, by paste, or from a receipt's name button. A reader who
used the click to load a name now pastes it, since the click copied it.

The cost is one more step per name. A path built by clicking now needs a paste or a drag for
each node.

## Assumptions and unknowns
- **Assumed shift-drag covers the joins made through the click.** Wrong if a reader asks for
  the click again.

## Revisit when
- An issue lands that asks for a click to load a name into the panel.
- A second reader builds a path by hand and reports the paste as the slow step.
