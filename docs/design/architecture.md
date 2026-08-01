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
| `src/server` | Two read-only routes, and the latency floor | Hold graph logic |
| `web/src` | Seating, camera, renderer, palette | Reach the database |

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

**Fetching follows a settled camera.** Movement triggers nothing, so panning never waits on
the network. [explore.ts](../../web/src/explore.ts) bounds the rest: three requests
outstanding at most, two nodes expanded per settle, and nothing below the zoom gate except a
node asked for by name.

**A node is claimed before its request leaves.** Two sweeps cannot double-fetch it.

**Degree comes from the node's own item**, never counted from the edge items that were read.
[repo.ts](../../src/graph/repo.ts) truncates a hub past 120 edges instead of paginating, so a
count taken from edges would silently understate it. `#meta` sorting ahead of `edge#` is what
lets a `Limit` drop edges but never the node.

**The API is read-only.** Both routes are `GET`; writes arrive through the seed script.

## Where each record landed

| Record | The constraint it put in the code |
|---|---|
| [0002](../decisions/0002-single-table-layout.md) | One table, `pk`/`sk`, one sparse GSI |
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | Frozen positions, a camera, fetch on settle |
| [0004](../decisions/0004-the-centre-and-its-neighbourhood.md) | The centre draws every neighbour; ghosts move, nothing else does |

0003 and 0004 are Proposed, so their constraints are live but unsettled — 0004 already
reverses one line of 0003.
