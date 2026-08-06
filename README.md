# connection

> **`connection` is a working placeholder, not a chosen name.** It collides with the
> ordinary noun in prose ("the connection layer") and with plenty of existing products.
> Settling it later means touching the repo directory, the package name, and any
> published domain — so it gets more expensive after the first published artifact.

A DynamoDB-backed service. TypeScript on Node, AWS SDK v3.

[![CI](https://github.com/DavidwithD/connection/actions/workflows/ci.yml/badge.svg)](https://github.com/DavidwithD/connection/actions/workflows/ci.yml)

## Prerequisites

| | Why |
|---|---|
| **Node 20.19+ or 22.12+** | Runtime. The floor is Vite's, not ours, and `engines` is held to it by the [docs gate](docs/checks.md) |
| **Java (JRE) 11+** | DynamoDB Local runs as a JAR — there is no Docker requirement. See [ADR 0002](docs/decisions/0002-single-table-layout.md) |
| **bash** | npm runs every script through it, so the POSIX ones work on Windows too. Ships with git. See [ADR 0015](docs/decisions/0015-bash-as-the-script-shell.md) |

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
| `npm run adr` | Run the decision gate over `docs/decisions/` |
| `npm run docs` | Run the docs gate: the living documents against the code |
| `npm run hooks:install` | Install the pre-commit hook that runs both gates on the staged tree |
| `npm run graph:seed` | Generate a small-world graph and write it to the table |
| `npm run graph:node` | Create one node by name |
| `npm run graph:edge` | Join two existing nodes by name |
| `npm run demo` | Graph API + dev server together |
| `npm run api` | Just the graph API, on `:8787` |
| `npm run web` | Just the Vite dev server, on `:5173` |
| `npm run build:web` | Bundle the map to `dist/web/` |

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
| `DYNAMODB_TABLE` | `connection` | The general table, per environment |
| `DYNAMODB_GRAPH_TABLE` | `connection-graph` | The graph's table, per environment |
| `DYNAMODB_LOCAL_PORT` | `8000` | Local server port |

Against DynamoDB Local the client supplies dummy credentials automatically — the
server ignores them, but the SDK will not sign a request without them.

## Layout

```
src/db/
  client.ts     the shared document client; the local-vs-AWS switch lives here
  tables.ts     the general table, and the registry migrate reads
  migrate.ts    creates missing tables (idempotent)
  smoke.ts      end-to-end check, doubles as a usage example
src/graph/
  table.ts      the graph's table and its label index
  keys.ts       key layout for nodes, edges, and labels
  generate.ts   Watts–Strogatz generator (pure, deterministic)
  seed.ts       drops the table, writes a new graph
  repo.ts       the reads: adjacency Query + metas BatchGet
  labels.ts     name -> node, exact and by prefix
  edge.ts       joins two nodes, in one transaction
  node.ts       creates one node, or deletes an edgeless one
  refused.ts    the graph declining a write, and the reason it gives back
src/server/
  index.ts      the graph API (Hono)
web/
  index.html    the map
web/src/            the map, and the client it reads the API through
  api.ts        the wire shape
  placement.ts  seating geometry + spatial index — pure, no renderer
  world.ts      the store: frozen positions, adjacency, degrees
  map-view.ts   Cytoscape render; additive only, no layout engine
  explore.ts    what the centre reads once the camera settles
  palette.ts    validated colour tokens, light and dark
  combobox.ts   a text box that hands back nodes, not text
  join.ts       the panel at the top: two ends, and the writes
  main.ts       wiring, accent tracking, the HUD
scripts/
  dynamodb-local.sh    start/stop/status/reset the local server
  adr-gate.py          the decision gate — shape, budgets, wiring
  docs-gate.py         the docs gate — the living docs against the code
  hooks/pre-commit     runs both gates on the staged tree
.github/workflows/
  ci.yml               the same gates, where they cannot be skipped
.dynamodb-data/        local database files + server log (gitignored)
vendor/                the DynamoDB Local JAR (gitignored)
```

## Data model

Two tables. `connection-graph` holds the graph and nothing else; `connection` is an
overloaded table waiting for entities the product has not named, keyed by prefixed values
rather than by type. [ADR 0007](docs/decisions/0007-a-table-for-the-graph.md) is why they
are apart.

| | Partition key | Sort key |
|---|---|---|
| Both tables | `pk` | `sk` |
| `connection-graph`, index `label` | `labelBucket` | `labelSort` |
| `connection`, index `gsi1` | `gsi1pk` | `gsi1sk` |

Only key attributes are declared; every other field is per-item and needs no migration. An
item that omits an index's keys stays out of it, which is what keeps both indexes sparse.

```ts
import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { db, TABLE_NAME } from "./db/client.js"

await db.send(new PutCommand({
  TableName: TABLE_NAME,
  Item: { pk: "user#1", sk: "profile", name: "Ada" },
}))
```

The graph's keys are in [keys.ts](src/graph/keys.ts): a node and its whole adjacency share
one partition, and a label owns another so a name resolves in one read
([ADR 0008](docs/decisions/0008-finding-a-node-by-name.md)). The general table's keys are
still **provisional** — the domain is not defined, and DynamoDB wants access patterns known
up front.

## The graph demo

One page, backed by the graph API. A second page answering the same question one node
at a time was retired — [ADR 0017](docs/decisions/0017-the-second-view-goes.md).

```bash
npm run dev:db          # local DynamoDB + tables
npm run graph:seed      # a small-world graph, sized in src/graph/seed.ts
npm run demo            # the map at :5173
```

Size the graph with `GRAPH_N`, `GRAPH_K`, `GRAPH_P` and `GRAPH_SEED`, and how many of its
nodes are hubs with `GRAPH_HUBS` and `GRAPH_HUB_K` — the defaults, and what each one costs,
are in [seed.ts](src/graph/seed.ts). Re-seeding drops the graph table and builds it again,
so it refuses to run against anything but the local emulator unless `GRAPH_SEED_DROP=1`
says otherwise. `GRAPH_API_DELAY_MS` sets the API's artificial latency floor, and `PORT`
moves the API off `:8787` ([index.ts](src/server/index.ts)).

Two commands write outside the seed. Each is one transaction, because `degree` and the
edges it counts must never disagree
([ADR 0009](docs/decisions/0009-the-first-write-outside-the-seed.md)):

```bash
npm run graph:node -- "Vessarin"              # a node with no edges yet
npm run graph:edge -- "Vessarin" "Ashanlin"   # join two that exist
```

Running either a second time is refused rather than repeated — a name is owned by one node,
and a degree must not be raised twice for one edge. Both reverse, and the reversal is
constrained from the other side: a degree must not be lowered for an edge that was not
there, and a node with edges cannot be deleted at all, because each edge is stored twice and
the other half would be left unreachable
([ADR 0011](docs/decisions/0011-taking-a-write-back.md)). The map page does all of this from
the browser; see **join** below.

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
to the middle is for. It is also the only node the map draws around, so what you see is the
route you walked. Reading runs a hop past that: arriving somewhere fetches the ring around
it too and holds the reply, unspent and undrawn, until somebody walks there. Panning itself
does no work — no simulation, no layout, every node seated once and never moved, and no
read until the camera goes still.

The box at the top is one box until you name something in it, and then it is an edge: two
ends and the line between them. Naming a node takes you there. Name one in the other end and
they are joined — either end, since the graph has no direction to tell them apart. Whichever
end you leave alone is the anchor, so the same widget fans out from one node or fans in to
one, and the end you fired empties for the next name.

| Key | In an end |
|---|---|
| `↑` `↓` | Move the highlight, wrapping at both ends |
| `↵` | Take the highlighted row — with the other end filled, that writes the edge |
| `⇧↵` | Create exactly what is typed, whatever the list shows |
| `Esc` | Close the list; again, let the name go |

The two Enters are the shape of it. `↵` takes the best match, so a prefix and one key
reaches a node that already exists. Creating is a different act with its own key, and never
what a half-typed name falls into — `ash` is far more often the start of `Ashanlin` than a
node somebody means to make. The one place they meet is a name matching nothing: there is
no best match to take, so `↵` creates as well.

**Every write can be taken back.** Each one leaves a receipt carrying `undo`, which parts
the edge again and deletes the node if that write is what created it. It stays for thirty
seconds. A node that something else has since been joined to is kept — the edge still
parts. See [ADR 0011](docs/decisions/0011-taking-a-write-back.md).

A receipt names both ends, and clicking either name puts it back in the near end, which is
how a path costs one name per node. Clicking loads and never writes.
See [ADR 0013](docs/decisions/0013-one-box-that-grows-into-an-edge.md).

How the map is put together, and what has to stay true, is in [design](docs/design/) —
[architecture.md](docs/design/architecture.md) for the layers and the invariants, and
[the-centre.md](docs/design/the-centre.md) for what the map draws around the centre.
[ADR 0003](docs/decisions/0003-graph-exploration-demo-stack.md),
[ADR 0004](docs/decisions/0004-the-centre-and-its-neighbourhood.md) and
[ADR 0006](docs/decisions/0006-only-the-centre-reads.md) hold the reasoning, and what each
choice cost.

## Docs

- [docs/](docs/) — the map: which document answers which question, and which ones get
  edited rather than appended to
- [Requirements](docs/requirements/) — no product scope yet, and what the demo has to do
- [Design](docs/design/) — layers, boundaries, and the invariants the code protects
- [Architecture decisions](docs/decisions/) — the "why" behind these choices
- [Checks](docs/checks.md) — what binds the tables and trees on this page to the code, so
  that a rename cannot quietly falsify them
