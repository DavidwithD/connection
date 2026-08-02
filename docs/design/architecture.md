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

**The API is read-only.** Both routes are `GET`; writes arrive through the seed script.

## Where each record landed

Which files carry each record's constraint. What was decided stays in the record — a
summary here is a second copy, and it is the copy that goes stale.

| Record | Carried by |
|---|---|
| [0002](../decisions/0002-single-table-layout.md) | [tables.ts](../../src/db/tables.ts), [keys.ts](../../src/graph/keys.ts) |
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | [placement.ts](../../web/src/placement.ts), [world.ts](../../web/src/world.ts), [repo.ts](../../src/graph/repo.ts) |
| [0004](../decisions/0004-the-centre-and-its-neighbourhood.md) | [map-view.ts](../../web/src/map-view.ts), drawn out in [the-centre.md](the-centre.md) |
| [0006](../decisions/0006-only-the-centre-reads.md) | [explore.ts](../../web/src/explore.ts), [main.ts](../../web/src/main.ts) |

0003, 0004 and 0006 are Proposed, so their constraints are live but unsettled — each of the
later two reverses one line of 0003.
