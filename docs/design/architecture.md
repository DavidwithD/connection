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
| `web/src` | The map: seating, camera, renderer, palette | Reach the database |
| `web/src/orbit` | The second page: rings, spokes, one neighbourhood | Import anything of the map's but `api.ts` |

Two things follow. [client.ts](../../src/db/client.ts) is the only file that differs between
DynamoDB Local and real AWS, so an environment is a variable rather than a code path. And the
browser cannot reach the store even in development: Vite proxies `/api`, which leaves one
origin and nothing to configure for CORS.

The rule repeats inside `web/src`. [placement.ts](../../web/src/placement.ts) and
[world.ts](../../web/src/world.ts) compute geometry and hold state with no renderer present,
[map-view.ts](../../web/src/map-view.ts) is the only file that knows Cytoscape exists, and
[palette.ts](../../web/src/palette.ts) is the sole authority on colour. Replacing the
renderer is meant to touch one file. The second page splits the same way —
[rings.ts](../../web/src/orbit/rings.ts) is geometry with no DOM,
[orbit-view.ts](../../web/src/orbit/orbit-view.ts) is the only file that touches SVG — and
it shares nothing with the map but the wire shape, which is the experiment
[0005](../decisions/0005-a-second-view-that-keeps-no-world.md) set up.

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

**The API is read-only.** Every route is a `GET`; writes arrive through the seed script, or
through [edge.ts](../../src/graph/edge.ts) when two nodes are joined by hand.

## Where each record landed

Which files carry each record's constraint. What was decided stays in the record — a
summary here is a second copy, and it is the copy that goes stale.

| Record | Carried by |
|---|---|
| [0002](../decisions/0002-single-table-layout.md) | Superseded — see 0007 |
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | [placement.ts](../../web/src/placement.ts), [world.ts](../../web/src/world.ts), [repo.ts](../../src/graph/repo.ts) |
| [0004](../decisions/0004-the-centre-and-its-neighbourhood.md) | [map-view.ts](../../web/src/map-view.ts), drawn out in [the-centre.md](the-centre.md) |
| [0005](../decisions/0005-a-second-view-that-keeps-no-world.md) | [web/src/orbit/](../../web/src/orbit/), drawn out in [one-node-at-a-time.md](one-node-at-a-time.md) |
| [0006](../decisions/0006-only-the-centre-reads.md) | [explore.ts](../../web/src/explore.ts), [main.ts](../../web/src/main.ts) |
| [0007](../decisions/0007-a-table-for-the-graph.md) | [table.ts](../../src/graph/table.ts), [tables.ts](../../src/db/tables.ts), [client.ts](../../src/db/client.ts) |
| [0008](../decisions/0008-finding-a-node-by-name.md) | [keys.ts](../../src/graph/keys.ts), [labels.ts](../../src/graph/labels.ts), [main.ts](../../web/src/main.ts) |
| [0009](../decisions/0009-the-first-write-outside-the-seed.md) | [edge.ts](../../src/graph/edge.ts) |

0003 through 0009 are Proposed, so their constraints are live but unsettled — 0004 and 0006
each reverse one line of 0003, 0005 exists to find out how much of it was needed, and 0007
is the first time the store's layout was argued rather than assumed.
