# Exploring a graph

**Scope: the demo, not the product.**
[ADR 0003](../decisions/0003-graph-exploration-demo-stack.md) fixed the graph page as
something that exercises the store. This file says what it has to do to be worth that.
Product scope is still open — see the [README](README.md).

## Who wants it

Whoever has to judge whether one partition per node can serve reading a graph at all. That
question is the cost [ADR 0002](../decisions/0002-single-table-layout.md) booked and left to
whoever defines the domain, and no amount of reading the key layout answers it.

## What they cannot do without it

Tell a store that serves exploration from one that serves only single lookups. A read that
looks cheap per node can still make walking a graph unbearable, and nothing short of walking
one shows which kind you have.

## The requests

- *Given a node, show everything it connects to* — not a sample, and not silently fewer than
  the store says it has.
- *Given something I can see, take me to it and show what it connects to.*
- *Given a connection to something too far away to draw, still show me that it exists, whose
  connection it is, and take me to the other end when I ask.*
- *Given a place I have already walked, leave it exactly where it was.*
- *Given a node whose connections were not all read, say so rather than looking complete.*
- *Given a graph too large to draw, keep working* — the answers above stay true at any point
  during a walk, not only at the start.

## How anyone would tell it worked

- Count what is drawn around the node in the middle. It matches the count the store reports
  for that node, or that node is visibly marked as having more.
- Nothing that has been drawn ever moves on its own. Not on arrival, not while loading, not
  on resize. A ghost crossing to the node it stands in for
  ([ADR 0004](../decisions/0004-the-centre-and-its-neighbourhood.md)) is the answer to a
  click, and it dissolves on landing.
- Every connection of the node in the middle can be followed in one gesture.
- Arriving somewhere new does not leave you looking at an empty screen while it loads.
- Two people walking different routes through the same graph get different pictures, and
  neither picture is missing anything.
- A node marked as having more, and then visited, stops being marked.

## Not required

Comparing one session's picture against another's. Seeing the whole graph at once. Reading
distance or direction off the picture. Writing anything.
