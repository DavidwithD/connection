# 0051 — The plain-prose rule covers committed text

**Status:** 🔵 Proposed
**Date:** 2026-10-06
**Deciders:** David HL

## Context
[0035](0035-a-rule-for-new-sentences.md) held new sentences to plain writing. It exempted two
things: prose already committed, and record titles.

Records, design pages, comments and code names used figurative terms: `ghost`, `doorway`,
`island`, `pill`. A new sentence beside them reused the same words.

The linter could not stop this. It reads only added text, and it has no check for a gesture or
an object written as the actor. In PR #33 the sentence "A click on the map fills no input in
the panel" passed every check. The click is the subject, and the sentence states only what does
not happen.

## Decision
David HL removed both exemptions. The whole repo uses one set of literal terms, and a gate
blocks the old ones.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Scope | Every markdown file, every comment, every identifier and UI string | One vocabulary in every file a reader opens |
| Terms | [plain-terms.txt](../../scripts/plain-terms.txt) maps each old term to a literal one | The linter and the glossary read one list |
| Definitions | [glossary.md](../glossary.md) defines each literal term once | Two definitions of one term can disagree |
| Record titles | Each title states its decision as a fact, and the files are renamed | A title is the line a reader sees in the index |
| Record bodies | Reworded, with facts, dates and links unchanged | The record keeps what was known at the time |
| Enforcement | The docs gate fails on a sentence over 25 words and on a blocked term | Both are counts, so neither is a guess |

The banned patterns are listed in [docs/README.md](../README.md#how-it-is-written).

## Alternatives considered
- **Keep 0035's exemptions.** The old terms then stay in every file a new sentence sits beside.
- **Rename the code and leave the docs.** A page would then name a function by a word the code
  no longer uses.
- **Reword the records and keep their titles.** The index would keep the old terms.
- **Block on the patterns the linter only guesses at.** `L007` and `L008` are guesses. A
  blocking guess would push writers to reword for the regex.

## Consequences
One change rewrites most of the prose in the repo. Each folder is one commit, so a reviewer
can read the diff in parts.

Records are no longer append-only for their wording. A record's facts, dates and alternatives
still never change. Only the words that state them do.

Stored data changes name too: the `islandSize` field, the `byIsland` index and one
`localStorage` key. Database version 3 and export version 3 carry the migration. A backup in
export version 2 still imports.

## Assumptions and unknowns
- **A literal term is easier to find than a figure.** Nobody has timed a reader on either.
- **The rewording kept every fact.** A reviewer checks that by reading. No script compares the
  meaning of two sentences.
- Unknown whether the advisory checks `L007` and `L008` catch the next figure before it spreads.

## Revisit when
- A blocked term returns in a merged change.
- A reworded record is found to state a different fact from its first version.
- The docs gate fails on a sentence that a person cannot shorten without losing a fact.
