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
  export.ts     copies the graph out to JSON; read-only
  restore.ts    checks an export, then rebuilds the table from it
  repo.ts       the reads: adjacency Query + metas BatchGet
  labels.ts     name -> node, exact and by prefix
  islands.ts    which nodes can reach which, as union-find over the graph
  edge.ts       joins two nodes, in one transaction
  node.ts       creates one node, or deletes one with its edges
  load.ts       reads a text file of names and joins, and adds it
  refused.ts    the graph declining a write, and the reason it gives back
  smoke.ts      a component through every write that changes it
src/server/
  index.ts      the graph API (Hono)
web/
  index.html    the map
  app.css       the chrome around it
web/src/            the map, and the client it reads the API through
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

One page, backed by the graph API. A second page answering the same question one node
at a time was retired — [ADR 0017](docs/decisions/0017-the-second-view-goes.md).

```bash
npm run dev:db          # local DynamoDB + tables
npm run graph:seed      # a small-world graph, sized in src/graph/seed.ts
npm run demo            # the map at :5173
```

Size the graph with `GRAPH_N`, `GRAPH_K`, `GRAPH_P` and `GRAPH_SEED`, how many of its nodes
are hubs with `GRAPH_HUBS` and `GRAPH_HUB_K`, and how many disconnected components it comes
in with `GRAPH_ISLANDS` — ten by default, halving in size down to a pair and a lone node, so
the page arrives with graph it cannot walk to. `GRAPH_ISLANDS=1` gives one connected graph,
which is what every seed before this was. The defaults, and what each one costs,
are in [seed.ts](src/graph/seed.ts). Re-seeding drops the graph table and builds it again, so
it refuses twice over: against anything but the local emulator, and — wherever it is pointed
— against a table holding nodes no seed wrote. The second refusal saves them to a timestamped
export first, so the answer is recoverable even when you meant it. `GRAPH_SEED_DROP=1` clears
both. `graph:restore` refuses on the same terms under `GRAPH_RESTORE_DROP`, since writing an
older export over a table that has moved on loses exactly as much. `GRAPH_API_DELAY_MS` sets the API's artificial latency floor, and `PORT`
moves the API off `:8787` ([index.ts](src/server/index.ts)).

Two commands write outside the seed. Each is one transaction, because `degree` and the
edges it counts must never disagree
([ADR 0009](docs/decisions/0009-the-first-write-outside-the-seed.md)):

```bash
npm run graph:node -- "Vessarin"              # a node with no edges yet
npm run graph:edge -- "Vessarin" "Ashanlin"   # join two that exist
```

### Writing a graph down

One line per node and whoever it joins, in a file you can edit
([ADR 0021](docs/decisions/0021-a-graph-in-a-text-file.md)):

```
# The towns, and a lighthouse nobody can reach
Kavara | Miselin | Vessarin | Thorne
Miselin | Ashanlin
Lighthouse
```

The first name on a line joins each of the rest — `a | b | c` is two edges out of `a`, not a
path through `b` — so a hub is one line, and a line of one name is a node with no edges. The
name is the identity, so nothing carries an id; case and runs of whitespace fold, so
`ashanlin` and `Ashanlin` are the same node. A name cannot hold `|` or `#`.

```bash
npm run graph:load -- towns.txt --dry-run   # what it would add, written nowhere
npm run graph:load -- towns.txt             # add it
```

It only ever adds. Deleting a line does not part an edge, and loading the same file twice
writes nothing the second time — both "already there" refusals are counted rather than
raised, which is what makes the file editable. A misspelling is therefore a new node and not
an error, so the plan prints every name it is about to create, and `--dry-run` prints the
pairs too: nothing in the file says whether a line was meant as a star or a chain.

Each node and each edge is its own transaction and they run in series, at roughly a round
trip per name and four per pair — seconds for a small file locally, minutes for a large one
against AWS. A load leaves `rootId` where it was, so `npm run graph:init` afterwards is what
moves the map's starting point onto the graph you just added.

### Starting a graph without seeding one

`graph#index` is a precondition, not a summary: every write carries a conditional update on
it, so a table without one refuses the first node as readily as the ten-thousandth. It also
holds `rootId`, which is where the map starts, and nothing maintains that after a write.

```bash
npm run graph:init            # write the index item from what is in the table
npm run graph:init -- --check # say what it would write, write nothing, fail if it differs
```

On an empty table that is the bootstrap — no generated nodes needed. On a graph that already
exists it recomputes `rootId` and the counts, which is the repair for a root that was deleted
or a count that drifted. It reads and puts one item; it never drops or deletes, so it is the
one graph command that needs no guard.

### Keeping what you made

