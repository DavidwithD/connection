# 0009 — The first write outside the seed

**Status:** ♻️ Superseded by [0030](0030-the-graph-moves-into-the-browser.md)
**Date:** 2026-08-02
**Deciders:** David HL

## Context
Until this, the only writer built the whole graph at once, on
[0007](0007-a-table-for-the-graph.md)'s table. Joining two nodes that already exist is the
first change that touches a graph somebody is reading.

It lands on an invariant. A reader weighs the edges it got back against the `degree` on the
node's meta item, and that is how it decides whether it has seen everything (`repo.ts`). The
whole map is drawn from the comparison: a node with more behind it is marked, and a finished
one is not. An edge that arrives without its count, or a count raised twice, makes the store
misdescribe itself.

## Decision
One edge is one transaction. Five operations, all of them or none.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The two directions and the two counts | A single transaction | The count and the edges cannot disagree. |
| Repeating a join | Refused by a condition | A second run must not raise a degree again. |
| Joining a node that is gone | Refused by a condition | Names are resolved before the write, not during. |
| A node to itself | Refused before the write | The transaction cannot touch one item twice. |
| Which condition failed | Reported as a sentence | The cancellation names a position, not a cause. |

## Alternatives considered
- **Four plain writes.** Cheaper, and available without a transaction. It is also exactly
  the drift the seed already paid for once, when edges outlived the counts that described
  them.
- **Counting edges at read time instead of storing a degree.** No invariant left to break.
  It also destroys the only signal that says a node has more graph behind it, because a
  truncated read would then look complete.
- **Adding edges over HTTP.** The demo page is where someone would want the button. It
  would make the API the first thing in the project that can change what others are
  reading, for a command run by hand.

## Consequences
Every join serialises on one item, where the graph's totals live. That item becomes a write
hotspot the moment two people add edges at once.

The recorded starting point goes stale. It names the best-connected node as the seed found
it, and joining edges can make that untrue with nothing to recompute it.

Holding a reply is no longer free of risk. A neighbourhood fetched ahead of a walk can
describe a graph that changed underneath it, which nothing had to account for while the
store was only ever read.

## Assumptions and unknowns
- Assumed edges are added by hand, rarely, by one person. The hotspot is unmeasured and
  would matter at any real rate.
- Assumed a stale starting point is harmless: it only picks where a session opens.
- Unknown how a held reply behaves against an edge added mid-session; the demo has only
  been driven with a store nobody was writing to.

## Revisit when
- Something other than a person at a terminal adds an edge.
- Edges need removing, which the same invariant constrains in the other direction.
- The starting point is wrong often enough that somebody notices.
- Two writers meet on the totals item and a transaction is cancelled for conflict.
