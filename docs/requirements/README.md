# Requirements

**There is no product scope yet.** This file exists to say so. An empty directory reads as
an oversight; a missing one reads as a decision nobody made.

The one capability written up here is the demo's, not the product's:
[exploring a graph](exploring-a-graph.md). It is scoped by
[ADR 0003](../decisions/0003-graph-exploration-demo-stack.md), which fixed the page as
something that exercises the store rather than something anyone asked for.

## What is fixed

| | How it got fixed | Where |
|---|---|---|
| The store is DynamoDB | Specified up front, not compared | [ADR 0002](../decisions/0002-single-table-layout.md) |
| `connection` is a placeholder | Unsettled, and dearer to settle later | [README](../../README.md) |
| The graph page is a demo | It exercises the store; it is not the product | [ADR 0003](../decisions/0003-graph-exploration-demo-stack.md) |

Open: who uses this, what an entity is, and which access patterns matter. The key design
cannot be judged until that closes — the cost 0002 booked, and paid by whoever defines the
domain.

## What goes here when scope arrives

One file per capability, named for the capability. Each says who wants it, what they cannot
do without it, and how anyone would tell it worked.

Write access patterns as requests — *given a person, list their connections, newest first* —
rather than as nouns. This store charges for getting them wrong and charges again for
learning them late, which is the one thing a requirement can cheaply prevent here.

A requirement is not a design. If a sentence names a table, an index, or a component, it
belongs in [design/](../design/) instead.
