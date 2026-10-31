# Writing to the graph

Four writes change the graph: create a node, delete a node, join two nodes, part two nodes.
Each one is a single transaction. Every rule that matters is a check inside that transaction.
So a refusal comes from the store, and a caller does not have to ask first. A fifth operation
takes a node out along with its edges. It is a loop over transactions, with no transaction of
its own. `Writes` runs every write from the page through one queue. Every write that succeeds
leaves a write log entry that can reverse it.

The shape behind this is [architecture.md](architecture.md). This page is the write path in
detail. Reads are the other half and live in [the-centre.md](the-centre.md).

## The pieces

| Name | What it is | In the code |
|---|---|---|
| node record | The node itself: `label`, `degree`, `parent`, `componentSize` if it is a root | `nodes` |
| edge record | One undirected edge, stored once and keyed on the pair | `edges` |
| refusal | The graph declining a write, as distinct from the write failing | [`Refused`](../../web/src/store/refused.ts) |
| unavailability | The store unable to answer at all, which is neither of those | [`Unavailable`](../../web/src/store/db.ts) |
| write log entry | One write on screen, carrying its undo while it stands | [`LogEntry`](../../web/src/writes.ts) |
| the write queue | The single chain every write waits in | [`Writes`](../../web/src/writes.ts) |

## The five transactions

All five are [write.ts](../../web/src/store/write.ts).

**Creating a node** holds one store. That is deliberate: there is no counter to raise and no
edge to touch. The transaction checks the name itself, so the refusal sentence comes from the
graph. The unique key underneath is the backstop. The engine's `ConstraintError` maps to the
same sentence, so a caller always gets a refusal it can read.

There is no id to mint. The name is the key ([finding-a-node.md](finding-a-node.md)). So three
things went together. One was the random id. One was the id shape that recorded whether a node
was made by hand. One was the item that stopped a name being claimed twice.

Only the create sets `componentSize` at the time of the write. A node with no edges is a
component of one. That is the single case where the size is known before the write, with no
walk afterwards.

**Deleting a node** refuses unless `degree` is zero. That condition used to protect the data.
An edge was stored twice, so deleting a node that held one left the other half where nothing
could reach it. An edge is one record now, so that hazard is gone. The refusal stays anyway,
because readers can see it and the undo is built on it. A node that something else joined to
since the write is no longer only that write's doing.

**Joining two nodes** writes one edge record and raises two degrees. Then it merges the two
components in the same transaction ([the-components.md](the-components.md)). It is one
transaction because a reader uses `degree` to decide whether it has seen all of a node's
edges. An edge written without its increment, or an increment written twice, makes the store
misdescribe itself.

The edge is one record because a `multiEntry` index over its two ends reaches it from either
end. That index does all the work the second copy did.

The join refuses a node joined to itself before it reads anything. The graph has no
self-edges, and one guard in one place covers every caller.

**Renaming a node** is a delete and a re-add, because the name is the key. The rename holds
both stores, so the node record and every edge on it move together. A rename split across
transactions could leave two names, each holding some of the edges. No degree changes, since
each neighbour loses one edge and gains one. This edge read has no cap. An edge left behind
would name a node the store does not hold.

The rename leaves the components unchanged, which keeps it cheap. The edges afterwards are the
edges before. So `reparent` moves the `parent` pointers that name the old key, and nothing is
walked.

**Parting two nodes** deletes the edge and lowers both degrees, neither below zero. A degree
lower than its edge count is the one state a reader cannot detect. The node simply stops
asking for edges that exist. The part may have split a component. That component is recounted
*after* the transaction, because the recount is a walk.

## A refusal is thrown where it is decided

Each check throws its sentence at the point it fails. There is no table of reasons, and no
position to keep in step with one. A table was a real hazard. A reason at the wrong index gave
a confident sentence about the wrong thing, and nothing in the repo would have caught it.

Two of those sentences are exported as constants: a name already taken, and a pair already
joined. A bulk load counts them as skipped rather than as faults. It compares against the
exported string itself, and holds no copy of it.

A third type sits beside `Refused`. `Unavailable` means the store cannot answer. One cause is an
exceeded origin quota. Others are a transaction aborted from outside, or another tab holding
the database at a different version. The last is a browser that stores nothing at
all. A refusal is an answer the page can act on, and these are not. A page has to tell "that
name is taken" from "there is nowhere to put it".

## Taking a node out with its edges

The delete above refuses a node holding an edge, so this operation empties the node first. It
reads what the node is joined to, deletes each edge and lowers each neighbour's degree. It
deletes the node in the same transaction as the last edge.

**Once at the end, not once per edge.** Each part used to recount the components behind it. A
node at the read ceiling then cost one component recount per edge. One recount produces the
same state directly. Almost all of that work only found that nothing had split. The index is
knowingly stale in between. [0024](../decisions/0024-taking-a-node-out-with-its-edges.md)
already accepts that trade.

The loop captures the component on the first round, while the node still exists. Read
afterwards, a deleted root leaves every chain ending at a record that is gone. The size needed
to name a new root is gone with it.

The loop re-reads the edges each round, because the read stops at a ceiling. A node past the
ceiling returns only part of its edges each time. The loop ends because every round parts at
least one edge and nothing here adds any. A join that arrives mid-run adds work, and the loop
still ends.

## One queue, and a way back

