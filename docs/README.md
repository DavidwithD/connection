# Docs

Three kinds of document, split by the question each answers and by how each one ages.

| Directory | Answers | Lifecycle |
|---|---|---|
| [requirements/](requirements/) | What are we building, and for whom? | Living — edited in place |
| [design/](design/) | How is it put together, and what must hold? | Living — edited in place |
| [decisions/](decisions/) | Why this way, and what did we not know? | Append-only — never rewritten |

The split is the point. A living document describes the present, so it gets edited until it
is wrong about nothing. A record describes one moment, so editing it destroys the only thing
it holds — the state of knowledge at the time. A reversal is a new record, not a rewrite.

## Every capability

Start here. One row per thing the demo does, so finding the current shape of one costs a
read rather than a sweep through the records.

| Capability | What it must do | How it works | Records |
|---|---|---|---|
| Explore a graph | [exploring-a-graph.md](requirements/exploring-a-graph.md) | [the-centre.md](design/the-centre.md) | 0003, 0004, 0006, 0012, 0017, 0025 |
| Build a graph | [building-a-graph.md](requirements/building-a-graph.md) | [writing-to-the-graph.md](design/writing-to-the-graph.md) | 0009, 0010, 0011, 0013, 0024 |
| Move a graph in or out | [moving-a-graph.md](requirements/moving-a-graph.md) | [a-graph-as-text.md](design/a-graph-as-text.md) | 0018, 0021, 0022, 0023 |
| Find a node by name | **not written up** | [finding-a-node.md](design/finding-a-node.md) | 0008, 0013 |
| Cross to an island | **not written up** | [the-islands.md](design/the-islands.md) | 0019, 0020 |
| Store a graph at all | Open — see [requirements/](requirements/) | [architecture.md](design/architecture.md), the README's data model | 0002, 0007 |
| Keep the docs honest | n/a — serves this directory | [checks.md](checks.md), [decisions/GATE.md](decisions/GATE.md) | 0014, 0015, 0016 |

Four rows are short of a requirement, in three different ways, and the column says which.
**Not written up** is a genuine gap: both capabilities arrived after
[exploring-a-graph.md](requirements/exploring-a-graph.md) was written and neither was ever
scoped, so what a search box or an island list *must* do exists only as the records that
built them. **Open** is the domain nobody has defined
([ADR 0002](decisions/0002-single-table-layout.md)). **n/a** is the gates, which serve this
directory rather than a reader of the graph.

[architecture.md](design/architecture.md) sits across all of it — layers, and the invariants
that cross them. Every other design page is one row above.

## Where a given sentence belongs

- Naming a constraint the code obeys → **design/**, linking the record behind it.
- Arguing why that constraint beat the alternative → **decisions/**.
- A number (a cap, a threshold, a budget) → beside the code that reads it, cited once from
  anywhere else. Two copies is one stale copy.
- Anything true only this week → nowhere. It belongs in the change that makes it true.

Rejecting something is what makes a decision a decision. If no option lost, you have a note,
and a note goes in the document it explains.

## The reader

Not someone browsing this directory. Someone who hit a constraint in the code and needs to
know whether it still holds. So the links that matter run *inbound*: the file carrying a
constraint points at the document explaining it, not only the reverse.
[decisions/GATE.md](decisions/GATE.md) makes that a rule for records (`M010`); the same
habit is what keeps the two living directories from going unread.

## What is enforced

One gate per lifecycle, following the split at the top of this page.
[decisions/GATE.md](decisions/GATE.md) holds a record to its shape and its supersede
discipline; [checks.md](checks.md) holds a living document to the code it describes.
