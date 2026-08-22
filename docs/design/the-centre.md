# The centre and its neighbourhood

What the map draws around the centre, and what has to stay true while it does. The constraints
behind it are [ADR 0004](../decisions/0004-the-centre-and-its-neighbourhood.md), for what is
drawn, [ADR 0012](../decisions/0012-the-name-is-the-node.md), for the mark it is drawn as, and
[ADR 0032](../decisions/0032-the-centre-is-named.md), for which node holds it.

The centre is named, never inferred. A click, a doorway, a search hit, a crossing to an island
— each of those hands the mark over, and nothing else does. Panning and zooming are looking, so
the middle of the screen is where the centre was put rather than what defines it. A reader who
wants the older rule can tick **walk by pan**. The camera then names the centre again, at the
price [ADR 0032](../decisions/0032-the-centre-is-named.md) sets out.

A click takes no camera. It names a node **where it stands**
([ADR 0033](../decisions/0033-a-click-takes-no-camera.md)), so the centre sits as often at an
edge as at the middle. The search box, an island row and a doorway do still move the camera to
their node. The centre and its neighbours are the only nodes named at rest, and a named node is
drawn as its name; everything else is a disc. A disc draws as its name while the pointer rests
on it. A neighbour off screen is stood in for by a ghost in the ring, and clicking one flies to
the node it stands for. Nothing on the map moves except a ghost in flight.

## What the renderer may do

Only *add*. [map-view.ts](../../web/src/map-view.ts) never moves an element, never restyles
one per frame, and never removes one, so a pan is camera work and costs nothing beyond the
redraw. Panning triggers no read and no layout, because there is no layout.

Cytoscape's own gestures are already the convention a map wants — drag pans, wheel zooms
toward the cursor — so none of that is reimplemented. `autoungrabify` turns a drag that
starts on a node into a pan rather than a move, which both matches a map and protects the
frozen positions.

Ghosts are the one exception, and it is deliberate. They are also the one thing here the
camera decides.

A hover is the one restyle. It writes one flag on the node the pointer entered, and clears the
one it left. The cost is per pointer crossing rather than per frame, and `setTiers` already
writes more than that per read.

## The names

A named node draws *as* its name: a pill sized to the label, with no disc beside it. A disc
with a label beside it is two marks carrying one fact, and a reader has to bind them before
reading either. The pill is Cytoscape's own node box rather than drawn text, so it keeps the
hit target, the place an edge stops, and a border the finer marks can use.

Only the centre and its ring are named, so only they are pills. Everything else stays a
disc: a field node is seen rather than read, and nothing about it has to be legible for the
map to work.

Until it is pointed at. A disc under the pointer draws as its name, in the ring's pill at the
ring's size. It goes back to a disc when the pointer leaves, so reading a field node costs no
click. The ink is the page's own rather than the ring's, because this node is not a neighbour of
the centre. The pill is wider than the disc it replaces, and it takes the taps inside it. A
neighbour whose seat falls under it has to be approached from outside.

The kinds of thing on the map.

| Name | What it is | In the code |
|---|---|---|
| centre | The node somebody named, until somebody names another | `tier 0` |
| ring | A neighbour of the centre, named — the name being the mark | `tier 1` |
| arrival | A ring node that turns up *while* its parent is the centre | born at `tier 1` |
| backdrop | Near the centre, connected to something else, dimmed | `tier 3` |
| field | Everything else, at rest | `tier 2` |
| pointed at | A field or backdrop node named for as long as the pointer rests on it | `hover` |
| frontier | Has connections that were never read | `more` |
| tether | A dashed stub standing in for an edge too long to draw | `stub` |
| open line | A tether's whole edge, drawn while the pointer holds it | `long` |
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
doorways into the nodes they stood for, zooming in raises them for the neighbourhood you zoomed
past, and panning away raises them for the one you left behind — a doorway being the only mark
on the map the camera still has any say over.

Which means the doorways can leave the screen themselves. They stand in the centre's own rings,
so a pan that carries the centre off the edge takes them along, and what is left is a
neighbourhood standing in for neighbours where neither can be seen. Nothing is lost by it:
**Recentre** brings the whole picture back, and clicking anything still on screen names a
centre where you are instead.

The camera decides it because nothing else can. How far a neighbour sits from the centre is
fixed when it is seated and never changes; whether the reader can see it changes with every
zoom and every pan. Only the camera knows the second.

The rule reads the canvas, which is not quite what the reader sees: the HUD, the islands and
the legend float over it, so a neighbour parked under one counts as on screen and gets no
ghost while being as hidden as one that left.

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

