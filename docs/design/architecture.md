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

## The three reads

Every read of the graph is one of three shapes, all in
[repo.ts](../../src/graph/repo.ts):

```
Query     pk = node#<id>       the meta item, then every edge item
BatchGet  node#<other>/#meta   labels and true degrees, in bulk
Query     island index         one row per component, largest first
```

Nothing else reads the table on the request path. A fourth shape would be a new access
pattern, which is a key-layout question rather than a repository one.

Whole-table work is the exception and lives apart, in
[bulk.ts](../../src/graph/bulk.ts): reading everything, writing many items at once, and
dropping the table. Its retry loop and its two waiters each exist for a failure that never
happens against DynamoDB Local. That is why they are held in one place rather than copied
into the seed, the export and the reckoning — a second copy reads as dead code right up
until it runs against AWS.

## Reads are cancellable, writes are not

[api.ts](../../web/src/api.ts) aborts a read whose node has been panned away from, so
graph nobody is looking at stops being paid for. No write is ever abandoned. The asymmetry
is the point: dropping a read costs a reply nobody wanted, while dropping a write leaves
nobody able to say whether it landed.

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

Which files carry each record's constraint, and which page describes the result. What was
decided stays in the record — a summary here is a second copy, and it is the copy that goes
stale.

The code carries no pointers back. This table and the page column are the whole of the map,
so a record missing a row here is a record nothing reaches.