Every write from the page goes through a single chain, one at a time
([writes.ts](../../web/src/writes.ts)). The reason for the chain changed, and the chain stayed.
It was added because two transactions on the totals item at once made the store cancel one of
them. The page had no failed condition to read. That item no longer exists, and IndexedDB
serialises overlapping transactions anyway. The chain still has a use. Two fast gestures write
in the order they were made. A write log entry waits its turn, and nobody sees the delay.

Two tabs still go out of step. The chain only stops one reader's writes from colliding with
each other. Nothing tells the other tab anything
([storing-a-graph.md](../requirements/storing-a-graph.md)).

The queue lives outside the panel because the map writes too. The map fires the delete of a
node with its edges from the selected node, and that write never touches an end of the panel.
A queue that a second writer cannot reach would not order that writer's writes.

The map also fires a join, from a shift-drag between two nodes
([0038](../decisions/0038-a-drag-that-joins-two-nodes.md)). Its undo parts the pair. That
mirrors a part's undo, which joins the pair again. Both reach the map through one function. So
the map draws a pair from a drag and a pair from an undo the same way.

Creating a name and joining it are two transactions ([join.ts](../../web/src/join.ts)). A
create that succeeds followed by a refused join leaves a real node with no edges. That node is
reachable by name and attached to nothing.

Undo runs that order backwards. The edge parts first, then the node the write created goes,
because the store will not delete a node that still has edges. Something else may have joined
to that node since. Then the delete is refused, and the write log entry says the node was left
in place. That is the right result. The node is no longer only this write's doing, and the
edge is gone, as asked.

The undo never removes the start name's node. The user is working from it. Reversing it while
the box still names it would be a stranger result than leaving it.

## What has to stay true

**A degree and its edges move together.** The edge and both counts are in one transaction,
always. `missing` is degree minus the edges loaded. An edge drawn without raising both degrees
makes an unfinished node report that it is finished. A part without both decrements makes a
finished node claim edges that are gone.

**A degree never goes below zero.** A negative degree makes `missing` meaningless for that node
for the rest of the graph's life.

**A node is deleted only once nothing is joined to it.** The store's delete and
[`World.forget`](../../web/src/world.ts) both refuse otherwise. The loop above is the only code
allowed past that rule. It parts the edges first, and the rule stays as it is.

**No end of the panel holds a node the store has lost.** A node is deleted in two ways, and
both call [`JoinPanel.forget`](../../web/src/join.ts). One is an undo deleting what its write
created. The other is the map's own delete of the selected node. A deleted name left in an end
sends its next pick to an id the store no longer holds.

**Nothing inside a transaction awaits anything but the store.** A transaction commits as soon
as its queue drains with nothing pending. So one timer, or one call to anything else, ends it
mid-write. Every function here makes only store calls from open to done.

**A refusal is raised after the transaction, never inside it.** A check decides where the
reason is known, and the throw waits. A throw mid-transaction leaves `tx.done` to resolve with
no handler. It then surfaces as an unhandled rejection instead of as a refusal. So each write
decides, finishes the transaction, and then throws. Nothing has been written on any of those
paths, so there is nothing to undo.

**The graph is the transaction, and the split is derived.** A recount follows each part. The
recount runs outside the part's transaction and is allowed to fail. A recount that cannot be
recorded must not undo a part that already happened. A merge is two record updates, so it runs
inside the transaction.

## Where the numbers are

Each number lives once, beside the code that reads them.
[writes.ts](../../web/src/writes.ts) holds how long a write log entry stays and how many are
kept. It also gives the reason half a minute replaced the first five seconds.
[read.ts](../../web/src/store/read.ts) holds the ceiling on how many edges one read returns.
[store/index.ts](../../web/src/store/index.ts) holds how much text one file may carry.
[components.ts](../../web/src/store/components.ts) holds the records per transaction and the
budget for one recount.

Each carries the reason for its value in a comment. A copy here would go stale.

## Records behind it

| Record | What it decided |
|---|---|
| [0009](../decisions/0009-the-first-write-outside-the-seed.md) | One edge is one transaction, and why the degrees ride with it |
| [0010](../decisions/0010-writing-to-the-graph-from-the-browser.md) | Writes from the page at all; ids not labels; one write in flight |
| [0011](../decisions/0011-taking-a-write-back.md) | That every write is reversible, and the order an undo runs in |
| [0030](../decisions/0030-the-graph-moves-into-the-browser.md) | One record per edge, no totals item, and a check where a condition was |
| [0013](../decisions/0013-one-box-that-grows-into-an-edge.md) | The panel that fires the writes, and why `↵` is enough |
| [0019](../decisions/0019-every-component-has-an-address.md) | That the component index is derived, and so may lag behind a part |
| [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) | Edge by edge rather than one transaction, and what a stopped run leaves |
| [0028](../decisions/0028-where-a-chained-name-lands.md) | Which end a chained name goes in, and what moving the start name costs |
| [0036](../decisions/0036-a-click-that-writes-nothing.md) | That the map's click fires no join, and a key is what does |
| [0038](../decisions/0038-a-drag-that-joins-two-nodes.md) | That a drag on the map fires one, and where its arrow is drawn |
| [0040](../decisions/0040-a-node-under-a-new-name.md) | That a rename is one transaction, needs no walk, and gets its own box |
| [0049](../decisions/0049-a-click-leaves-the-panel-alone.md) | That a click on the map fills no end of the panel |
