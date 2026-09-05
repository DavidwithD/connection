---
name: commit
description: Review the working tree and write the commit. Use when the user asks to commit, stage, or draft a commit message, or says "commit this" / "/commit". Checks the diff for half-finished work, unverified tests, debug leftovers, secrets, approach drift, unrecorded decisions, and writing problems in comments and docs. Blocks on the serious ones, then writes the message in this repo's style. Also covers splitting one dirty tree into several commits, and amend/fixup.
---

# Commit gate

What to check before a commit, and what the message must say.

Follow this order: **read the tree → verify → review → message → confirm → commit.** Do not
write the message first. A message written before the review will justify whatever the diff
happens to contain.

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

Read the hunks themselves. `--stat` is not enough. If nothing is staged, treat the whole
working tree as the candidate. Then stage files one at a time. Do not run `git add -A` to
save a step.

## 2. Verify

Run the checks. Do not report a result you did not observe.

```
npm run typecheck     # always; needs nothing running
npm run test:unit     # always; needs no browser and no server
npm run build         # the build catches errors typecheck misses
scripts/adr-gate.py   # docs/** touched, or a file a record links to moved
```

The checks must answer for the **index**, not for the disk. Staging the whole working tree
makes those the same, and `npm test` then runs every check at once. A partial stage does
not, because the file on disk differs from the file being committed. §5's `git add -p`
produces exactly that. In that case, run the checks against the staged tree. Either wrap the
run in `git stash push --keep-index --include-untracked`, or copy the index into a temp
directory with `git checkout-index -a --prefix=`. `scripts/hooks/pre-commit` uses the second
method.

Typecheck blocks. The suite blocks. The build blocks.

`npm test` runs the suite in `test/`, which executes `web/src/` against happy-dom and
fake-indexeddb. No browser opens. The store and the pure functions are covered. The two
renderers are not, and neither is the wiring in `main.ts`. So a diff touching those stays
unverified until someone drives the running page. Offer to drive it, with `npm run web` and
`node scripts/drive-map.mjs`. Do not report a skipped check as a pass. Name the check that
did not run, and say what it would have covered.

The ADR gate checks more than the records. `M010` and `D005` read the whole tree. `M002`
breaks when a file a record links to is renamed or deleted. So a commit touching only
`web/src/` can fail the gate.

`scripts/hooks/pre-commit` runs the same gate against the staged tree on every commit. It
runs only where someone ran `npm run hooks:install`, because `.git/hooks` is not versioned.
It also needs `python3` on `PATH`, and it fails the commit outright without one. A console
that is not UTF-8 crashes the gate on the em dash the gate itself prints. Set
`PYTHONIOENCODING=utf-8` to fix that. A `UnicodeEncodeError` traceback is a failure, not a
pass. Where the hook cannot run, §2 by hand is the only check there is. Say so in the
report. Otherwise the report implies a hook ran and found nothing.

## 3. Review

Every finding carries a code. **Blocks** stop the commit until they are fixed, or until the
user overrides them. **Warnings** go in the report, and the user decides. **Notes** are one
line each.

Report only what this diff introduces. Do not block on problems that were already in a file
you touched. The report names them once.

Before reading the hunks, state each modified file's role in one line. Say what only that
file holds, and what each section it touches is for. Use the repo's own description where
one exists — `README.md`, `docs/README.md`, or a record. Prefer it over your own reading of
the filename. `W020`, `W021` and `W024` need that baseline. Without it, every new line looks
like it belongs.

### Blocks

`B001` a secret in the diff — key, token, password, connection string, real cloud
credentials, a `.env` file · `B002` conflict markers, or a half-finished merge or rebase ·
`B003` typecheck failing, or never run; the suite failing, or never run; the build failing,
or never run · `B004` the ADR gate fails, on any record, including one this change does not
touch (§2) · `B005` an ADR renumbered, or a *decided* one deleted. A reversed decision gets
a *new* record, and the old one becomes ♻️ Superseded. A record still Proposed may be withdrawn. Delete its index row
with it, and leave its number spent (`docs/decisions/README.md`) · `B006` ignored or
generated output staged — `dist/`, `__pycache__/`, `*.log` · `B007` the change reverts or
deletes work and you cannot say why. §6 confirms the message says it.

### Warnings

**Half-finished** — `W001` `TODO`/`FIXME`/`XXX`/`HACK`/`WIP` added by this diff · `W002`
a stub that returns nothing, `throw new Error('not implemented')`, an empty `catch {}` ·
`W003` a code path written but never reachable, or a flag added with no reader · `W004`
one side of a pair changed alone — `db.ts` without `DB_VERSION`, `package.json` without
`package-lock.json`, a new script with no `npm` entry, a new element id in one page's HTML
with no reader in the module that loads it.

