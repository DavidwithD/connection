# 0001 — Product Name

**Status:** 🔵 Proposed — _decision pending_
**Date:** 2026-07-28

## Context
The project is currently called **connection**, chosen as a working label to get a
directory and docs started — not as a considered name. It carries no branding intent
and is generic enough to collide with countless existing products and with the ordinary
noun in prose ("the connection layer"), which will make search, imports, and
conversation ambiguous.

Naming can stay open for a while, but it leaks into things that are annoying to change
later: the repo/directory name, package names, domains, and the vocabulary the docs use
to talk about the product.

## Decision
_TBD._ **connection** is a placeholder. Until this ADR is Accepted, treat the name as
provisional and prefer describing *what the thing is* over invoking the name in docs.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Product name | _TBD_ | |
| Directory / repo name | `connection` (provisional) | rename when the name lands |
| Domain | _TBD_ | check availability before committing |

## Alternatives considered
_None yet — no candidate list exists._

## Consequences
- Docs written now may need a find-and-replace pass once the name is settled.
- Deferring is cheap today and gets more expensive after the first published artifact
  (domain, package registry entry, or anything user-facing).

## TODO
- [ ] Write down what the product actually is — a name needs something to describe
- [ ] Generate candidates, check domain + registry availability
- [ ] Decide, flip status to ✅ Accepted, and rename the directory
