# Writing to the graph

Four writes change the graph: a node is created, a node is deleted, two nodes are joined, two
nodes are parted. Each one is a single transaction, and every rule that matters is a check
inside it — so a refusal is the store declining rather than a caller having asked first. A
fifth operation, taking a node out along with its edges, is a loop over transactions rather
than one of its own. Every write from the page stands in one line, and every write that lands
leaves a receipt that can reverse it.

The shape behind this is [architecture.md](architecture.md); this is the write path in detail.
Reads are the other half and live in [the-centre.md](the-centre.md).

## The pieces

| Name | What it is | In the code |
|---|---|---|
| node record | The node itself: `label`, `degree`, `parent`, `islandSize` if it is a root | `nodes` |
| edge record | One undirected edge, stored once and keyed on the pair | `edges` |
| totals | Two numbers, memoised in the module and adjusted per write | `counts`, `counted` |
| refusal | The graph declining a write, as distinct from the write failing | [`Refused`](../../web/src/store/refused.ts) |
| unavailability | The store unable to answer at all, which is neither of those | [`Unavailable`](../../web/src/store/db.ts) |
| receipt | One write on screen, carrying its undo while it stands | [`Receipt`](../../web/src/writes.ts) |
| the line | The single chain every write waits in | [`Writes`](../../web/src/writes.ts) |

## The five transactions

All five are [write.ts](../../web/src/store/write.ts).

**Creating a node** holds one store, and that narrowness is the point: there is no counter to
bump and no edge to touch. The name is checked inside the transaction, which is what makes the
sentence the graph's own; the unique key underneath is the backstop, and the engine's
`ConstraintError` maps to the same sentence — a net nobody catches is not a net.

There is no id to mint. The name is the key ([finding-a-node.md](finding-a-node.md)), so the
random id, the shape that recorded whether a node was made by hand, and the item that held the
name against being claimed twice all go together.

`islandSize` goes on at creation, uniquely among writes: a node with no edges is a component of
one, and that is the single case where the answer is known before the write rather than walked
afterwards.

**Deleting a node** refuses unless `degree` is zero. That condition used to be load-bearing —
an edge was stored twice, so taking a node holding one stranded the other half where nothing
could reach it. An edge is one record now, so the hazard is gone and the refusal stays anyway:
it is reader-visible, and the undo is built on it. A node something else has been joined to
since is no longer only that write's doing.

**Joining two nodes** writes one edge record and raises two degrees, and then merges the two
components in the same transaction ([the-islands.md](the-islands.md)). It is one transaction
because `degree` is how a reader decides whether it has seen all of a node's edges — an edge
that lands without its increment, or an increment that lands twice, makes the store misdescribe
itself.

The edge is one record because a `multiEntry` index over its two ends reaches it from either
of them, which is the whole of what the second copy was buying.

A node joined to itself is refused before anything is read. The graph has no self-edges, and
guarding it in one place covers every caller.

**Renaming a node** is a delete and a re-add, because the name is the key. Both stores are held
so the node record and every edge on it move together; a rename split across transactions would
leave two names each holding some of the edges. No degree changes anywhere, since each
neighbour loses one edge and gains one. The edge read is the one that is not capped: an edge
left behind would name a node the store has not got.

The components are untouched, which is what makes it cheap. The edges afterwards are the edges
before, so `reparent` moves the `parent` pointers naming the old key and nothing is walked.

**Parting two nodes** deletes the edge and lowers both degrees, neither below zero. A degree
short of its edges is the one state a reader cannot detect — the node simply stops asking for
graph that is there. The component it may have divided is recounted *after* the transaction,
because that is a walk.

## A refusal is thrown where it is decided

Each check throws the sentence it means, at the point it fails. There is no table of reasons
and no position to keep in step with it — which was a real hazard: a reason at the wrong index
was a confident sentence about the wrong thing, and nothing in the repo would have caught it.

Two of those sentences are exported as constants — a name being taken, and a pair already being
joined — because a bulk load counts them as skipped rather than as faults, and it compares
against the string itself rather than a copy of it.

A third type sits beside `Refused`. `Unavailable` is the store being unable to answer: the
origin's quota exceeded, a transaction aborted from outside, another tab holding the database
at a different version, or a browser that will not store anything at all. A refusal is an
answer to act on; these are not, and a page has to be able to tell "that name is taken" from
"there is nowhere to put it".

## Taking a node out with its edges

The delete above will not take a node holding an edge, so this empties it first: read what it
is joined to, delete each edge, lower each neighbour's degree, and take the node itself in the
same transaction as the last of them.

**Once at the end, not once per edge.** Each part used to recount the components behind it, so
taking out a node at the read ceiling recomputed a component per edge to reach a state one
recount produces directly — and almost all of that work was spent discovering that nothing had
split. The index is knowingly stale in between, which is the trade
[0024](../decisions/0024-taking-a-node-out-with-its-edges.md) already accepts.

The component is captured on the first round, while the node is still there. Read afterwards, a
deleted root leaves every chain ending at a record that is gone, and the size needed to name a
new root has gone with it.

