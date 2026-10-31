# 0012 — The name is the node

**Status:** 🔵 Proposed
**Date:** 2026-08-03
**Deciders:** David HL

## Context
[ADR 0004](0004-the-centre-and-its-neighbourhood.md) gave the selected node and each
neighbour a disc, with the label beside it. Two marks carry one fact, and a reader pairs
them first. On a neighbour the disc encodes only what type could: tier.

The disc had three other jobs: hit target, edge stop, and a border. The border carries the
encodings that may not become hues, as [the hop ramp](../../web/src/palette.ts) reserves hue
for distance.

[ADR 0006](0006-only-the-centre-reads.md) found the border too loud. Reading a hop ahead
marks nearly every node with the dashed unread outline. "A mark almost everything wears
says less".

## Decision
A named node draws as its name. Only the selected node and its neighbours have names, so
only they change.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| A named node's mark | Its name, in a label box sized to it | The name is the content. |
| Everything else | The disc it already had | An other node is seen, not read. |
| What the label box is | Cytoscape's own node box | Keeps hit target, edge stop and a border. |
| The selected node | Accent as fill, not as text colour | Only fill still says "you are here". |
| `more` and off-screen marker | The border, finer | A label box's perimeter is twice a disc's. |
| Two label boxes that overlap | Stack by degree, slots untouched | Wider slots would cost drawn edges. |

## Alternatives considered
- **Bare type, no box.** Least ink, but `more` and the off-screen marker lose their border,
  and hue is taken.
- **Keeping the disc, tuning the gap.** Two marks for one fact, the whole complaint.
- **Widening the slots so label boxes clear.** Circle four then falls past `LONG_EDGE`
  ([placement.ts](../../web/src/placement.ts)) and drawn edges become connector lines.
  Deferred: slots are never persisted, so a reload can apply it.
- **Measuring labels to set widths.** Avoids a deprecated call, at the price of duplicating
  Cytoscape's font metrics.

## Consequences
Type needs reading. The neighbours read better node by node and worse as a shape. Names
differ in length, so the circle stops looking like one.

Label boxes overlap where slots were spaced for discs. Paint order and a near-opaque fill
handle that in place of geometry, so the lower box is partly covered.

The selected node's name moved onto the accent, with a validated contrast pair. White
failed both (3.2:1 light, 3.9:1 dark). The canvas went to two device pixels, which costs
fill. The other nodes keep discs, so two kinds of mark share the map.

## Assumptions and unknowns
- `width: label` is deprecated in Cytoscape 3.34, which
  [warns on parse](https://github.com/cytoscape/cytoscape.js/blob/master/src/style/parse.mjs).
  It works.
- **A hollow label box still reads as "not the real node".** 0004 assumed that of the disc
  and never tested it. Still untested.
- The overlap was judged on the root's neighbours, never deeper.
- `neighbourReach` still pads the dimmed area by a disc's diameter, not a name's width.

## Revisit when
- Anyone reads an overlapping pair as one name.
- Cytoscape drops label-sized widths.
- Label boxes overlap past legibility more than a step from the root.
- The other nodes need names too, so two marks lose their reason.
- `more` has to be visible without looking for it.
