# 0029 — A click that joins

**Status:** 🔵 Proposed
**Date:** 2026-08-14
**Deciders:** David HL

## Context
A click on the map glides a node to the middle. The node already there has nowhere to glide,
so that click spends itself. Its name is the one thing on screen the
[panel](0013-one-box-that-grows-into-an-edge.md) cannot be handed — it has to be read off the
HUD and typed back in.

0013 weighed a map click against the same widget and refused it, because the version on offer
was the box *mirroring* the middle: refilled wherever the camera drifted, arming a write
nobody asked for. A click is not drift. It names one node, at a moment somebody chose.

## Decision
Clicking the node the middle holds hands its name to the end of the panel that is free.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Which end | Whichever is not the anchor | Where typing that name would have put it. |
| The second one | Writes the edge | A pair in the ends is a join, whatever filled them. |
| `⌘` on the click | Carries the anchor onto what was written | The modifier reads the same over a row. |
| The caret | Into the end left free | The name after this one is as often typed. |
| The camera | Follows an arming click alone | Firing has never moved it — 0013. |

## Alternatives considered
- **The near end always, writing nothing.** Where a receipt name loads
  ([0028](0028-where-a-chained-name-lands.md) records the pull of one landing place). It makes
  the click a fourth way to arm and leaves every join to the keyboard, so a mouse could walk
  the graph and never build it.
- **Mirroring the middle, as 0013 read it.** No click to learn, and no gesture spent. Every
  idle pan would leave a write one keystroke away.
- **A modifier before the name is taken at all.** Guards a click that has nothing else to
  mean, and buys what the undo already covers.

## Consequences
Two clicks and no keyboard now write an edge. The receipt is the only thing that says so, and
[0011](0011-taking-a-write-back.md)'s undo is the whole of the way back.

The caret leaves the map on every such click, so the arrows stop panning until `Esc` returns
it. Recentring the middle by clicking it is lost with them, and **Recentre** is what does it.

Clicking the middle twice running asks for a node joined to itself, and is refused in the
words the panel already uses.

## Assumptions and unknowns
- **Assumed a click on the middle is deliberate.** It did recentre a middle that had drifted,
  and that is the habit this costs.
- **Assumed the pair is worth more than the gesture it spends.** Joining two nodes was
  keyboard-only; nothing else wanted the click.
- **Unknown whether losing the arrows mid-walk reads as a trap.** Only the author has clicked
  a pair together.

## Revisit when
- Somebody reports an edge they never meant, once a click rather than a key made it.
- The arrows are needed while an end holds a name.
- The middle is clicked for a recentre, and **Recentre** fails to answer for it.
