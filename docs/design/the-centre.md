# The selected node and its neighbours

What the map draws around the selected node, and what has to stay true while it does. Three
records set the constraints. [ADR 0004](../decisions/0004-the-centre-and-its-neighbourhood.md)
sets what is drawn. [ADR 0012](../decisions/0012-the-name-is-the-node.md) sets the mark each
node is drawn as. [ADR 0032](../decisions/0032-the-centre-is-named.md) sets which node is
selected.

A person selects the node, and the code never infers it. A click, an off-screen marker, a search
hit and a component row each select a node. Nothing else does. A pan or a zoom
changes only the view. The middle of the screen is where a camera move put the selected node.
It does not define the selected node. A reader who wants the older rule can tick **walk by
pan**. The camera then selects the node again, at the cost
[ADR 0032](../decisions/0032-the-centre-is-named.md) sets out.

The click handler leaves the camera where it is. It selects the node **at its current position**
([ADR 0033](../decisions/0033-a-click-takes-no-camera.md)). So the selected node sits at an edge
as often as at the middle. The search box, a component row and an off-screen marker still move
the camera to their node. At rest, only the selected node and its neighbours show their names.
A node with a name is drawn as its name. Every other node is a disc. A disc is drawn as its name
while the pointer rests on it. An off-screen marker near the selected node stands for each
neighbour outside the view. A click on one moves the camera to the node it stands for. Nothing
on the map moves except an off-screen marker during a camera move.

## What the renderer may do

The renderer only *adds*. [map-view.ts](../../web/src/map-view.ts) never moves an element,
never restyles one per frame, and never removes one. So a pan is camera work and costs only the
redraw. A pan triggers no read and no layout, because the map has no layout step.

Cytoscape's own gestures already follow the map convention: drag pans, and the wheel zooms
toward the cursor. This code reimplements none of them. `autoungrabify` turns a drag that starts
on a node into a pan instead of a move. That matches a map, and it protects the fixed positions.

Off-screen markers are the one exception, and it is deliberate. They are also the one thing here
the camera decides.

A hover is the one restyle. The hover handler writes one flag on the node the pointer entered.
It clears the flag on the node the pointer left. The cost is per pointer crossing, not per
frame. `setTiers` already writes more than that per read.

## The names

A named node is drawn *as* its name: a label box sized to the label, with no disc beside it. A
disc with a label beside it is two marks for one fact. A reader has to connect them before
reading either. The label box is Cytoscape's own node box, not drawn text. So it keeps the hit
target, the point where an edge stops, and a border the finer marks can use.

Only the selected node and its neighbours have names, so only they are label boxes. Every other
node stays a disc. A reader sees an other node and does not read it. The map works with no other
node legible.

That changes when the pointer rests on a disc. The disc is then drawn as its name, in the
neighbours' type, with every line shown. It goes back to a disc when the pointer leaves. So a
reader can read an other node without a click. The ink is the page's own and not the
neighbours', because this node is not a neighbour of the selected node. The label box is wider
than the disc it replaces, and it takes the taps inside it. To reach a neighbour placed under
it, the pointer has to come from outside the box.

A long name is cut to fit ([0048](../decisions/0048-a-long-name-is-cut-to-fit.md)). A
neighbour's name and an off-screen marker's name wrap to two lines of at most 150 px. Each ends
in `…` if more text is left. The name under the pointer opens to 260 px with every line. The
selected node's name is cut like a neighbour's name at rest, in its own larger type. The pointer
opens it to 300 px with every line. A slot is as wide as the widest cut name. So one long name
no longer widens the circle.

The map draws eight kinds of thing. The table also lists *new neighbour*, which is a behaviour.
The off-screen marker is never a node.

| Name | What it is | In the code |
|---|---|---|
| selected node | The node somebody selected, until somebody selects another | `tier 0` |
| neighbour | A neighbour of the selected node, drawn as its name | `tier 1` |
| new neighbour | A neighbour that appears *while* its parent is selected | starts at `tier 1` |
| dimmed node | Near the selected node, connected to something else, faded | `tier 3` |
| other node | Every other node, at rest | `tier 2` |
| node under the pointer | An other or dimmed node, named while the pointer rests on it | `hover` |
| node with unread edges | Has edges the map never read | `more` |
| stub | A dashed short mark that stands for an edge too long to draw | `stub` |
| off-screen marker | A hollow label box that stands for a neighbour off screen | `marker` |

*New neighbour* describes behaviour. No state records it. Every neighbour carries the same
label outline in the surface colour. So a new neighbour drawn over a dimmed node reads as on top
of it. No code has to remember that the neighbour is new.

## Where two names meet

