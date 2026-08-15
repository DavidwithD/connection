# The islands

The map is walked outward from one node, so a component holding nothing anyone has reached
is at the end of no walk however long they look — and every node made from the page starts
as exactly that. Naming those components is the only way in. Every node carries a
union-find `parent`; a node pointing at itself is a *root*, and a root is a component. Only
roots carry the island index keys, so one Query returns one row per component, largest
first. The index is derived, maintained one edge at a time by writes that are allowed to
fail, and reckoned back from the graph itself when it drifts.

The store cannot simply answer *what components are there*: membership spans the whole edge
set, and each node owns its own partition, so the only other way to ask is a Scan.

## The pieces

| Name | What it is | In the code |
|---|---|---|
| parent | Every node's union-find pointer. Itself, if it is a root | `parent` on the meta item |
| root | A node pointing at itself — which is to say, a component | `find` |
| island keys | Bucket and padded size, on roots alone. What makes the index sparse | `islandBucket`, `islandSort` |
| settle | Merge the two components a new edge joined | [islands.ts](../../src/graph/islands.ts) |
| resettle | Recount after a part, and give the far half its own root | [islands.ts](../../src/graph/islands.ts) |
| the reckoning | Derive the whole index from the nodes and edges | `npm run graph:init` |
| home island | The component the map is currently standing in | `homeIslandId` |

## One row per component

The size rides in the sort key, zero-padded so it sorts as a number rather than as text —
without the padding "9" lands after "100" — and the id breaks ties so two islands of equal
size both keep a row. A descending Query therefore offers the largest island first, which
is the order somebody choosing where to go wants.

Every root sits in one bucket. The access pattern is *every component*, so there is nothing
to spread across partitions and a second bucket would only mean a second Query. That does
put every root in one partition, which is affordable precisely because there are as many
roots as components, and only a write that merges or splits one ever touches them.

Balancing is by size, never by rank. Size is wanted anyway — to say how big an island is
before anyone goes there — and it survives what rank does not: a split can recount a size
exactly, while rank is a height bound that only ever rises and could never be corrected.

There is no path compression. Union by size holds the depth at two or three at this scale,
and compression is the one part that would write during a read.

## Merging, after the fact

A join is written first; `settle` runs afterwards, outside that transaction. Two conditional
updates on two different items — a transaction may not touch one item twice — and both
conditions make the same claim from opposite ends: that what `find` read is still true.

The loser stops being a root and leaves the index by losing the only two attributes that put
it there. The winner takes both sizes, conditioned on the exact sort-key value `find` just
read, which is what makes this safe without a lock. Absent is allowed too, for a graph
written before this index existed.

A failed condition means somebody merged one of these components while this was deciding.
That is not a fault: the retry re-reads and either finds work to do or finds it done.

Only the losing root is re-pointed, not the nodes behind it, so a member two joins deep
reaches its root in two hops. Flattening that would be an optimisation rather than a repair,
and it would report as drift after every join.

## Splitting, by walking

Union-find has no un-union, so `resettle` is a recount rather than a pointer flip. It walks
outward from both ends of the parted edge at once, alternating, and stops the moment either
side closes. Whichever closes first *is* the smaller half, and stopping there is what keeps
this from ever paying for the larger one. If the two walks meet, the edge was not a bridge
and nothing moves.

One case pays a full walk: when the old root turns out to be in the half that closed. The
side keeping the old root must be the side that is *not* re-pointed — otherwise every node
left behind points at a root that has moved to the other component — so the other half is
walked instead, having stopped early on the wrong side.

It is not a transaction and cannot be: the walk spans a partition per node. It is idempotent
instead. Run twice, the second run finds the halves already apart and writes the same
pointers back. What a crash halfway leaves is an index that over-lists or misstates a size,
which is the thing the reckoning exists to repair.

## The reckoning

`npm run graph:init` derives the index from every node and edge at once, where `settle` and
`resettle` maintain it one edge at a time and can lose. It is the only graph command with no
destructive mode: it reads, derives, and puts back what it derived, so it needs no guard
against being pointed at somewhere real. `--check` says what it would write and writes
nothing.

