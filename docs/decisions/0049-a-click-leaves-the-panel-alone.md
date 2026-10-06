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
On a node click, `main.ts` copies the node's name and stops. The join panel's inputs keep their
values.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The centre's click | Copies the name, and nothing else | [0039](0039-any-nodes-name-on-the-clipboard.md) keeps the clipboard. |
| The caret | Stays on the map | The arrow keys keep panning. |
| A name in the panel | Typed, pasted, or a receipt's name button | Each one starts in the panel. The reader sees the name land. |
| A join by mouse | Shift-drag | [0038](0038-a-drag-that-joins-two-nodes.md) covers it. |

The receipt's name button stays. The reader clicks it inside the panel, next to the inputs it
fills. The centre's click happened on the map, and the panel at the top of the page changed
out of view.

This record replaces three parts of 0036. The first is the sentence under its Decision
heading. The second is its rows on where the name lands and where the caret goes. The third is
its consequence about the caret. 0036's rule on writes holds. A click on the map writes no
edge. An edge comes from a key, or from the drag in 0038.

`JoinPanel.take` in [join.ts](../../web/src/join.ts) is deleted. It had no other caller.

## Alternatives considered
- **Keep 0036.** The click goes on arming a pair the reader may not see.
- **Fill the panel only with a held key.** A second gesture to learn, and shift-drag already joins.
- **Remove the receipt's name button too.** Then every name in the panel is typed or pasted.
  The button is the one way back to a node the reader just wrote, and the click happens
  where its result shows.

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
