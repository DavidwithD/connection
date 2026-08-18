# connection

A graph explorer that runs entirely in the browser. No server, no build step but Vite, the
graph in IndexedDB.

## Prose

Before writing a sentence in `docs/**`, a comment, or a commit message, apply these four
tests. [docs/README.md](docs/README.md) § *How it is written* owns the rule, its one
exemption, and why it exists — read it when the scope is in question.

- **One point per sentence.** Under 25 words. Split rather than joining with a dash.
- **A concrete subject.** A file, a function, a person, a named behaviour. Not "stillness",
  not "the drift" where a setting is meant, not an abstraction standing in for the thing.
- **No metaphor and no personification.** A doorway has no price. A box does not want.
- **No aphorism.** "Asking to go is asking to be taken" and "X is not a Y" say nothing.

This applies to decision records too, including new ones written beside old ones in the
older voice. Record *titles* keep the existing convention.

[scripts/prose-lint.py](scripts/prose-lint.py) checks the measurable part of this on every
markdown and source write, and reports back in the same turn. It counts words and matches
patterns; it cannot see a metaphor, so the four tests above are yours to apply, not the
linter's to catch. `W033` in [the commit gate](.claude/skills/commit/SKILL.md) is the
backstop.

## Gates

`npm run typecheck`, `npm run build`, `npm run docs`, `scripts/adr-gate.py`. All four run in
CI and in `scripts/hooks/pre-commit`. The gates are described in
[docs/checks.md](docs/checks.md) and [docs/decisions/GATE.md](docs/decisions/GATE.md).

A new file under `scripts/` or `web/src/` must be added to the layout tree in
[README.md](README.md), or the `layout` check fails.
