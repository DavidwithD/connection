# Storing a graph

**Scope: the demo, not the product.** What the store under the graph has to do, and at what
size. Product scope is still open — see the [README](README.md).

This is the row the [capability table](../README.md#every-capability) marked **Open** for as
long as it existed. Every other capability is about what a reader does with a graph. This one
is about the store all of them depend on. Nobody had written a number for it.

## Who wants it

Whoever is building a graph and expects to find it again. Every other capability assumes this
one without saying so. Exploring assumes there is something to walk, building assumes a write lands,
moving assumes there was a graph to move.

And whoever is deciding how the store is put together. A design cannot argue that a walk is
affordable, or that a count can be scanned, without a size to argue it at.

## What they cannot do without it

Tell a slow operation from a broken one. Without a stated size, "the full recount takes a
while" and "the full recount never finishes" are the same report. Then nobody can show a design
choice to be wrong.

That gap was real. Comments in the code relied on an undefined scale many times. Depth holds
"at this scale". The first node reads as readily as "the ten-thousandth". The nearest written
assumption was in a record, and on no design page.
[0019](../decisions/0019-every-component-has-an-address.md) assumed splits were rare and
shallow. It also said a general split could walk half a component. No current page repeated
it.

## The ceiling

**Fifty thousand nodes and about a hundred and fifty thousand edges.**

This is a ceiling, not a prediction. The store is built to hold this much with every operation
still usable. The ceiling is deliberately far above any graph the demo has held.
**Seed a demo graph** builds six hundred nodes, which is a sample rather than a specification.

## The requests

- *Given a graph at the ceiling, draw any node's neighbourhood* without the page pausing.
- *Given a join, list the components correctly straight away.* A merge may not lag.
- *Given a part, let the component list update late* rather than freezing the page.
- *Given a component list that lags, let me recount it* from the nodes and edges themselves.
- *Given any single operation, do not stall the map for longer than a reader will tolerate.*
- *Given the graph, let me take the whole of it out as one file* — slowly is acceptable.
- *Given a browser that will not store it, say so* rather than half-working.

## How anyone would tell it worked

- Seed fifty thousand nodes. The map still draws, the search box still answers as you type,
  and the side panel still scrolls.
- A hub at the read ceiling draws as fast as a node with three edges.
- Join two components: the list loses a row immediately. Part the edge between them: the row
  comes back. If it does not, **Recount the components** brings it back.
- No single operation holds the map still for longer than about a third of a second. The
  exceptions are the ones a reader pressed a button for and is watching.
- Export at the ceiling produces one file. It takes seconds, and the page says it is working.

## What gives first past it

Named rather than left to be discovered. Past the ceiling, in this order:

- **The export and the import.** One file, one string, one transaction. At the ceiling that is
  several tens of megabytes, and each is a single allocation.
- **The full recount.** Linear in the graph, and it rewrites every record it changes.

None of these is on the path of an ordinary read or write. So past the ceiling, the
whole-graph operations fail first, and the map keeps working.

## Not required

Surviving the browser. **The graph lives in one browser profile and nowhere else.** Clearing
site data destroys it, and another browser is another graph
([0030](../decisions/0030-the-graph-moves-into-the-browser.md)). Two tabs agreeing with each
other. Any server, account, or network. Concurrent writers beyond one reader in one tab.
Renaming a node. Searching the middle of a name.

## Where the design is

[architecture.md](../design/architecture.md) covers the layers and the invariants across them.
[the-components.md](../design/the-components.md) covers the choice the ceiling decides most
clearly. It says which half of the component index runs inside a write and which runs after it.
