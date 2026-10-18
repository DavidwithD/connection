# 0029 — A click that joins

**Status:** ♻️ Superseded by [0036](0036-a-click-that-writes-nothing.md)
**Date:** 2026-08-14
**Deciders:** David HL

## Context
A click on the map selects a node. The selected node cannot be selected twice, so a click
on it has nothing to do. Its name is the one thing on screen the
[panel](0013-one-box-that-grows-into-an-edge.md) cannot receive. A person has to read it off
the HUD and type it back in.

0013 weighed a map click against the same widget and refused it. The version on offer was
the box *mirroring* the middle. It refilled wherever walk by pan moved the camera, and armed
a write nobody asked for. A click names one node, at a moment somebody chose.

## Decision
A click on the selected node sends its name to the free end of the panel.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Which end | Whichever is not the start name | Where typing that name would have put it. |
| The second one | Writes the edge | A pair in the ends is a join, whatever filled them. |
| `⌘` on the click | Carries the start name onto what was written | The modifier reads the same over a row. |
| The caret | Into the end left free | The name after this one is as often typed. |
| The camera | Follows an arming click alone | Firing has never moved it — 0013. |

## Alternatives considered
- **The near end always, writing nothing.** Where a name from a write log entry loads
  ([0028](0028-where-a-chained-name-lands.md) records the case for one place). It makes the
  click a fourth way to arm. Every join stays on the keyboard, so a mouse could walk the
  graph and never build it.
- **Mirroring the middle, as 0013 read it.** No click to learn, and no gesture spent. Every
  idle pan would leave a write one keystroke away.
- **A modifier before the name is taken at all.** Guards a click that has nothing else to
  mean, and adds what the undo already covers.

## Consequences
Two clicks and no keyboard now write an edge. The write log entry is the only report of it.
[0011](0011-taking-a-write-back.md)'s undo is the whole of the way back.

The caret leaves the map on every such click, so the arrows stop panning until `Esc` returns
it. Clicking the middle no longer moves the camera back to it. **Go to selected** does that.

Clicking the middle twice running asks for a node joined to itself, and is refused in the
words the panel already uses.

## Assumptions and unknowns
- **Assumed a click on the middle is deliberate.** It used to move the camera back to a
  middle node that walk by pan had moved. This costs that habit.
- **Assumed the pair is worth more than the gesture it spends.** Joining two nodes was
  keyboard-only; nothing else wanted the click.
- **Unknown whether losing the arrows mid-walk reads as a trap.** Only the author has clicked
  a pair together.

## Revisit when
- Somebody reports an edge they never meant, once a click rather than a key made it.
- The arrows are needed while an end holds a name.
- Someone clicks the middle to move the camera back, and **Go to selected** does not serve
  them.
