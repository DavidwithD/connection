# The generated graph

**Seed a demo graph** on the transfer page writes a graph nobody typed. `generate` builds it in
three passes over a fixed set of ids. Pass one builds one ring lattice per component. Pass two
rewires a fraction of the lattice edges. Pass three pulls a few nodes up into hubs. The result
is deterministic: the same seed gives the same graph. Its purpose is to give the map something
worth exploring. It models nothing real.

The next seed replaces everything the generator produces. What survives a seed is
[a-graph-as-text.md](a-graph-as-text.md).

The generator itself is pure and always was. Where its output goes has changed. It used to be
a command that dropped a table. It is now a button that asks first.

## The pieces

| Name | What it is | In the code |
|---|---|---|
| ring lattice | Every node joined to its nearest neighbours on both sides | `generate`, pass one |
| rewiring | One end of a lattice edge moved elsewhere, with probability `p` | `generate`, pass two |
| hub | A node pulled up to a high degree, paid for by edges taken from elsewhere | `generate`, pass three |
| component | A contiguous range of ids that no edge leaves | `shares`, `starts` |
| reach | How far the lattice runs inside one component, which can be less than was asked for | `reachIn` |
| labeller | Three syllable slots, so the demo does not read as a load test | `labeller` |

## Why a small world

A ring lattice is densely cyclic and gives every node the same degree. Rewiring a fraction of
its edges collapses the average path length. So exploring the result never feels like walking
down a corridor. The map needs both properties: somewhere to go in every direction, and no
long thin stretches.

A plain lattice has no hub. The degree spread stays narrow at any useful rewiring probability.
So no node in it stands out as well connected. The views that size a node by its degree then
show no difference. The third pass makes the hubs.

A rewired ring lattice also stays in one piece. It is connected at every probability. So the
generator builds the components itself. It runs one ring lattice per component, instead of one
across the whole node list.

## One ring lattice per component

`shares` divides the nodes between components as halving shares, largest first. Even shares
would make the smallest component as big as the largest. The order the page lists them in
would then mean nothing. Halving gives one component worth exploring and a few worth crossing
to. At the end are the ones that matter most here: a pair and a lone node. Those are what a
person making nodes by hand actually produces.

The shares must sum to exactly `n`, and that part needs care. A node in no component has no
lattice to join. Rounding moves the total either way. So `shares` corrects the difference
against the largest components. Only they have nodes to spare, and only for them is a node or
two either way unimportant.

Components are **contiguous ranges of ids**, so finding a node's component is arithmetic
rather than a lookup. Those ids are internal to the generator now. It writes names, because the
name is the key ([finding-a-node.md](finding-a-node.md)).

All three passes stay inside a component, and each has its own way to leave one:

- the lattice can wrap past the end of a component, so the modulus is the component's size and
  never the graph's;
- a rewired edge can end in the next component, so a shortcut is drawn from inside the
  component only;
- a hub takes an edge from wherever it finds one, so both ends are held to the hub's component.

The page can never offer a joined component as a separate place to go. That is the whole reason
the component count exists, so the generator must never join two components.

## Making hubs without changing the mean

Each edge a hub gains is paid for by one edge dropped elsewhere. An edge `(v, w)` becomes
`(v, hub)`. `v` is unchanged and `w` gives up one. The total edge count, and with it the mean
degree, is exactly what it was.

The pass refuses two kinds of donor. The first is a node already at the lattice's minimum
degree. That stops the pass breaking a lattice open to feed a hub. The second is any earlier
hub. The hubs built after it would otherwise drain it back down. The graph would then quietly
lose the top degree the caller asked for.

Those two refusals also cap how many hubs are possible. Every edge a hub gains is somebody
else's spare degree. Once that is spent, the pass runs out of donors. Any further hubs stay at
the mean degree, and nothing reports it.

The pass drives one hub to the top degree exactly, so the top of the range is where the caller
asked for it. It spreads the rest from just above the degree plain rewiring reaches. That fills
the tail of the distribution and leaves no spike with a gap below it.

## What has to stay true

**The same seed gives the same graph.** The *graph* is reproducible across seed runs. The
*layout* deliberately is not. Two independent random streams keep it that way: one for
structure, one for labels. With one shared stream, a change to the name list would shift every
later draw. That would silently rewire the graph, and it did so once.

**No edge leaves its component.** All three passes are confined to a range. If an edge left,
the component list on the page would list things that are connected. Nothing downstream would
report it.

**The mean degree survives the hub pass.** Each hub edge is paid for. A pass that only added
edges would make `k` a lower bound rather than a mean. The degree-based sizing on the map would
change with it.

**A component of one comes out with no edges.** That is correct, since its only candidate
neighbour is itself. The reach is whatever the component can hold, which can be less than was
asked for. The small end of the halving is a pair.

## Where the numbers are

[transfer.ts](../../web/src/transfer.ts) holds the defaults the button seeds with.
[generate.ts](../../web/src/store/generate.ts) holds the retry bounds on rewiring and on the
hub pass, and the syllable lists. It also holds the guards on `n`, `k` and the component count.
Each carries the reason for its value in a comment.

## Records behind it

| Record | What it decided |
|---|---|
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | A generated small-world graph as the demo's data, and that the graph is reproducible while the layout is not |
| [0019](../decisions/0019-every-component-has-an-address.md) | Components as a thing the page must be able to reach, which is why the generator makes them |
| [0018](../decisions/0018-the-graph-outlives-the-seed.md) | That a seed replaces the graph, and what has to leave before it |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | That seeding is a button now, and asks before it replaces anything |
