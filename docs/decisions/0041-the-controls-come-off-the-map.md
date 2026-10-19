# 0041 — The controls come off the map

**Status:** 🔵 Proposed
**Date:** 2026-08-24
**Deciders:** David HL

## Context
The map page floats six panels over the canvas. The name box and the zoom buttons are used. The
HUD, the legend and the key list cover the graph, and their content stays fixed as you pan.
The component list covers it too, and readers navigate the map with it.

Three media-query blocks in [app.css](../../web/app.css) exist only to decide which panel to
drop on a short window. The component list carries a second cap: nine rows, then five, then
three, each stated in the stylesheet.

## Decision
The list pulls out from the left edge. The three reading aids go behind one button.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The component list | A side panel behind a tab at the left edge | It is navigation, so the way back has to be on screen. |
| The HUD, legend and keys | One popover, off one button | Each is read once or glanced at. |
| The popover | Native `popover` | Escape, outside-click and the top layer are the browser's. |
| `#status` | Out of the popover, into a label box | An error inside a shut panel cannot be read. |
| The list's scrollbar | Hidden, with a fade in its place | The side panel grows with the list, so the row cap is gone. |
| What is stored | The side panel, shut by default | A popover that reopens on load stays in view. |

## Alternatives considered
- **A second side panel on the right for the aids.** Both edges would then open the same way. The
  price is a second tab on screen, for three panels a reader opens once.
- **Keeping the HUD's fold.** Folded, it still covers a corner the reader must avoid.
- **Hiding the scrollbar and nothing else.** Then nothing says rows continue below the fold.
- **Anchor positioning for the popover.** Chrome only when this was written.

## Consequences
[app.css](../../web/app.css) loses `--island-row`, the three row caps and most of three media
queries.

The side panel is as tall as its rows, up to the window height. Nine rows was the old cap.
Its paging is unchanged.

The selected node's name is on no panel now. A click still copies it
([0039](0039-any-nodes-name-on-the-clipboard.md)), and the accent still marks it.

The key list drops its four pointer rows. So the page no longer says that a right-click parts
a pair or takes a node off the map. Only [using-the-demo.md](../using-the-demo.md) does.

[drive-map.mjs](../../scripts/drive-map.mjs) loses two legs: no fold to read, no column to
overlap.

## Assumptions and unknowns
- **A tab at the left edge is found without being pointed at.** Untested on anybody.
- **`?` is enough of a way in for a keyboard.** The key list now sits inside the popover it
  describes, so it cannot announce itself.
- **The fade says "more below" as well as a bar did.** It is drawn only while rows are past the
  fold.
- The popover floor is Chrome 114, Safari 17 and Firefox 125. The page already needs `:has()`.

## Revisit when
- A number has to be watched while the camera moves.
- The guide grows past one screen.
- Somebody reports not finding the component list.
- Something else has to go at the left edge.
