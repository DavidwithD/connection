# The centre and its neighbourhood

What the map draws around the node in the middle, and what has to stay true while it does.
The constraints behind it are [ADR 0004](../decisions/0004-the-centre-and-its-neighbourhood.md),
for what is drawn, and [ADR 0012](../decisions/0012-the-name-is-the-node.md), for the mark it
is drawn as; the options that lost are still drawn in
[names-and-options.html](names-and-options.html).

## The names

A named node draws *as* its name: a pill sized to the label, with no disc beside it. Only
the centre and its ring are named, so only they are pills — everything else is still a disc,
and the reason for the split is [ADR 0012](../decisions/0012-the-name-is-the-node.md).

Seven kinds of thing, and one of them is not a node.

| Name | What it is | In the code |
|---|---|---|
| centre | The node nearest the middle of the screen | `tier 0` |
| ring | A neighbour of the centre, named — the name being the mark | `tier 1` |
| arrival | A ring node that turns up *while* its parent is the centre | born at `tier 1` |
| backdrop | Near the centre, connected to something else, dimmed | `tier 3` |
| field | Everything else, at rest | `tier 2` |
| frontier | Has connections that were never read | `more` |
| tether | A dashed stub standing in for an edge too long to draw | `stub` |
| ghost | A hollow stand-in, in the ring, for a neighbour seated too far away | `ghost` |

*Arrival* is a word for describing behaviour, not a state. Every ring node carries the same
surface-coloured outline, so one arriving over a dimmed node reads as being on top of it
without anything having to remember that it arrived.

## Where two names meet

A pill is as wide as its name, and seats were spaced for discs, so two ring pills can
overlap where a ring runs horizontally. They stack rather than interleave: the
better-connected name draws whole, over the other. `setTiers` ranks the ring into a band of
`z-index` values for that, and `RING_Z` ([map-view.ts](../../web/src/map-view.ts)) carries
the reason degree settles it and distance cannot.

## Tiers

Tier is recomputed in `setTiers` ([map-view.ts](../../web/src/map-view.ts)) — when the
centre changes, and again when a reply lands on the current centre. The second is not
optional: a node already seated when that reply arrives was tiered for a neighbourhood it
was not yet known to be in, and nothing else would promote it until the centre moved on.
Never per frame, though — four data writes over two neighbourhoods on a centre change, and
`O(degree + backdrop)` once per reply, so it stays affordable during a pan.

Backdrop membership is a distance test, not a corridor test: everything within the centre's
own ring reach that is not one of its neighbours. `ringReach` measures that from the
neighbours actually drawn as lines, because a neighbour represented by a ghost is already in
the ring and must not stretch the radius out to its real seat.

Nodes arriving mid-flight are born into the right tier rather than waiting for the next
centre change, which is why `add` reads the current centre before it builds an element.

## Ghosts

A ghost exists only in the renderer. It is never in `World`, never in `Occupancy`, and holds
no ground — which is what stops `nearestTo` from returning one and making a ghost the centre.
Its slot comes from `slotsAround` ([world.ts](../../web/src/world.ts)): gaps first, and a ring
position regardless if there are none, since crowding is what put the neighbour out of range
to begin with.

A ghost replaces the *centre's own end* of that long edge. The tether at the far end stays;
it belongs to the other node. Raised on a settled camera, not on every centre change — and
once at boot, because the first frame is the root's ring and has nothing else to stand in
for a neighbour seated out of range.

## The flight

Clicking a ghost runs `flyTo` ([map-view.ts](../../web/src/map-view.ts)):

1. The request for the destination goes out at once, before anything moves.
2. The centre is pinned. Nothing may take it while a ghost is in the air.
3. Camera and ghost travel together, for a duration set by how far the move looks on screen.
4. On landing, the destination becomes the centre and the ghost dissolves into it.

Steps 2 and 4 are the ones that break if touched. A ghost torn down when its centre stops
being the centre leaves nothing under the cursor by the second frame; a destination promoted
before the landing shows you arriving at a place you have not reached.

## Invariants

**Nothing moves except a ghost, and only while flying.** `autolock` is off for exactly that
long. Frozen seating rests on `World` exposing no method that moves a node — see the
invariants in [architecture.md](architecture.md).

**A neighbour is never discarded for want of room.** One that finds no seat is kept and
retried at a tighter separation, so "no room" is a fact about now rather than a loss. Room is
the only reason a neighbour is not drawn, and it is temporary.

**A ghost is never a node.** Hollow, dashed, unseated, and gone when the centre moves on.

## Where the numbers are

Beside the code that reads them, once: separations and ring geometry in
[placement.ts](../../web/src/placement.ts), flight speed and its clamps, the ghost cap, the
long-edge threshold, the pill's inset and the ring's paint band in
[map-view.ts](../../web/src/map-view.ts), and the settle delay and accent hysteresis in
[main.ts](../../web/src/main.ts). Each carries the reason for its value in a comment.
Copying one here would make this the stale copy.
