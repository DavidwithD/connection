# 0028 — Where a chained name lands

**Status:** 🔵 Proposed
**Date:** 2026-08-13
**Deciders:** David HL

## Context
The widget from [0013](0013-one-box-that-grows-into-an-edge.md) holds two ends. The end
that fires empties for the next name. That serves a run of names from one node. A path is
the other shape, and it costs two names a node. The typist enters each node once as the
thing joined to, and again as the thing the next write joins from.

Clicking a name in a write log entry saves the second. It needs the mouse, though, and it
reaches only a write that has finished. A modifier on the pick can save it as the write
fires. The question is then which of the two ends the name goes into.

## Decision
`⌘` held on a pick puts the name it writes into the end the caret is not in.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Which end takes it | The one not being typed in | The next name needs the caret where it is. |
| The start name it meets | Let go of | Two ends hold one start name between them. |
| The camera | Follows it, as any arming does | An end holding a name is armed, whatever armed it. |

## Alternatives considered
- **The near end, which is where a write log entry loads.** One place for both ways of
  going on, and a reader could predict it. It breaks on a fan-in fired from the near end.
  The name would arrive under the caret, and the next name typed would replace it.
- **A third Enter.** ⌘ says nothing about which node is meant, only about what follows. So
  it combines with the two keys that do, and they stay two.
- **Holding both start names.** The widget would stop reading as one edge, which is the thing
  [0013](0013-one-box-that-grows-into-an-edge.md) decided it draws.

## Consequences
A run of names from one node cannot be resumed after a chained pick. The node it was working
from is out of the widget. It comes back only through a write log entry or by being typed
again.

An end can hold a name the typist never put there. That is a second way for an end to name
a node deleted from the store since. Whatever clears one end of that has to clear both.

## Assumptions and unknowns
- **Assumed the path is worth the start name.** Both shapes run through the same widget,
  and this spends the start name a run of names holds.
- **Unknown whether the caret staying put reads as help or as a lost place.** Only the author
  has typed a chain.

## Revisit when
- A run of names is broken by a chained pick often enough to be said out loud.
- The ends stop being stacked, so "the end you are not typing in" names no fixed place.
