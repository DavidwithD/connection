# Writing to the graph

Four writes change the graph: a node is created, a node is deleted, two nodes are joined,
two nodes are parted. Each one is a single transaction whose conditions carry every rule
that matters, so a refusal is the store declining rather than a caller having checked
first. The terminal and the API call the same functions, and a fifth operation — taking a
node out along with its edges — is a loop over the other four rather than a transaction of
its own. Every write from the browser stands in one line, and every write that lands
leaves a receipt that can reverse it.

The shape behind this is [architecture.md](architecture.md); this is the write path in
detail. Reads are the other half and live in [the-centre.md](the-centre.md).

## The pieces

| Name | What it is | In the code |
|---|---|---|
| claim | The item that owns a name, so two nodes cannot share one | `labelPk(name)` / `LABEL_OWNER_SK` |
| meta | The node itself: label, `degree`, the index keys | `nodePk(id)` / `META_SK` |
| edge item | One half of an edge. Every edge is stored twice, once per end | `nodePk(from)` / `edgeSk(to)` |
| totals | One item holding `nodeCount` and `edgeCount` for the whole graph | `INDEX_PK` / `META_SK` |
| refusal | The graph declining a write, as distinct from the write failing | [`Refused`](../../src/graph/refused.ts) |
| reason table | Positions in a transaction, read back as sentences | `JOIN_REASONS`, `CREATE_REASONS`, … |
| receipt | One write on screen, carrying its undo while it stands | [`Receipt`](../../web/src/writes.ts) |
| the line | The single chain every browser write waits in | [`Writes`](../../web/src/writes.ts) |

## The four transactions

Each is written as positions in a list, and the position is what a refusal names — so the
count and the order below are the contract, not an implementation detail.

**Creating a node** ([node.ts](../../src/graph/node.ts)) is three operations: claim the
name, write the meta, raise `nodeCount`. The claim is conditional on nothing already
holding it, which is the write [ADR 0008](../decisions/0008-finding-a-node-by-name.md) put
the reservation item there to allow. The seed can check a name in memory because it writes
every node at once; nothing here can, so the check has to be a condition.

The id is random rather than the seed's counter, because continuing a counter means
reading the highest one and hoping nobody else did the same. Its prefix is the only record
that a node was made by hand rather than seeded, which is what `graph:export` reads.

The island keys go on at creation, uniquely among writes: a node with no edges is a
component of one, and that is the single case where the answer is known before the write
rather than walked afterwards.

**Deleting a node** is the same three, reversed, and `degree = 0` is the load-bearing
condition. Each edge is stored twice, so taking a node that still holds one leaves the
other half in a partition nothing can reach — an edge item pointing at nothing, and a
neighbour whose degree counts it for good. The orphan is unreachable, so nothing would
ever repair it.

The label is read from the node's own item rather than taken from the caller, in the
terminal and at the route alike. It is what the claim's key is built from, and a wrong one
deletes the node while leaving its name held by nothing.

**Joining two nodes** ([edge.ts](../../src/graph/edge.ts)) is five operations: both edge
halves, both degrees, and `edgeCount`. It is a transaction rather than five writes because
`degree` is how a reader decides whether it has seen all of a node's edges — an edge that
lands without its increment, or an increment that lands twice, makes the store misdescribe
itself.

A node joined to itself is refused *before* the write, not by a condition. A transaction
cannot touch the same item twice, so it would otherwise fail as a cancellation several
positions from anything a caller could act on.

**Parting two nodes** is those five positions read backwards, deliberately item for item,
so the two reason tables line up and a reader can hold both at once. Two conditions do the
work: an edge item must exist before it is deleted, and a degree may not go below zero. A
degree short of its edges is the one state a reader cannot detect — it simply stops asking
for graph that is there.

## Turning a cancellation into a sentence

DynamoDB reports which *operation* refused, never why in terms the graph would recognise.
Each module keeps a table of reasons in the same order as its operations, and
[`reasonFor`](../../src/graph/refused.ts) reads the first failed condition's position back
into English.

Keep the two in step. A reason at the wrong index is a confident sentence about the wrong
thing, and nothing in the repo will catch it.

Two of those sentences are exported as constants — a name being taken, and a pair already
being joined — because a bulk load counts them as skipped rather than as faults, and it
compares against the string itself rather than a copy of it.

## Taking a node out with its edges

The delete above will not take a node holding an edge, so this empties it first: read the
adjacency, part every neighbour through the ordinary `removeEdge`, then delete the node
once nothing is left ([node.ts](../../src/graph/node.ts)).

Not atomic, and that is the trade
([ADR 0024](../decisions/0024-taking-a-node-out-with-its-edges.md)). A transaction sized to
a node's degree would outgrow what one transaction can hold, so instead every step leaves a
graph that is true: a run that stops partway leaves a smaller node, and asking again
finishes the job — index included, because each part repairs it in passing.

The adjacency is re-read each round rather than once at the top, because the read stops at
a ceiling and a node past it hands back an instalment. It terminates because every round
parts at least one edge and nothing here adds any; a join arriving mid-run is more work,
not a loop that never closes.

