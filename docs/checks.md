# Docs checks

What the living documents must clear before they land.

```
npm run docs                    # every check
npm run docs:selftest           # prove the checks still compare something
scripts/docs-gate.py --json     # for a hook or CI
scripts/docs-gate.py --strict   # warnings fail too
scripts/docs-gate.py --only keys # one check, while fixing it
```

`npm run hooks:install` puts this and the [decision gate](decisions/GATE.md) on every
commit, over the staged tree. Errors block, warnings print and pass, and
`DOCS_GATE_STRICT=1` makes warnings block too. [CI](../.github/workflows/ci.yml) runs the
same two gates the same way, because a developer can skip or never install a hook.
[ADR 0016](decisions/0016-the-gates-run-in-ci.md) records that choice.

## What we're actually protecting

A record goes wrong when nobody updates it, and its gate is built for that. The two living
directories go wrong the other way round. They hold statements about the code: this
directory contains these files, that script exists, that index is built. A change that never
opens the document can make any of them false. Nobody edits a page to make it wrong. A
rename makes it wrong without a warning, and the page still looks maintained.

So five of the six checks read no writing. Each of them finds one fact in the code and the
same fact in the document. It fails when the two disagree. It compares identifiers only: a path, a
variable name, a filename. It never compares wording. The sentence beside each identifier is
the part a person came for, and no script can grade it.

## What is bound to what

| Check | Code says | Document says |
|---|---|---|
| `commands` | the scripts in `package.json` | the README's command table |
| `engines` | the runtime range npm demands | the README's prerequisites |
| `keys` | stores, key paths and indexes in [the schema](../web/src/store/db.ts) | the README's data model |
| `layout` | the files in each directory | the README's layout tree |
| `paths` | what exists | every link and backticked path |
| `prose` | the word limit and the blocked terms | every tracked markdown file |

The gate checks both directions wherever both mean something. A file missing from the
layout tree makes a reader believe a directory is smaller than it is. A tree naming a file
nobody wrote is the same error the other way round.

Two checks went when the graph moved into the browser
([0030](decisions/0030-the-graph-moves-into-the-browser.md)). `routes` held an API's header
comment to the routes it registered and the client to both — there are no routes. `env` held
every variable the code read to a table describing it — nothing reads one.

`engines` is the exception, and runs one way only. The prerequisites also name a browser, a
shell and python3. `engines` has no entry for them, so a reverse check would call them
undeclared.

## Where a bound document lives

The right-hand column above is a *decision*, and it is declared in one place:
`BOUND_DOCS` in [docs-gate.py](../scripts/docs-gate.py). These checks used to name the
README inside their own function. Moving a bound section out of the README then failed as a
broken extractor. The real cause was a choice nobody had written down. Moving one is now a
one-line edit. A reader can see where each fact lives without reading the checks.

An entry may list more than one document, and the gate searches them in order. This serves
a section that is being moved, or a fact that belongs in two places. The first document that
carries the fact wins, and the gate reads no further. Two documents holding one table is the
stale copy this gate exists to prevent.

`paths` and `prose` are absent from it on purpose. Each binds to every markdown file, so
neither names a single document. `paths` exempts two trees. Records have their
own gate. `temp/` is scratch, and a plan there is allowed to name a file nobody has written.

## The prose check

`prose` runs [prose-lint.py](../scripts/prose-lint.py) over every tracked markdown file,
records included. It fails on two of the linter's codes. Both are counts. `L001` is a
sentence over `MAX_WORDS` in that file. `L006` is a term from the `[block]` list in
[plain-terms.txt](../scripts/plain-terms.txt). The linter's other codes are guesses, and
the gate leaves them out. [ADR 0051](decisions/0051-the-plain-prose-rule-covers-committed-text.md)
records the rule.

In a work tree the check takes its file list from git. The hook and CI see tracked files
only, so a local run gives the same result as they do. An untracked note fails no run.
The check reads markdown only. Comments in source files are linted on each write, by the
hook, and no gate fails on them.

## Rules

**Bindings**

- `N001`/`N002`: a script missing from the command table, or a row naming no script.
- `G001`: a version that `engines` demands and the prerequisites leave out.
- `K001`: a store, key path or index absent from the data model.
- `L001`: the layout tree names a file that does not exist.
- `L002`: a source file the tree omits.
- `M001`: a broken relative link.
- `M002`: a backticked path with nothing behind it.

**Prose**

- `P001`: a sentence over the word limit (the linter's `L001`).
- `P002`: a blocked term (the linter's `L006`).

**Extraction**: `N000`, `G000`, `K000`, `L000`, `M000`, `P000` mean the check found nothing at all
to compare. Every extractor is a pattern over how this repo writes things. So each one must
match something. A gate that stops looking without a warning reports PASS for ever. It is
worse than no gate, because people believe it. For the four bound checks the message names
both causes. Either one produces it: a pattern that has stopped matching, or a `BOUND_DOCS`
entry pointing at the wrong document.

## What proves the checks still work

`npm run docs:selftest` ([docs-gate-selftest.py](../scripts/docs-gate-selftest.py)). The
rules above stop the gate from going silent, and nothing tested those rules. The selftest
copies the tree, takes one fact away, and asserts the gate reports it. It does this three
ways per bound check:

| Case | The tree it builds | Expects |
|---|---|---|
| `missing` | the bound document deleted | that check's `X000` |
| `hollow` | the document present, the fact gone | that check's `X000` |
| `drift` | the fact present and disagreeing | `N001`, `K001` |

`prose` has three cases of its own. They delete the linter (`P000`), add a long sentence
(`P001`), and add a blocked term (`P002`). Each finding must name the file the case
changed. Untracked notes in the copied tree can raise the same codes.

`drift` is the case that matters most. `X000` proves only that a check is still *looking*.
`drift` proves that it is still *comparing*. The selftest first asserts that the unmutated
tree passes. So the selftest never mistakes a no-op mutation for a gate finding no fault.

The selftest imports `BOUND_DOCS` to choose which document each case mutates. So a binding
that moves takes its own test with it. The selftest reimplements everything else on purpose.
A test that shared its subject's table parser would share its bugs too.

## The suite beside the gates

`npm test` also runs `test:unit`. It is the only step that executes a line of `web/src/`.
It needs no browser and no server. happy-dom replaces the document and fake-indexeddb
replaces the store. So it runs with the gates, and apart from the drive scripts.
[ADR 0045](decisions/0045-a-runner-for-the-browser-code.md) records what it covers, what it
costs, and what it cannot reach.

## Where a check cannot reach

- **Is the sentence true?** The gate checks that `explore.ts` exists. No check reads whether
  the file does what its line claims. A description that was right once and is now only plausible
  reads exactly like a correct one.
- **Is the number right?** A default in prose and a default in code are two literals
  nothing compares. Cite the file instead of copying the value.
- **Was a decision made?** The hook prints a reminder when a commit changes a committed
  shape and adds no record. Then it lets the commit through. Blocking would produce empty
  records, which cost more than the missing one.
- **Should this page exist?** Nothing measures whether a document is read. A page nobody
  opens is worth deleting, and only a person can say which one that is.

[ADR 0014](decisions/0014-binding-the-docs-to-the-code.md) records why the gate compares
identifiers instead of generating tables.
