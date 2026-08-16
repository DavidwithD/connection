---
name: commit
description: Review the working tree and write the commit. Use when the user asks to commit, stage, or draft a commit message, or says "commit this" / "/commit". Scans the diff for half-finished work, unverified tests, leftover debug code, secrets, approach drift, unrecorded decisions, and writing discipline in comments and docs — placement, single source, duplication, phrasing, unsourced claims; blocks on the serious ones; then generates a message in this repo's style. Also covers splitting one dirty tree into a series of commits, and amend/fixup.
---

# Commit gate

What a change must clear before it lands, and what the message has to say.

Order is fixed: **read the tree → verify → review → message → confirm → commit.** Never
write the message first; a message drafted before the review rationalises whatever is in
the diff.

## 1. Read the tree

```
git status --porcelain=v2 --branch      # branch, ahead/behind, staged vs not
git diff --cached                        # what would land
git diff                                 # what would be left behind
git diff --cached --check                # whitespace + conflict markers, in what lands
git diff --check                         # the same, in what stays behind
git log --format='%s%n%b%n---' -8        # the style to match
git stash list                           # work that may belong to this change
```

Read the actual hunks, not just `--stat`. If nothing is staged, treat the whole working
tree as the candidate and stage deliberately — never `git add -A` to save a step.

## 2. Verify

Run it. An unverified commit is a claim, not a change.

```
npm run typecheck     # always; needs nothing running
npm run build         # bundling fails in ways typecheck cannot see
scripts/adr-gate.py   # docs/** touched, or a file a record links to moved
```

Verification answers for the **index**, not the disk. Staging the whole working tree makes
the two the same, and `npm test` runs every leg at once. A partial stage — §5's
`git add -p` — does not: the file on disk is not the file being committed. Run against the
staged tree instead, either `git stash push --keep-index --include-untracked` around the
run, or `git checkout-index -a --prefix=` into a temp dir, which is what
`scripts/hooks/pre-commit` does and why.

Typecheck always blocks, and so does the build.

Nothing in `npm test` executes a line of `web/src/`. There is no behavioural test in this
repo at all, so a diff that changes what the graph *does* — anything under
`web/src/store/`, or a write path in `web/src/` — is unverified until someone drives the
running page. Offer that, with `npm run web` and `node scripts/drive-map.mjs`. Never quietly
count a skipped leg as a pass — name the leg that didn't run and what it would have covered.

The gate is not only for records. `M010` and `D005` read the whole tree, and `M002` breaks
when a file a record links to is renamed or deleted, so a commit touching only `web/src/`
can fail it. `scripts/hooks/pre-commit` runs the same gate against the staged tree on every
commit — but only where someone ran `npm run hooks:install`, since `.git/hooks` is not
versioned, and only where `python3` is on `PATH`, since it fails the commit outright
without one. Even with one, a console that isn't UTF-8 kills the gate on the em dash in its
own output; `PYTHONIOENCODING=utf-8` fixes that, and a `UnicodeEncodeError` traceback is not
a pass. Where none of that holds, §2 by hand is the only gate there is — say so, rather than
letting a hook that never ran read as one that found nothing.

## 3. Review

Findings carry a code. **Blocks** stop the commit until fixed or explicitly overridden by
the user. **Warnings** go in the report and the user decides. **Notes** are one line each.

Report only what this diff introduces. Pre-existing mess in a touched file is not this
commit's problem — mention it once, never block on it.

Before reading the hunks, state each modified file's role in one line — what only it
holds, and what each section it touches is for. Prefer the repo's own declaration where
one exists (`README.md`, `docs/README.md`, a record) over your reading of the filename.
`W020`, `W021` and `W024` need that baseline; without it every new line looks like it
belongs.

### Blocks

`B001` a secret in the diff — key, token, password, connection string, real cloud
credentials, a `.env` file · `B002` conflict markers or a half-finished merge/rebase ·
`B003` typecheck failing, or never run; the build failing, or never run · `B004` the ADR
gate fails — on any record, not only one this change touches (§2) · `B005` an ADR
renumbered, or a *decided* one deleted: a reversed decision gets a *new* record and the old
one flips to ♻️ Superseded. A record still Proposed may be withdrawn, if its index row goes
with it and its number stays spent (`docs/decisions/README.md`) · `B006` ignored or
generated output staged — `dist/`, `__pycache__/`, `*.log` · `B007` the change reverts or
deletes work and you cannot say why — §6 confirms the message says it.

