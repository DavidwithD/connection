# connection

> The name is a placeholder — see [ADR 0001](docs/decisions/0001-product-name.md).

A DynamoDB-backed service. TypeScript on Node, AWS SDK v3.

## Prerequisites

| | Why |
|---|---|
| **Node ≥ 20.6** | Runtime |
| **Java (JRE) 11+** | DynamoDB Local runs as a JAR — there is no Docker requirement. See [ADR 0002](docs/decisions/0002-dynamodb-as-datastore.md) |

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
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile to `dist/` |
| `npm test` | `typecheck` + `ddb:smoke` |

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
[ADR 0002](docs/decisions/0002-dynamodb-as-datastore.md) records that trade-off.

## Docs

- [Architecture decisions](docs/decisions/) — the "why" behind these choices
