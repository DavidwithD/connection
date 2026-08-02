# 0002 — Single-table layout for an undefined domain

**Status:** ♻️ Superseded by [0007](0007-a-table-for-the-graph.md)
**Date:** 2026-07-28
**Deciders:** David HL

## Context
DynamoDB was specified, so the store itself was never in play. What was open was how to
lay a table out for a product that does not exist: the repo held documentation only, and
the product is still unnamed (see the [README](../../README.md)). DynamoDB wants access
patterns known up front, and there were none to know.

The machine also had no container runtime, so the usual `amazon/dynamodb-local` image was
out, and no AWS credentials, so real DynamoDB was unreachable. A JRE was present, which
makes AWS's DynamoDB Local JAR a working substitute.

## Decision
Use a single table: one physical table for every entity type, keyed by prefixed values
(`user#1` / `profile`) with one overloaded GSI. Only key attributes are declared, so new
fields need no migration.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Table layout | One table, `pk`/`sk`, one GSI | Idiomatic, and commits to no domain model. |
| Runtime | TypeScript on Node | Best client ergonomics among the SDKs. |
| Local dev | Vendored DynamoDB Local JAR | Wants a JRE, not a container runtime. |

## Alternatives considered
- **A table per entity** — the layout most people reach for first. But DynamoDB joins
  nothing, so cross-entity reads become extra round trips, and the set of tables would
  encode a domain model nobody can describe.
- **Postgres** — the honest best fit for an undefined domain: ad-hoc queries stay cheap,
  and the schema can follow the domain instead of preceding it. Foreclosed by the
  mandate, not out-argued.
- **The container image for local dev** — the documented norm, and it keeps 57 MB of
  vendored runtime out of the tree. No runtime on this machine. Worth revisiting for CI.
- **An entity library such as ElectroDB** — real gains for single-table work, but an
  entity mapper wants a domain model to describe.

## Consequences
The cost is paid by whoever defines the domain. A wrong key design costs a new index or a
backfill, not an `ALTER TABLE`, so the layout stays provisional until entities exist.
Queries the keys and GSI do not serve degrade into a full `Scan`.

`npm run dev:db` yields a database with no cloud account and no container runtime, and
reaching AWS becomes an environment change. A JRE became a prerequisite of a TypeScript
project — the piece most likely to break for the next person.

## Assumptions and unknowns
- The bet: that a layout committing to no domain model survives contact with a real one.
- On-demand billing is assumed cheaper than provisioned. No traffic estimate exists.
- The emulator is assumed faithful enough to develop against. Nothing here has run
  against real DynamoDB.
- Verified only on macOS with Java 21. The vendored native libs are untested on Linux.
- Unknown whether a container runtime arrives and retires the JAR.

## Revisit when
- A second access pattern needs a `Scan` — the signal that the key design is wrong.
- The product gets a name and a scope, so real entities can be modelled.
- CI needs a database, or a container runtime lands on developer machines.
- Read or write volume grows steady enough that provisioned capacity beats on-demand.
- Anything starts depending on streams, IAM, or throttling, which the emulator misreports.