A seed run replaces the graph, so anything created since the last one goes with it — but
neither `graph:seed` nor `graph:restore` will let that happen silently. Each reads the table
first, writes whatever no seed wrote to a timestamped export, and then stops. Doing it on
purpose is the two commands below; the guard is for the times you were doing something else.

```bash
npm run graph:export                             # only nodes made by hand → graph-export.json
npm run graph:restore -- graph-export.json --dry-run   # check the file, touch nothing
npm run graph:restore -- graph-export.json       # ⚠️ drop the table, rebuild from the file
```

The export tells the two apart by id shape alone — `n-<uuid>` for a node made one at a time
against the seed's `n0000` ([keys.ts](src/graph/keys.ts)) — and refuses anything of neither
shape rather than guessing. A subset of a graph is not automatically a graph, so it drops
edges with one end outside the export, drops claims on names not coming, and rewrites
`degree` to match what it kept, saying so each time.

Restoring drops the table and builds it again, because DynamoDB has no rename and no way to
copy a table onto an existing name. Every check happens before the drop: both halves of every
edge, degrees matching the edges they count, one live claim per name. A file that fails any
of them leaves the table exactly as it was, and `--dry-run` stops after the checks. Like the
seed, it refuses to drop anything but the local emulator unless `GRAPH_RESTORE_DROP=1` says
otherwise. The index item is rebuilt rather than restored, since `rootId` usually named a
node the export left behind
([ADR 0018](docs/decisions/0018-the-graph-outlives-the-seed.md)).

Running either write a second time is refused rather than repeated — a name is owned by one node,
and a degree must not be raised twice for one edge. Both reverse, and the reversal is
constrained from the other side: a degree must not be lowered for an edge that was not
there, and a node with edges cannot be deleted at all, because each edge is stored twice and
the other half would be left unreachable
([ADR 0011](docs/decisions/0011-taking-a-write-back.md)). A node that has been joined to
leaves by parting each edge first — a second removal rather than a loosening of that rule
([ADR 0022](docs/decisions/0022-taking-a-node-out-with-its-edges.md)). The map page does all
of this from the browser; see **join** below.

### The map — `/`

Pan around an undirected cyclic graph like a map. Whatever you stop on is what loads.

| Gesture | Does |
|---|---|
| drag | Pan |
| wheel | Zoom toward the cursor |
| click a node | Glide it to the middle |
| click a ghost | Fly to the node it stands in for |
| right-click the centre | Take it off the map, with everything joined to it |
| click under **islands** | Cross to a component, or go back to one you crossed to before |
| `↑↓←→` | Nudge the view |

The node nearest the middle of the screen is the **centre**, which is what gliding a node
to the middle is for. It is also the only node the map draws around, so what you see is the
route you walked. Reading runs a hop past that: arriving somewhere fetches the ring around
it too and holds the reply, unspent and undrawn, until somebody walks there. Panning itself
does no work — no simulation, no layout, every node seated once and never moved, and no
read until the camera goes still.

Which is exactly why **islands** exists. A graph in pieces has components no walk from here
can reach, however long you look — and a node you make is one until you join it to something.
That list is every component, biggest first, and picking one sets it down in open water
rather than in the nearest gap, so the island it grows into stays its own
([ADR 0019](docs/decisions/0019-every-island-has-an-address.md)).

Rows do not leave when you use them, which is what makes the list an *index of places* rather
than a list of errands: crossing back is a click, not a name typed from memory
([ADR 0020](docs/decisions/0020-the-islands-list-is-an-index.md)). The marked row is the
island you are standing in. A dim one is not on the map yet — clicking it seats a whole
island that was never there; clicking any other row only moves the camera. The list changes
only when the graph's components do, which is a join, a split, or a node made from the box
at the top.

How many components a graph has is a property of the data and has no ceiling — 688 nodes of
vocabulary arrived as 267 of them. So the list is a page of twenty and says which page it is:
the heading reads `20 of 267` until it holds them all, and scrolling to the foot fetches the
next twenty. Pages already loaded are left alone by a write, because a join changes an
island's size and size is what the list is ordered by; only the first page is re-read.

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

**Every write from the box can be taken back.** Each one leaves a receipt carrying `undo`,
which parts the edge again and deletes the node if that write is what created it. It stays
for thirty seconds. A node that something else has since been joined to is kept — the edge
still parts. See [ADR 0011](docs/decisions/0011-taking-a-write-back.md).

Taking a node off the map is the one write with no way back, since its edges cannot return
with it. So it asks before rather than offering an undo after, and the row it asks with says
what is going — `delete Ashanlin and its 3 edges`. It is raised on the centre alone, whose
degree the page already knows
([ADR 0022](docs/decisions/0022-taking-a-node-out-with-its-edges.md)).

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
