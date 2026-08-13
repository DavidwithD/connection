# 0028 — Where a chained name lands

**Status:** 🔵 Proposed
**Date:** 2026-08-13
**Deciders:** David HL

## Context
The widget [0013](0013-one-box-that-grows-into-an-edge.md) settled holds two ends, and the
end that fires empties for the next name. That serves a run of names from one node. A path
is the other shape, and it costs two names a node: once as the thing joined to, again as the
thing the next write joins from.

Clicking a name in a receipt spares the second. It needs the mouse, though, and it reaches
only a write that has landed. A modifier on the pick can spare it as the write is fired —
and then the question is which of the two ends the name goes into.

## Decision
`⌘` held on a pick puts the name it writes into the end the caret is not in.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Which end takes it | The one not being typed in | The next name needs the caret where it is. |
| The anchor it meets | Let go of | Two ends hold one anchor between them. |
| The camera | Follows it, as any arming does | An end holding a name is armed, whatever armed it. |

## Alternatives considered
- **The near end, which is where a receipt loads.** One landing place for both ways of going
  on, and a reader could predict it. It breaks on a fan-in, fired from the near end: the name
  would arrive under the caret, and the next one typed would type over it.
- **A third Enter.** ⌘ carries no opinion about which node is meant, only about what follows,
  so it rides on the two keys that do rather than splitting them three ways.
- **Holding both anchors.** The widget would stop reading as one edge, which is the thing
  [0013](0013-one-box-that-grows-into-an-edge.md) decided it draws.

## Consequences
A run of names from one node cannot be resumed after a chained pick. The node it was working
from is out of the widget, and comes back only through a receipt or by being typed again.

An end can hold a name the typist never put there, which is a second way to be left naming a
node that has since left the store. Whatever clears one end of that has to clear both.

## Assumptions and unknowns
- **Assumed the path is worth the anchor.** Both shapes run through the same widget, and this
  spends the one a run of names holds.
- **Unknown whether the caret staying put reads as help or as a lost place.** Only the author
  has typed a chain.

## Revisit when
- A run of names is broken by a chained pick often enough to be said out loud.
- The ends stop being stacked, so "the end you are not typing in" names no fixed place.
