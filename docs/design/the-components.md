# The components

A person explores the map outward from one node. A walk never reaches a component that holds
no node anyone has reached. Every node made from the page starts in such a component. So the
side panel lists the components, and a person can reach them only from that list. Every node
carries a union-find `parent`. A node whose `parent` is itself is a *root*, and each root
identifies one component. Only a root carries `componentSize`. So an index over that field
holds one entry per component, largest first. The index is derived from the graph. The write
that causes a merge records it. A split is recorded after the write and may lag. The full
recount rebuilds the whole index from the graph.

The store has no direct query for *what components are there*. Membership depends on the
whole edge set. The only other way to answer is to read every node and every edge.

## The pieces

| Name | What it is | In the code |
|---|---|---|
| parent | Every node's union-find pointer. A root points at itself | `parent` on the node record |
| root | A node that points at itself. It identifies a component | `find` |
| componentSize | The size a root stores. A node without it has no index entry | `byComponent` |
| byParent | The nodes that point at a given node | The index the root repair reads |
| merge | Joins the two components a new edge connected, inside the write | [components.ts](../../web/src/store/components.ts) |
| recount | Finds the components a set of nodes are in, after an edge between them went | [components.ts](../../web/src/store/components.ts) |
| full recount | Rebuilds the whole index from the nodes and edges | **Recount the components** |
| start component | The component the map opens in | `components[0]`, at boot |

## One entry per component

`byComponent` is keyed on `["componentSize", "labelKey"]`. IndexedDB sorts a number as a
number, so the size needs no zero-padding. The label key breaks ties, so two components of
one size each keep an entry. A descending cursor therefore returns the largest component first.
That is the order a person choosing where to go needs.

The index is sparse with no code to make it so. IndexedDB leaves a record out of an index when
the record lacks the key path. The store writes `componentSize` only to a root. So "one entry
per component" is the engine's behaviour, and no code has to maintain it.

The union balances by size, never by rank. The size is needed anyway, to say how big a
component is before anyone goes there. A split can also recount a size exactly. Rank is a
height bound that only rises, and no code could correct it.

There is no path compression. Union by size holds the depth at two or three at the size this
store is built for ([storing-a-graph.md](../requirements/storing-a-graph.md)). Compression is
the one part that would write during a read.

## Merging, inside the write

`merge` runs in the same transaction as the edge that caused it. A merge is two record updates,
whatever the components hold. The losing root points at the winner and drops `componentSize`.
Dropping the field removes it from the index. The winner stores both sizes added together.

Two record updates at any size is the whole reason it runs inside the write. It once ran
outside and was allowed to fail, because no transaction could span a walk. A merge has never
needed a walk.

So **a join keeps the component list current.** A merge that lags is now a bug. The join path
can no longer produce the extra entries this index used to accept.

The merge has no conditional updates. IndexedDB serialises overlapping transactions. So what
`find` read a moment ago is still true when `merge` writes. The old conditional updates and
their retry loop were for a store that could not promise that.

`merge` re-points only the losing root, and leaves the nodes behind it as they were. So a
member two joins deep reaches its root in two hops. Flattening that would be an optimisation
and no repair. The full recount would also report it as a change after every join.

## Splitting, by racing walks

Union-find has no operation to undo a union. So `recount` walks the edges, where a merge only
changes a pointer. The walk is why it runs outside the transaction. A transaction holds its
stores for its whole life, and the lock is per object store. One long write stalls *reads* of
the same store. The map, the search box and the components panel would all stop while it runs.
Outside, a slow recount is a slow write. Inside, the whole page would stop responding.

It takes **k starting points**. `removeEdge` passes the two ends of the edge it parted.
Deleting a node with its edges passes every neighbour it parted from. Both ask the same
question, *what components are these nodes in now*, so one function answers it.

Three things keep the cost down:

- **It stops while one frontier is still live.** The last group still walking is the
  remainder. Listing its nodes is the cost this function must avoid. Stopping only when *no*
  frontier is live would walk every group to the end and lose the shortcut.
- **The remainder's size comes from subtraction**, never from counting it.
- **Groups merge.** All starting points in one component join into one group. So 120 starting
  points cost the number of components the deletion produced. In the common case that is one.

Two starting points is the same computation. The old `resettle` was this function before a
reason to generalise it existed.

One case still pays a full walk: the old root is in a group that closed. The remainder cannot
keep a root that has moved to another component. So the function has to list the remainder
after all. The cost is the same at k starting points as at two.

`recount` is not a transaction and cannot be one. It is idempotent instead. A second run finds
the pieces already apart and writes the same pointers back. A run cut short leaves an index
with extra entries or a wrong size. The full recount repairs exactly that.

## A `parent` pointer and an edge differ in shape

The walks above follow edges. The index follows `parent` pointers, and the two differ in
shape. `merge` re-points a losing *root* at the winner and leaves the nodes behind it as they
were. So many nodes can point at a node deep in the graph that is not a root. A chain can also
run across an edge that a part or a delete has just removed.

This has two consequences. The walk cannot repair either one on its own.

**The deleted node may have been the root.** Every remaining node's chain then ends at a
record that is gone. `find` returns null for all of them, and the component drops out of the
component list. A missing entry costs more than a wasted trip. A person can find a component
nobody has walked to *only* through that list.

