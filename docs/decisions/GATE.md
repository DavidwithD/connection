# Decision gate

What a record must clear before it lands.

```
npm run adr                    # all records + the index
scripts/adr-gate.py --stats    # metrics table
scripts/adr-gate.py --strict   # warnings fail too
scripts/adr-gate.py --json     # for a hook or CI
```

Errors block. Warnings need a reason. If a warning is wrong for a record, say why in the
change that keeps it. Nobody ever clears a warning that has no reason next to it.

`npm run hooks:install` links `scripts/hooks/pre-commit` into `.git/hooks`. The hook runs
this gate and the [docs gate](../checks.md) on every commit. Its header explains how the
link is made. It checks the **staged** tree. A partial `git add -p` stages one version while
the file on disk holds another, and the commit is what has to be correct. Errors block, and
warnings print and pass. `ADR_GATE_STRICT=1` makes warnings block too. `--no-verify` skips
the hook. `.git/hooks` is outside version control. So a fresh clone runs no hook until
someone runs the install. Git also skips a hook it cannot execute, with no message. This
gate cannot warn you about that one failure. [CI](../../.github/workflows/ci.yml) runs the
same gates, and nobody can skip it.

## What we're actually protecting

Everything else in the repo records what is true *now*. The code holds the what, and the
tests hold the invariants. The docs hold the how, and git holds the changes. Only a decision
record holds **what we didn't know at the time**: the uncertainty, and the things we bet on.
People forget this information first. It is gone from everyone's head in six weeks, and
nobody can recover it after that.

So the job is narrow. A record lets a future person answer **"is this still the right
call?"** without redoing the analysis. Any text that does not serve that is padding.

A record is useful at exactly two moments. Browsing this directory is neither of them:

- **Write time.** Writing out the alternatives sometimes changes the decision. So a record
  written *after* the fact has already lost most of its value. A record written later
  justifies the choice, and it almost always leaves out the uncertainty. Open the record
  while the answer is still Proposed.
- **Collision time.** Someone hits the constraint in the code and asks why it is like
  this. They do not open the index. So a reader must reach the record from the living
  documents. The design page describing the result must link *to* it (`M010`). The code
  links to nothing, by design. See [the reader](../README.md#the-reader).

A set of records fails when readers stop trusting it. Bad writing matters less. A reader
who finds one Accepted record that is out of date stops believing all of them. The directory
then costs more than it returns. A short, rough, current record is better than a polished
stale one. So the supersede rules outrank every writing rule below.

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
place the record can say *we knew this might be wrong*. That line separates a bad decision
from bad luck. It lets people improve their judgement instead of arguing the case again.
**Revisit when** lets a reader detect that a record is out of date. Without it, nobody can
show that a record is out of date. They can only suspect it.

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

Each budget is a ceiling. A 120-word record that says the thing beats a 480-word one that
says it slowly.

## Rules

**Shape**

- `S001`: filename `NNNN-kebab-title.md`. `S002`: the H1 number matches the filename.
- `S004`: the status is one of the four, with its legend emoji.
- `S005`: the six sections, once each, in order. `S006`: no invented sections.
- `S007`: nothing past h3. `S008`: the title is short and names one decision.
- `S013`: the decision table stays small. `S014`: ISO date.
- `S017`: the deciders are named people.

**Substance**

- `S011`: alternatives listed or explicitly waived. `S012`: consequences name a cost.
- `S015`: no hedging inside Decision. `S016`: Context links something.
- `S018`: every revisit trigger is an observable condition. "As needed" is rejected.
- `S019`: at least one assumption or unknown. The gate challenges "none".

**Concision**

- `C001`: total words. `C002`: per-section words. `C003`: sentence length.
- `C004`: paragraph size. `C005`: line length. `C008`: bullet sprawl.
- `C009`: code in a record. `C010`: "it was decided". Name who decided.

The gate has no filler or buzzword rule, on purpose. That is a copy-editor's job. Every
cheap rule makes the hard, contested record more costly to write, and we need that record
most.

**Accuracy**

- `A001`: no `TBD`, `FIXME` or open boxes in a decided record. Once the record is over 90
  days old, the finding reports its age.
- `A002`: no unfilled `<placeholder>`.
- `A004`: a Superseded record links forward to its replacement.
- `A005`: every quantity links to where the number came from.

**Duplication**

- `D001`: 7-word runs shared with another record.
- `D002`: a sentence repeated inside one record. `D003`: template prose left in place.
- `D004`: the index includes a copy of the template.
- `D005`: 25+ words verbatim from a doc outside the records.

Quoting a spec is fine. Copying it means two things to update.

**Time**

- `M001`: time-relative words ("currently", "soon") that go stale.
- `M010`: no living document links to this record.
- `M012`: still Proposed after 90 days. Decide it, reject it, or admit it isn't live.

**Wiring**

- `M002`: broken relative links. `M003`: links to records that don't exist.
- `M004`/`M005`: the index row exists and its status matches.
- `M006`: no machine-local paths. `M007`: https.
- `M008`: no `TODO` outside the TODO section. `M009`: whitespace.

## What no script can check

- **Is it a decision?** A decision has at least two options, and one of them lost. If
  nothing was rejected, it's a note. Put it somewhere else.
- **Is the Context true?** Check the claims against the code and the docs it cites.
  Constraints invented to justify the choice are the most expensive kind of wrong.
- **Would the losing option's advocate recognise their own argument?** Alternatives
  written to lose are worse than no alternatives section.
- **Is the cost real, and does someone feel it?** If nobody pays, it was a preference.
- **Is it one reversible commitment?** An irreversible choice belongs in history. An
  uncommitted choice is noise. A useful record constrains future work *and* could be
  revisited.
- **Did the record change what anyone did?** This test matters most. A record nobody acts
  on cost more than it returned.