A tether stops drawing for two reasons, and they are tracked apart. A ghost replacing it adds
`hidden`. The pointer opening its line adds `eclipsed`. Either class is enough to stop the
tether drawing, so neither path has to test for the other
([ADR 0041](../decisions/0041-a-stub-that-opens.md)). Resting the pointer on a tether draws the
whole edge, solid. Both tethers stay down for as long as the pointer is on the line. The line
is a real edge with two real ends, so right-click parts the pair.

How many can stand is what the rings have room for, not a number written down:
`pillsAround` ([placement.ts](../../web/src/placement.ts)) divides a ring's circumference by the
widest name in the plan, and a neighbourhood wider than one ring uses the next one out. How far
out is half the viewport's smaller span — measured once, when the visit began, and measured
*from the centre* rather than from the frame. The two agree while the centre sits at the middle,
which is the arrangement the bound was cut for: a doorway off screen opens for nobody. They part
company when a click names a node where it stands
([ADR 0033](../decisions/0033-a-click-takes-no-camera.md)). A centre near an edge then plans
doorways that fall outside the frame. **Recentre** brings them back within reach on the next
visit, not this one. `slotsFor` rebuilds the plan when the centre changes, not when the camera
moves. Two slots that would touch are refused — a name half under a sibling is still readable,
a doorway half under one has lost its click.

A constant could not stay true. Every input to that division moves — the type, the plan, the
viewport — so a number fixed against one ring stops matching the next, and nothing reports the
gap: doorways simply stop appearing.
[ADR 0027](../decisions/0027-a-ring-holds-what-it-holds.md) is why this is measured rather than
declared.

The rings still run out on a hub at close zoom, so the order they are offered in decides who
gets one. Ranked unlined first — a neighbour reached by two tethers has almost nothing pointing
at it, while one with a drawn line at least has a direction — then nearest first, which puts
the doors on the neighbours close enough to be worth walking to.

## The flight

Clicking a ghost runs `flyTo` ([map-view.ts](../../web/src/map-view.ts)):

1. The read for the destination starts at once, before anything moves.
2. The centre is pinned. Nothing may take it while a ghost is in the air.
3. Camera and ghost travel together, for a duration set by how far the move looks on screen.
4. On landing, the destination becomes the centre and the ghost dissolves into it.

Steps 2 and 4 are the ones that break if touched. A ghost torn down when its centre stops
being the centre leaves nothing under the cursor by the second frame; a destination promoted
before the landing shows you arriving at a place you have not reached.

A flight out and a flight back are symmetric in everything geometric and asymmetric in
everything they know. The motion mirrors: whichever ghost was clicked is the one that travels,
the way back covers the distance the way out did, and the centre being left demotes and stands
a ghost of itself in the new ring. What differs is what you land on. Flying out, the
destination is an unlabelled dot whose neighbours may not be seated, so its ring has to be
read; flying back, every seat exists and nothing is read at all. Step 1 is what that asymmetry
pays for — the outbound flight is otherwise idle time, and the return needs none of it.

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
clear the screen by, the pill's inset and type, and the paint bands for the ring, the doorways
and the node under the pointer in [map-view.ts](../../web/src/map-view.ts), and the settle
delays, the keyboard pan step and the accent hysteresis in [main.ts](../../web/src/main.ts).
Each carries the reason for its value in a comment. Copying one here would make this the stale
copy. The one stored key is in [settings.ts](../../web/src/settings.ts), beside the guard that
reads it.

## Records behind it

| Record | What it settled |
|---|---|
| [0004](../decisions/0004-the-centre-and-its-neighbourhood.md) | That the centre shows every neighbour it has, and what a ghost is |
| [0012](../decisions/0012-the-name-is-the-node.md) | The pill, and which nodes get one rather than a disc |
| [0025](../decisions/0025-when-a-ghost-stands.md) | The camera rather than the seat as what raises a ghost |
| [0027](../decisions/0027-a-ring-holds-what-it-holds.md) | How many doorways a ring offers, and that the number is measured |
| [0006](../decisions/0006-only-the-centre-reads.md) | That drawing is the centre's neighbourhood, and reading runs a hop past it |
| [0032](../decisions/0032-the-centre-is-named.md) | What moves the mark, and what it costs to let the camera move it |
| [0033](../decisions/0033-a-click-takes-no-camera.md) | That a click names a node where it stands, and what that costs the doorways |
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | One frozen position per node, and a camera panned over it |
