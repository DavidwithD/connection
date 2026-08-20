# 0037 — The centre's name on the clipboard

**Status:** ♻️ Superseded by [0039](0039-any-nodes-name-on-the-clipboard.md)
**Date:** 2026-08-18
**Deciders:** David HL

## Context
A name on the map is drawn to a canvas ([0003](0003-graph-exploration-demo-stack.md)), so no
pointer can select one. The HUD holds the centre's name as text, and taking it from there is a
drag across one line of a panel. Anywhere else, the reader retypes it.

[0036](0036-a-click-that-writes-nothing.md) left the centre click with one job: it names the
centre in the panel. The name is already in hand at that moment.

## Decision
Every click on the centre writes its name to the clipboard.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| When | Every centre click, with no modifier | A modifier is a second thing to learn for one name. |
| On success | Nothing is said | The box shows the name that was copied. |
| On refusal | The status line says so | A clipboard nobody can see needs the failure reported. |

## Alternatives considered
- **A copy button in the HUD**, beside the name. It says what it does, and it is a second
  target to aim at for a name the reader is already clicking.
- **Behind `⌘`.** No clipboard is overwritten by accident, and the gesture is undiscoverable.
- **Nothing at all.** The drag across the HUD line still works, and so does retyping.
- **Say `copied Ashanlin` on success.** It confirms the copy and overwrites whatever the
  status line was reporting, on every click.

## Consequences
Every centre click discards what the reader had on the clipboard. That click is made for the
box as often as for the name. A clipboard is then lost to a gesture aimed at something else.

The clipboard needs a secure context. Served over plain http on a LAN address, every centre
click fails and says so. The reader gets an error line for a copy they did not ask for.

`navigator.clipboard` is now the second browser API the map depends on, after IndexedDB. The
map opens empty on a browser with no IndexedDB. On one with no clipboard, only the centre
click changes.

## Assumptions and unknowns
- **Assumed a reader clicking the centre wants that name outside the page.** Wrong if the
  clipboard they lost mattered more than the name they gained.
- **Assumed the status line is read.** It sits in the HUD, which folds away.
- **Unknown how often the page is served over anything but `localhost`.** Nobody has deployed
  it yet.

## Revisit when
- Somebody reports a clipboard they wanted, lost to a click on the centre.
- The page ships anywhere but `localhost`, and the failure line turns up on every click.
- A reader needs the name of a node that is not the centre.