| Record | Carried by | Described in |
|---|---|---|
| [0002](../decisions/0002-single-table-layout.md) | Superseded — see 0007 | the README's data model |
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | [placement.ts](../../web/src/placement.ts), [world.ts](../../web/src/world.ts), [repo.ts](../../src/graph/repo.ts), [keys.ts](../../src/graph/keys.ts), [generate.ts](../../src/graph/generate.ts), [map-view.ts](../../web/src/map-view.ts), [main.ts](../../web/src/main.ts), [server/index.ts](../../src/server/index.ts) | this page, [the-centre.md](the-centre.md), [the-generated-graph.md](the-generated-graph.md) |
| [0004](../decisions/0004-the-centre-and-its-neighbourhood.md) | [map-view.ts](../../web/src/map-view.ts) | [the-centre.md](the-centre.md) |
| [0005](../decisions/0005-a-second-view-that-keeps-no-world.md) | Superseded — see 0017 | [a-graph-as-text.md](a-graph-as-text.md) |
| [0006](../decisions/0006-only-the-centre-reads.md) | [explore.ts](../../web/src/explore.ts), [main.ts](../../web/src/main.ts) | this page, [the-centre.md](the-centre.md) |
| [0007](../decisions/0007-a-table-for-the-graph.md) | [table.ts](../../src/graph/table.ts), [tables.ts](../../src/db/tables.ts), [client.ts](../../src/db/client.ts), [keys.ts](../../src/graph/keys.ts), [bulk.ts](../../src/graph/bulk.ts) | this page, the README's data model |
| [0008](../decisions/0008-finding-a-node-by-name.md) | [keys.ts](../../src/graph/keys.ts), [labels.ts](../../src/graph/labels.ts), [node.ts](../../src/graph/node.ts), [text.ts](../../src/graph/text.ts) | [finding-a-node.md](finding-a-node.md) |
| [0009](../decisions/0009-the-first-write-outside-the-seed.md) | [edge.ts](../../src/graph/edge.ts), [load.ts](../../src/graph/load.ts), [restore.ts](../../src/graph/restore.ts), [world.ts](../../web/src/world.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) |
| [0010](../decisions/0010-writing-to-the-graph-from-the-browser.md) | [node.ts](../../src/graph/node.ts), [edge.ts](../../src/graph/edge.ts), [server/index.ts](../../src/server/index.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) |
| [0011](../decisions/0011-taking-a-write-back.md) | [edge.ts](../../src/graph/edge.ts), [join.ts](../../web/src/join.ts), [writes.ts](../../web/src/writes.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) |
| [0012](../decisions/0012-the-name-is-the-node.md) | [map-view.ts](../../web/src/map-view.ts), [palette.ts](../../web/src/palette.ts), [text.ts](../../src/graph/text.ts), [load.ts](../../src/graph/load.ts) | [the-centre.md](the-centre.md), [a-graph-as-text.md](a-graph-as-text.md) |
| [0013](../decisions/0013-one-box-that-grows-into-an-edge.md) | [join.ts](../../web/src/join.ts), [combobox.ts](../../web/src/combobox.ts), [index.html](../../web/index.html) | [finding-a-node.md](finding-a-node.md) |
| [0014](../decisions/0014-binding-the-docs-to-the-code.md) | [docs-gate.py](../../scripts/docs-gate.py) | [checks.md](../checks.md) |
| [0015](../decisions/0015-bash-as-the-script-shell.md) | [dynamodb-local.sh](../../scripts/dynamodb-local.sh), [hooks/pre-commit](../../scripts/hooks/pre-commit) | the README's prerequisites |
| [0016](../decisions/0016-the-gates-run-in-ci.md) | [ci.yml](../../.github/workflows/ci.yml), [hooks/pre-commit](../../scripts/hooks/pre-commit) | [checks.md](../checks.md) |
| [0017](../decisions/0017-the-second-view-goes.md) | [transfer.ts](../../web/src/transfer.ts), [app.css](../../web/app.css), [vite.config.ts](../../vite.config.ts) | [a-graph-as-text.md](a-graph-as-text.md) |
| [0018](../decisions/0018-the-graph-outlives-the-seed.md) | [export.ts](../../src/graph/export.ts), [restore.ts](../../src/graph/restore.ts), [init.ts](../../src/graph/init.ts) | [a-graph-as-text.md](a-graph-as-text.md), [the-islands.md](the-islands.md) |
| [0019](../decisions/0019-every-island-has-an-address.md) | [islands.ts](../../src/graph/islands.ts), [table.ts](../../src/graph/table.ts), [keys.ts](../../src/graph/keys.ts), [edge.ts](../../src/graph/edge.ts), [init.ts](../../src/graph/init.ts), [repo.ts](../../src/graph/repo.ts), [the panel](../../web/src/islands.ts) | this page, [the-islands.md](the-islands.md) |
| [0020](../decisions/0020-the-islands-list-is-an-index.md) | [islands.ts](../../web/src/islands.ts), [text.ts](../../src/graph/text.ts), [index.html](../../web/index.html) | [the-islands.md](the-islands.md) |
| [0021](../decisions/0021-a-graph-in-a-text-file.md) | [text.ts](../../src/graph/text.ts), [load.ts](../../src/graph/load.ts), [transfer.ts](../../web/src/transfer.ts), [server/index.ts](../../src/server/index.ts) | [a-graph-as-text.md](a-graph-as-text.md) |
| [0022](../decisions/0022-a-graph-written-back-out.md) | [text.ts](../../src/graph/text.ts), [export.ts](../../src/graph/export.ts) | [a-graph-as-text.md](a-graph-as-text.md) |
| [0023](../decisions/0023-the-graph-moves-through-the-page.md) | [transfer.ts](../../web/src/transfer.ts), [server/index.ts](../../src/server/index.ts), [vite.config.ts](../../vite.config.ts) | [a-graph-as-text.md](a-graph-as-text.md) |
| [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) | [node.ts](../../src/graph/node.ts), [server/index.ts](../../src/server/index.ts), [world.ts](../../web/src/world.ts), [writes.ts](../../web/src/writes.ts), [main.ts](../../web/src/main.ts), [index.html](../../web/index.html) | [writing-to-the-graph.md](writing-to-the-graph.md) |
| [0025](../decisions/0025-when-a-ghost-stands.md) | [map-view.ts](../../web/src/map-view.ts) | [the-centre.md](the-centre.md) |
| [0026](../decisions/0026-a-fourth-kind-of-document.md) | [using-the-demo.md](../using-the-demo.md) | [docs/README.md](../README.md) |
| [0027](../decisions/0027-a-ring-holds-what-it-holds.md) | [placement.ts](../../web/src/placement.ts), [map-view.ts](../../web/src/map-view.ts) | [the-centre.md](the-centre.md) |

Every record is Proposed apart from 0002 and 0005, so their constraints are live but
unsettled — 0004 and 0006 each reverse one line of 0003, 0007 is the first time the store's
layout was argued rather than assumed, 0012 replaces the mark 0004 chose without touching
what it chose to draw, and 0019 qualifies 0009's one-transaction rule rather than breaking
it.

Two rows name no source file. 0015 is about the shell the scripts are written in, so the
whole of `scripts/` carries it and no one file does. 0026 is about this directory rather than
the code.
