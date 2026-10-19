# 0020 — The components list is an index

**Status:** 🔵 Proposed
**Date:** 2026-08-09
**Deciders:** David HL

## Context
[0019](0019-every-component-has-an-address.md) gave every component an address, and the page a
list of them — built as errands. The API withheld the component holding `rootId`
(`index.ts`); the page dropped a row on landing.

So the list only shrank. Getting back meant typing a node's name from memory, and a short
window hid the list outright. Then nothing could be reached.

## Decision
The list names every component, including the one the map is in. A row stays after use.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| What is listed | Every component | A row you used is the row you look for again. |
| Start component | Named by the API, marked by the page | Only the store can say which one it is. |
| A row's second fact | On the map, or not | One click places a component; the other only pans. |
| Size on a row | Dropped | It ranks places to go; this ranks nothing. |
| How many are listed | A page of 20, and the total | A list that stops without saying so claims to be the graph. |
| Across a rebuild | The component id, never its row | A merge shifts every row beneath it. |

## Alternatives considered
- **Prev/next buttons.** A shrinking set has no next: prev would be history, next a to-do,
  behind two buttons drawn alike.
- **A back button, list unchanged.** Answers "where was I", not "where else is there".
- **Keep the filter, dim the visited rows.** Half the change: the component the map opens in
  stays unnamed.

## Consequences
Crossing back costs a click, and the map gains an index of where you are.

The cost: a click is no longer uniformly cheap. A row off the map places a whole component
permanently — `World` never reassigns a position — while a row on it only pans. The dim is
all that separates them.

The list outgrows the HUD, so it folds to a chevron and the left column becomes one flow. The
status line folds with it; the chevron takes its tone, so a failed read is a colour rather
than a sentence. Paging adds a route and a cursor.

## Assumptions and unknowns
- **Assumed a row's name is stable enough.** It is the node that won its unions, so a merge
  can rename a row while the component stays. A row that changes name under a reader is the
  sign.
- **Unknown which component the reader is in after a merge.** Only the store can say, from a
  node, and the page asks about none. The mark is dropped, not guessed.
- **Unknown what a page boundary survives.** Size is the sort key, so a join moves a row. Only
  the first page is reconciled. The rest go stale, as in
  [0019](0019-every-component-has-an-address.md).
- **Assumed counting stays cheap.** A `COUNT` per load, not a number anyone maintains. That
  would depend on the writes 0019 lets fail.

## Revisit when
- A reader reports the mark missing after an ordinary join.
- Somebody scrolls looking for a name rather than reading down. That calls for a search box.
- The count query is measured slow enough to maintain instead.
- A split renames a row often enough to be noticed.
