# Decision gate

What a record must clear before it lands.

```
npm run adr                    # all records + the index
scripts/adr-gate.py --stats    # metrics table
scripts/adr-gate.py --strict   # warnings fail too
scripts/adr-gate.py --json     # for a hook or CI
```

Errors block. Warnings need a reason — if a warning is wrong for a record, say why in
the change that keeps it. An unexplained warning is one nobody will ever clear.

`npm run hooks:install` links `scripts/hooks/pre-commit` into `.git/hooks`, which runs this
gate and the [docs gate](../checks.md) on every commit; that file's header covers how the
link is made. It checks the **staged** tree, not the working tree: a partial `git add -p`
stages one version while the file on disk says another, and the commit is what has to be
correct. Errors block, warnings print and pass; `ADR_GATE_STRICT=1` makes warnings block
too and `--no-verify` skips the hook. `.git/hooks` is not versioned, so a fresh clone is
unguarded until someone runs the install — and git skips a hook it cannot execute without
saying so, which is the one failure mode this cannot warn you about.
[CI](../../.github/workflows/ci.yml) is the copy that cannot be skipped.

## What we're actually protecting

Everything else in the repo records what is true *now*: code is the what, tests are the
invariants, docs are the how, git is the delta. A decision record's monopoly is **what
we didn't know at the time** — the uncertainty, the things we bet on. That is also the
most perishable information in the project: out of everyone's head in six weeks, and
unrecoverable after that.

So the job is narrow. A record exists to let a future person answer **"is this still the
right call?"** without redoing the analysis. Anything that doesn't serve that is padding.

Value lands at exactly two moments, and neither is browsing this directory:

- **Write time.** Articulating the alternatives sometimes changes the decision. That
  means a record written *after* the fact has already forfeited most of its value —
  retro-written records are rationalisations, and they reliably omit the uncertainty.
  Open the record while the answer is still Proposed.
- **Collision time.** Someone hits the constraint in the code and asks why it is like
  this. They do not open the index. Findability is **inbound**: the code and the specs
  must point *at* the record (`M010`).

And the thing that kills a corpus is trust, not prose. The first time a reader finds an
Accepted record that is quietly dead, they stop believing all of them, and the whole
directory goes net negative. A terse, ugly, current record beats a beautiful stale one,
so the supersede discipline outranks every writing rule below.

## Required shape

```
# NNNN — Title                        one decision, ≤60 chars, em dash
**Status:** <emoji> <Proposed|Accepted|Rejected|Superseded>
**Date:** YYYY-MM-DD                  when this was true
**Deciders:** names, not roles         who to ask

## Context                            forces — links, not restatement
## Decision                           the choice, active voice, no hedging
## Alternatives considered             what lost and why, or "None — <why>"
## Consequences                        including what this costs, and who pays it
## Assumptions and unknowns            what it rests on; what we chose not to find out
## Revisit when                        observable conditions that reopen this
```

Optional after those: `TODO`, `Follow-ups`, `Open questions`, `References`, `Notes`.

The last two sections carry most of the value. **Assumptions and unknowns** is the only
place the record can say *we knew this might be wrong* — which is the line between a bad
decision and bad luck, and the only way judgement gets calibrated instead of relitigated.
**Revisit when** is what makes staleness detectable at all; without it a record can never
be shown to be out of date, only suspected of it.

## Budgets

| Metric | Budget | Fails at |
|--------|--------|----------|
| Prose words, whole record | 500 | 800 |
| Context / Decision / Alternatives / Consequences | 220 / 250 / 200 / 180 | 1.6× |
| Assumptions and unknowns / Revisit when | 120 / 100 | 1.6× |
| Sentence | 35 words | 55 words |
| Paragraph | 100 words or 7 lines | — |
| Line | 100 chars | — |
| Bullets per section | 8 | — |
| Rows in the Decision table | 6 | — |
| Code block | 15 lines | — |
| Heading depth | h3 | — |
| Days a record may sit Proposed | 90 | — |
| Phrases shared with another record | 0 (7-word runs) | verbatim from `template.md` |

Ceilings, not targets. A 120-word record that says the thing beats a 480-word one that
says it slowly.

## Rules

**Shape** — `S001` filename `NNNN-kebab-title.md` · `S002` H1 number matches the filename
· `S004` status is one of the four with its legend emoji · `S005` the six sections, once
each, in order · `S006` no invented sections · `S007` nothing past h3 · `S008` title is
short and names one decision · `S013` decision table stays small · `S014` ISO date ·
`S017` deciders are named people.

**Substance** — `S011` alternatives listed or explicitly waived · `S012` consequences
name a cost · `S015` no hedging inside Decision · `S016` Context links something ·
`S018` every revisit trigger is a condition, not a mood ("as needed" is rejected) ·
`S019` at least one assumption or unknown, and "none" is challenged.

**Concision** — `C001` total words · `C002` per-section words · `C003` sentence length ·
`C004` paragraph size · `C005` line length · `C008` bullet sprawl · `C009` code in a
record · `C010` "it was decided" — name who decided.

There is deliberately no filler or buzzword rule. That is a copy-editor's job, and every
cheap rule raises the price of writing the contested record we most need to exist.

**Accuracy** — `A001` no `TBD`/`FIXME`/open boxes in a settled record, reported with the
record's age once it's over 90 days · `A002` no unfilled `<placeholder>` · `A004` a
Superseded record links forward to its replacement · `A005` every quantity links to where
the number came from.

**Duplication** — `D001` 7-word runs shared with another record · `D002` a sentence
repeated inside one record · `D003` template prose left in place · `D004` the index
inlining a copy of the template · `D005` 25+ words verbatim from a non-record doc.
Quoting a spec is fine; copying it means two things to update.

**Time** — `M001` time-relative words ("currently", "soon") that go stale · `M010` nothing
outside the index points at this record · `M012` still Proposed after 90 days — decide it,
reject it, or admit it isn't live.

**Wiring** — `M002` broken relative links · `M003` links to records that don't exist ·
`M004`/`M005` index row exists and its status matches · `M006` no machine-local paths ·
`M007` https · `M008` no `TODO` hiding outside the TODO section · `M009` whitespace.

## What no script can check

- **Is it a decision?** A real fork, with a road not taken. If nothing was rejected, it's
  a note — put it somewhere else.
- **Is the Context true?** Check the claims against the code and the docs it cites.
  Constraints invented to justify the choice are the most expensive kind of wrong.
- **Would the losing option's advocate recognise their own argument?** Alternatives
  written to lose are worse than no alternatives section.
- **Is the cost real, and does someone feel it?** If nobody pays, it wasn't a decision,
  it was a preference.
- **Is it one reversible commitment?** Irreversible things are history. Uncommitted
  things are noise. The useful band constrains future work *and* could be revisited.
- **Did the record change what anyone did?** The only test that matters. A record nobody
  acts on cost more than it returned.