A label box is as wide as its name, and the free spots were spaced for discs. So two neighbours'
label boxes can overlap where a circle runs horizontally. The renderer stacks them, and the two
names never interleave. The name with more edges draws whole, over the other. `setTiers` ranks
the neighbours into a range of `z-index` values for that.
`NEIGHBOUR_Z` ([map-view.ts](../../web/src/map-view.ts)) carries the reason degree decides the
order and distance cannot.

## Tiers

`setTiers` ([map-view.ts](../../web/src/map-view.ts)) recomputes the tiers in two cases. It runs
when the selected node changes. It runs again when a reply arrives for the current selected
node. The second run is required. A node placed before that reply was tiered for a neighbourhood
it was not yet known to be in. Nothing else would promote it until another node was selected.
`setTiers` never runs per frame. A change of selected node costs four data writes over two
neighbourhoods. A reply costs `O(degree + dimmed)` once. So the cost stays affordable during a
pan.

The dimmed-node test measures distance, and it uses no corridor. A dimmed node is any node
within the selected node's neighbour reach that is not one of its neighbours. `neighbourReach`
measures that reach from the neighbours joined by a drawn line. So the radius is in world
coordinates and ignores the camera. A radius that changed with the zoom would dim a different
set at every step. Each idle camera would then restyle everything near the selected node. The
test finds the nodes this selected node *crowds*. Crowding depends on where the nodes are
placed.

A node added during a camera move starts in the right tier. It does not wait for the next change
of selected node. For that, `add` reads the current selected node before it builds an element.

## Off-screen markers

Each neighbour of the selected node is either legible at its own place, or an off-screen marker
stands for it. Exactly one of the two holds. That is the whole rule, and the camera decides
which one holds. An off-screen marker stands while its neighbour's drawn box is off screen. So
a zoom out removes the markers, and the nodes they stood for show instead. A zoom in raises
markers for the neighbours the zoom pushed off screen. A pan away raises them for the
neighbours left behind. The off-screen marker is the only mark on the map the camera still
controls.

So the off-screen markers can leave the screen too. They stand on the circles around the
selected node. A pan that moves the selected node off the edge takes them along. Then neither
the markers nor the neighbours they stand for are visible. Nothing is lost.
**Go to selected** brings the whole picture back. A click on any node still on screen selects
that node instead.

The camera decides because nothing else can. A neighbour's distance from the selected node is
fixed when the neighbour is placed. Whether the reader can see it changes with every zoom and
every pan. Only the camera knows the second fact.

The rule reads the canvas, and the canvas differs a little from what the reader sees. The side
panel covers part of it while it is open. The guide covers part of it while it is open
([0041](../decisions/0041-the-controls-come-off-the-map.md)). A neighbour under either counts as
on screen and gets no off-screen marker. It is as hidden as one that left the screen.

The rule tests the drawn box and ignores the placed position, because a neighbour is drawn as
its name. A neighbour placed just past the edge still shows half its label. An off-screen marker
for it would show the same name twice. The marker comes down as soon as any part of the
neighbour shows. It goes up only once the neighbour is clear of the edge by a margin. The gap
between the two tests is a hysteresis margin. With it, a small pan and the pan back raise and
lower nothing.

An off-screen marker exists only in the renderer. It is never in `World` or in `Occupancy`, and
it takes up no space there. That keeps `nearestTo` from returning one and making a marker the
selected node. Its slot comes from `slotsAround` ([world.ts](../../web/src/world.ts)). That
function offers gaps first. With no gap, it offers a position on the circle anyway. A full
region is where an off-screen marker is most useful. The slots are computed once per visit and
kept for that visit. `freeSpots` spreads what it is given evenly. A second call for a different
number would move the markers already standing. Nothing on this map moves except an off-screen
marker during a camera move.

A neighbour claims a slot only when it needs one at the time, and never gives it back. So the
claim follows the camera, and the position stays fixed. `slotsFor`
([map-view.ts](../../web/src/map-view.ts)) explains in a comment how a permanent claim can follow
what the reader sees. The claim moves no off-screen marker already standing.

A long edge has a stub at the selected node's end. The off-screen marker replaces that stub. The
stub at the far end stays, because it belongs to the other node. An edge short enough to draw
also stays, and its line runs off the edge of the screen. The line shows which way the neighbour
lies. An off-screen marker cannot show that. So the marker's own edge is dashed, to keep the two
marks apart. The renderer raises and lowers markers when the camera is idle, never per frame. It
also does so once at boot, for a window too small to hold the root's neighbours.

The number of markers that can stand is what the circles have room for. No constant sets it.
`boxesAround` ([placement.ts](../../web/src/placement.ts)) divides a circle's circumference by
the widest name in the plan. A neighbourhood wider than one circle uses the next one out. The
outer limit is half the viewport's smaller span. It is measured once, when the visit began, and
*from the selected node* instead of from the frame. The two agree while the selected node is at
the middle of the screen. The limit was set for that case, because nobody can click an
off-screen marker that is itself off screen. The two differ when a click selects a node at its
current position ([ADR 0033](../decisions/0033-a-click-takes-no-camera.md)). A selected node
near an edge then plans off-screen markers outside the frame. **Go to selected** brings them
within reach on the next visit only. `slotsFor` rebuilds the plan when the selected node
changes. A camera move leaves the plan as it is. The plan holds no two slots that `touches`
reports as touching. A name half under another name is still readable. An off-screen marker
half under another one can no longer be clicked.

