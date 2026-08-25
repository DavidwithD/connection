# Storing a graph

**Scope: the demo, not the product.** What the store under the graph has to do, and at what
size. Product scope is still open — see the [README](README.md).

This is the row the [capability table](../README.md#every-capability) marked **Open** for as
long as it existed. Every other capability is about what a reader does with a graph; this one
is about the ground all of them stand on, and it was the one nobody had written a number
against.

## Who wants it

Whoever is building a graph and expects to find it again. Every other capability assumes this
one silently: exploring assumes there is something to walk, building assumes a write lands,
moving assumes there was a graph to move.

And whoever is deciding how the store is put together. A design cannot argue that a walk is
affordable, or that a count can be scanned, without a size to argue it at.

## What they cannot do without it

Tell a slow operation from a broken one. Without a stated size, "the reckoning takes a while"
and "the reckoning never finishes" are the same report, and no design choice can be shown to
be wrong.

That gap is not hypothetical. The code leaned on an undefined scale repeatedly — depth holds
"at this scale", the first node reads as readily as "the ten-thousandth" — and the nearest
thing to a written assumption sat in a record rather than on a page:
[0019](../decisions/0019-every-island-has-an-address.md) assumed splits were rare and shallow
while admitting a general one could walk half a component. Nothing living repeated it.

## The ceiling

**Fifty thousand nodes and about a hundred and fifty thousand edges.**

A ceiling, not a prediction. It is what the store is built to hold with every operation still
usable, and it is deliberately far above any graph the demo has held. **Seed a demo graph**
builds six hundred nodes, which is a sample rather than a specification.

## The requests

- *Given a graph at the ceiling, draw any node's neighbourhood* without the page pausing.
- *Given a write, tell me how big the graph is* without re-counting the whole of it.
- *Given a join, list the islands correctly straight away* — a merge may not lag.
- *Given a part, let the island list catch up late* rather than freezing the page.
- *Given a lagging island list, let me reckon it back* from the nodes and edges themselves.
- *Given any single operation, do not stall the map for longer than a reader will tolerate.*
- *Given the graph, let me take the whole of it out as one file* — slowly is acceptable.
- *Given a browser that will not store it, say so* rather than half-working.

## How anyone would tell it worked

- Seed fifty thousand nodes. The map still draws, the search box still answers as you type,
  and the island drawer still scrolls.
- A hub at the read ceiling draws as fast as a node with three edges.
- The totals in the guide update after a write without the write getting slower as the graph
  grows.
- Join two islands: the list loses a row immediately. Part the bridge: the row comes back,
  and if it does not, **Recount the islands** brings it back.
- No single operation holds the map still for longer than about a third of a second, except
  the ones a reader pressed a button for and is watching.
- Export at the ceiling produces one file. It takes seconds, and the page says it is working.

## What gives first past it

Named rather than left to be discovered. Past the ceiling, in this order:

- **The counts.** They are memoised from one scan when the database opens, and that scan is
  linear in the graph.
- **The export and the import.** One file, one string, one transaction — several tens of
  megabytes at the ceiling, and each is a single allocation.
- **The reckoning.** Linear in the graph, and it rewrites every record it changes.

None of these is on the path of an ordinary read or write. That is the shape of the ceiling:
it is the whole-graph operations that give, not the map.

## Not required

Surviving the browser. **The graph lives in one browser profile and nowhere else** — clearing
site data destroys it, and another browser is another graph
([0030](../decisions/0030-the-graph-moves-into-the-browser.md)). Two tabs agreeing with each
other. Any server, account, or network. Concurrent writers beyond one reader in one tab.
Renaming a node. Searching the middle of a name.

## Where the design is

[architecture.md](../design/architecture.md) for the layers and the invariants across them,
and [the-islands.md](../design/the-islands.md) for the one thing the ceiling decides most
sharply — which half of the component index runs inside a write and which runs after it.
