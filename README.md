# connection

> **`connection` is a working placeholder, not a chosen name.** It collides with the
> ordinary noun in prose ("the connection layer") and with plenty of existing products.
> Settling it later means touching the repo directory, the package name, and any
> published domain — so it gets more expensive after the first published artifact.

A DynamoDB-backed service. TypeScript on Node, AWS SDK v3.

## Prerequisites

| | Why |
|---|---|
| **Node ≥ 20.6** | Runtime |
| **Java (JRE) 11+** | DynamoDB Local runs as a JAR — there is no Docker requirement. See [ADR 0002](docs/decisions/0002-single-table-layout.md) |

No AWS account or credentials are needed for local development.

## Getting started

```bash
npm install
npm run ddb:install     # fetch DynamoDB Local (~47MB download, one time)
npm run dev:db          # start the local server + create tables
npm run ddb:smoke       # verify it all works
```

`ddb:smoke` should print a list of passing checks ending in *"DynamoDB is ready."*

## Commands

| Command | Does |
|---|---|
| `npm run ddb:install` | Download DynamoDB Local into `vendor/` |
| `npm run ddb:start` | Start the local server on `:8000` (background) |
| `npm run ddb:stop` | Stop it |
| `npm run ddb:restart` | Stop, then start |
| `npm run ddb:status` | Is it running? (exits non-zero if not) |
| `npm run ddb:reset` | ⚠️ Wipe every local table and item |
| `npm run ddb:migrate` | Create any missing table — idempotent, never drops or alters |
| `npm run ddb:smoke` | Round-trip test against the current target |
| `npm run dev:db` | `ddb:start` + `ddb:migrate` |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `web/` |
| `npm run build` | Compile to `dist/` |
| `npm test` | `typecheck` + `ddb:smoke` |
| `npm run graph:seed` | Generate a small-world graph and write it to the table |
| `npm run demo` | Graph API + dev server together — both demo pages |
| `npm run api` | Just the graph API, on `:8787` |
| `npm run web` | Just the Vite dev server, on `:5173` |
| `npm run build:web` | Bundle both demo pages to `dist/web/` |

Use a different port with `DYNAMODB_LOCAL_PORT=8001`.

## Local vs. real AWS

One variable decides the backend, and no application code changes between them:

```bash
DYNAMODB_ENDPOINT=http://localhost:8000   # → DynamoDB Local
# unset                                   # → real AWS, default credential chain
```

The `ddb:*` scripts default it to `http://localhost:8000`. To point one at real AWS,
pass it through as empty:

```bash
DYNAMODB_ENDPOINT= AWS_PROFILE=your-profile npm run ddb:migrate
```

Copy [.env.example](.env.example) to `.env` to set defaults for your machine.

| Variable | Default | Meaning |
|---|---|---|
| `DYNAMODB_ENDPOINT` | *(unset → real AWS)* | Set to target DynamoDB Local |
| `AWS_REGION` | `us-east-1` | Region |
| `DYNAMODB_TABLE` | `connection` | Table name, per environment |
| `DYNAMODB_LOCAL_PORT` | `8000` | Local server port |

Against DynamoDB Local the client supplies dummy credentials automatically — the
server ignores them, but the SDK will not sign a request without them.

## Layout

```
src/db/
  client.ts     the shared document client; the local-vs-AWS switch lives here
  tables.ts     table + index definitions
  migrate.ts    creates missing tables (idempotent)
  smoke.ts      end-to-end check, doubles as a usage example
src/graph/
  keys.ts       key layout for nodes and edges
  generate.ts   Watts–Strogatz generator (pure, deterministic)
  seed.ts       clears the old graph, writes a new one
  repo.ts       the reads: adjacency Query + metas BatchGet
src/server/
  index.ts      the graph API (Hono)
web/
  index.html    the map
  orbit.html    one node at a time
web/src/            the map, and the client both pages read the API through
  api.ts        the wire shape; the only code the two pages share
  placement.ts  seating geometry + spatial index — pure, no renderer
  world.ts      the store: frozen positions, adjacency, degrees
  map-view.ts   Cytoscape render; additive only, no layout engine
  explore.ts    what the centre reads once the camera settles
  palette.ts    validated colour tokens, light and dark
  main.ts       wiring, accent tracking, the HUD
web/src/orbit/      one node at a time
  rings.ts      ring geometry — pure, no DOM
  orbit-view.ts the SVG drawing, and the hop
  main.ts       wiring: fetch, hop, cancel
scripts/
  dynamodb-local.sh    start/stop/status/reset the local server
.dynamodb-data/        local database files + server log (gitignored)
vendor/                the DynamoDB Local JAR (gitignored)
```