A constant could not stay true. Every input to that division changes: the type, the plan and the
viewport. A number fixed for one circle stops matching the next, and nothing reports the gap.
Off-screen markers just stop appearing.
[ADR 0027](../decisions/0027-a-ring-holds-what-it-holds.md) records why the code measures this
number and declares no constant.

On a hub at close zoom, the circles still run out of slots. So the order of the offer decides
which neighbours get one. Neighbours with no drawn line come first. A neighbour reached by two
stubs has almost nothing pointing at it. One with a drawn line at least shows a direction. Then
the nearest come first. That puts the markers on neighbours close enough to be worth walking to.

## The camera move

A click on an off-screen marker runs `moveToMarker` ([map-view.ts](../../web/src/map-view.ts)):

1. The read for the destination starts at once, before anything moves.
2. The selected node is pinned. No other node can become selected while a marker is moving.
3. The camera and the marker move together. The duration depends on how far the move looks on
   screen.
4. When the move ends, the destination becomes the selected node, and the node replaces the
   marker.

Steps 2 and 4 break if changed. Suppose a marker is removed when its node stops being selected.
Then nothing is under the cursor by the second frame. Suppose the destination is selected before
the move ends. Then the map shows you at a place you have not reached.

A camera move out and a move back have the same geometry. They differ in what is known. The
motion is mirrored. The clicked marker is the one that moves. The way back covers the same
distance as the way out. The node being left loses its tier, and an off-screen marker for it
stands near the new selected node. The difference is the destination. On the way out, it is an
unlabelled disc whose neighbours may not be placed. So its neighbours have to be read. On the
way back, every node is placed and nothing is read. Step 1 exists for that difference. It uses
the move out, which is otherwise idle time. The move back needs no read.

## Invariants

**Nothing moves except an off-screen marker, and only during a camera move.** `autolock` is off
for exactly that long. Fixed positions rely on `World` having no method that moves a node. See
the invariants in [architecture.md](architecture.md).

**A neighbour is never dropped for lack of room.** A neighbour with no free spot is kept and
retried at a tighter separation. So "no room" describes the present and loses nothing. Lack of
room is the only reason a neighbour is not drawn, and it is temporary.

**An off-screen marker is never a node.** It is hollow, dashed and never placed. It goes when
another node is selected. It is never on screen at the same time as the node it stands for.

## Where the numbers are

Each number is written once, beside the code that reads it.
[placement.ts](../../web/src/placement.ts) holds the separations, the circle geometry and the
long-edge threshold. [map-view.ts](../../web/src/map-view.ts) holds the camera move speed and
its clamps, and the margin a neighbour must clear the screen by. It also holds the label box
inset and type. It holds the `z-index` ranges for neighbours, off-screen markers and the node
under the pointer. [main.ts](../../web/src/main.ts) holds the idle delays, the keyboard pan step
and the walk-by-pan hysteresis margin. Each one carries the reason for its value in a comment.
A copy here would be the copy that goes stale. The one stored key is in
[settings.ts](../../web/src/settings.ts), beside the guard that reads it.

## Records behind it

| Record | What it decided |
|---|---|
| [0004](../decisions/0004-the-centre-and-its-neighbourhood.md) | That the selected node shows every neighbour, and what an off-screen marker is |
| [0012](../decisions/0012-the-name-is-the-node.md) | The label box, and which nodes get one instead of a disc |
| [0025](../decisions/0025-when-an-off-screen-marker-stands.md) | The camera, and not the placed position, as what raises an off-screen marker |
| [0027](../decisions/0027-a-ring-holds-what-it-holds.md) | How many off-screen markers a circle offers, and that the number is measured |
| [0048](../decisions/0048-a-long-name-is-cut-to-fit.md) | How a long name is cut, and what opens it |
| [0043](../decisions/0043-off-screen-becomes-an-angle.md) | Off screen as an angle from the middle, once the map draws on a sphere |
| [0006](../decisions/0006-only-the-centre-reads.md) | That the map draws the selected node's neighbours, and reads a hop past them |
| [0032](../decisions/0032-the-centre-is-named.md) | What changes the selected node, and what it costs to let the camera change it |
| [0033](../decisions/0033-a-click-takes-no-camera.md) | That a click selects a node in place, and what that costs the off-screen markers |
| [0003](../decisions/0003-graph-exploration-demo-stack.md) | One fixed position per node, and a camera panned over it |
