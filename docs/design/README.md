# Design

How the parts fit together, and what has to stay true. Living documents — edit them until
nothing in here is wrong.

| Document | Holds |
|---|---|
| [architecture.md](architecture.md) | Layers, which way dependencies point, the invariants |
| [the-centre.md](the-centre.md) | What the map draws around the node in the middle |
| [finding-a-node.md](finding-a-node.md) | A label as an address, and the box that resolves one |
| [writing-to-the-graph.md](writing-to-the-graph.md) | The four transactions, how a refusal reads, and the way back |
| [the-islands.md](the-islands.md) | Components as an index, maintained by writes that may fail |
| [a-graph-as-text.md](a-graph-as-text.md) | The file a graph is typed and written back as |
| [names-and-options.html](names-and-options.html) | The far-neighbour options, drawn and animated |
| [two-ends.html](two-ends.html) | The panel that finds and joins, driveable, with its losing layouts |

`architecture.md` is the whole system — layers, and the invariants that cross them. Every
other page is one capability, at the level where you can argue with the design without
opening a source file. [template.md](template.md) is the one copy of that shape.

A figure earns its own file when the thing in question is visual. The options for a far
neighbour were drawn and moved before one was picked, and
[ADR 0004](../decisions/0004-the-centre-and-its-neighbourhood.md) cites that page as the
comparison it chose from — which only works because the page still shows the losers.

## What does not go here

The reasoning. A design document states that positions are frozen; a record states what
freezing cost and what was turned down to buy it. If you catch yourself writing *we chose*,
you are writing a record — take the next number in [decisions/](../decisions/).