## What the routes add

Nothing. That is the design
([ADR 0010](../decisions/0010-writing-to-the-graph-from-the-browser.md)) — the
four routes in [server/index.ts](../../src/server/index.ts) import the same functions the
terminal runs, and one wrapper decides the status number: a refusal is `409`, anything else
propagates and becomes a `500`. A taken name is an answer to show, not a fault to page
anyone about.

Edges are addressed by id, never by label. The search box has already resolved a name to a
node, and resolving it again at the route would restore the ambiguity that box exists to
remove — a prefix returns a page of hits ([labels.ts](../../src/graph/labels.ts)), so a
name cannot identify a node.

There is no read before a write to see whether it will be allowed. Whether a name is free
is decided by the condition inside the transaction, not by asking first and hoping the
answer holds.

## One line, and a way back

Every write from the page goes down a single chain, one at a time
([writes.ts](../../web/src/writes.ts)). All four writes update the totals item, and
DynamoDB cancels one of two transactions reaching for the same item at once — a conflict
that carries no failed condition, so `reasonFor` has nothing to read and the page would
show the SDK's own sentence about a join that simply did not happen. The line costs nothing
anybody sees, because a receipt waits its turn.

Two browsers still race. This only stops one reader fighting themselves.

The line lives outside the panel because the map writes too: taking a node out is fired
from the centre and never touches an end of the panel. A queue a second writer cannot reach
is a queue that does not do its job.

Creating a name and joining it are two transactions, not one
([join.ts](../../web/src/join.ts)). A create that lands followed by a join that is refused
leaves a real node with no edges — reachable by name, attached to nothing.

Undo runs that order backwards: the edge parts, then the node it brought with it goes,
because the store will not delete a node that still has edges. If something else has been
joined to that node since, the delete is refused and the receipt says the node was left in
place. That is right — the node is no longer only this write's doing, and the edge is gone,
which is what was asked for.

The anchor is never undone. It is the thing being worked from, and taking it away under the
box still naming it would be a stranger result than leaving it.

## What has to stay true

**A degree and its edges move together.** Both halves and both counts in one transaction,
always. `missing` is degree minus the edges loaded, so an edge drawn without raising both
degrees makes an unfinished node report that it is finished, and a part without both
decrements makes a finished one claim graph that is gone.

**A degree never goes below zero.** Enforced by a condition, because a negative degree
makes `missing` meaningless for that node for the rest of the graph's life.

**A node leaves only once nothing is joined to it.** The store's delete and
[`World.forget`](../../web/src/world.ts) refuse for the same reason, and the loop above is
the only thing allowed to get around it — by parting the edges first, not by relaxing the
rule.

**One name is owned by one node.** The claim item, conditionally written. Two nodes holding
one name leaves the claim pointing at whichever landed last, with the other unreachable by
name while staying perfectly reachable by id — the kind of divergence nothing reports.

**Every rule is a condition inside the transaction.** That is what makes the browser and
the terminal refuse identically, and it is why the self-edge guard being an exception is
written down where it is.

**The graph is the transaction; the island index is derived.** A join or a part is followed
by a second write that maintains the component index, outside the transaction and allowed
to fail ([ADR 0019](../decisions/0019-every-island-has-an-address.md)). A merge that cannot
be recorded must not undo a join that already happened. What it costs when it loses is an
index that over-lists or a size that is short, and `npm run graph:init` reckons either back
from the nodes and edges themselves. It sits inside `edge.ts` rather than in its callers so
the API and the terminal cannot drift on it.

## Where the numbers are

Beside the code that reads them, once. How long a receipt stays and how many are kept, in
[writes.ts](../../web/src/writes.ts) — with the reason half a minute replaced the five
seconds it started as. The ceiling on how many edges one adjacency read returns, in
[repo.ts](../../src/graph/repo.ts). How many writes one text load will take and how much
text is accepted at all, in [server/index.ts](../../src/server/index.ts). Concurrency and
the hop limit for a component walk, in [islands.ts](../../src/graph/islands.ts).

Each carries the reason for its value in a comment. Copying one here would make this the
stale copy.

## Records behind it

| Record | What it settled |
|---|---|
| [0008](../decisions/0008-finding-a-node-by-name.md) | The claim item, which is what makes a conditional create possible |
| [0009](../decisions/0009-the-first-write-outside-the-seed.md) | One edge is one transaction, and why five operations rather than four writes |
| [0010](../decisions/0010-writing-to-the-graph-from-the-browser.md) | Writes over HTTP at all; ids not labels; 409 not 500; one write in flight |
| [0011](../decisions/0011-taking-a-write-back.md) | That every write is reversible, and the order an undo runs in |
| [0013](../decisions/0013-one-box-that-grows-into-an-edge.md) | The panel that fires the writes, and why `↵` is enough |
| [0019](../decisions/0019-every-island-has-an-address.md) | That the island index is derived, and so may fail behind a write |
| [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) | Edge by edge rather than one transaction, and what a stopped run leaves |
