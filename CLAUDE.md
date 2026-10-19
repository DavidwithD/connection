# connection

A graph explorer that runs entirely in the browser. No server, no build step but Vite, the
graph in IndexedDB.

## Prose

Before writing a sentence in `docs/**`, a comment, a commit message or a record title, apply
these tests. [docs/README.md](docs/README.md) § *How it is written* owns the rule, with a
before and after for each pattern.

- **One point per sentence.** Under 25 words. Split rather than joining with a dash.
- **A concrete subject.** A file, a function, a person, a named behaviour.
- **The glossary's term.** [docs/glossary.md](docs/glossary.md) defines each term once. The old
  figurative terms in [scripts/plain-terms.txt](scripts/plain-terms.txt) are banned. Example:
  write "off-screen marker", never `ghost` or `doorway`.
- **Code or a person as the actor.** A gesture or a part of the page does nothing by itself.
  Example: write "the click handler copies the name", never `a click leaves the panel alone`.
- **The positive fact.** State what happens. Example: write "the click copies the name and
  returns", never `a click fills no input`. Keep a negative only when the negative is the fact.
- **No metaphor and no aphorism.** Example: never `asking to go is asking to be taken`.

This applies to every record, title and body alike. A reworded record keeps its facts, dates
and links. [ADR 0051](docs/decisions/0051-the-plain-prose-rule-covers-committed-text.md) records
the rule. The [plain-prose skill](.claude/skills/plain-prose/SKILL.md) is the procedure for
rewriting a file.

[scripts/prose-lint.py](scripts/prose-lint.py) checks every markdown and source write, and
reports back in the same turn. `L001` (length) and `L006` (banned term) are certain, and
`npm run docs` fails on them. The other codes are guesses. The linter cannot see a metaphor,
so the tests above are yours to apply. `W033` in [the commit gate](.claude/skills/commit/SKILL.md)
is the backstop.

## Gates

`npm run typecheck`, `npm run build`, `npm run docs`, `scripts/adr-gate.py`. All four run in
CI and in `scripts/hooks/pre-commit`. The gates are described in
[docs/checks.md](docs/checks.md) and [docs/decisions/GATE.md](docs/decisions/GATE.md).

A new file under `scripts/` or `web/src/` must be added to the layout tree in
[README.md](README.md), or the `layout` check fails.
