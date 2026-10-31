# 0014 — Binding the living docs to the code

**Status:** 🔵 Proposed
**Date:** 2026-08-05
**Deciders:** David HL

## Context
[GATE.md](GATE.md) checks records, which go wrong when nobody updates them. The two living
directories in [docs/README.md](../README.md) go wrong the other way. They state facts about
the code, and a rename makes them false without anyone opening the file.

Four such assertions were false before this was written. The API's header comment listed
five of the seven routes it serves. The [README](../../README.md) layout tree left out four
source files, and its variable table left out the port the API binds. Nothing in the repo
could have reported any of it.

## Decision
Each check pulls one fact from the code and the same fact from the document describing it,
then fails when they disagree. It reads identifiers only: a path, a variable, a filename.
It ignores wording, so every page keeps its own voice.

[docs/checks.md](../checks.md) holds the list of what is bound to what. Two properties
belong here instead:

- An extractor matching nothing fails. Each is a pattern over how this repo writes things.
  One that stops matching without a warning would report agreement it never checked.
- A knob must be written down, in whichever file fits. The switch a gate reads belongs
  beside that gate.

## Alternatives considered
- **Generating the tables.** A stronger guarantee: a generated table cannot disagree with
  its source. It also drops the clause in each row saying what the file is for. That clause
  is why anyone reads those tables instead of the directory listing.
- **A committed snapshot, diffed by a build step.** The same guarantee with the prose
  kept. The price is an artefact to regenerate, and a failure that arrives as a diff in
  place of a sentence naming the file.
- **More rules in the decision gate.** Its subject is a record's shape. Two kinds of
  document failing two ways would share an argument parser and nothing else.
- **Review.** Review caught none of the four.

## Consequences
The layout tree becomes a list somebody maintains: a new source file cannot land without a
line describing it. That is a real cost, paid per file, for a tree a reader can trust.

Code and document renamed together pass, so the gate proves agreement and never accuracy.
A description that became false without notice still reads as maintained.

Extraction depends on this repo's idioms. A rewritten helper can hide a knob until the
empty-extractor rule reports it. That is a delay, and the rule still closes the gap.

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