The edges are re-read each round rather than once at the top, because the read stops at a
ceiling and a node past it hands back an instalment. It terminates because every round parts at
least one edge and nothing here adds any; a join arriving mid-run is more work, not a loop that
never closes.

## One line, and a way back

Every write from the page goes down a single chain, one at a time
([writes.ts](../../web/src/writes.ts)). The reason changed and the chain did not. It was there
because two transactions reaching for the totals item at once made the store cancel one of
them, with no failed condition for the page to read; that item no longer exists, and IndexedDB
serialises overlapping transactions anyway. What is left is worth keeping on its own: two rapid
gestures land in the order they were made, and a receipt waits its turn at no cost anyone sees.

Two tabs still drift. This only stops one reader fighting themselves, and nothing tells the
other tab anything ([storing-a-graph.md](../requirements/storing-a-graph.md)).

The line lives outside the panel because the map writes too: taking a node out is fired from the
centre and never touches an end of the panel. A queue a second writer cannot reach is a queue
that does not do its job.

Creating a name and joining it are two transactions, not one
([join.ts](../../web/src/join.ts)). A create that lands followed by a join that is refused
leaves a real node with no edges — reachable by name, attached to nothing.

Undo runs that order backwards: the edge parts, then the node it brought with it goes, because
the store will not delete a node that still has edges. If something else has been joined to
that node since, the delete is refused and the receipt says the node was left in place. That is
right — the node is no longer only this write's doing, and the edge is gone, which is what was
asked for.

The anchor is never undone. It is the thing being worked from, and reversing it under the box
still naming it would be a stranger result than leaving it.

## What has to stay true

**A degree and its edges move together.** The edge and both counts in one transaction, always.
`missing` is degree minus the edges loaded, so an edge drawn without raising both degrees makes
an unfinished node report that it is finished, and a part without both decrements makes a
finished one claim graph that is gone.

**A degree never goes below zero.** A negative degree makes `missing` meaningless for that node
for the rest of the graph's life.

**A node leaves only once nothing is joined to it.** The store's delete and
[`World.forget`](../../web/src/world.ts) refuse alike, and the loop above is the only thing
allowed to get around it — by parting the edges first, not by relaxing the rule.

**No end of the panel holds a node the store has lost.** A node goes two ways, and
[`JoinPanel.forget`](../../web/src/join.ts) is called on both: an undo deleting what its write
created, and the map's own delete from the centre. A dead name left in an end fires its next
pick at an id nothing carries.

**Nothing inside a transaction awaits anything but the store.** A transaction commits the
moment the queue drains with nothing pending, so one timer or one call to anything else ends it
mid-write. Every function here is store calls from open to done.

**A refusal is raised after the transaction, never inside it.** A check decides where the
reason is known, but the throw waits. Throwing mid-transaction leaves `tx.done` settling into
nobody's hands, and it surfaces as an unhandled rejection rather than as the refusal it is. So
each write decides, finishes the transaction, and then says. Nothing has been written on any of
those paths, so there is nothing to undo.

**The graph is the transaction; the split is derived.** A part is followed by a recount that
runs outside it and is allowed to fail, because a recount that cannot be recorded must not undo
a part that already happened. A merge is not: it is two record updates, so it is inside.

## Where the numbers are

Beside the code that reads them, once. How long a receipt stays and how many are kept, in
[writes.ts](../../web/src/writes.ts) — with the reason half a minute replaced the five seconds
it started as. The ceiling on how many edges one read returns, in
[read.ts](../../web/src/store/read.ts). How much text one file may carry, in
[store/index.ts](../../web/src/store/index.ts). Records per transaction and the budget for one
recount, in [islands.ts](../../web/src/store/islands.ts).

Each carries the reason for its value in a comment. Copying one here would make this the stale
copy.

## Records behind it

| Record | What it settled |
|---|---|
| [0009](../decisions/0009-the-first-write-outside-the-seed.md) | One edge is one transaction, and why the degrees ride with it |
| [0010](../decisions/0010-writing-to-the-graph-from-the-browser.md) | Writes from the page at all; ids not labels; one write in flight |
| [0011](../decisions/0011-taking-a-write-back.md) | That every write is reversible, and the order an undo runs in |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | One record per edge, no totals item, and a check where a condition was |
| [0013](../decisions/0013-one-box-that-grows-into-an-edge.md) | The panel that fires the writes, and why `↵` is enough |
| [0019](../decisions/0019-every-island-has-an-address.md) | That the island index is derived, and so may lag behind a part |
| [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) | Edge by edge rather than one transaction, and what a stopped run leaves |
| [0028](../decisions/0028-where-a-chained-name-lands.md) | Which end a chained name lands in, and what moving the anchor spends |
| [0036](../decisions/0036-a-click-that-writes-nothing.md) | That the map fires no join, and the keyboard is what does |
| [0038](../decisions/0038-a-node-under-a-new-name.md) | That a rename is one transaction, needs no walk, and gets its own box |
