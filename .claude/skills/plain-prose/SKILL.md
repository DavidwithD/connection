---
name: plain-prose
description: Rewrite the prose in one file to the repo's plain-language rule — literal glossary terms, code or a person as the actor, positive facts, sentences under 25 words. Use when asked to rewrite, plain-ify or fix the wording of a doc, a decision record or the comments in a source file, when prose-lint reports L001/L006 on a file, or before committing a file the docs gate rejects for P001/P006.
---

# Rewrite one file in plain language

The rule is `docs/README.md` § *How it is written*. The terms are in `docs/glossary.md`. The
old terms and their replacements are in `scripts/plain-terms.txt`. Read all three before the
first file.

## What must not change

- **Facts.** Every claim, number, date, name and condition stays. A rewrite that drops a
  qualifier ("on a click on the selected node") has changed a fact.
- **Links and anchors.** Every link target stays the same character for character. Only the
  link text may change.
- **Code spans and fenced blocks.** Text in backticks is an identifier or a quoted example.
  Leave it, unless the identifier itself was renamed in the code.
- **Structure.** Headings stay at their level and in their order. Tables keep their columns
  and row count. Lists keep their items. A record keeps its sections and metadata lines.
- **Records.** A decision record states what was known at the time. Keep its tense and its
  claims. Change the words only. Keep the record under its section budgets in
  `docs/decisions/GATE.md`.
- **Code.** In a source file, change comments only. Do not touch a line of code.

## The procedure

1. Run `python3 scripts/prose-lint.py <file>` and keep the report.
2. Read the file top to bottom, one sentence at a time.
3. For each sentence, ask four questions.
   - **What is the subject, and is it the real actor?** A click, a drag, a box, a panel or the
     map does nothing by itself. Name the function, the file, the handler or the person.
     `A click leaves the panel alone` becomes "the click handler in `main.ts` copies the name
     and returns".
   - **Does it state the positive fact?** `A click fills no input` says what does not happen.
     Write what does happen. Keep a negative only when the negative is the whole fact, such
     as "nothing reads this value".
   - **Is every noun the glossary's term?** Replace each old term with its literal term. Use
     the sense the context needs: `ring` can mean the neighbours, a placement circle, or an
     outline.
   - **Is it under 25 words, with one point?** Split it. Do not join with a dash or a
     semicolon.
4. Remove metaphor, personification and aphorism. `The box wants a name` becomes "`join.ts`
   writes nothing on Enter until the input holds a name". Replace `X is not a Y` with a
   statement of what X is.
5. Keep the result short. A rewrite should be about the same length as the original. Cut a
   sentence that only restates the one before it.
6. Run the linter again. `L001` and `L006` must be gone. For each `L002`–`L005`, `L007` and
   `L008` left, read the sentence and decide. A literal use stays. Examples of literal uses:
   "ring lattice" in the generator, "the accent colour token", "leads to".
7. For a decision record, run `python3 scripts/adr-gate.py`. For any other markdown file, run
   `python3 scripts/docs-gate.py --only paths`.

## Terms with more than one sense

Some old terms have a literal sense the repo keeps. The [check] list in
`scripts/plain-terms.txt` holds them. Replace the figurative sense and keep the literal one.

| Word | Figurative sense (replace) | Literal sense (keep) |
|---|---|---|
| centre | the selected node | the middle of the screen, `text-valign: center` |
| ring | the neighbours, a placement circle, an outline | the ring lattice in `generate.ts` |
| accent | the selected node | the colour token `--accent` |
| lead | a connector line | the verb, as in "leads to" |
| field | the other nodes | a record field, a form field |
| settle | a merge, an idle camera | none |
| frontier | a node with unread edges | the BFS frontier in `store/` |

## Reporting

Say which files changed. List any sentence you could not shorten without losing a fact, with
its line number. Do not commit.
