# The generated graph

`npm run graph:seed` writes a graph nobody typed. It is built in three passes over a fixed
set of ids: one ring per component, a fraction of the ring edges rewired, then a pass that
pulls a few nodes up into hubs. The result is deterministic — the same seed gives the same
graph — and it exists to give the map something worth exploring, not to model anything real.

Everything the generator produces is thrown away by the next seed run. What survives one is
[a-graph-as-text.md](a-graph-as-text.md).

## The pieces

| Name | What it is | In the code |
|---|---|---|
| ring lattice | Every node joined to its nearest neighbours on both sides | `generate`, pass one |
| rewiring | One end of a lattice edge moved elsewhere, with probability `p` | `generate`, pass two |
| hub | A node pulled up to a high degree, paid for by edges taken from elsewhere | `generate`, pass three |
| island | A contiguous range of ids that no edge leaves | `shares`, `starts` |
| reach | How far the ring runs inside one island, which is not always what was asked for | `reachIn` |
| labeller | Three syllable slots, so the demo does not read as a load test | `labeller` |

## Why a small world

A ring lattice is densely cyclic and gives every node the same degree. Rewiring a fraction of
its edges collapses the average path length, so exploring the result never feels like walking
down a corridor. Both properties are what the map needs: somewhere to go in every direction,
and no long thin stretches.

What it will not give is a hub. The degree spread stays narrow at any rewiring probability
worth using, so nothing in a plain lattice is worth calling well connected and the views that
size a node by its degree have nothing to say. The third pass is what makes some.

Nor will it give a graph in pieces. A rewired ring lattice is connected and stays connected
at every probability. Islands are built instead, by running one ring per component rather
than one across the whole node list.

## One ring per island

Nodes divide between islands as halving shares, largest first. Even shares would make the
tail as big as the continent and leave nothing to notice about the order the page offers them
in. Halving gives one component worth exploring, a few worth crossing to, and at the end of
it the ones that matter most here — a pair, and a lone node, which is what somebody making
nodes by hand actually produces.

The shares must sum to exactly `n`, and that is the part worth being careful about. A node in
no island has no ring to join and no component to belong to. Rounding moves the total either
way, so the difference is settled against the largest islands: the only ones with nodes to
spare, and the only ones a few either way says nothing about.

Islands are **contiguous ranges of ids**, so which island a node is in is arithmetic rather
than a lookup, and the ids in one island read consecutively in the table.

All three passes are held inside an island, and each has its own way of escaping one:

- the ring can wrap past the end of a component, so the modulus is the island's size and
  never the graph's;
- a rewired edge can land in the next component, so a shortcut is drawn from inside the
  island only;
- a hub takes an edge from wherever it finds one, so both ends are held to the hub's island.

A component this generator quietly joins to another is one the page can never offer as
somewhere else to go — which is the whole reason the island count exists.

## Making hubs without changing the mean

Every edge a hub gains is paid for by one dropped elsewhere. An edge `(v, w)` becomes
`(v, hub)`: `v` is unchanged, `w` gives up one, and the total edge count — and with it the
mean degree — is exactly what it was.

Two kinds of donor are refused. A node already at the ring's floor, so the pass cannot tear a
ring open to feed a hub; and any earlier hub, which would otherwise be drained back down by
the hubs built after it and quietly cost the graph the top degree it was asked for.

Those two refusals are also the ceiling on how many hubs are possible. Everything a hub gains
is somebody else's spare degree, so once that is spent the pass runs out of donors and any
further hubs are left sitting at the mean. Silently — nothing reports it.

One hub is driven to the top degree exactly, so the top of the range is where the caller
asked for it. The rest are spread from just past where plain rewiring tops out, which fills
the tail rather than leaving a spike and a gap.

## What has to stay true

**The same seed gives the same graph.** The *graph* is reproducible across seed runs even
though the *layout* deliberately is not. Two independent random streams keep it that way: one
for structure, one for labels. Sharing a stream would let a change to the name list shift
every later draw and silently rewire the graph — which it did, once.

**No edge leaves its island.** All three passes are confined to a range. Break this and the
island list on the page becomes a list of things that are not separate, which nothing
downstream would report.

**The mean degree survives the hub pass.** Each hub edge is paid for. A pass that only added
would make `k` a lower bound rather than a mean, and the degree-based sizing on the map would
drift with it.

**An island of one comes out with no edges.** Correctly — every candidate neighbour is
itself. The reach is whatever the island can hold rather than what was asked for, because the
small end of the halving is a pair.

## Where the numbers are

The defaults, and the environment variables that override them, in
[seed.ts](../../src/graph/seed.ts). The retry bounds on rewiring and on the hub pass, the
syllable lists, and the guards on `n`, `k` and the island count, in
[generate.ts](../../src/graph/generate.ts). Each carries the reason for its value in a
comment.

## Records behind it

| Record | What it settled |
|---|---|
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | A generated small-world graph as the demo's data, and that the graph is reproducible while the layout is not |
| [0019](../decisions/0019-every-island-has-an-address.md) | Components as a thing the page must be able to reach, which is why the generator makes them |
| [0018](../decisions/0018-the-graph-outlives-the-seed.md) | That a seed run replaces the graph, and what has to leave before it |
