# 0016 — The gates run in CI

**Status:** 🔵 Proposed
**Date:** 2026-08-05
**Deciders:** David HL

## Context
[0014](0014-binding-the-docs-to-the-code.md) added a second gate, and both run from the
pre-commit hook that [GATE.md](GATE.md) describes. That hook lives in `.git/hooks`, which
no clone carries and nothing installs by itself.

On the machine this was written on it was absent, and `.git/hooks` is versioned nowhere, so
how long that had been true cannot be recovered. A hook also answers to `--no-verify`, and
neither gate can tell afterwards that it did.

## Decision
[A workflow](../../.github/workflows/ci.yml) runs both gates on every push to main and on
every pull request.

Two jobs. The first needs nothing installed and stays quick: typecheck, the two gates, and
both builds, run twice — against the floor `engines` declares and against the version the
work is done on. The second fetches a JRE and walks the README's getting-started through to
its round trip.

No step is a check of its own. Each one is an npm script a person can run, so a red run is
reproduced by the command printed beside it.

## Alternatives considered
- **The hook by itself.** Instant and free, and it was found uninstalled on the one machine
  anybody has checked.
- **A pre-push hook underneath it.** Fires later, still local, still absent from a fresh
  clone, still one flag from silence.
- **Pull requests only.** Cheaper, but main takes direct pushes here, which is precisely
  where the missing hook went unnoticed.

## Consequences
Two files now describe how the gates run. A flag added to one is a divergence sitting in
the other, and keeping the hook as the quick copy and CI as the authority is a discipline
rather than a mechanism.

The smoke job downloads a JAR and starts a database, so it costs minutes where the other
costs seconds. Caching softens that; it cannot remove it.

A run cannot be waved through the way a hook can. That is the entire point, and also the
bill: a stale sentence in the README will hold up a merge.

## Assumptions and unknowns
- **Assumed the runner carries python3.** lsof is installed when missing; python3 is taken
  on trust, and the gates are useless without it.
- **Unknown whether the declared floor holds.** Nothing has ever executed on it, which is
  the reason it is in the matrix.

## Revisit when
- A gate option exists in one of the two places and not the other.
- The smoke job fails for a reason belonging to the runner rather than the repo.
- Branch protection starts requiring a green run before a merge.
