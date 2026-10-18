# 0031 — Parting an edge from the map

**Status:** 🔵 Proposed
**Date:** 2026-08-17
**Deciders:** David HL

## Context
The map can take a node out with its edges ([0024](0024-taking-a-node-out-with-its-edges.md))
but cannot remove one join. Parting a pair exists only as the undo on a new write log entry
([0011](0011-taking-a-write-back.md)). That undo reaches only the edge the box just wrote.
An edge written yesterday costs a whole node, or a file exported and edited by hand.

The store has parted a pair since it had a write path. The map lacked a target to click,
and a line is the only thing on the map that names an edge.

## Decision
Right-click a line reaching the selected node, and part the two nodes it joins.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Which lines | One end at the selected node | The rule 0024 already set for the menu. |
| An off-screen marker's connector line | Included | It stands for a real edge, always at the selected node. |
| A long edge's marks | Excluded | They name no node; an off-screen marker reaches the same edge. |
| The way back | `undo` on the write log entry | Both nodes stay, so the edge can return. |
| The menu | One button, two rows | One gesture removes two different things. |

## Alternatives considered
- **Any line on screen.** More reach, and the same code. Away from the selected node no
  degree is shown, so a reader parting two distant nodes cannot see what either had.
- **Asking first, as 0024 does.** One rule for the whole menu. It spends a dialog on a write
  that costs a click to reverse, and 0011 already treats a reversible write as undoable.
- **Decoding the marks a long edge draws.** Closes the last gap. The mark belongs to no node
  and carries no name, so the row would have to be built from an id.

## Consequences
The right-click now means two writes, told apart by what is under the pointer. A reader who
learned it as *delete the middle* can part a pair by clicking a few pixels off.

A join drawn as two marks, with both ends on screen, cannot be parted at all. Panning until
one end leaves the view brings back an off-screen marker that can. Only
[using-the-demo.md](../using-the-demo.md) says so. The key list on the page leaves it out.

The undo is on the write log entry, which disappears after thirty seconds
([`KEPT_OK_MS`](../../web/src/writes.ts)). After that the way back is the box above, typing
both names.

## Assumptions and unknowns
- **Assumed the selected-node rule reads as one rule.** It was written for a node, and a
  line has two ends. Only the author has clicked one.
- **Assumed parting is not feared like deleting.** It is offered without a warning, on the
  strength of the undo.
- **Unknown how often a line at the selected node is right-clicked by accident.** The miss
  radius around a node now also hits its edges.

## Revisit when
- Somebody parts a pair they meant to keep, and the write log entry has already gone.
- A long edge with both ends on screen is reported as unremovable.
- A third write wants a place in this menu, and one button stops holding it.
