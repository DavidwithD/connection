# 0013 — One box that grows into an edge

**Status:** 🔵 Proposed
**Date:** 2026-08-05
**Deciders:** David HL

## Context
[0008](0008-finding-a-node-by-name.md) gave the page a box that resolves a typed prefix and
moves the centre; [0010](0010-writing-to-the-graph-from-the-browser.md) gave it a second that
writes an edge. One [combobox](../../web/src/combobox.ts) serves both, differing only in what
a pick does.

Two tabs stand in front of them, so the first act is choosing between them. That order is
wrong: whether you mean to travel to Kavara or write from it is answerable once Kavara is in
front of you.

The panel that writes never shows what it writes from, and its `from` and `to` claim a
direction the store does not have: it keeps each edge twice.

## Decision
One box. Naming a node in it opens a second, and the two are an edge's ends.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The ends | Stacked, joined by a constant line | It draws what it makes, so neither needs a label. |
| Which end writes | Both | Nothing in the store tells them apart. |
| The camera | Follows an arming pick, not a firing one | The anchor stays in view through a run of names. |
| A receipt | Names the pair; either name loads into the near end | The way back to any landed write. |
| A queued write's pair | Fixed when the target is picked | Retyping an end would otherwise redirect a queued edge. |

The far end arrives on the pick, since the list opens into its space. The widget shrinks when
its last name goes.

## Alternatives considered
- **Revealing the far end on the keystroke, or behind a chevron.** The list opens into that
  space, so the first flickers and the second spends a glyph reading *open the options* above
  a list of them.
- **Ends side by side.** It fits only by re-centring as it grows, which slides the panel
  under the caret, and each end loses a quarter of its width.
- **The box mirroring the centre, refilled by a map click.** One notion of the current node
  rather than two, at the price of arming a write on every idle click.

## Consequences
Writing from a node means travelling to it: an end cannot be armed without the camera
following.

Both ends write, so a pick is never only a read: an edge nobody meant is a keystroke away.
The undo is the whole answer, the bargain [0011](0011-taking-a-write-back.md) struck for `↵`.

The box may create, which the finding half refused to do, so it can hold a name no store
carries.

A receipt is live only while its write stands, since undoing can delete a node it names.

## Assumptions and unknowns
- **Assumed the undo covers what a symmetric widget makes easy.** How often a pick writes
  something unmeant is unknown.
- **Assumed a clickable name is found at all.** Nothing announces it but the hover.
- **Unknown whether a camera walking a chain reads as help.** Only the author has drawn one.

## Revisit when
- Someone needs to write from a node without the camera moving.
- A name in a receipt is clicked expecting it to write.
- The page is made responsive, so stacking is no longer the only layout that fits.
