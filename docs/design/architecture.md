# Architecture

This page names the parts, the direction they depend in, and what must not break. The file
tree is in the [README](../../README.md). This page is the shape behind it.

## Layers

Dependencies run one way. Nothing on the right imports anything to its left.

```
web/src  ──>  web/src/store  ──>  IndexedDB
```

| Layer | Owns | Must not |
|---|---|---|
| `web/src/store` | The schema, every read and write, components, the file formats | Touch the DOM or the renderer |
| `web/src` | The map: placement, camera, renderer, palette | Open a database |

Three layers went when the graph moved into the browser
([0030](../decisions/0030-the-graph-moves-into-the-browser.md)). They were a Node data layer, a
graph layer and an HTTP server. There is one process now. Every page reads through
[store/index.ts](../../web/src/store/index.ts). It has the same eleven functions the wire shape
had, with store calls in their bodies instead of `fetch`.

The rule repeats inside `web/src`. [placement.ts](../../web/src/placement.ts),
[projection.ts](../../web/src/projection.ts) and [world.ts](../../web/src/world.ts) compute
geometry and hold state with no renderer present.
[palette.ts](../../web/src/palette.ts) is the sole authority on colour. The page calls
[map.ts](../../web/src/map.ts), and never a renderer by name.

Two renderers sit behind `map.ts` while
[ADR 0042](../decisions/0042-the-map-draws-on-a-sphere.md) is being built.
[map-view.ts](../../web/src/map-view.ts) is the only file that knows Cytoscape exists.
[sphere-view.ts](../../web/src/sphere-view.ts) draws the projected surface on a canvas of its
own. `map.ts` also holds the numbers both renderers must share. These are the off-screen marker
margin, the label box geometry and the camera move timings.

## Two stores

One database, two object stores, three indexes
([db.ts](../../web/src/store/db.ts)). Four item kinds collapsed into two records:

```
nodes   keyed by labelKey    { label, degree, parent, componentSize?, created }
        byComponent  ["componentSize", "labelKey"]   sparse — roots only
        byParent     "parent"                        who points here
edges   keyed by [a, b]      { ends }
        byEnd     "ends"     multiEntry        either end reaches the record
```

`keyPath` names the property a key is read out of. So `labelKey` is the key *and* an ordinary
property, in one field. `edges` uses an array key path, which is IndexedDB's composite key. The
engine validates nothing else about a record. Key uniqueness and a unique index are its only
constraints, so the interfaces in `db.ts` carry the rest.

There is no third store for the boot node. It is the first row of the component page, which
boot already reads. It used to live on a singleton item that every write contended on.

## The reads

Every read is a key, a key range, or an index range. Nothing scans.

```
edges.byEnd     range on one name       every edge at a node, from either end
nodes.get       one key per neighbour   labels and true degrees
nodes.byComponent  descending cursor    one entry per component, largest first
nodes           bound key range         every name starting with a prefix
```

All four are in [read.ts](../../web/src/store/read.ts). A fifth shape would be a new access
pattern. That is a schema question rather than a repository one.

Whole-graph work is the exception and lives apart, in
[store/transfer.ts](../../web/src/store/transfer.ts). It reads everything out, writes a whole
graph in, and checks one. Each of those holds the whole graph in memory.
[storing-a-graph.md](../requirements/storing-a-graph.md) says what that costs at the ceiling.

## A transaction is the whole rule

IndexedDB gives serialisable isolation for overlapping scopes. So a read-then-write inside one
transaction is safe without a condition on it. Three rules used to be conditions: a name not
already claimed, an edge not already there, a degree not going below zero. Each is now a check
at the point it matters, and it throws the sentence it means.

The cost is a trap the old stack did not have. **A transaction commits the moment the
microtask queue drains with no request pending.** So nothing inside one may await a promise
that is not an IDB request. No timer, no network call, no promise from elsewhere. Nobody sees
it until it fails, so `db.ts` states it as well as this page.

## Invariants

