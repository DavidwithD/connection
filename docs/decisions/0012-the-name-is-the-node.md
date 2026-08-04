# 0012 — The name is the node

**Status:** 🔵 Proposed
**Date:** 2026-08-03
**Deciders:** David HL

## Context
[ADR 0004](0004-the-centre-and-its-neighbourhood.md) gave the centre and its ring a disc
each, with the label beside it. Two marks carry one fact, and a reader binds them before
reading anything. On the ring the disc encodes only what type could: tier.

It was doing three quieter jobs too: hit target, the place an edge stops, and a border.
That border carries the encodings that may not become hues, since
[the hop ramp](../../web/src/palette.ts) reserves hue for distance.

[ADR 0006](0006-only-the-centre-reads.md) already found it shouting: reading a hop ahead
leaves nearly every node wearing the dashed frontier mark — "a mark almost everything wears
says less".

## Decision
A named node draws as its name. Only the centre and its ring are named, so only they change.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| A named node's mark | Its name, in a pill sized to it | The name was always the payload. |
| Everything else | The disc it already had | A field node is seen, not read. |
| What the pill is | Cytoscape's own node box | Keeps hit target, edge stop and a border. |
| The centre | Accent as fill, not as ink | Only fill still says "you are here". |
| `more` and ghost | The border, finer | A pill's perimeter is twice a disc's. |
| Two pills that overlap | Stack by degree, seats untouched | Wider seats would cost drawn edges. |

## Alternatives considered
- **Bare type, no plate.** Least ink, and it strands `more` and ghost: no border left, and
  hue is spoken for.
- **Keeping the disc, tuning the gap.** Two marks for one fact, the whole complaint.
- **Widening the seats so pills clear.** Ring four then falls past `LONG_EDGE`
  ([placement.ts](../../web/src/placement.ts)) and drawn edges become tethers. Deferred, not
  refused: seats are never persisted, so it stays a reload away.
- **Measuring labels to set widths.** Avoids a deprecated call, at the price of duplicating
  Cytoscape's font metrics.

## Consequences
Type is not pre-attentive. A ring reads better node by node and worse as a shape — names
differ in length, so a ring stops looking like one.

Pills overlap where seats were spaced for discs. Paint order and a near-opaque fill pay for
that instead of geometry, so the loser of a pair is partly covered.

The centre's name moved onto the accent, needing its own validated contrast pair — white
cleared neither (3.2:1 light, 3.9:1 dark). The canvas
went to two device pixels, which costs fill. The field keeps discs, so two kinds of mark now
share the map.

## Assumptions and unknowns
- `width: label` is deprecated in Cytoscape 3.34, which
  [warns on parse](https://github.com/cytoscape/cytoscape.js/blob/master/src/style/parse.mjs).
  It works.
- **A hollow pill still reads as "not the real node".** 0004 assumed that of the disc and
  never tested it. Inherited, still untested.
- The overlap was judged on the root's ring, never deeper.
- `ringReach` still pads the backdrop by a disc's diameter, not a name's width.

## Revisit when
- Anyone reads an overlapping pair as one name.
- Cytoscape drops label-sized widths.
- Pills overlap past legibility more than a step from the root.
- The field has to be named too, leaving no reason for two marks.
- `more` has to be visible without looking for it.
