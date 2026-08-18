# The islands

The map is walked outward from one node, so a component holding nothing anyone has reached is
at the end of no walk however long they look — and every node made from the page starts as
exactly that. Naming those components is the only way in. Every node carries a union-find
`parent`; a node pointing at itself is a *root*, and a root is a component. Only a root carries
`islandSize`, so an index over it holds one entry per component, largest first. The index is
derived: a merge is recorded inside the write that caused it, a split is recorded after the
fact and may lag, and the whole thing can be reckoned back from the graph itself.

The store cannot simply answer *what components are there*. Membership spans the whole edge
set, so the only other way to ask is to read every node and every edge.

## The pieces

| Name | What it is | In the code |
|---|---|---|
| parent | Every node's union-find pointer. Itself, if it is a root | `parent` on the node record |
| root | A node pointing at itself — which is to say, a component | `find` |
| islandSize | What a root counts. Its absence keeps a node out of the index | `byIsland` |
| byParent | Who points at a given node | The index the root repair reads |
| settle | Merge the two components a new edge joined, inside the write | [islands.ts](../../web/src/store/islands.ts) |
| recount | What components a set of nodes are in, after something between them went | [islands.ts](../../web/src/store/islands.ts) |
| the reckoning | Derive the whole index from the nodes and edges | **Recount the islands** |
| home island | The component the map is currently standing in | `islands[0]`, at boot |

## One entry per component

`byIsland` is keyed on `["islandSize", "labelKey"]`. A number sorts as a number, so the size
needs no zero-padding, and the key breaks ties so two islands of one size both keep an entry. A
descending cursor therefore offers the largest island first, which is the order somebody
choosing where to go wants.

The index is sparse without anything making it so. IndexedDB leaves a record out of an index
when the key path is not present in it, and `islandSize` is only ever written to a root — so
"one entry per component" is the engine's behaviour rather than a rule anybody maintains.

Balancing is by size, never by rank. Size is wanted anyway — to say how big an island is before
anyone goes there — and it survives what rank does not: a split can recount a size exactly,
while rank is a height bound that only ever rises and could never be corrected.

There is no path compression. Union by size holds the depth at two or three at the size this
store is built to ([storing-a-graph.md](../requirements/storing-a-graph.md)), and compression
is the one part that would write during a read.

## Merging, inside the write

`settle` runs in the same transaction as the edge that caused it. A merge is two record
updates whatever the components hold: the losing root points at the winner and drops
`islandSize`, which is what takes it out of the index, and the winner carries both sizes.

Two record updates at any size is the whole argument for it being in there. It was outside,
allowed to fail, because no transaction could span a walk — and it has never needed to span
one.

So **a join can no longer leave the island list stale.** A merge that lags is a bug now, not a
tolerated outcome, and the over-listing this index used to accept is unreachable from the join
path.

Nothing conditions on what was read. IndexedDB serialises overlapping transactions, so what
`find` read a moment ago is still true when this writes; the pair of conditional updates and
their retry loop were how a store that could not promise that was asked to.

Only the losing root is re-pointed, not the nodes behind it, so a member two joins deep reaches
its root in two hops. Flattening that would be an optimisation rather than a repair, and it
would report as drift after every join.

## Splitting, by racing

Union-find has no un-union, so `recount` is a walk rather than a pointer flip — and a walk is
what keeps it outside the transaction. A transaction holds its stores for its whole life, and
the lock is per object store: one long write stalls *reads* of the same store, so the map, the
search box and the islands panel all stop for as long as it runs. Outside, a slow recount is a
slow write. Inside, it is a frozen application.

It takes **k starting points**, not two. `removeEdge` passes the two ends of the edge it
parted; deleting a node with its edges passes every neighbour it parted. The question is the
same in both — *what components are these nodes in now* — so one function answers it.

Three things carry the cost:

- **It stops while one frontier is still live.** The last group standing is the remainder, and
  enumerating it is exactly what this must never pay for. Stopping when *any* frontier is live
  would walk every group to completion and throw the shortcut away.
- **The remainder's size comes from subtraction**, never from counting it.
- **Groups merge.** Every starting point that turns out to be in one component collapses into
  one group, so a hundred and twenty of them cost the number of components the deletion
  actually produced — which in the common case is one.

Two starting points is that same computation, and the old `resettle` is what it looked like
before there was a reason to generalise it.

One case still pays a full walk: the old root turns out to be in a group that closed. The
remainder cannot keep a root that has moved to another component, so it has to be enumerated
after all. No worse at k starting points than at two.

It is not a transaction and cannot be one. It is idempotent instead: run twice, the second run
finds the pieces already apart and writes the same pointers back. What a run cut short leaves
is an index that over-lists or misstates a size, which is what the reckoning exists to repair.

## A `parent` is not an edge, and that is where this gets sharp

The walks above follow edges. The index is `parent` pointers, and the two are not the same
shape: `settle` re-points a losing *root* at the winner and leaves everything behind it alone,
so a node deep in the graph can be named by many others without being a root itself, and a
chain can run clean across whatever a part or a delete has just cut.

