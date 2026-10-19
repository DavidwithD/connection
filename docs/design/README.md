# Design

How the parts fit together, and what has to stay true. These are living documents. Edit
them until every statement in them is true.

| Document | Holds |
|---|---|
| [architecture.md](architecture.md) | Layers, which way dependencies point, the invariants |
| [the-centre.md](the-centre.md) | What the map draws around the node in the middle |
| [finding-a-node.md](finding-a-node.md) | A label as an address, and the box that resolves one |
| [writing-to-the-graph.md](writing-to-the-graph.md) | The four transactions, how a refusal reads, and the way back |
| [the-components.md](the-components.md) | Components as an index: a merge inside the write, a split after it |
| [a-graph-as-text.md](a-graph-as-text.md) | The file a graph is typed and written back as |
| [the-generated-graph.md](the-generated-graph.md) | The three passes a seeded graph is built in, and why each one |

`architecture.md` covers the whole system: the layers, and the invariants that cross them.
Every other page covers one capability. It goes deep enough that you can argue with the
design without opening a source file. [template.md](template.md) is the one copy of that
shape.

## What does not go here

The reasoning. A design document states that positions are frozen. A record states what
freezing cost and which options it rejected. If you catch yourself writing *we chose*, you
are writing a record. Take the next number in [decisions/](../decisions/).

Anything that stays true only while someone remembers to update it. Two pages tried this.
One was a drawing of a comparison already argued in prose. The other was a working copy of
the panel with its own cut-down combobox. Both went stale, and no check reported it. Neither
gate reads such a page. [checks.md](../checks.md) binds markdown, and the layout tree covers
the code directories only.