### Warnings

**Half-finished** — `W001` `TODO`/`FIXME`/`XXX`/`HACK`/`WIP` added by this diff · `W002`
a stub that returns nothing, `throw new Error('not implemented')`, an empty `catch {}` ·
`W003` a code path written but never reachable, or a flag added with no reader · `W004`
one side of a pair changed alone — `db.ts` without `DB_VERSION`, `package.json` without
`package-lock.json`, a new script with no `npm` entry, a new element id in one page's HTML
and not in the module that reads it.

**Leftovers** — `W005` `console.log`, `debugger`, stray `print()` · `W006` `.only(` or
`.skip(` in a test, an assertion commented out · `W007` commented-out code kept "just in
case" — git is the delta, delete it · `W008` a hardcoded endpoint, port, path, or
`/Users/...` where config belongs.

**Approach** — `W009` drift from what this repo already decided: ESM, no server, no build
step but Vite, the graph in the browser · `W010` a new dependency where the platform or
stdlib already does it, or one added without a record · `W011` `any`, `@ts-ignore`,
non-null `!` used to get past a real type problem · `W012` an error swallowed so a failure
surfaces as wrong data instead of a crash · `W013` logic duplicated from somewhere else in
`web/src/` instead of shared · `W014` a schema change — a store, a key path, an index —
with no `DB_VERSION` bump and no `upgrade` path for a graph already in someone's browser ·
`W032` an `await` inside an IndexedDB transaction on anything that is not a store request:
the transaction commits early and the rest of the write is silently dropped
(`web/src/store/db.ts`).

**Scope** — `W015` two unrelated concerns in one commit → propose the split (§5) · `W016`
formatting or rename churn mixed into a behavioural change → separate commits · `W017` a
deleted or renamed file still referenced by code, docs, or a link — the same for a renamed
identifier, or content moved between sections or documents. Grep the whole repo for the
old name; the definition site is never the whole sweep.

**Record** — `W018` this change *is* a decision — a fork with a road not taken, a
constraint future work must obey — and no ADR is open. The value is at write time, so the
record goes in this change, not after (`docs/decisions/GATE.md`) · `W019` behaviour
changed and `README.md` now contradicts the code · `W020` a sentence landed in the wrong
document — reasoning in `design/`, a component or table named in `requirements/`, a number
copied instead of cited once, a fact true only this week written into a living doc
(`docs/README.md`). The content is right, the file is wrong, and this is the last moment
moving it is free.

**Writing** — `W021` a fact landed one level short of its topic: right file, wrong
section, or a rule wedged into a figure, tree, or example cell whose job is to illustrate ·
`W022` a value copied instead of taken from the one place that owns it — imported in code,
cited by name in a doc (`W020`). Grep the diff for `= \d` and check each against its
source · `W023` an ad-hoc `python -c` or shell one-off for
something a repo script or `npm` entry already does; extend the tool · `W024` a sentence a
reader of the section above already knows — especially a negative aside ("X is unaffected",
"same pattern as Y") that elaborates a topic outside their current thread · `W025` one
rationale restated across files, sections, or comments; within a function, a docstring and
an inline comment carrying the same content — the docstring owns the contract, the comment
owns why this implementation · `W026` a comment restating what the code says, running
multi-line where a pointer would do, or measuring the code against an alternative absent
from the repo, which no reader can check · `W027` provenance outside its home — "confirmed
by X on date Y", a threshold derived from one sample sitting in a general algorithm
comment, or first-person narrative in a doc ("my guess was wrong"). The rationale stays;
the log goes to a record · `W028` "not A but B" and its disguises: "A isn't enough — you
need B", `Aではなく`, `Aではない` trailed by the positive. Grep for `ではなく`, `ではない`,
`rather than`, `isn't`, then read the sentence that follows. Write only B · `W029` a
struck-through list item (`~~#2~~ — resolved: …`) or a gap left by an earlier deletion —
delete resolved items outright, renumber from 1, keep it contiguous · `W030` a paragraph
or bullet breaking the section's established pattern — inline formula where the section
uses code blocks, outputs mixed into a list of inputs, an item wedged between two
paragraphs that belong together · `W031` a claim about a schema, column, API shape, config
value, or enum meaning asserted with no primary source — verify it, or mark it unverified.
A guess in the body reads as a fact forever.

### Notes

`N001` new exported surface with no test · `N002` committing on `main` — confirm that's
intended · `N003` diff over ~600 lines: say what a reviewer should read first ·
`N004` a stash that looks like part of this work.

