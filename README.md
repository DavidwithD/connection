# connection

> **`connection` is a working placeholder, not a chosen name.** It collides with the
> ordinary noun in prose ("the connection layer") and with plenty of existing products.
> Settling it later means touching the repo directory, the package name, and any
> published domain — so it gets more expensive after the first published artifact.

A DynamoDB-backed service. TypeScript on Node, AWS SDK v3.

**What this page is for.** Getting the project running, and the reference tables you need
while it is. Everything here is either something you want before you can use the repo at
all — prerequisites, commands, the one variable that picks a backend — or a table the
[docs gate](docs/checks.md) holds the code to, so that a rename cannot quietly falsify it.

Anything that explains how the thing works, why it works that way, or how to drive it lives
under [docs/](docs/) and is linked from the foot of this page. The test is the reader: this
page is for somebody who has just cloned the repo, and it stops where their questions stop
being about setup.

[![CI](https://github.com/DavidwithD/connection/actions/workflows/ci.yml/badge.svg)](https://github.com/DavidwithD/connection/actions/workflows/ci.yml)

## Prerequisites

| | Why |
|---|---|
| **Node 20.19+ or 22.12+** | Runtime. The floor is Vite's, not ours, and `engines` is held to it by the [docs gate](docs/checks.md) |
| **npm 12** | `packageManager` names it. Only the npm that writes the lock has to agree with the npm that reads it — npm 11.6.2 writes one that CI rejects |
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
| `npm run docs:selftest` | Prove each bound check still compares something — mutates a throwaway copy |
| `npm run hooks:install` | Install the pre-commit hook that runs both gates on the staged tree |
| `npm run graph:init` | Make the index item match the table — starts an empty graph, repairs a stale root |
| `npm run graph:seed` | ⚠️ Drop the graph table and write a generated small-world graph |
| `npm run graph:export` | Copy the graph out to JSON — by default only what was made by hand |
| `npm run graph:restore` | ⚠️ Drop the graph table and rebuild it from an export |
| `npm run graph:node` | Create one node by name |
| `npm run graph:edge` | Join two existing nodes by name |
| `npm run graph:load` | Add a text file of names and joins — additive, and safe to re-run |
| `npm run graph:smoke` | Walk a component through create, join and part — cleans up after itself |
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
  table.ts      the graph's table, its label index and its island index
  keys.ts       key layout for nodes, edges, labels, and components
  generate.ts   Watts–Strogatz generator (pure, deterministic)
  bulk.ts       whole-table reads and writes, and dropping the table
  args.ts       the command line, for the two commands that take a file
  init.ts       makes what is derived match the table; writes nothing else
  seed.ts       drops the table, writes a new graph
  export.ts     copies the graph out, as JSON or as text; read-only
  restore.ts    checks an export, then rebuilds the table from it
  text.ts       the graph as lines of names, read and written
  repo.ts       the reads: adjacency Query + metas BatchGet
  labels.ts     name -> node, exact and by prefix
  islands.ts    which nodes can reach which, as union-find over the graph
  edge.ts       joins two nodes, in one transaction
  node.ts       creates one node, or deletes one with its edges
  load.ts       surveys a reading against the table, then adds it
  refused.ts    the graph declining a write, and the reason it gives back
  smoke.ts      a component through every write that changes it
src/server/
  index.ts      the graph API (Hono)
web/
  index.html    the map
  transfer.html a graph out as a file, and a file in as a graph
  app.css       the chrome around both
web/src/            the two pages, and the client they read the API through
  api.ts        the wire shape
  placement.ts  seating geometry + spatial index — pure, no renderer
  world.ts      the store: frozen positions, adjacency, degrees
  map-view.ts   Cytoscape render; additive only, no layout engine
  explore.ts    what the centre reads once the camera settles
  palette.ts    validated colour tokens, light and dark
  combobox.ts   a text box that hands back nodes, not text
  writes.ts     the line every write stands in, and the receipts it leaves
  join.ts       the panel at the top: two ends, and the writes
  islands.ts    the panel down the left: every component, as somewhere to go
  main.ts       wiring, accent tracking, the HUD
  transfer.ts   the file page: survey first, write on the second click
scripts/
  dynamodb-local.sh    start/stop/status/reset the local server
  adr-gate.py          the decision gate — shape, budgets, wiring
  docs-gate.py         the docs gate — the living docs against the code
  docs-gate-selftest.py  proves each bound check still compares something
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
| `connection-graph`, index `island` | `islandBucket` | `islandSort` |
| `connection`, index `gsi1` | `gsi1pk` | `gsi1sk` |

An index is the exception to that, and `island` is a new one. `ddb:migrate` creates missing
tables and never alters an existing one, so a table made before this gains no `island` index
and `GET /api/graph` fails against it until one arrives. Both routes that build a table carry
it: export and restore, or re-seed.

```bash
npm run graph:export && npm run graph:restore -- graph-export.json   # keep what you made
npm run graph:init                                                    # stamp the components
```

Only key attributes are declared; every other field is per-item and needs no migration. An
item that omits an index's keys stays out of it, which is what keeps all three indexes
sparse — edge items carry no label, and only a component's root carries the island keys, so
`island` holds one row per component rather than one per node.

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

Two pages backed by the graph API: a map you pan around, and a page a graph arrives at
as a file and leaves as one. Seeding one, driving both, and every command that changes a
graph are in **[docs/using-the-demo.md](docs/using-the-demo.md)**.

## Docs

- [docs/](docs/) — the map: every capability across the four kinds of document, and which
  ones get edited rather than appended to
- [Using the demo](docs/using-the-demo.md) — how to drive it: the commands, the gestures,
  the keys
- [Requirements](docs/requirements/) — no product scope yet, and what the demo has to do
- [Design](docs/design/) — layers, boundaries, and the invariants the code protects
- [Architecture decisions](docs/decisions/) — the "why" behind these choices
- [Checks](docs/checks.md) — what binds the tables and trees on this page to the code, so
  that a rename cannot quietly falsify them
