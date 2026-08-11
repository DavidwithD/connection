# Building a graph

**Scope: the demo, not the product.** Like
[exploring a graph](exploring-a-graph.md), this describes what the demo's writes have to do
to be worth having. Product scope is still open — see the [README](README.md).

That other file says *Not required: writing anything*, and was right when it was written.
[ADR 0009](../decisions/0009-the-first-write-outside-the-seed.md) onward changed it, and this
is the capability that picks it up.

## Who wants it

Whoever has to judge whether a graph can be *kept* in this store, not just read from it.
Reading a graph somebody generated tests only that it can be served. Changing one tests the
promise underneath — that what the store says about a node and what it will hand back for
that node cannot come apart.

## What they cannot do without it

Tell a store that can hold a graph somebody maintains from one that can only serve a graph
somebody generated. A store that reads beautifully can still make every change a chance to
leave it describing itself wrongly, and nothing short of changing one shows which kind you
have.

Also: the graph a demo starts with is invented. Anything worth showing anyone has to be
typed in.

## The requests

- *Given two nodes I can see, join them* — and the map shows the edge without being reloaded.
- *Given a name nothing carries yet, make it a node and join it in one gesture.*
- *Given a write I did not mean, take it back* — the edge, and the node it brought with it.
- *Given a node I no longer want, take it off the map* — with whatever it is joined to.
- *Given the same write twice, do it once* — a second attempt is refused, not counted again.
- *Given a write the graph will not accept, tell me which rule it broke*, in a sentence,
  wherever I made the request from.

Building a graph from a file, and writing one back out, is
[moving a graph](moving-a-graph.md).

## How anyone would tell it worked

- Join two nodes, then count what the map draws around each. Both counts went up by one, and
  a page reload shows the same graph.
- Part that edge again and both counts went back down. Nothing ever claims a node has more
  or fewer connections than it will actually hand back.
- Every refusal is a sentence naming the rule, and the sentence is the same one whether the
  write came from the terminal or the page.
- A node with edges is never silently removed. Either the edges go with it, or the removal is
  refused and says why.
- A run interrupted halfway leaves a graph that is true, not a broken one. Asking again
  finishes the job.

## Not required

Renaming a node. Editing an edge — parting and rejoining is the whole of it. Any history of
who changed what, or when. Two people writing at once: a single writer is assumed
([ADR 0010](../decisions/0010-writing-to-the-graph-from-the-browser.md)), and nothing here
detects or resolves a collision beyond refusing it.

## Where the design is

[writing-to-the-graph.md](../design/writing-to-the-graph.md) for the four transactions and
the way back, and [the-islands.md](../design/the-islands.md) for what a join or a part does
to the index of places.
