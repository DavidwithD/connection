# 0039 — Any node's name on the clipboard

**Status:** 🔵 Proposed
**Date:** 2026-08-19
**Deciders:** David HL

## Context
[0037](0037-the-centres-name-on-the-clipboard.md) settled the click on the centre, and the case
for it is there rather than here. Its last revisit trigger is what this answers: a name wanted
for a node the reader is not standing on.

Every argument that made one name worth copying holds for the twenty others on screen. The
centre's is the only one reachable as text at all.

## Decision
Clicking any node copies its name.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Which click | Any node the map draws | A name under the pointer is a name in hand. |
| A ghost | Copies, then flies | Its name is on screen long before its node is. |
| The panel | The centre's click alone | That click takes the caret off the map — [0036](0036-a-click-that-writes-nothing.md). |
| On success | Silence | The reader is looking at the name they clicked. |
| On refusal | The first one says so, and no other | A browser that turns one copy down turns them all down. |

## Alternatives considered
- **Leave it at the centre.** 0037's rule stands, and one click means one thing. A name two
  hops away then costs two clicks and a journey to reach it.
- **Behind a held key.** Nothing goes to the clipboard unasked. It also hides the gesture,
  which is the ground 0037 turned the same idea down on.
- **Copy whatever the pointer is over.** No click at all, and the name is always in hand. The
  clipboard would then be taken by every node the pointer crossed on the way somewhere else.

## Consequences
Every step of a walk takes the clipboard. Ten clicks across a graph lose ten things, where
0037 spent one.

The first refusal is reported and no later one is. A reader who missed that line can believe a
name is on the clipboard when nothing was written.

A ghost's click does two jobs. It copies and then flies, and the copy is silent while the
camera is moving.

The centre keeps a job no other node has. Its click still names it in the panel above.

## Assumptions and unknowns
- **Assumed a click on a node asks for its name.** A reader clicking to walk loses whatever
  they were holding.
- **Assumed a browser that turns one copy down turns down the rest.** A permission granted
  mid-session leaves the page quiet about copies it had already lost.
- **Unknown whether the silence after a refusal reads as success.** Only the author has seen
  that line.

## Revisit when
- A clipboard is reported lost to a walk, once any click on a node takes it.
- The clipboard is granted mid-session, and the page has already stopped reporting.
- A click on any node is asked to fill the panel as well.