Two consequences, and both are repairs the walk cannot do on its own.

**The deleted node may have been the root.** Every survivor's chain then ends at a record that
is gone, `find` answers null for all of them, and the component leaves the island list
entirely — under-listing, which costs more than a wasted trip, because a component nobody has
walked to is findable *only* through that list.

That one is repaired without walking. Every broken chain has a last node whose `parent` is the
node that went, so re-pointing those alone repairs every chain behind them. `byParent` turns
"who points at this" into one range read, and one of those children becomes the new root.

**A chain can point into the half that left.** The remainder is deliberately never walked, so
its pointers stand exactly as they were — including any that ran through the half that just
closed and got a new root of its own. Left alone, `find` answers with a component the node is
not in, and the next write reads a root and a size belonging to somebody else. So the closed
half is asked the same question the deleted node is: who names you? Anything outside it that
does is re-pointed at the root the remainder kept.

That costs one range read per node of the half already walked, which is the same order as the
walk that found it — and it is what keeps "never walk the larger half" honest, rather than
merely fast.

Neither repair applies when the deletion also split the component *and* took its name with it.
Then every piece needs a name and every piece has to be walked, which is the one path that
gives the early exit up.

## The reckoning

**Recount the islands** on the transfer page derives the index from every node and edge at
once, where `settle` and `recount` maintain it a write at a time and one of them can lose. It
reads, derives, and writes back what it derived, so nothing about it is destructive.

What it compares is the **grouping**, never the pointers. Which node ends up naming a component
is decided by the order the unions happened in, so a seed, a `settle` and the reckoning all
reach different roots for the same graph and every one of them is right. Reporting that as
drift would leave the reckoning permanently dirty and worth nothing — so a component whose
members already resolve to one root that is one of them keeps it, and only a wrong grouping, a
wrong size, or an `islandSize` on a node that is not a root is a change.

It has no totals item to maintain any more, and no root to repair: the counts are memoised and
the boot node is the first entry of the island index. What is left to reckon is the union-find
fields on node records, and nothing else.

## The list on the page

Every component is listed, the one under your feet included, and a row survives being used
([islands.ts](../../web/src/islands.ts)). A list that only shrank meant getting back required
typing a node's name from memory.

Which component the reader is standing in is the first entry of the island page, which is also
the node the map opens on — so it is answered by a read boot already makes rather than by a
walk from a separately stored root.

Two rows can be clicked and mean different things. A row already on the map only moves the
camera. A row that is not seats a whole island in open water, permanently, because positions
are never reassigned. The dim on an off-map row is the only thing separating them, and it is
the only fact on a row besides its name — size was dropped, because the list ranks places to go
and size ranks nothing.

How many islands exist is a property of the data and has no ceiling, so the list is paged and
the heading carries the total. A list that stops at a round number without saying so is a list
claiming to be the whole graph. The total is counted per load rather than maintained —
maintaining it would mean riding on the write this index deliberately lets fail.

## What has to stay true

**Only a root carries `islandSize`.** This is the whole of what keeps the index to one entry
per component. A node that stops being a root has to lose it, or it lingers as a second address
for the same island.

**The index over-lists rather than under-lists.** A recount that loses leaves a half unlisted
until the reckoning runs, and a repair interrupted leaves two addresses for one island. Nothing
leaves an island permanently unreachable — the root-deletion case that did is the repair above.

**A merge is exact.** It is inside the write, so there is no window in which a join has
happened and the list disagrees.

**The graph is the transaction; this index is derived.** Every failure in a recount leaves the
graph itself untouched. That is the licence for it being allowed to fail, and it is why it sits
inside [write.ts](../../web/src/store/write.ts) rather than in the page — so nothing calling a
write can forget it.

**A parent chain always reaches a root, and never leaves its own component.** No operation can
create a cycle, but an imported file can, and the walk gives up rather than spinning forever
inside a write path. Leaving the component is the subtler half: a chain that crosses a cut
makes `find` confidently wrong, which is worse than a size that is merely stale.

**A node with no `parent` is its own root.** That is what a record written before this index
existed looks like, and answering "itself" leaves such a graph exactly as the reckoning will
find it rather than inventing a component nobody wrote.

## Where the numbers are

Records rewritten per transaction, and how many nodes a recount visits before giving up, in
[islands.ts](../../web/src/store/islands.ts) — each with the measurement it was read off.
Islands per page, and the hop limit before a `find` gives up, beside the code that reads them.
Where an island is set down, in [world.ts](../../web/src/world.ts). What the whole thing is
sized for is [storing-a-graph.md](../requirements/storing-a-graph.md).

## Records behind it

| Record | What it settled |
|---|---|
| [0019](../decisions/0019-every-island-has-an-address.md) | Union-find on the nodes, a sparse index on the roots, and repair over correctness-in-the-moment |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | That a merge moved inside the write and a split did not, and why |
| [0020](../decisions/0020-the-islands-list-is-an-index.md) | That the list names every component and a row survives use |
| [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) | That taking a node out is not atomic, and asking again finishes it |