`recount` repairs that case without a walk. Every broken chain has a last node whose `parent`
is the deleted node. Re-pointing those nodes alone repairs every chain behind them. `byParent`
turns "which nodes point at this one" into one range read. One of those nodes becomes the new
root.

**A chain can point into the half that left.** `recount` never walks the remainder, so its
pointers stay exactly as they were. Some of them may run through the half that just closed and
got its own root. Left alone, `find` returns a component the node is not in. The next write
then reads another component's root and size. So `recount` asks the closed half the same
question it asks about the deleted node: which nodes point at you? It re-points each such node
outside the half at the root the remainder kept.

That costs one range read per node of the half already walked. That is the same order as the
walk that found the half. It keeps "never walk the larger half" correct as well as fast.

Neither repair applies when the deletion split the component *and* removed its root. Then
every piece needs a new root, and `recount` has to walk every piece. That is the one path
that gives up the early exit.

## The full recount

**Recount the components** on the transfer page rebuilds the index from every node and edge
at once. `merge` and `recount` maintain it one write at a time, and a recount can fail. The
full recount reads, derives, and writes back what it derived. It destroys nothing.

It compares the **grouping**, never the pointers. The order of the unions decides which node
becomes a component's root. So a seed, a `merge` and the full recount can each pick a
different root for the same graph, and each is correct. Reporting that as a change would make
every full recount report changes, and the report would be useless. So a component keeps its
root when all its members resolve to one root inside the component. Only these count as a
change: a wrong grouping, a wrong size, or a `componentSize` on a node that is not a root.

It has no stored start node to repair. The map opens on the first entry of the component
index. The full recount checks only the union-find fields on node records.

## The list on the page

The side panel lists every component, including the one the map is in. A row stays after a
person uses it ([components-panel.ts](../../web/src/components-panel.ts)). When the list
removed used rows, getting back meant typing a node's name from memory.

The first entry of the component index is the component the map opens in. It is also the node
the map opens on. So a read that boot already makes answers it, with no walk from a stored
root.

A click on a row does one of two things. For a row already on the map, it only moves the
camera. For a row not yet on the map, it places a whole component in an empty area. That
placement is permanent, because the map never reassigns positions. The dim style on an
off-map row is the only mark that tells the two apart. It is the only fact on a row besides
the name. The row dropped the size, because the list ranks places to go and size ranks
nothing.

The number of components depends on the data and has no upper limit. So the list is paged,
and the heading shows the total. A list that stops at a round number without saying so
implies it is the whole graph. Each load counts the total. Maintaining it would mean
depending on the write this index allows to fail.

The panel is a side panel at the left edge. A tab opens it, and it starts closed on a first
visit ([0041](../decisions/0041-the-controls-come-off-the-map.md)). It is as tall as its rows
and no taller than the window. The list inside it scrolls without a scrollbar. Two marks show
that more rows are below the visible part. The `N more…` row at the foot is one. The other is
a fade along the panel's bottom edge, drawn while the list is scrolled short of its end.

## What has to stay true

**Only a root carries `componentSize`.** This alone keeps the index to one entry per
component. A node that stops being a root has to lose the field. Otherwise the index keeps a
second entry for the same component.

**The index may list too many components, never too few.** A recount that fails leaves one
half without an entry until the full recount runs. An interrupted repair leaves two entries
for one component. No path leaves a component permanently unreachable. The root-deletion case
did, and the repair above fixes it.

**A merge is exact.** It runs inside the write. So the list never disagrees with a join that
has happened.

**The graph is the transaction, and this index is derived.** A failure in a recount leaves the
graph itself untouched. That is why a recount is allowed to fail. It is called from
[write.ts](../../web/src/store/write.ts) and not from the page. So no code that calls a write
can skip it.

**A parent chain always reaches a root and stays inside its own component.** No operation can
create a cycle, but an imported file can. So the walk gives up and does not loop forever inside
a write path. Staying inside the component is the harder half. A chain that crosses a removed
edge makes `find` return a wrong answer. That is worse than a stale size.

**A node with no `parent` is its own root.** A record written before this index existed has no
`parent`. Answering "itself" leaves such a graph exactly as the full recount will find it. It
adds no component that nobody wrote.

## Where the numbers are

Records rewritten per transaction, and how many nodes a recount visits before it gives up, are
in [components.ts](../../web/src/store/components.ts). Each has the measurement it came from.
Components per page, and the hop limit before a `find` gives up, are beside the code that reads
them. Where a new component is placed is in [world.ts](../../web/src/world.ts). The size the
whole design targets is in [storing-a-graph.md](../requirements/storing-a-graph.md).

## Records behind it

| Record | What it decided |
|---|---|
| [0019](../decisions/0019-every-component-has-an-address.md) | Union-find on the nodes, a sparse index on the roots, and repair over correctness-in-the-moment |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | That a merge moved inside the write and a split did not, and why |
| [0020](../decisions/0020-the-components-list-is-an-index.md) | That the list names every component and a row stays after use |
| [0041](../decisions/0041-the-controls-come-off-the-map.md) | That the panel is a side panel, and what replaced its scrollbar |
| [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) | That taking a node out is not atomic, and asking again finishes it |
