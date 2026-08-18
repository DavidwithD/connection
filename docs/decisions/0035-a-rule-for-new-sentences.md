# 0035 — A rule for new sentences

**Status:** 🔵 Proposed
**Date:** 2026-08-18
**Deciders:** David HL

## Context
Most of this repo is prose: every record, every living document, and the comments that carry
reasons the code cannot state. None of it has ever been checked for how it reads.

Both gates compare identifiers and stop there, which
[0014](0014-binding-the-docs-to-the-code.md) chose deliberately: a script can tell that
`explore.ts` exists, and cannot grade the sentence beside it.

So the voice drifted. A sentence would open on an abstract
noun, or invert, or run past thirty words. A reader then had to go back to find what it was
about. The writing was doing the work of sounding settled instead of being read once.

## Decision
New prose is held to plain sentences. A linter settles what arithmetic can, and a person
settles the rest.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The rule | One point, a concrete subject, under 25 words | The subject should be findable in one pass. |
| Where it lives | `docs/README.md` | That page already routes a sentence to its document. |
| What is read | Only text a write just added | A neighbour's sentence is not this writer's. |
| Prose already committed | Exempt | A rewrite for voice alone buries the next real change. |
| The linter | Advisory, and never blocking | It cannot see a metaphor. |
| Record titles | Exempt | A title is also a filename, and links point at it. |

## Alternatives considered
- **Block on it**, as the two gates block. No regex separates a metaphor from a fact, so
  blocking buys sentences rewritten to satisfy a pattern.
- **Report the word count alone.** Fewer false alarms, but the abstract subject is the case
  that most often needs saying.
- **Run it at commit time** beside the gates. The sentence is then a file to go back to rather
  than a line still being written.
- **Rewrite what is already here.** One voice throughout, at the price of a diff nobody can
  review.
- **Write nothing down** and leave it to review. That is what produced the drift.

## Consequences
The repo now holds two voices, and will for a long time. A new sentence reads differently from
the one above it, and a page changes only when something else brings a writer there.

The linter reports on every write, so it is noise whenever it is wrong, and it is wrong by
design. It names its guesses as guesses, which is the whole of the mitigation.

Nothing tests the linter. `docs-gate.py` has a self-test for this risk; this has none,
so a pattern can stop matching and nobody would learn of it.

## Assumptions and unknowns
- **Assumed a second pass to find the subject is worth spending words to avoid.** No reader has
  been watched losing one.
- **Assumed the guesses earn their false alarms.** They are three of the five checks.
- Unknown whether the exemption leaves the repo readable, or only mixed.
- Unknown whether a rule written down changes what gets written.

## Revisit when
- The findings are skipped rather than read.
- A pattern fires on more good sentences than bad ones.
- The two voices stop being tellable apart, and the exemption could go.
- Somebody wants the linter to block.
