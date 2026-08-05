# 0014 — Binding the living docs to the code

**Status:** 🔵 Proposed
**Date:** 2026-08-05
**Deciders:** David HL

## Context
[GATE.md](GATE.md) guards records, which go wrong by standing still. The two living
directories in [docs/README.md](../README.md) go wrong from the other side: they assert
things about the code, and a rename falsifies them without anyone opening the file.

Four such assertions were false before this was written. The API's header comment listed
five of the seven routes it serves. The [README](../../README.md) layout tree left out four
source files, and its variable table left out the port the API binds. Nothing in the repo
could have reported any of it.

## Decision
Each check pulls one fact from the code and the same fact from the document describing it,
then fails when they disagree. Identifiers only — a path, a variable, a filename. Wording
goes unread, so every page keeps the voice it has.

[docs/checks.md](../checks.md) holds the list of what is bound to what. Two properties
belong here instead:

- An extractor matching nothing is a failure, not a pass. Each is a pattern over how this
  repo writes things, and one that silently stops matching would certify agreement it
  never looked for.
- A knob must be written down somewhere, not in a nominated file. The switch a gate reads
  belongs beside that gate.

## Alternatives considered
- **Generating the tables.** A stronger guarantee: a generated table cannot disagree with
  its source. It also throws away the clause in each row saying what the file is for, which
  is the reason anyone reads those tables rather than the directory listing.
- **A committed snapshot, diffed by a build step.** The same guarantee with the prose
  kept, at the price of an artefact to regenerate and a failure arriving as a diff rather
  than a sentence naming the file.
- **More rules in the decision gate.** Its subject is a record's shape. Two kinds of
  document failing two ways would share an argument parser and nothing else.
- **Review.** What review caught here was none of it.

## Consequences
The layout tree becomes a list somebody maintains: a new source file cannot land without a
line describing it. A real cost, paid per file, buying a tree a reader can trust.

Code and document renamed together pass, so what the gate proves is agreement, never
accuracy. A description that quietly became false still reads as maintained.

Extraction leans on this repo's idioms, so a rewritten helper can hide a knob until the
empty-extractor rule notices — a delay rather than a hole.

## Assumptions and unknowns
- **Assumed agreement on identifiers is most of the value.** The plausible-but-stale
  sentence, which nothing here tests, may well be the more expensive kind.
- **Assumed those columns of prose earn the manual step.** If nobody reads them,
  generating the tables wins outright and this record is the thing to revisit.
- **Unknown what the extractors miss.** Only the idioms present at the time have been
  tried against them.

## Revisit when
- An extractor fails on a refactor where a rename would have been caught.
- A hand-written column stops being read, or starts being copied instead of cited.
- The nudge yields a record with nothing rejected in it.
