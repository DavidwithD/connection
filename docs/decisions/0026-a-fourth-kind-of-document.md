# 0026 — A fourth kind of document

**Status:** 🔵 Proposed
**Date:** 2026-08-11
**Deciders:** David HL

## Context
[docs/README.md](../README.md) declared three kinds, split by the question each answers.
The [README](../../README.md) declared no purpose at all, and had absorbed a 255-line
walkthrough of the demo — over half the page. That walkthrough answers a question none of
the three directories does: how do I drive this?

Nothing was wrong with the prose. It was in the only file that had no rule about what it
holds, which is why it landed there.

## Decision
Driving the demo gets a document of its own, and it is one file.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Where | [using-the-demo.md](../using-the-demo.md) | Beside the other three, not inside one. |
| One file, not a directory | One | A tour has an order; six files do not. |
| Lifecycle | Living, edited in place | It describes the present, like design. |
| Against a design page | The design page wins | One of them is the fuller answer. |
| Left in the README | Setup, and the tables the gate binds | What a fresh clone needs first. |

## Alternatives considered
- **Leave it in the README.** No new kind to explain. The page keeps a purpose it cannot
  state, and only grows — every capability added since has landed there.
- **Put it under `design/`.** One fewer directory to know about. A design page states what
  must hold; a table of keystrokes holds nothing, and the two readers want opposite depths.
- **A directory of guides, one per capability.** Symmetrical with the other three. The
  walkthrough splits into six files and stops being a walkthrough.

## Consequences
The price is duplication, paid by whoever edits either copy. Several mechanisms are now
written twice at two depths — the star reading of a text file, the two Enters, why a used
row survives. The guide names the design page as the fuller answer, and nothing enforces
that: no check reads prose, and the duplication rule in [GATE.md](GATE.md) has no
equivalent for living documents.

A fourth kind also costs a fourth place to look, and a fourth to keep true.

`graph:export` and `graph:restore` have no design page, so the guide carries their
mechanism rather than pointing at one.

## Assumptions and unknowns
- **Assumed a driver and a judge are different readers.** Only the author has been either.
  If they are the same person, four documents serve one need and the split is overhead.
- **Assumed the trimmed guide stays trimmed.** It was 255 lines of mechanism and is now
  mostly commands and tables; nothing stops a mechanism paragraph landing back in it.
- **Unknown whether the two copies drift, or how anyone would notice.** Nothing compares
  living documents to each other.

## Revisit when
- A sentence in the guide and a sentence in a design page contradict each other.
- The guide wants splitting because its terminal readers and its browser readers have
  stopped being the same person.
- Export and restore gain a design page, ending the exception the guide admits to.
- A second guide is wanted, which makes this a directory after all.