**Leftovers** — `W005` `console.log`, `debugger`, stray `print()` · `W006` `.only(` or
`.skip(` in a test, an assertion commented out · `W007` commented-out code kept "just in
case". Delete it; git holds the old version · `W008` a hardcoded endpoint, port, path, or
`/Users/...` where config belongs.

**Approach** — `W009` drift from what this repo already decided: ESM, no server, no build
step but Vite, the graph in the browser · `W010` a new dependency where the platform or
stdlib already does the job, or one added without a record · `W011` `any`, `@ts-ignore`,
non-null `!` used to get past a real type problem · `W012` an error swallowed, so a failure
surfaces as wrong data instead of a crash · `W013` logic duplicated from somewhere else in
`web/src/` instead of shared · `W014` a schema change — a store, a key path, an index —
with no `DB_VERSION` bump and no `upgrade` path for a graph already in someone's browser ·
`W032` an `await` inside an IndexedDB transaction on anything other than a store request.
The transaction commits early, and the rest of the write is dropped with no error
(`web/src/store/db.ts`).

**Scope** — `W015` two unrelated concerns in one commit → propose the split (§5) · `W016`
formatting or rename churn mixed into a behavioural change → separate commits · `W017` a
deleted or renamed file still referenced by code, docs, or a link. The same applies to a
renamed identifier, and to content moved between sections or documents. Search the whole
repo for the old name. Searching the definition site alone misses the callers.

**Record** — `W018` this change *is* a decision, and no ADR is open. `W018` fires when the
change picks between real alternatives, or sets a constraint future work must follow. Write
the record inside this change. A record written afterwards omits the uncertainty
(`docs/decisions/GATE.md`) · `W019` behaviour changed, and `README.md` now contradicts the
code · `W020` a sentence landed in the wrong document — reasoning in `design/`, a component
or table named in `requirements/`, a number copied instead of cited once, a fact true only
this week written into a living doc (`docs/README.md`). The content is correct and the file
is wrong. Moving it later costs more.