### What no scan can check

Ask these yourself, on the hunks:

- **Does the code do what the message will claim?** The single most common defect.
- **Is this one change?** If the subject needs "and", it's two commits.
- **Would this bisect cleanly?** A commit that doesn't build is a landmine for whoever
  bisects through it later.
- **Is anything load-bearing untested** — not "is coverage up", but: if this broke, would
  anything fail before a user found it?
- **What did the author decide?** If a real alternative was rejected, that belongs in a
  record, not in a commit body nobody greps.
- **Does each file still hold only what it monopolises?** Not "is this true" — `W019` asks
  that. Ask whether the code, the design doc, the record, and this commit message are each
  carrying only the part no other one can.
- **Does this comment belong *here*?** A comment earns its place by explaining a
  non-obvious why at the point of confusion, or by stating a contract a caller depends on.
  Anything else moves or goes, however accurate it is.
- **Could someone read this section alone and follow it?** And could a maintainer keep it
  accurate without hunting? A title, an opener, and a first table row saying one thing
  three times; related facts split between a table and a trailing paragraph — every line
  correct, the whole harder to keep true.

## 4. Message

Everything else in the repo records what is true *now*. A commit's monopoly is **why this
change, now** — the reason that is invisible in the resulting code. Spend the body there.

```
<subject: imperative, sentence case, ≤60 chars, no trailing period>

<why, in prose. Wrapped at 76. The forces, what was ruled out, what a
reader would otherwise get wrong. One or two short paragraphs.>

Refs: docs/decisions/0002-single-table-layout.md
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

- Match `git log`, not a convention from elsewhere. This repo uses plain sentence-case
  subjects and prose bodies — **no** `feat:`/`fix:` prefixes. If the repo later adopts
  Conventional Commits, follow the log, not this file.
- Imperative: "Add", "Move", "Drop" — the subject completes "this commit will …".
- No diffstat in prose. "Changed 4 files, added keys.ts" is already in the diff.
- No time-relative words — "currently", "for now", "soon" go stale in the log forever.
- Bullets only for a genuine list of independent items. Default to prose.
- Trailers: `Refs:` a record or issue when one exists; `Co-Authored-By:` when Claude wrote
  code in the commit. Nothing invented — no issue number that isn't real.
- Body is optional for a change whose why is truly self-evident (a typo, a version bump).
  Everything else gets one.

Rejected subjects: `Update files`, `Fix bug`, `Various improvements`, `WIP`, `Address
feedback`, anything that would read identically on a hundred other commits.

## 5. Splitting

When the tree holds more than one change, don't average them into one message. Propose the
series — for each commit: the files or hunks, the subject, and why it stands alone. Then
stage and commit them one at a time, verifying between (§2) so every commit builds.

Use `git add -p` when one file holds two concerns. Say plainly if a clean split isn't
possible without editing the code.

## 6. Confirm

Show the report and the full message, then wait. Don't commit through an unresolved block.

Name the checks you applied alongside the findings, and the file roles §3 assumed. A check
you skipped leaves no trace in a clean report, and that list is what lets the user catch
the gap. Once fixes land, review the new diff again — placement, structure, and a disguised
`W028` surface on a second pass far more often than a first.

Then: `git commit` with the message via a heredoc or `-F`, and report the resulting
`git log -1 --stat`.

Never, without being asked in that turn: `push`, `amend` a commit that is already pushed,
`git checkout`/`restore`/`reset --hard` anything with uncommitted work in it, `stash drop`,
`rebase`, or a force flag of any kind. A commit is recoverable; those are how work is lost.

`--no-verify` belongs on that list for a different reason: it costs nothing and voids
`B004`. The hook names it as the fix whenever it blocks, which is the one moment it must
not be taken. Fix the record, or ask.

## Amend and fixup

`amend` — for the tip commit only, and only while it is unpushed. `git status --porcelain=v2
--branch` has to show `# branch.ab +N -M` with N ≥ 1: those are the commits the upstream
does not have yet. `+0` means the tip is already published and amending rewrites history
someone else may hold. No `branch.ab` line at all means nothing was compared, which is not
an answer either — ask. Re-run §2 and §3 against the *combined* diff, and rewrite the
message to describe the result rather than appending "also fix X".

`fixup` — once the commit is pushed or shared, a follow-up commit is the answer. Say that
instead of rewriting history.
