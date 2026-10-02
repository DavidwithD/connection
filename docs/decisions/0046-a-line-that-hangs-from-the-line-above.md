# 0046 — A line that hangs from the line above

**Status:** 🔵 Proposed
**Date:** 2026-09-06
**Deciders:** David HL

## Context
[0021](0021-a-graph-in-a-text-file.md) reads a line as a star. The name at its head joins
every other name on it. A tree is then one line per parent. Every node that has both a parent
and children is spelled twice. It appears in its parent's list, then again at the head of its
own line.

0021 already records what a second spelling costs. A misspelling is a new node, and nothing
matches a name against a near miss.

[0022](0022-a-graph-written-back-out.md) writes the other half of this format. The two have
to agree. A reader the writer no longer matched would load a file as some other graph, and
raise nothing.

## Decision
Leading whitespace hangs a line from the line above it. The reader takes it. The writer never
produces it.

```
Kavara | Miselin
    Vessarin | Sarn
        Sarn | Veyle
```

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The parent | Nearest line above with a smaller indent | No fixed step to get wrong. |
| The join | Child's head to the parent's head | The star rule, unchanged. |
| Depth | Unlimited | One level leaves the duplicate below it. |
| A ragged column | Hangs from the next line out | A typed file does not hold its columns. |
| Tabs and spaces | One file uses one of the two. A fault | Two styles share no column. |
| The writer | Flat, unchanged | The graph holds no tree to indent by. |

## Alternatives considered
- **A marker character, `- D | E` or `| D | E`.** It reserves a character that 0021 lets a
  name hold. This format has no escape, and 0022 left adding one open. Leading whitespace
  reserves nothing, because `naming` in keys.ts trims it off every name already.
- **One level of nesting.** It removes the second spelling only for parents whose children are
  all leaves. Every level below gets the second spelling back.
- **A ragged column as a fault.** Python's rule. It rejects a typed file over cosmetics, and
  the preview lists every pair before anything is written.
- **Indenting on the writer too.** It would have to pick a spanning tree. Any rule it picked
  would re-indent unchanged nodes whenever one edge moved a degree.

## Consequences
A file that indented for looks now reads as a different graph. Nothing reports a fault,
because that reading is valid. The preview is the guard. It lists every pair before the write
button appears.

`parse` grows a stack and two faults. `format`, `survey` and `apply` are untouched.

The text round trip loses one more thing. Export a nested file after loading it, and the
indentation is gone. The graph is the same.

## Assumptions and unknowns
- **Assumed no file in the wild indents for looks.** Wrong when a load reports edges nobody
  typed. The repo holds no such file.
- **Assumed a typed file wants the forgiving column rule.** Wrong when a ragged file builds a
  tree nobody meant and the preview is skimmed.
- **Unknown whether anyone wants a nested export.** Not built, because that tree would be
  invented rather than read.

## Revisit when
- A load reports an edge nobody typed, once the file's indentation is the reason.
- Somebody needs an export that indents.
- A second nesting rule is proposed, so the reader would carry two.