Break one of these and the map shows false data, beyond looking wrong.

**A node is placed once.** `World` exposes no method that moves a node. The guarantee rests on
that missing method, and the renderer plays no part. Drawing only adds. So a reply that arrives
mid-gesture cannot disturb what is on screen.

**The map draws the selected node's neighbourhood, and reads it when the camera arrives.**
Camera movement starts no read, so panning never waits. A gesture that crosses six nodes draws the
one it stops on. The neighbours are read when the camera gets there. They used to be read a hop
ahead and held. That saved a round trip that no longer exists. A local read is an index range,
so a cache in front of the store would be a cache in front of a cache.

**A node is claimed before its read starts**, so two idle events cannot read it twice. The claim
is released if that read fails. A node marked as read while missing some of its neighbours
makes the map show false data.

**Degree comes from the node's own record**, never counted from the edges that were read. A
neighbourhood read stops at a ceiling ([read.ts](../../web/src/store/read.ts)). So a count
taken from edges would silently understate a hub. Degree is stored rather than derived because
it is on the hot path. `World.missing` reads every neighbour's degree to decide whether a node
has more edges to load. Deriving it would turn one read of a hub into a range count per
neighbour. That count would run on the main thread each time the camera goes idle.
**Check the graph** tests the invariant: it compares every stored degree against the edges
themselves.

**A node's date is written once and never changed.** `created` is milliseconds. `createNode`
sets it, and so do the file paths that build a whole graph. A rename carries it across, because
a renamed node is the same node. No index covers it, so anything ordering by date sorts in
memory ([0044](../decisions/0044-the-node-record-carries-a-date.md)).

**A node's `label` is the spelling of its own key.** One helper mints the pair
([keys.ts](../../web/src/store/keys.ts)), and nothing else writes either field. A record whose
label does not normalise to its key is found under a name it does not display. An imported
file is where such a record would come from.

**A write is one transaction, and nothing sits above it.** Create, join, part and delete are in
[write.ts](../../web/src/store/write.ts), and the page calls them directly. There is no layer
left between the gesture and the record.

That holds of the *graph*, and holds of a merge now: `merge` runs inside the write. A split
does not. A split walks, so it runs after the transaction and is allowed to fail.

**A root is a component, and the component index can list too many, never too few.** Every
node carries a `parent`. A node pointing at itself is a root. Only a root carries
`componentSize`, and that keeps every other node out of `byComponent`
([components.ts](../../web/src/store/components.ts)). A recount that fails to save leaves two
entries for one component, which costs a wasted trip. **Recount the components** runs the full
recount that repairs it. It compares the grouping, and ignores the pointers. Union order
decides which node names a component. So a check that wanted one answer would report a change
after every join.

**A drawn edge raises both degrees, and a parted one lowers them.** `missing` is degree minus
the edges loaded. Linking without [`bumpDegree`](../../web/src/world.ts) on both ends makes a
node with more edges to load report that it is finished. Unlinking without `lowerDegree` makes
a finished node claim edges that are gone. Neither is ever called alone.

**A node is deleted only once nothing is joined to it.** `World.forget` and the store's delete
both refuse otherwise. The store's reason changed. An edge is one record now, so no half edge
can be left behind. The refusal stays because readers can see it and the panel's undo is built
on it.

## What measures them

No part of `npm test` runs a line of `web/src/`. Only a person reading the code checks the
invariants above. The geometric ones are the exception. Three scripts drive the real page in
Chrome and report numbers.

| Command | Drives |
|---|---|
| `npm run drive:map` | Placement, off-screen markers, the camera, the side panel, the guide |
| `npm run drive:join` | The join panel's keyboard |
| `npm run drive:part-edge` | The right-click that parts a pair |

They are measuring tools and do not gate anything. The project does not install Playwright,
so a person runs them. Neither CI nor `npm test` ever will. They do the arithmetic a reader
cannot. They measure slot overlap, the nodes a pan placed, and an off-screen marker drawn
beside the node it stands for. The screenshots left in `.shots/` are a by-product, since
anyone can open the page and look.

