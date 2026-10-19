# Docs

Four kinds of document, split by the question each answers and by how each one ages.

| Document | Answers | Lifecycle |
|---|---|---|
| [requirements/](requirements/) | What are we building, and for whom? | Living — edited in place |
| [design/](design/) | How is it put together, and what must hold? | Living — edited in place |
| [decisions/](decisions/) | Why this way, and what did we not know? | Append-only — facts never change; wording follows the glossary |
| [using-the-demo.md](using-the-demo.md) | How do I drive it? | Living — edited in place |

Each kind ages differently. A living document describes the present. People edit it until
every statement in it is true. A record describes one moment: the state of knowledge at the
time. Editing a record destroys that. A reversal is a new record.

The fourth kind was once over half of the [README](../README.md). It answers a different
question from the other three. A reader following it wants the keystroke, and has no use for
the invariant. It crowded out what the README is for. It is one file, because a tour has an
order and a directory of six files has none.

A guide and a design page sometimes describe the same mechanism. Then the design page is the
fuller answer, and it wins any disagreement. [ADR 0026](decisions/0026-a-fourth-kind-of-document.md)
records what that duplication costs and which options it rejected.

## Every capability

Start here. The table has one row per thing the demo does. A reader finds the current shape
of one capability in one read, without a sweep through the records. Two of the four kinds
have a column here. [One guide](using-the-demo.md) covers driving every capability, so the
guide has no column. Each design page ends with the records behind it. A second list of
records here would go stale, so the records have no column either.

| Capability | What it must do | How it works |
|---|---|---|
| Explore a graph | [exploring-a-graph.md](requirements/exploring-a-graph.md) | [the-centre.md](design/the-centre.md) |
| Build a graph | [building-a-graph.md](requirements/building-a-graph.md) | [writing-to-the-graph.md](design/writing-to-the-graph.md) |
| Move a graph in or out | [moving-a-graph.md](requirements/moving-a-graph.md) | [a-graph-as-text.md](design/a-graph-as-text.md) |
| Find a node by name | **not written up** | [finding-a-node.md](design/finding-a-node.md) |
| Cross to a component | **not written up** | [the-components.md](design/the-components.md) |
| Seed a graph to explore | **not written up** | [the-generated-graph.md](design/the-generated-graph.md) |
| Store a graph at all | [storing-a-graph.md](requirements/storing-a-graph.md) | [architecture.md](design/architecture.md), [the-components.md](design/the-components.md) |
| Keep the docs honest | n/a — serves this directory | [checks.md](checks.md), [decisions/GATE.md](decisions/GATE.md) |

Four rows have no requirement, for one of two reasons, and the column says which. **Not
written up** is a real gap. All three capabilities arrived after
[exploring-a-graph.md](requirements/exploring-a-graph.md) was written, and nobody scoped
them. What a search box, a component list or a seeded graph *must* do exists only in the
records that built them. **n/a** marks the gates. They serve this directory, and no reader of
the graph uses them.

[architecture.md](design/architecture.md) covers every row. It describes the layers and the
invariants that cross them. Every other design page is one row above.

## Where a given sentence belongs

- Naming a constraint the code obeys, and why it holds → **design/**, in that page's own
  words. The record goes in its footer, and nowhere else on the page.
- Arguing why that constraint beat the alternative, or saying what nobody knew at the time
  → **decisions/**.
- A number (a cap, a threshold, a budget) → beside the code that reads it. Other pages cite
  it once. A second copy goes stale.
- Anything true only this week → nowhere. It belongs in the change that makes it true.

A decision rejects at least one option. If no option lost, you have a note. A note goes in
the document it explains.

## The reader

The reader hit a constraint in the code and needs to know whether it still holds. That
reader is somebody other than a person browsing this directory.

No source file names a document, so every link runs one way: from here, outward. A rename
then cannot make a comment wrong without anyone seeing it. Each rationale stays in one place,
so two copies cannot diverge. The cost is a reader who starts in the code and must come here
to find the page. The capability table above is one entry point.
[design/architecture.md](design/architecture.md#what-each-file-carries) is the other. It
maps every file to the page describing it, and to the records behind it.

So those two tables matter. A capability with no row is a document nobody reaches. So is a
file whose page no table names. A reader reaches a record from the design page it sits
under.

## How it is written

Plain sentences. One point per sentence, a concrete subject, and a full stop before 25 words.
The subject is a file, a function, a person or a capability. Every page here is in scope,
including record titles, record bodies and code comments.

[glossary.md](glossary.md) defines each term once. Use the term from the glossary. Do not
invent a second name for the same thing.

Four patterns are banned. Each example below is a sentence this repo once held.

| Pattern | Before | After |
|---|---|---|
| A gesture or a part of the page as the actor | `A click leaves the panel alone.` | The click handler in `main.ts` copies the name and returns. |
| A sentence that only says what does not happen | `A click on the map fills no input in the panel.` | The click handler copies the selected node's name to the clipboard. |
| A figurative noun for a concept | `A doorway loses its click.` | The renderer ignores a click on that off-screen marker. |
| An aphorism, or "X is not a Y" | `Asking to go is asking to be taken.` | `goTo` in `main.ts` moves the camera to the node a search found. |

A negative sentence is fine when the negative is the fact. "The rename keeps the key" is
better than "the rename does not change the key". "Nothing reads this value" is a fact
with no positive form.

[prose-lint.py](../scripts/prose-lint.py) checks every write. It reports two findings with
certainty: `L001`, a sentence over 25 words, and `L006`, a term from the block list in
[plain-terms.txt](../scripts/plain-terms.txt). The docs gate fails on both, in every
markdown file and every code comment. The linter also reports guesses. `L002`–`L005` flag
abstract subjects and aphorisms. `L007` flags a page part as the actor. `L008` flags a term
that may be figurative. A guess never blocks. No script can see a metaphor, so the writer
applies this section. [ADR 0051](decisions/0051-the-plain-prose-rule-covers-committed-text.md)
records why the rule covers committed text. [ADR 0035](decisions/0035-a-rule-for-new-sentences.md)
records the first version of the rule.

## What is enforced

Each lifecycle at the top of this page has one gate. [decisions/GATE.md](decisions/GATE.md)
checks a record's shape and its supersede rules. [checks.md](checks.md) checks a living
document against the code it describes.
