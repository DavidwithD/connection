# Requirements

**There is no product scope yet.** This file exists to say so. An empty directory reads as
an oversight; a missing one reads as a decision nobody made.

The capabilities written up here are the demo's, not the product's:
[exploring a graph](exploring-a-graph.md), [building a graph](building-a-graph.md),
[moving a graph](moving-a-graph.md), and [storing a graph](storing-a-graph.md). All four are
scoped by
[ADR 0003](../decisions/0003-graph-exploration-demo-stack.md), which fixed the page as
something that exercises the store rather than something anyone asked for.

Exploring came first and says *Not required: writing anything*, which was true when it was
written. Building and moving are the capabilities that picked that up, and each says what it
is worth rather than restating the other.

Storing arrived last and differently. The other three describe what a reader does; that one
describes the ground they stand on, and it was written because every design argument about
size was resting on a number nobody had put in writing.

## What is fixed

| | How it got fixed | Where |
|---|---|---|
| The store is the browser's IndexedDB | Chosen against alternatives, unlike the store before it | [ADR 0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| `connection` is a placeholder | Unsettled, and dearer to settle later | [README](../../README.md) |
| The graph page is a demo | It exercises the store; it is not the product | [ADR 0003](../decisions/0003-graph-exploration-demo-stack.md) |

Open: who uses this, what an entity is, and which access patterns matter. That is still the
cost [ADR 0002](../decisions/0002-single-table-layout.md) booked, and it is still paid by
whoever defines the domain — but it no longer blocks judging the store. The graph's access
patterns are known, and [storing a graph](storing-a-graph.md) states the size they hold at.

## What goes here when scope arrives

One file per capability, named for the capability. Each says who wants it, what they cannot
do without it, and how anyone would tell it worked.

Write access patterns as requests — *given a person, list their connections, newest first* —
rather than as nouns. This store charges for getting them wrong and charges again for
learning them late, which is the one thing a requirement can cheaply prevent here.

A requirement is not a design. If a sentence names a table, an index, or a component, it
belongs in [design/](../design/) instead.