Each script seeds its own graph first, because Playwright opens a profile with no graph in it.
[ADR 0034](../decisions/0034-what-reading-cannot-check.md) records what that costs. It also
records why the geometry the scripts re-derive may be a second copy.

## When the store itself fails

`Refused` and `Missing` cover the graph *declining*. They say nothing about a store that
cannot answer. One browser profile creates that category, and a server did not. On the server,
every storage failure was "unreachable", and it was somebody else's data.

`Unavailable` is the third type ([db.ts](../../web/src/store/db.ts)). With it, a page can tell
"that name is taken" from "there is nowhere to put it". It covers an exceeded quota, a
transaction aborted from outside, and a second tab holding the database at another version. It
also covers a browser that stores nothing at all. None of them is a refusal.

A blocked open must always be handled. An unhandled blocked open never resolves, so boot hangs
with no error. That is the worst form a failure can take. So `open()` races the block event
and reports it.

## What each file carries

The code carries no links back to the docs, so this table is the way in. Find the file you are
in. The page column says where its shape is described. Read that page, which says what holds
now in its own words.

The record column gives the history. Open a record when the page has told you the rule. The
record says which options lost, and what nobody knew at the time.

| File | Described in | Records |
|---|---|---|
| [store/db.ts](../../web/src/store/db.ts) | this page, [storing-a-graph.md](../requirements/storing-a-graph.md) | [0030](../decisions/0030-the-graph-moves-into-the-browser.md), [0050](../decisions/0050-the-numbers-come-off-the-guide.md) |
| [store/shapes.ts](../../web/src/store/shapes.ts) | this page | [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/keys.ts](../../web/src/store/keys.ts) | [finding-a-node.md](finding-a-node.md) | [0008](../decisions/0008-finding-a-node-by-name.md), [0012](../decisions/0012-the-name-is-the-node.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/read.ts](../../web/src/store/read.ts) | this page, [the-centre.md](the-centre.md), [the-components.md](the-components.md), [finding-a-node.md](finding-a-node.md) | [0006](../decisions/0006-only-the-centre-reads.md), [0019](../decisions/0019-every-component-has-an-address.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/write.ts](../../web/src/store/write.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) | [0009](../decisions/0009-the-first-write-outside-the-seed.md), [0010](../decisions/0010-writing-to-the-graph-from-the-browser.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/components.ts](../../web/src/store/components.ts) | [the-components.md](the-components.md) | [0019](../decisions/0019-every-component-has-an-address.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/refused.ts](../../web/src/store/refused.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) | [0010](../decisions/0010-writing-to-the-graph-from-the-browser.md) |
| [store/text.ts](../../web/src/store/text.ts) | [a-graph-as-text.md](a-graph-as-text.md) | [0012](../decisions/0012-the-name-is-the-node.md), [0021](../decisions/0021-a-graph-in-a-text-file.md), [0022](../decisions/0022-a-graph-written-back-out.md) |
| [store/load.ts](../../web/src/store/load.ts) | [a-graph-as-text.md](a-graph-as-text.md) | [0009](../decisions/0009-the-first-write-outside-the-seed.md), [0021](../decisions/0021-a-graph-in-a-text-file.md) |
| [store/transfer.ts](../../web/src/store/transfer.ts) | this page, [a-graph-as-text.md](a-graph-as-text.md) | [0018](../decisions/0018-the-graph-outlives-the-seed.md), [0022](../decisions/0022-a-graph-written-back-out.md) |
| [store/generate.ts](../../web/src/store/generate.ts) | [the-generated-graph.md](the-generated-graph.md) | [0003](../decisions/0003-graph-exploration-demo-stack.md) |
| [store/index.ts](../../web/src/store/index.ts) | this page | [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [placement.ts](../../web/src/placement.ts) | [the-centre.md](the-centre.md) | [0003](../decisions/0003-graph-exploration-demo-stack.md), [0027](../decisions/0027-a-ring-holds-what-it-holds.md) |
| [world.ts](../../web/src/world.ts) | this page, [the-centre.md](the-centre.md), [writing-to-the-graph.md](writing-to-the-graph.md) | [0003](../decisions/0003-graph-exploration-demo-stack.md), [0009](../decisions/0009-the-first-write-outside-the-seed.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) |
| [projection.ts](../../web/src/projection.ts) | this page | [0042](../decisions/0042-the-map-draws-on-a-sphere.md), [0043](../decisions/0043-off-screen-becomes-an-angle.md) |
| [map.ts](../../web/src/map.ts) | this page | [0042](../decisions/0042-the-map-draws-on-a-sphere.md) |
| [map-view.ts](../../web/src/map-view.ts) | [the-centre.md](the-centre.md) | [0003](../decisions/0003-graph-exploration-demo-stack.md), [0004](../decisions/0004-the-centre-and-its-neighbourhood.md), [0012](../decisions/0012-the-name-is-the-node.md), [0025](../decisions/0025-when-an-off-screen-marker-stands.md), [0027](../decisions/0027-a-ring-holds-what-it-holds.md) |
| [sphere-view.ts](../../web/src/sphere-view.ts) | this page | [0042](../decisions/0042-the-map-draws-on-a-sphere.md), [0043](../decisions/0043-off-screen-becomes-an-angle.md) |
| [palette.ts](../../web/src/palette.ts) | this page, [the-centre.md](the-centre.md) | [0012](../decisions/0012-the-name-is-the-node.md) |
| [settings.ts](../../web/src/settings.ts) | this page, [the-centre.md](the-centre.md) | [0032](../decisions/0032-the-centre-is-named.md) |
| [explore.ts](../../web/src/explore.ts) | this page, [the-centre.md](the-centre.md) | [0006](../decisions/0006-only-the-centre-reads.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [main.ts](../../web/src/main.ts) | [the-centre.md](the-centre.md), [writing-to-the-graph.md](writing-to-the-graph.md) | [0003](../decisions/0003-graph-exploration-demo-stack.md), [0006](../decisions/0006-only-the-centre-reads.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md), [0032](../decisions/0032-the-centre-is-named.md), [0033](../decisions/0033-a-click-takes-no-camera.md), [0039](../decisions/0039-any-nodes-name-on-the-clipboard.md), [0049](../decisions/0049-a-click-leaves-the-panel-alone.md) |
| [combobox.ts](../../web/src/combobox.ts) | [finding-a-node.md](finding-a-node.md) | [0013](../decisions/0013-one-box-that-grows-into-an-edge.md), [0028](../decisions/0028-where-a-chained-name-lands.md) |
| [join.ts](../../web/src/join.ts) | [finding-a-node.md](finding-a-node.md), [writing-to-the-graph.md](writing-to-the-graph.md) | [0011](../decisions/0011-taking-a-write-back.md), [0013](../decisions/0013-one-box-that-grows-into-an-edge.md), [0028](../decisions/0028-where-a-chained-name-lands.md), [0049](../decisions/0049-a-click-leaves-the-panel-alone.md) |
| [drag-join.ts](../../web/src/drag-join.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) | [0038](../decisions/0038-a-drag-that-joins-two-nodes.md) |
| [writes.ts](../../web/src/writes.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) | [0011](../decisions/0011-taking-a-write-back.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) |
| [web/src/components-panel.ts](../../web/src/components-panel.ts) | [the-components.md](the-components.md) | [0019](../decisions/0019-every-component-has-an-address.md), [0020](../decisions/0020-the-components-list-is-an-index.md), [0041](../decisions/0041-the-controls-come-off-the-map.md) |
| [transfer.ts](../../web/src/transfer.ts) | [a-graph-as-text.md](a-graph-as-text.md) | [0017](../decisions/0017-the-second-view-goes.md), [0021](../decisions/0021-a-graph-in-a-text-file.md), [0023](../decisions/0023-the-graph-moves-through-the-page.md) |
| [index.html](../../web/index.html) | [finding-a-node.md](finding-a-node.md), [the-components.md](the-components.md), [writing-to-the-graph.md](writing-to-the-graph.md) | [0013](../decisions/0013-one-box-that-grows-into-an-edge.md), [0020](../decisions/0020-the-components-list-is-an-index.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md), [0041](../decisions/0041-the-controls-come-off-the-map.md), [0050](../decisions/0050-the-numbers-come-off-the-guide.md) |
| [transfer.html](../../web/transfer.html) | [a-graph-as-text.md](a-graph-as-text.md) | [0023](../decisions/0023-the-graph-moves-through-the-page.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [app.css](../../web/app.css) | [a-graph-as-text.md](a-graph-as-text.md) | [0017](../decisions/0017-the-second-view-goes.md), [0041](../decisions/0041-the-controls-come-off-the-map.md) |
| [vite.config.ts](../../vite.config.ts) | [a-graph-as-text.md](a-graph-as-text.md) | [0017](../decisions/0017-the-second-view-goes.md), [0023](../decisions/0023-the-graph-moves-through-the-page.md) |
| [docs-gate.py](../../scripts/docs-gate.py) | [checks.md](../checks.md) | [0014](../decisions/0014-binding-the-docs-to-the-code.md) |
| [probe.mjs](../../scripts/probe.mjs) | this page | [0034](../decisions/0034-what-reading-cannot-check.md), [0042](../decisions/0042-the-map-draws-on-a-sphere.md) |
| [drive-map.mjs](../../scripts/drive-map.mjs) | this page, [the-centre.md](the-centre.md) | [0034](../decisions/0034-what-reading-cannot-check.md) |
| [drive-join.mjs](../../scripts/drive-join.mjs) | this page, [finding-a-node.md](finding-a-node.md) | [0034](../decisions/0034-what-reading-cannot-check.md) |
| [drive-part-edge.mjs](../../scripts/drive-part-edge.mjs) | this page, [writing-to-the-graph.md](writing-to-the-graph.md) | [0034](../decisions/0034-what-reading-cannot-check.md) |
| [drive-drag-join.mjs](../../scripts/drive-drag-join.mjs) | this page, [writing-to-the-graph.md](writing-to-the-graph.md) | [0034](../decisions/0034-what-reading-cannot-check.md) |
| [drive-sphere.mjs](../../scripts/drive-sphere.mjs) | this page | [0034](../decisions/0034-what-reading-cannot-check.md), [0042](../decisions/0042-the-map-draws-on-a-sphere.md) |
| [hooks/pre-commit](../../scripts/hooks/pre-commit) | [checks.md](../checks.md), the README's prerequisites | [0015](../decisions/0015-bash-as-the-script-shell.md), [0016](../decisions/0016-the-gates-run-in-ci.md) |
| [ci.yml](../../.github/workflows/ci.yml) | [checks.md](../checks.md) | [0016](../decisions/0016-the-gates-run-in-ci.md) |
| [using-the-demo.md](../using-the-demo.md) | [docs/README.md](../README.md) | [0026](../decisions/0026-a-fourth-kind-of-document.md) |

Two rows stand for more than the file they name.
[0015](../decisions/0015-bash-as-the-script-shell.md) is about the shell every script is
written in. So the whole of `scripts/` carries it, and the row above is only where it shows.
[0026](../decisions/0026-a-fourth-kind-of-document.md) is about this directory rather than
about the code.

Three records appear nowhere above, because no file carries them now:
[0002](../decisions/0002-single-table-layout.md),
[0005](../decisions/0005-a-second-view-that-keeps-no-world.md) and
[0007](../decisions/0007-a-table-for-the-graph.md). 0002 was superseded by 0007 and 0007 by
[0030](../decisions/0030-the-graph-moves-into-the-browser.md); 0005 by
[0017](../decisions/0017-the-second-view-goes.md). They stay on disk as the record of what was
tried.
