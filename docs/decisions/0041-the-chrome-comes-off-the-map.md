# 0041 — The chrome comes off the map

**Status:** 🔵 Proposed
**Date:** 2026-08-24
**Deciders:** David HL

## Context
The map page floats six panels over the canvas. The name box and the zoom buttons are used. The
HUD, the legend and the key list cover the graph while saying nothing that changes as you pan.
The island list covers it too, and it is what the map is navigated with.

Three media-query blocks in [app.css](../../web/app.css) exist only to decide which panel to
drop on a short window. The island list carries a second cap: nine rows, then five, then three,
each stated in the stylesheet.

## Decision
The list pulls out from the left edge. The three reading aids go behind one button.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The island list | A drawer behind a tab at the left edge | It is navigation, so the way back has to be on screen. |
| The HUD, legend and keys | One popover, off one button | Each is read once or glanced at. |
| The popover | Native `popover` | Escape, outside-click and the top layer are the browser's. |
| `#status` | Out of the popover, into a pill | An error inside a shut panel cannot be read. |
| The list's scrollbar | Hidden, with a fade in its place | The drawer grows with the list, so the row cap is gone. |
| What is stored | The drawer, shut by default | A popover that reopens on load is not hidden. |

## Alternatives considered
- **A second drawer on the right for the aids.** Both edges would then open the same way. The
  price is a second tab on screen, for three panels a reader opens once.
- **Keeping the HUD's fold.** Folded, it still holds a corner and is still stepped around.
- **Hiding the scrollbar and nothing else.** Then nothing says rows continue below the fold.
- **Anchor positioning for the popover.** Chrome only when this was written.

## Consequences
[app.css](../../web/app.css) loses `--island-row`, the three row caps and most of three media
queries.

The drawer is as tall as its rows and no taller than the window, where nine rows was the cap.
Its paging is unchanged.

The centre's name is on no panel now. A click still copies it
([0039](0039-any-nodes-name-on-the-clipboard.md)) and the accent still marks it on the map.

The key list drops its four pointer rows. So the page no longer says that a right-click parts
a pair or takes a node off the map. Only [using-the-demo.md](../using-the-demo.md) does.

[drive-map.mjs](../../scripts/drive-map.mjs) loses two legs: no fold to read, no column to
overlap.

## Assumptions and unknowns
- **A tab at the left edge is found without being pointed at.** Untested on anybody.
- **`?` is enough of a way in for a keyboard.** The key list now sits inside the thing it
  describes, so it cannot advertise itself.
- **The fade says "more below" as well as a bar did.** It is drawn only while rows are past the
  fold.
- The popover floor is Chrome 114, Safari 17 and Firefox 125. The page already needs `:has()`.

## Revisit when
- A number has to be watched while the camera moves.
- The guide grows past one screen.
- Somebody reports not finding the island list.
- Something else has to go at the left edge.