## Data model

A **single-table design**: one table holds every entity type, distinguished by prefixed
key values rather than by separate tables.

| | Partition key | Sort key |
|---|---|---|
| Table | `pk` | `sk` |
| GSI `gsi1` | `gsi1pk` | `gsi1sk` |

Only key attributes are declared; every other field is per-item and needs no migration.
Items that omit `gsi1pk` stay out of the index, which keeps it sparse.

```ts
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { db, TABLE_NAME } from "./db/client.js"

await db.send(new PutCommand({
  TableName: TABLE_NAME,
  Item: { pk: "user#1", sk: "profile", name: "Ada" },
}))
```

The key design is deliberately generic and should be treated as **provisional** — the
domain is not defined yet, and DynamoDB normally wants access patterns known up front.
[ADR 0002](docs/decisions/0002-single-table-layout.md) records that trade-off.

## Graph demos

Two pages, one API, opposite ideas about what exploring a graph is. Both come up under
`npm run demo`.

```bash
npm run dev:db          # local DynamoDB + tables
npm run graph:seed      # 600 nodes / 1800 edges by default
npm run demo            # the map at :5173, one node at a time at :5173/orbit.html
```

Size the graph with `GRAPH_N`, `GRAPH_K`, `GRAPH_P` and `GRAPH_SEED`. Re-seeding clears
the previous graph first. The API adds an artificial `GRAPH_API_DELAY_MS` (default 120)
because a local read returns too fast to ever see a loading state. Both pages read the
same seed through the same two routes.

### The map — `/`

Pan around an undirected cyclic graph like a map. Whatever you stop on is what loads.

| Gesture | Does |
|---|---|
| drag | Pan |
| wheel | Zoom toward the cursor |
| click a node | Glide it to the middle |
| click a ghost | Fly to the node it stands in for |
| `↑↓←→` | Nudge the view |

The node nearest the middle of the screen is the **centre**, which is what gliding a node
to the middle is for. It is also the only node that reads: the map holds the route you
walked, and nothing is loaded ahead of you except the far end of a ghost you clicked.
Panning itself does no work — no simulation, no layout, every node seated once and never
moved, and no read until the camera goes still.

How that is put together, and what has to stay true, is in [design](docs/design/) —
[architecture.md](docs/design/architecture.md) for the layers and the invariants, and
[the-centre.md](docs/design/the-centre.md) for what the map draws around the centre.
[ADR 0003](docs/decisions/0003-graph-exploration-demo-stack.md),
[ADR 0004](docs/decisions/0004-the-centre-and-its-neighbourhood.md) and
[ADR 0006](docs/decisions/0006-only-the-centre-reads.md) hold the reasoning, and what each
choice cost.

### One node at a time — `/orbit.html`

The same graph with no world kept. One node sits in the middle, its whole ring around it,
and a hop recomputes every position and forgets the last neighbourhood.

| Gesture | Does |
|---|---|
| click a neighbour | It travels to the middle and its own ring resolves around it |
| hover | Names a node, once there are too many to label them all |

Neighbours sit on concentric rings — one ring for a handful, more as the count grows,
each filled in proportion to what it holds. Size is `degree`: how much graph is behind a
node. Anything that is a neighbour on both sides of a hop keeps its element and slides;
only nodes that genuinely leave fade out, which is what stops the node you came from
blinking as it reappears in the new ring. The hop starts on the click rather than on the
response, so the API's latency is spent moving instead of waiting.

No Cytoscape here, no store, no shared code but [api.ts](web/src/api.ts) — the page is
SVG and CSS transitions, and it bundles to about 7 kB against the map's 450.
[ADR 0005](docs/decisions/0005-a-second-view-that-keeps-no-world.md) records why this is a
second page rather than a mode on the map, and what keeping no world costs.

## Docs

- [docs/](docs/) — the map: which document answers which question, and which ones get
  edited rather than appended to
- [Requirements](docs/requirements/) — no product scope yet, and what the demo has to do
- [Design](docs/design/) — layers, boundaries, and the invariants the code protects
- [Architecture decisions](docs/decisions/) — the "why" behind these choices