What it compares is the **partition**, never the pointers. Which node ends up naming a
component is decided by the order the unions happened in, so the seed, a `settle`, and the
reckoning all reach different roots for the same graph and every one of them is right.
Reporting that as drift would leave the reckoning permanently dirty and worth nothing — so a
component whose members already resolve to one root that is one of them keeps it, and only a
wrong grouping, a wrong size, or an index entry on a node that is not a root is a change.

It also maintains the index item, which is a precondition rather than a summary: every write
carries a conditional update on it, so a table without one refuses the first node as readily
as the ten-thousandth. Nothing maintains `rootId` after a write, so a root that is parted and
deleted takes the page's first read with it — and no amount of writing fixes what only a
reckoning can.

## The list on the page

Every component is listed, the one under your feet included, and a row survives being used
([islands.ts](../../web/src/islands.ts)). A list that only shrank meant getting back required
typing a node's name from memory.

Which component the reader is standing in has to be asked of the store, because the node
naming an island is whichever won its unions and is rarely the best-connected node `rootId`
picks. The API names it; the page marks it.

Two rows can be clicked and mean different things. A row already on the map only moves the
camera. A row that is not seats a whole island in open water, permanently, because positions
are never reassigned. The dim on an off-map row is the only thing separating them, and it is
the only fact on a row besides its name — size was dropped, because the list ranks places to
go and size ranks nothing.

How many islands exist is a property of the data and has no ceiling, so the list is paged and
the heading carries the total. A list that stops at a round number without saying so is a
list claiming to be the whole graph. The total is a `COUNT` per load rather than a number
anyone maintains — maintaining it would mean riding on the writes this index deliberately
lets fail.

## What proves it survives a sequence

`npm run graph:smoke` ([smoke.ts](../../src/graph/smoke.ts)) walks one component through
create, join, join, part. The index is maintained by writes that are allowed to fail and
repaired by a command nobody runs on a schedule, so the thing worth testing is not any single
write but the order they arrive in. Three of those four steps are the cases that sank the
designs this one replaced: a pair of made nodes joined only to each other is invisible to an
index keyed on degree, and a part is the one thing union-find cannot undo.

Everything it makes, it removes. Names are scoped to the run, and the last act is to check
the graph counts what it counted before. That is the only sense in which it is safe against a
real table — it writes to the real graph, because a component is a property of the real graph
and there is nowhere else to have one.

## What has to stay true

**Only a root carries the island keys.** This is the whole of what keeps the index to one row
per component. A node that stops being a root has to lose both attributes, or it lingers as a
second address for the same island.

**The index over-lists rather than under-lists.** A `settle` that loses leaves two addresses
for one island, which costs a wasted trip to somewhere already walked. A `resettle` that loses
leaves a half unlisted until the reckoning runs. Nothing leaves an island permanently
unreachable except a part whose repair was interrupted, and the reckoning repairs that too.

**The graph is the transaction; this index is derived.** Every failure here leaves the graph
itself untouched. That is the licence for the second write being allowed to fail, and it is
why it lives inside [edge.ts](../../src/graph/edge.ts) rather than in either caller — so the
API and the terminal cannot drift on it.

**A parent chain always reaches a root.** No operation can create a cycle, but a hand-edited
table can, and the walk gives up rather than spinning forever inside a write path.

**A node with no `parent` is its own root.** That is what every node written before this index
existed looks like, and answering "itself" leaves such a graph exactly as the reckoning will
find it rather than inventing a component nobody wrote.

## Where the numbers are

Islands per page, in [repo.ts](../../src/graph/repo.ts) — with the reason it is a page and not
a cap. Reads in flight while walking, and the hop limit before a `find` gives up, in
[islands.ts](../../src/graph/islands.ts). How many times a `settle` retries, in its own
signature. How wide the padded size is, in [keys.ts](../../src/graph/keys.ts). Where an island
is set down, in [world.ts](../../web/src/world.ts).

## Records behind it

| Record | What it settled |
|---|---|
| [0019](../decisions/0019-every-island-has-an-address.md) | Union-find on the nodes, a sparse index on the roots, and repair over correctness-in-the-moment |
| [0020](../decisions/0020-the-islands-list-is-an-index.md) | That the list names every component and a row survives use |
| [0018](../decisions/0018-the-graph-outlives-the-seed.md) | The reckoning, and the index item as a precondition |
| [0007](../decisions/0007-a-table-for-the-graph.md) | One partition per node — which is why components cannot be queried directly |
