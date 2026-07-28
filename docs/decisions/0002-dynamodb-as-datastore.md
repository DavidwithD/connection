# 0002 — DynamoDB as the Data Store

**Status:** ✅ Accepted
**Date:** 2026-07-28

## Context
The project needed a store and had no application code — documentation only, with the
product itself unnamed ([0001](0001-product-name.md)). So this choice also settled the
runtime.

Two facts about the development machine shaped the setup rather than the choice. It has
no container runtime, so the usual `amazon/dynamodb-local` image was unavailable, and no
AWS credentials, so real DynamoDB was unreachable. A JRE was present, which makes AWS's
DynamoDB Local JAR a working substitute for the image.

## Decision
Use Amazon DynamoDB, reached through AWS SDK v3 from TypeScript on Node.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Store | Amazon DynamoDB | Requested. Managed, serverless, on-demand billing. |
| Runtime | TypeScript on Node | Best client ergonomics among the SDKs. |
| Client | `DynamoDBDocumentClient` | Plain objects, not attribute-value wire format. |
| Local dev | Vendored DynamoDB Local JAR | Wants a JRE, not a container runtime. |
| Backend switch | `DYNAMODB_ENDPOINT` | Set for local, unset for AWS. No code branch. |
| Table layout | One table, `pk`/`sk`, one GSI | Idiomatic, and commits to no domain model. |

## Alternatives considered
- **Postgres** — the safer default while queries are unknown, since ad-hoc ones stay
  cheap. DynamoDB was the requirement.
- **DynamoDB Local via the container image** — the documented norm, and it keeps 57 MB of
  vendored runtime out of the tree. No runtime on this machine. Worth revisiting for CI.
- **LocalStack** — also wants a container runtime, and a wide surface for one service.
- **Real AWS for development** — no credentials, and it puts a bill in the inner loop.
- **An entity library such as ElectroDB** — real gains for single-table work, but an
  entity mapper wants a domain model to describe.

## Consequences
`npm run dev:db` yields a working database with no cloud account and no container
runtime, and reaching AWS later becomes an environment change.

The cost lands awkwardly. DynamoDB wants access patterns known up front, and
[0001](0001-product-name.md) is open, so we cannot say what the product is. A wrong key
design costs a new index or a backfill, not an `ALTER TABLE`. Treat the schema as
provisional.

Queries the keys and index do not serve degrade into a full `Scan`, so analytics belongs
elsewhere. A JRE became a prerequisite of a TypeScript project, and is the piece most
likely to break for the next person. The emulator also misreports throttling, IAM, and
streams, so anything resting on those needs testing against real AWS.

## Follow-ups
- Revisit the key design once [0001](0001-product-name.md) lands and entities exist.
- Provision the real table in infrastructure code; that tool choice is its own record.
- Decide how CI gets a database: the JAR, or the container image.
- Enable point-in-time recovery before production data exists.