**Writing** — `W021` a fact placed one level below its topic: right file, wrong section.
Also a rule placed inside a figure, tree, or example cell that exists to illustrate ·
`W022` a value copied instead of taken from the one place that owns it. Import it in code;
cite it by name in a doc (`W020`). Grep the diff for `= \d` and check each against its
source · `W023` an ad-hoc `python -c` or shell one-off doing something a repo script or
`npm` entry already does. Extend the tool instead · `W024` a sentence the reader already
learned from the section above. Watch for a negative aside ("X is unaffected", "same
pattern as Y") about a topic the reader is not currently following · `W025` one rationale
repeated across files, sections, or comments. Inside a function, that means a docstring and
an inline comment carrying the same content. The docstring owns the contract; the comment
owns why this implementation · `W026` a comment restating what the code says, or running
multi-line where a pointer would do, or comparing the code against an alternative that is
not in the repo for a reader to check · `W027` provenance outside its home — "confirmed by
X on date Y", a threshold derived from one sample sitting in a general algorithm comment,
first-person narrative in a doc ("my guess was wrong"). Keep the rationale. Move the log to
a record · `W028` "not A but B", its disguises ("A isn't enough — you need B",
`Aではなく`/`Aではない` trailed by the positive), and the bare `X, not Y` / `X and not Y`.
Grep for `ではなく`, `ではない`, `rather than`, `isn't`, `, not `, `— not `, ` and not `, then
read the sentence and ask: **would a reader have assumed A?** If yes, it disambiguates. "The
degree in the stored graph, not the number of edges loaded" names the wrong reading a caller
would reach for. If no, A is a strawman, so write only B. Plain negation does not count
here: "whichever end is not the anchor" has no B · `W029` a struck-through list item
(`~~#2~~ — resolved: …`), or a gap left by an earlier deletion. Delete resolved items,
renumber from 1, keep the list contiguous · `W030` a paragraph or bullet breaking the
section's established pattern — an inline formula where the section uses code blocks,
outputs mixed into a list of inputs, an item wedged between two paragraphs that belong
together · `W031` a claim about a schema, column, API shape, config value, or enum meaning
asserted with no primary source. Verify it, or mark it unverified. A guess written in the
body will be read later as a fact · `W033` a sentence written for its sound: a metaphor, an
abstract noun standing in for the file or function the sentence is really about, an inverted
or aphoristic clause, or a run past 25 words. `docs/README.md` holds the rule and its one
exemption. It applies to `docs/**` including records, to comments under `web/src/`, and to
§4's message. Read each added sentence once and ask what its subject is. If finding the
subject takes a second pass, rewrite the sentence.

### Notes

`N001` new exported surface with no test · `N002` committing on `main` — confirm that's
intended · `N003` diff over ~600 lines: say what a reviewer should read first ·
`N004` a stash that looks like part of this work.

### What no scan can check

Ask these yourself, on the hunks:

- **Does the code do what the message will claim?** This is the most common defect.
- **Is this one change?** If the subject needs "and", it is two commits.
- **Would this bisect cleanly?** Anyone bisecting later stops on a commit that does not
  build.
- **Is anything load-bearing untested?** Ask whether anything would fail before a user
  found the breakage. Rising coverage does not answer that.
- **What did the author decide?** A rejected alternative belongs in a record. Nobody greps
  commit bodies for it.
- **Does each file still hold only what it monopolises?** `W019` covers whether the content
  is true. This check is different. Confirm that the code, the design doc, the record, and
  this commit message each carry only the part no other one can.
- **Does this comment belong *here*?** Keep a comment in two cases. It explains a
  non-obvious why at the point of confusion, or states a contract a caller depends on. Move
  or delete anything else, however accurate it is.
- **Could someone read this section alone and follow it?** And could a maintainer keep it
  accurate without hunting? Watch for a title, an opener, and a first table row that all say
  the same thing. Watch for related facts split between a table and a trailing paragraph.
  Every line can be correct while the whole gets harder to keep true.

## 4. Message

Everything else in the repo records what is true *now*. Only the commit message records
**why this change, and why now**. That reason is invisible in the resulting code. Write the
body about that.

```
<subject: imperative, sentence case, ≤60 chars, no trailing period>

<why, in prose. Wrapped at 76. The forces, what was ruled out, what a
reader would otherwise get wrong. One or two short paragraphs.>

Refs: docs/decisions/0002-single-table-layout.md
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

- Match `git log`, not a convention from elsewhere. This repo uses plain sentence-case
  subjects and prose bodies, with **no** `feat:`/`fix:` prefixes. If the repo later adopts
  Conventional Commits, follow the log rather than this file.
- Imperative: "Add", "Move", "Drop". The subject completes "this commit will …".
- No diffstat in prose. "Changed 4 files, added keys.ts" is already in the diff.
- No time-relative words. "Currently", "for now" and "soon" become wrong as time passes.
- Bullets only for a genuine list of independent items. Otherwise write prose.
- Trailers: `Refs:` a record or issue when one exists. `Co-Authored-By:` when Claude wrote
  code in the commit. Invent nothing, including an issue number that does not exist.
- A change whose reason is self-evident needs no body: a typo, a version bump. Everything
  else gets one.

Rejected subjects: `Update files`, `Fix bug`, `Various improvements`, `WIP`, `Address
feedback`, and any subject that would fit a hundred other commits.

## 5. Splitting

When the tree holds more than one change, do not average them into one message. Propose the
series instead. For each commit give the files or hunks, the subject, and why it stands
alone. Then stage and commit them one at a time. Verify between commits (§2), so that every
commit builds.

Use `git add -p` when one file holds two concerns. Say plainly when a clean split needs the
code edited first.

## 6. Confirm

Show the report and the full message, then wait. Do not commit through an unresolved block.

Name the checks you applied alongside the findings, and the file roles §3 assumed. A check
you skipped leaves no trace in a clean report, so that list is what lets the user catch the
gap. Once fixes land, review the new diff again. A second pass catches placement problems,
structure problems and a disguised `W028` far more often than a first pass does.

Then run `git commit` with the message via a heredoc or `-F`, and report the resulting
`git log -1 --stat`.

Do none of the following unless the user asks in that turn:

- `push`
- `amend` a commit that is already pushed
- `git checkout`/`restore`/`reset --hard` over uncommitted work
- `stash drop`
- `rebase`
- any force flag

A commit can be undone. These commands destroy work.

`--no-verify` belongs on that list for a different reason. It is easy to type, and it skips
`B004` entirely. The hook suggests it every time it blocks, which is the one moment to
refuse it. Fix the record, or ask.

## Amend and fixup

Use `amend` on the tip commit only, and only while that commit is unpushed. `git status
--porcelain=v2 --branch` must show `# branch.ab +N -M` with N ≥ 1. Those N commits are the
ones the upstream does not have yet. `+0` means the tip is already published, so amending
would rewrite history someone else may hold. A missing `branch.ab` line means nothing was
compared, which is also not an answer — ask. Re-run §2 and §3 against the *combined* diff.
Rewrite the message to describe the result, instead of appending "also fix X".

Use `fixup` once the commit is pushed or shared. A follow-up commit is the answer there. Say
so, rather than rewriting history.
