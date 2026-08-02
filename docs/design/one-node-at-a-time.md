# One node at a time

How the second demo page is built, and what has to stay true while it runs. The constraint
behind it is [ADR 0005](../decisions/0005-a-second-view-that-keeps-no-world.md): one node,
its whole ring, and no world kept between hops. Everything the map holds — frozen seats, an
occupancy grid, a camera, tiers, ghosts — is absent here on purpose, so this page is also
the measurement of which of those the map actually needs.

## The spoke

There is one drawing primitive. A node is a **spoke**: turn to a bearing, run out to a
length. The centre is the same thing at length zero.

That is what makes a hop cheap. The node clicked keeps its elements all the way in and the
node left behind keeps its elements all the way out, because neither is created or
destroyed — their lengths are swapped. Anything present on both sides of a hop slides;
only a node that genuinely leaves the neighbourhood fades.

Motion is CSS, not a loop. The arm and the node carry matching transform lists — `rotate
scale` and `rotate translate rotate`, the trailing turn keeping the label upright — so both
interpolate componentwise over one duration and cannot come apart mid-flight. Arms and
nodes live in two layers rather than one group per spoke: every arm meets at the origin, so
a group each would paint them across the centre mark.

## Rings

A ring of radius r seats `2πr / SEP` nodes before they touch, so the ring count follows
from the neighbour count and nothing is tuned per graph
([rings.ts](../../web/src/orbit/rings.ts)). Rings fill *proportionally*, largest remainder
first — filling in order packs the inner ring against a nearly empty outer one, which reads
as a fault rather than as a layout. Every other ring is turned half a slot, or the seats
line up radially and the spokes become an artifact of the seating.

One scale factor works in both directions. A hub whose rings overflow the window is
compressed uniformly; a node with six neighbours is grown, up to a ceiling, because six
dots at the base radius read as small rather than as sparse.

## The hop

`beginHop` runs on the click, not on the reply
([orbit-view.ts](../../web/src/orbit/orbit-view.ts)). The neighbours are still a fetch away,
but the clicked node is already known to be the next centre, so it sets off immediately and
the API's floor is spent moving instead of waiting.

Seating is read before anything moves, and a returning neighbour takes the free seat nearest
the bearing it already holds. Seating in the order the API returned them would reshuffle the
ring every hop, and then nothing would look like it stayed put — which is the one thing the
surviving elements exist to convey.

A second click while the first is in the air wins ([main.ts](../../web/src/orbit/main.ts)).
No reset is needed: every spoke is keyed by node id, so the next draw diffs against whatever
is on screen, mid-transition or not.

## Invariants

**The whole ring, or a count that says otherwise.** A ring too big for the window is
compressed, never clipped or paginated. When the store itself truncated a hub, the HUD says
*n of degree* rather than letting the drawing imply completeness.

**Size means degree and nothing else.** Marks shrink with a compressed ring but are not
grown by a roomy one — a neighbour swelling toward the size of the centre would read as an
encoding, and there is only one.

**A spoke is moved, never replaced.** Removing and re-adding an element that is present on
both sides of a hop is the blink this page was built to avoid.

**Nothing is remembered between hops.** No store, no history, no back. That is 0005's whole
bet, and the cost is that circling back is invisible.

## Where the numbers are

Beside the code that reads them, once: separation, ring radius and step, fill target and
growth ceiling in [rings.ts](../../web/src/orbit/rings.ts); mark radii, the degree at which
size saturates, the label limit, and the stagger and fade durations in
[orbit-view.ts](../../web/src/orbit/orbit-view.ts). Each carries the reason for its value in
a comment. Copying one here would make this the stale copy.
