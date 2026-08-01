# Design

How the parts fit together, and what has to stay true. Living documents — edit them until
nothing in here is wrong.

| Document | Holds |
|---|---|
| [architecture.md](architecture.md) | Layers, which way dependencies point, the invariants |
| [the-centre.md](the-centre.md) | What the map draws around the node in the middle |
| [names-and-options.html](names-and-options.html) | The far-neighbour options, drawn and animated |

A figure earns its own file when the thing in question is visual. The options for a far
neighbour were drawn and moved before one was picked, and
[ADR 0004](../decisions/0004-the-centre-and-its-neighbourhood.md) cites that page as the
comparison it chose from — which only works because the page still shows the losers.

## What does not go here

The reasoning. A design document states that positions are frozen; a record states what
freezing cost and what was turned down to buy it. If you catch yourself writing *we chose*,
you are writing a record — take the next number in [decisions/](../decisions/).
