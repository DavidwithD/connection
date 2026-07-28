# Decision gate

What a record must clear before it lands. Run it:

```
scripts/adr-gate.py            # all records + the index
scripts/adr-gate.py --stats    # add the metrics table
scripts/adr-gate.py --strict   # warnings fail too
```

**Errors block. Warnings need a reason.** If a warning is wrong for a record, say so in
the change that keeps it — an unexplained warning is a warning nobody will ever clear.

## The five things we're checking for

| Perspective | The failure it prevents |
|-------------|-------------------------|
| **Structure** | Every record reads the same way, so a reader knows where to look. |
| **Concision** | Length is a tax on every future reader. Budgets force the edit. |
| **Accuracy** | A record states what was true, when, and on what evidence. |
| **Non-duplication** | One home per fact. Restating a doc creates two things to update. |
| **Maintainability** | The record survives contact with time: no rot, no dead links. |

## Required shape

```
# NNNN — Title                       one decision, ≤60 chars, em dash
**Status:** <emoji> <Proposed|Accepted|Rejected|Superseded>
**Date:** YYYY-MM-DD                 when this was true

## Context                           forces, constraints — links, not restatement
## Decision                          the choice, active voice, no hedging
## Alternatives considered            what lost and why, or "None — <why>"
## Consequences                       including what this costs us
```

Optional after those: `TODO`, `Follow-ups`, `Open questions`, `References`, `Notes`.

## Budgets

| Metric | Budget | Fails at |
|--------|--------|----------|
| Prose words, whole record | 500 | 800 |
| Context / Decision / Alternatives / Consequences | 220 / 250 / 200 / 180 | 1.6× budget |
| Sentence length | 35 words | 55 words |
| Paragraph | 100 words or 7 lines | — |
| Line length | 100 chars | — |
| Bullets per section | 8 | — |
| Rows in the Decision table | 6 | — |
| Code block | 15 lines | — |
| Heading depth | h3 | — |
| Phrases shared with another doc | 0 (7-word runs) | verbatim from `template.md` |

Numbers are a forcing function, not a target. A 120-word record that says the thing is
better than a 480-word one that says it slowly.

## Rules the script enforces

**Structure** — `S001` filename `NNNN-kebab-title.md` · `S002` H1 number matches the
filename · `S004` status is one of the four, with its legend emoji · `S005` the four
sections, once each, in order · `S006` no invented sections · `S007` no heading past h3
· `S008` title is short and names one decision · `S011` alternatives are listed or
explicitly waived · `S012` consequences name a cost · `S013` decision table stays small
· `S014` ISO date · `S015` no hedging inside Decision · `S016` Context links something.

**Concision** — `C001` total words · `C002` per-section words · `C003` sentence length ·
`C004` paragraph size · `C005` line length · `C006` filler ("very", "in order to", "it
should be noted") · `C007` buzzwords ("leverage", "robust", "seamless") · `C008` bullet
sprawl · `C009` code in a record · `C010` "it was decided" — name who decided.

**Accuracy** — `A001` no `TBD`/`FIXME`/open checkboxes in a settled record · `A002` no
unfilled `<placeholder>` · `A004` a Superseded record links forward to its replacement ·
`A005` every quantity has a link to where it came from.

**Duplication** — `D001` 7-word runs shared with another doc, reported with the file and
the shared text · `D002` a sentence repeated inside one record · `D003` template prose
left in place · `D004` the index inlining a copy of the template.

**Maintainability** — `M001` time-relative words ("currently", "soon", "today") that go
stale · `M002` broken relative links · `M003` links to records that don't exist ·
`M004`/`M005` index row exists and its status matches the record · `M006` no
machine-local paths · `M007` https · `M008` no `TODO` hiding outside the TODO section ·
`M009` whitespace and newline hygiene.

## What the script can't check

Read for these before approving. They are the reason a gate isn't just a linter.

- **Is it a decision?** A real fork, with a road not taken. If nothing was rejected,
  it's a note — put it somewhere else.
- **Is the Context true?** Check the claims against the code and the docs it cites.
  Constraints invented to justify the choice are the most expensive kind of wrong.
- **Would the loser recognise their argument?** Alternatives written to lose are worse
  than no alternatives section.
- **Is the cost real?** "Slightly more complex" is not a trade-off. Name what breaks,
  what we can't do now, and what it would take to reverse.
- **Does it belong here?** If it restates a spec, link the spec. If it's how-to, it's a
  guide. A record explains *why*, once.
- **Could you tell in a year whether it held?** State the choice so that reality can
  contradict it.
- **Is it still the reason?** When a record stops being true, supersede it — never edit
  history quietly.
