# Architecture

What the parts are, which way they depend, and what must not break. The file tree is in the
[README](../../README.md); this is the shape behind it.

## Layers

Dependencies run one way. Nothing on the right imports anything to its left.

```
web/src  ──HTTP──>  src/server  ──>  src/graph  ──>  src/db  ──>  DynamoDB
```

| Layer | Owns | Must not |
|---|---|---|
| `src/db` | Client, table and index definitions, the local-vs-AWS switch | Know about graphs |
| `src/graph` | Key layout, the generator, the reads | Speak HTTP |
| `src/server` | Routing, status codes, and the latency floor | Hold graph logic |
| `web/src` | The map: seating, camera, renderer, palette | Reach the database |

Two things follow. [client.ts](../../src/db/client.ts) is the only file that differs between
DynamoDB Local and real AWS, so an environment is a variable rather than a code path. And the
browser cannot reach the store even in development: Vite proxies `/api`, which leaves one
origin and nothing to configure for CORS.

The rule repeats inside `web/src`. [placement.ts](../../web/src/placement.ts) and
[world.ts](../../web/src/world.ts) compute geometry and hold state with no renderer present,
[map-view.ts](../../web/src/map-view.ts) is the only file that knows Cytoscape exists, and
[palette.ts](../../web/src/palette.ts) is the sole authority on colour. Replacing the
renderer is meant to touch one file.

## Invariants

Break one of these and the map lies, rather than merely looking wrong.

**A node is seated once.** `World` exposes no method that moves a node, so the guarantee
rests on that absence and not on the renderer declining. Drawing is additive only, which is
why a reply landing mid-gesture cannot disturb what is on screen.

**Drawing is the centre's neighbourhood; reading runs a hop past it.** Movement triggers
nothing, so panning never waits on the network, and a gesture crossing six nodes draws the
one it stops on. Landing also reads the ring around that node and holds the replies unspent
— nothing from one reaches the map, because a seat taken for a place nobody walked to would
freeze against a map that never existed. [explore.ts](../../web/src/explore.ts) holds the
whole rule.

**A node is claimed before its request leaves**, so two settles cannot double-read it — and
the claim comes back if that request is cancelled or fails, because a node marked as read
while short of its own neighbours is a map that lies.

**Degree comes from the node's own item**, never counted from the edge items that were read.
[repo.ts](../../src/graph/repo.ts) truncates a hub past 120 edges instead of paginating, so a
count taken from edges would silently understate it. `#meta` sorting ahead of `edge#` is what
lets a `Limit` drop edges but never the node.

**A write is one transaction, and the routes add nothing to it.** `POST /api/nodes` and
`POST /api/edges` call [node.ts](../../src/graph/node.ts) and
[edge.ts](../../src/graph/edge.ts), the same functions the terminal runs, and every rule
that matters is a condition inside the transaction rather than a check in the route. Reads
stay `GET` and stay free of all this.

That holds of the *graph*, and since [0019](../decisions/0019-every-island-has-an-address.md)
no longer of the call: joining or parting is followed by a second write that maintains the
island index and is allowed to fail. It is inside `edge.ts` rather than in either caller, so
the API and the terminal cannot drift on it — and it can fail precisely because it changes
no graph, only what is derived from one.

**A root is a component, and the island index over-lists rather than under-lists.** Every
node carries a `parent`; a node pointing at itself is a root, and only roots carry the index
keys ([islands.ts](../../src/graph/islands.ts)). A merge that does not land leaves two
addresses for one island, which costs a wasted trip; nothing leaves an island unreachable
except a part whose repair was interrupted. `npm run graph:init` is the reckoning that
repairs either, and it compares the partition rather than the pointers — union order decides
which node names a component, so insisting on one answer would report drift after every join.

**A drawn edge raises both degrees, and a parted one lowers them.** `missing` is degree
minus the edges loaded, so linking without [`bumpDegree`](../../web/src/world.ts) on both
ends makes a node with more graph behind it report that it is finished, and unlinking
without `lowerDegree` makes a finished one claim graph that is gone. Neither is ever called
alone.

**A node leaves only once nothing is joined to it.** `World.forget` and the store's delete
both refuse otherwise, for the same reason: each edge is stored twice, so removing a node
with edges strands the other half in a partition nothing can reach.

## Where each record landed

Which files carry each record's constraint. What was decided stays in the record — a
summary here is a second copy, and it is the copy that goes stale.

| Record | Carried by |
|---|---|
| [0002](../decisions/0002-single-table-layout.md) | Superseded — see 0007 |
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | [placement.ts](../../web/src/placement.ts), [world.ts](../../web/src/world.ts), [repo.ts](../../src/graph/repo.ts) |
| [0004](../decisions/0004-the-centre-and-its-neighbourhood.md) | [map-view.ts](../../web/src/map-view.ts), drawn out in [the-centre.md](the-centre.md) |
| [0005](../decisions/0005-a-second-view-that-keeps-no-world.md) | Superseded — see 0017 |
| [0006](../decisions/0006-only-the-centre-reads.md) | [explore.ts](../../web/src/explore.ts), [main.ts](../../web/src/main.ts) |
| [0007](../decisions/0007-a-table-for-the-graph.md) | [table.ts](../../src/graph/table.ts), [tables.ts](../../src/db/tables.ts), [client.ts](../../src/db/client.ts) |
| [0008](../decisions/0008-finding-a-node-by-name.md) | [keys.ts](../../src/graph/keys.ts), [labels.ts](../../src/graph/labels.ts), [main.ts](../../web/src/main.ts) |
| [0009](../decisions/0009-the-first-write-outside-the-seed.md) | [edge.ts](../../src/graph/edge.ts) |
| [0010](../decisions/0010-writing-to-the-graph-from-the-browser.md) | [node.ts](../../src/graph/node.ts), [server/index.ts](../../src/server/index.ts), [join.ts](../../web/src/join.ts), [world.ts](../../web/src/world.ts) |
| [0011](../decisions/0011-taking-a-write-back.md) | [edge.ts](../../src/graph/edge.ts), [node.ts](../../src/graph/node.ts), [combobox.ts](../../web/src/combobox.ts), [map-view.ts](../../web/src/map-view.ts) |
| [0012](../decisions/0012-the-name-is-the-node.md) | [map-view.ts](../../web/src/map-view.ts), [palette.ts](../../web/src/palette.ts), drawn out in [the-centre.md](the-centre.md) |
| [0019](../decisions/0019-every-island-has-an-address.md) | [islands.ts](../../src/graph/islands.ts), [table.ts](../../src/graph/table.ts), [keys.ts](../../src/graph/keys.ts), [edge.ts](../../src/graph/edge.ts), [init.ts](../../src/graph/init.ts) |

Every record here is Proposed apart from 0005, so their constraints are live but unsettled
— 0004 and 0006 each reverse one line of 0003, 0007 is the first time the store's layout was
argued rather than assumed, 0012 replaces the mark 0004 chose without touching what it chose
to draw, and 0019 qualifies 0009's one-transaction rule rather than breaking it.

Rows for 0013 through 0018 are missing. Each of those records is reachable from the code
that carries it, which is what findability needs; this table is the slower half.
