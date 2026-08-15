# The centre and its neighbourhood

What the map draws around the node in the middle, and what has to stay true while it does.
The constraints behind it are [ADR 0004](../decisions/0004-the-centre-and-its-neighbourhood.md),
for what is drawn, and [ADR 0012](../decisions/0012-the-name-is-the-node.md), for the mark it
is drawn as.

## What the renderer may do

Only *add*. [map-view.ts](../../web/src/map-view.ts) never moves an element, never restyles
one per frame, and never removes one, so a pan is camera work and costs nothing beyond the
redraw. Panning triggers no fetch and no layout, because there is no layout.

Cytoscape's own gestures are already the convention a map wants — drag pans, wheel zooms
toward the cursor — so none of that is reimplemented. `autoungrabify` turns a drag that
starts on a node into a pan rather than a move, which both matches a map and protects the
frozen positions.

Ghosts are the one exception, and it is deliberate. They are also the one thing here the
camera decides.

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
| ghost | A hollow stand-in, in the ring, for a neighbour that is off screen | `ghost` |

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
own ring reach that is not one of its neighbours. `ringReach` measures that from the neighbours
joined by a drawn line, so the radius answers to the world and not to the camera — one that
moved with the zoom would dim a different set at every step, and each settle would become a
restyle over everything near the centre. What the backdrop asks is what this centre *crowds*,
and crowding is a fact about where the seats are.

Nodes arriving mid-flight are born into the right tier rather than waiting for the next
centre change, which is why `add` reads the current centre before it builds an element.

## Ghosts

Every neighbour of the centre is either legible at its own seat or stood in for by a ghost.
Never both, never neither. That is the whole rule, and it is the camera that decides which:
a ghost stands while its neighbour's drawn box is off screen. So zooming out dissolves the
doorways into the nodes they stood for, and zooming in raises them for the neighbourhood you
zoomed past.

Reading the camera at all is [ADR 0025](../decisions/0025-when-a-ghost-stands.md); the ghost
itself is 0004's. The rule reads the canvas, which is not quite what the reader sees: the HUD,
the islands and the legend float over it, so a neighbour parked under one counts as on screen
and gets no ghost while being as hidden as one that left.

The box and not the seat, because a ring node draws as its name: a seat just past the edge
still has half its label readable, and a ghost raised for it would be the same name twice.
Coming down needs only that some part of the neighbour shows; going up needs it clear of the
edge by a margin. Those two are not each other's negation, which is what gives the dead band
that stops a nudge and the nudge back from raising and lowering anything.

A ghost exists only in the renderer. It is never in `World`, never in `Occupancy`, and holds
no ground — which is what stops `nearestTo` from returning one and making a ghost the centre.
Its slot comes from `slotsAround` ([world.ts](../../web/src/world.ts)): gaps first, and a ring
position regardless if there are none, since a full region is exactly where a doorway is worth
most. The slots are cut once per visit and held for it, because `seat` spreads what it is given
evenly — asking again for a different number moves the ghosts already standing, and nothing on
this map moves except a ghost in flight.

A slot is claimed only by a neighbour that needs one at the time, and never given back — which is
what lets the claim answer to the camera while the position does not. `slotsFor`
([map-view.ts](../../web/src/map-view.ts)) carries the reason a claim that is never revoked can
be made on what the reader can see without disturbing a doorway already standing.

Where the centre's end of a long edge is a tether, the ghost replaces it. The tether at the far
end stays; it belongs to the other node. Where the edge is short enough to be drawn, the line
stays too, running off the edge of the screen — it says which way the neighbour lies, which is
the one thing a stand-in in the ring cannot, so the ghost's own edge is dashed to keep the two
marks apart. Raised and lowered on a settled camera, never per frame, and once at boot for a
window too small to hold the root's ring.

How many can stand is what the rings have room for, not a number written down:
`pillsAround` ([placement.ts](../../web/src/placement.ts)) divides a ring's circumference by the
widest name in the plan, and a neighbourhood wider than one ring uses the next one out. Only
rings the viewport can show are used, because a doorway off screen opens for nobody, and two
slots that would touch are refused — a name half under a sibling is still readable, a doorway
half under one has lost its click. [ADR 0027](../decisions/0027-a-ring-holds-what-it-holds.md)
is why this is measured rather than declared.

The rings still run out on a hub at close zoom, so the order they are offered in decides who
gets one. Ranked unlined first — a neighbour reached by two tethers has almost nothing pointing
at it, while one with a drawn line at least has a direction — then nearest first, which is also
the order the read-ahead holds replies in, so a door usually opens without a fetch.

## The flight

Clicking a ghost runs `flyTo` ([map-view.ts](../../web/src/map-view.ts)):

1. The request for the destination goes out at once, before anything moves.
2. The centre is pinned. Nothing may take it while a ghost is in the air.
3. Camera and ghost travel together, for a duration set by how far the move looks on screen.
4. On landing, the destination becomes the centre and the ghost dissolves into it.

Steps 2 and 4 are the ones that break if touched. A ghost torn down when its centre stops
being the centre leaves nothing under the cursor by the second frame; a destination promoted
before the landing shows you arriving at a place you have not reached.

A round trip is symmetric in everything geometric and asymmetric in everything it knows.
The motion mirrors: whichever ghost was clicked is the one that travels, the way back covers
the distance the way out did, and the centre being left demotes and stands a ghost of itself
in the new ring. What differs is what you land on. Flying out, the destination is an
unlabelled dot whose neighbours may not be seated, and whether its ring is there on arrival
is network-bound; flying back, every seat exists and nothing is fetched. Step 1 is what that
asymmetry pays for — the outbound flight is otherwise idle time, and the return needs none
of it.

## Invariants

**Nothing moves except a ghost, and only while flying.** `autolock` is off for exactly that
long. Frozen seating rests on `World` exposing no method that moves a node — see the
invariants in [architecture.md](architecture.md).

**A neighbour is never discarded for want of room.** One that finds no seat is kept and
retried at a tighter separation, so "no room" is a fact about now rather than a loss. Room is
the only reason a neighbour is not drawn, and it is temporary.

**A ghost is never a node.** Hollow, dashed, unseated, gone when the centre moves on — and
never on screen at the same time as the node it stands for.

## Where the numbers are

Beside the code that reads them, once: separations, ring geometry and the long-edge threshold in
[placement.ts](../../web/src/placement.ts), flight speed and its clamps, the margin a seat must
clear the screen by, the pill's inset and type, and the paint bands for the ring and the doorways
in [map-view.ts](../../web/src/map-view.ts), and the settle delay and accent hysteresis in
[main.ts](../../web/src/main.ts). Each carries the reason for its value in a comment. Copying one
here would make this the stale copy.
