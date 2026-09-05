# Architecture

What the parts are, which way they depend, and what must not break. The file tree is in the
[README](../../README.md); this is the shape behind it.

## Layers

Dependencies run one way. Nothing on the right imports anything to its left.

```
web/src  ──>  web/src/store  ──>  IndexedDB
```

| Layer | Owns | Must not |
|---|---|---|
| `web/src/store` | The schema, every read and write, components, the file formats | Touch the DOM or the renderer |
| `web/src` | The map: seating, camera, renderer, palette | Open a database |

Three layers went when the graph moved into the browser
([0030](../decisions/0030-the-graph-moves-into-the-browser.md)): a Node data layer, a graph
layer and an HTTP server. There is one process now, and the seam every page reads through is
[store/index.ts](../../web/src/store/index.ts) — the same eleven functions the wire shape had,
with store calls in their bodies instead of `fetch`.

The rule repeats inside `web/src`. [placement.ts](../../web/src/placement.ts),
[projection.ts](../../web/src/projection.ts) and [world.ts](../../web/src/world.ts) compute
geometry and hold state with no renderer present, and
[palette.ts](../../web/src/palette.ts) is the sole authority on colour. The page calls
[map.ts](../../web/src/map.ts), and never a renderer by name.

Two renderers stand behind that surface while
[ADR 0042](../decisions/0042-the-map-draws-on-a-sphere.md) is being built.
[map-view.ts](../../web/src/map-view.ts) is the only file that knows Cytoscape exists.
[globe-view.ts](../../web/src/globe-view.ts) draws the projected surface on a canvas of its
own. `map.ts` also holds the numbers the two have to draw alike — the doorway margin, the pill
geometry, the flight timings.

## Two stores

One database, two object stores, three indexes
([db.ts](../../web/src/store/db.ts)). Four item kinds collapsed into two records:

```
nodes   keyed by labelKey    { label, degree, parent, islandSize?, created }
        byIsland  ["islandSize", "labelKey"]   sparse — roots only
        byParent  "parent"                     who points here
edges   keyed by [a, b]      { ends }
        byEnd     "ends"     multiEntry        either end reaches the record
```

`keyPath` names the property a key is read out of, so `labelKey` is the key *and* an ordinary
property rather than two things. `edges` uses an array key path, which is IndexedDB's
composite key. Nothing else about a record is validated: key uniqueness and a unique index are
the only constraints the engine enforces, so the interfaces in `db.ts` carry the rest.

There is no third store for the graph's totals. The counts are memoised in the module and
seeded by one scan when the database opens; the boot node is the first row of the island page,
which boot already reads. Both used to live on a singleton item that every write contended on.

## The reads

Every read is a key, a key range, or an index range. Nothing scans.

```
edges.byEnd     range on one name       every edge at a node, from either end
nodes.get       one key per neighbour   labels and true degrees
nodes.byIsland  descending cursor       one entry per component, largest first
nodes           bound key range         every name starting with a prefix
```

All four are in [read.ts](../../web/src/store/read.ts). A fifth shape would be a new access
pattern, which is a schema question rather than a repository one.

Whole-graph work is the exception and lives apart, in
[store/transfer.ts](../../web/src/store/transfer.ts): reading everything out, writing a whole
graph in, and checking one. Each of those materialises the graph in memory, and
[storing-a-graph.md](../requirements/storing-a-graph.md) says what that costs at the ceiling.

## A transaction is the whole rule

IndexedDB gives serialisable isolation for overlapping scopes, so a read-then-write inside one
transaction is safe without a condition on it. Every rule that used to be a condition — a name
not already claimed, an edge not already there, a degree not going below zero — is now a check
at the point it matters, throwing the sentence it means.

The cost is a footgun with no counterpart in the old stack. **A transaction commits the moment
the microtask queue drains with no request pending**, so nothing inside one may await a
promise that is not an IDB request. No timer, no network call, no promise from elsewhere. It
is invisible until it fails, which is why it is said in `db.ts` as well as here.

## Invariants

Break one of these and the map lies, rather than merely looking wrong.

**A node is seated once.** `World` exposes no method that moves a node, so the guarantee rests
on that absence and not on the renderer declining. Drawing is additive only, which is why a
reply landing mid-gesture cannot disturb what is on screen.

**Drawing is the centre's neighbourhood, and reading happens on arrival.** Movement triggers
nothing, so panning never waits, and a gesture crossing six nodes draws the one it stops on.
The ring is read when the camera gets there. It used to be read a hop ahead and held unspent,
which was buying a round trip that no longer exists — a local read is an index range, so
keeping a cache in front of the store would be keeping a cache in front of a cache.

**A node is claimed before its read starts**, so two settles cannot double-read it — and the
claim comes back if that read fails, because a node marked as read while short of its own
neighbours is a map that lies.

**Degree comes from the node's own record**, never counted from the edges that were read. A
neighbourhood read stops at a ceiling ([read.ts](../../web/src/store/read.ts)), so a count
taken from edges would silently understate a hub. It stays denormalised rather than derived
because it is on the hot path: every neighbour's degree is what `World.missing` reads to decide
whether there is more graph behind a node, so deriving it would turn one read of a hub into a
range count per neighbour, on the main thread, on every settle. The invariant is checked rather
than assumed — **Check the graph** compares every stored degree against the edges themselves.

**A node's date is written once and never changed.** `created` is milliseconds, set by
`createNode` and by the file paths that build a whole graph. A rename carries it across,
because a renamed node is the same node. No index covers it, so anything ordering by date
sorts in memory ([0044](../decisions/0044-the-node-record-carries-a-date.md)).

**A node's `label` is the spelling of its own key.** One helper mints the pair
([keys.ts](../../web/src/store/keys.ts)) and nothing else writes either field. A record whose
label does not normalise to its key is a node found under a name it does not display, and an
imported file is where that would arrive.

**A write is one transaction, and nothing sits above it.** Create, join, part and delete are
[write.ts](../../web/src/store/write.ts), called directly by the page. There is no layer left
between the gesture and the record.

That holds of the *graph*, and holds of a merge now: `settle` runs inside the write. A split
does not — it walks, so it runs after the transaction and is allowed to fail.

**A root is a component, and the island index over-lists rather than under-lists.** Every node
carries a `parent`; a node pointing at itself is a root, and only a root carries `islandSize`,
which is what keeps it out of `byIsland` otherwise
([islands.ts](../../web/src/store/islands.ts)). A recount that does not land leaves two
addresses for one island, which costs a wasted trip. **Recount the islands** is the reckoning
that repairs it, and it compares the grouping rather than the pointers — union order decides
which node names a component, so insisting on one answer would report drift after every join.

**A drawn edge raises both degrees, and a parted one lowers them.** `missing` is degree minus
the edges loaded, so linking without [`bumpDegree`](../../web/src/world.ts) on both ends makes
a node with more graph behind it report that it is finished, and unlinking without
`lowerDegree` makes a finished one claim graph that is gone. Neither is ever called alone.

**A node leaves only once nothing is joined to it.** `World.forget` and the store's delete both
refuse otherwise. The store's reason changed — an edge is one record now, so there is no orphan
half to strand — but the refusal is reader-visible and the panel's undo is built on it.

## What measures them

No part of `npm test` runs a line of `web/src/`. A person reading the code is all that holds
the invariants above. The geometric ones are the exception: three scripts drive the real page
in Chrome and report numbers.

| Command | Drives |
|---|---|
| `npm run drive:map` | Seating, ghosts, the camera, the island drawer, the guide |
| `npm run drive:join` | The join panel's keyboard |
| `npm run drive:part-edge` | The right-click that parts a pair |

They are instruments rather than gates. Playwright is not a dependency, so a person runs them,
and neither CI nor `npm test` ever will. They do the arithmetic a reader cannot: slot overlap,
the nodes a pan seated, and a ghost drawn beside the node it stands in for. The screenshots
left in `.shots/` are a by-product, since anyone can open the page and look.

Each seeds its own graph first, because Playwright opens a profile with none in it. What that
costs, and why the geometry they re-derive is allowed to be a second copy, is
[ADR 0034](../decisions/0034-what-reading-cannot-check.md).

## When the store itself fails

`Refused` and `Missing` cover the graph *declining*. They say nothing about the store being
unable to answer, which is a category one browser profile creates and a server did not: there,
every storage failure was "unreachable", and it was somebody else's data.

`Unavailable` is the third type ([db.ts](../../web/src/store/db.ts)), so a page can tell "that
name is taken" from "there is nowhere to put it". It carries the quota being exceeded, a
transaction aborted from outside, a second tab holding the database at another version, and a
browser that will not store anything at all. None of them is a refusal.

The one that must not be left unhandled is a blocked open. Unhandled it never settles, so boot
hangs with no error — the worst shape a failure can take — which is why `open()` races the
block event and reports it.

## What each file carries

The code carries no pointers back, so this is the route in. Find the file you are in, and the
page column says where its shape is described. Read that page: it says what holds now, in its
own words.

The record column is provenance. Open one when the page has told you what the rule is and you
want to know what it beat, or what nobody knew at the time.

| File | Described in | Records |
|---|---|---|
| [store/db.ts](../../web/src/store/db.ts) | this page, [storing-a-graph.md](../requirements/storing-a-graph.md) | [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/shapes.ts](../../web/src/store/shapes.ts) | this page | [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/keys.ts](../../web/src/store/keys.ts) | [finding-a-node.md](finding-a-node.md) | [0008](../decisions/0008-finding-a-node-by-name.md), [0012](../decisions/0012-the-name-is-the-node.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/read.ts](../../web/src/store/read.ts) | this page, [the-centre.md](the-centre.md), [the-islands.md](the-islands.md), [finding-a-node.md](finding-a-node.md) | [0006](../decisions/0006-only-the-centre-reads.md), [0019](../decisions/0019-every-island-has-an-address.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/write.ts](../../web/src/store/write.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) | [0009](../decisions/0009-the-first-write-outside-the-seed.md), [0010](../decisions/0010-writing-to-the-graph-from-the-browser.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [store/islands.ts](../../web/src/store/islands.ts) | [the-islands.md](the-islands.md) | [0019](../decisions/0019-every-island-has-an-address.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
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
| [map-view.ts](../../web/src/map-view.ts) | [the-centre.md](the-centre.md) | [0003](../decisions/0003-graph-exploration-demo-stack.md), [0004](../decisions/0004-the-centre-and-its-neighbourhood.md), [0012](../decisions/0012-the-name-is-the-node.md), [0025](../decisions/0025-when-a-ghost-stands.md), [0027](../decisions/0027-a-ring-holds-what-it-holds.md) |
| [globe-view.ts](../../web/src/globe-view.ts) | this page | [0042](../decisions/0042-the-map-draws-on-a-sphere.md), [0043](../decisions/0043-off-screen-becomes-an-angle.md) |
| [palette.ts](../../web/src/palette.ts) | this page, [the-centre.md](the-centre.md) | [0012](../decisions/0012-the-name-is-the-node.md) |
| [settings.ts](../../web/src/settings.ts) | this page, [the-centre.md](the-centre.md) | [0032](../decisions/0032-the-centre-is-named.md) |
| [explore.ts](../../web/src/explore.ts) | this page, [the-centre.md](the-centre.md) | [0006](../decisions/0006-only-the-centre-reads.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [main.ts](../../web/src/main.ts) | [the-centre.md](the-centre.md), [writing-to-the-graph.md](writing-to-the-graph.md) | [0003](../decisions/0003-graph-exploration-demo-stack.md), [0006](../decisions/0006-only-the-centre-reads.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md), [0032](../decisions/0032-the-centre-is-named.md), [0033](../decisions/0033-a-click-takes-no-camera.md), [0036](../decisions/0036-a-click-that-writes-nothing.md), [0039](../decisions/0039-any-nodes-name-on-the-clipboard.md) |
| [combobox.ts](../../web/src/combobox.ts) | [finding-a-node.md](finding-a-node.md) | [0013](../decisions/0013-one-box-that-grows-into-an-edge.md), [0028](../decisions/0028-where-a-chained-name-lands.md) |
| [join.ts](../../web/src/join.ts) | [finding-a-node.md](finding-a-node.md), [writing-to-the-graph.md](writing-to-the-graph.md) | [0011](../decisions/0011-taking-a-write-back.md), [0013](../decisions/0013-one-box-that-grows-into-an-edge.md), [0028](../decisions/0028-where-a-chained-name-lands.md), [0036](../decisions/0036-a-click-that-writes-nothing.md) |
| [drag-join.ts](../../web/src/drag-join.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) | [0038](../decisions/0038-a-drag-that-joins-two-nodes.md) |
| [writes.ts](../../web/src/writes.ts) | [writing-to-the-graph.md](writing-to-the-graph.md) | [0011](../decisions/0011-taking-a-write-back.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md) |
| [web/src/islands.ts](../../web/src/islands.ts) | [the-islands.md](the-islands.md) | [0019](../decisions/0019-every-island-has-an-address.md), [0020](../decisions/0020-the-islands-list-is-an-index.md), [0041](../decisions/0041-the-chrome-comes-off-the-map.md) |
| [transfer.ts](../../web/src/transfer.ts) | [a-graph-as-text.md](a-graph-as-text.md) | [0017](../decisions/0017-the-second-view-goes.md), [0021](../decisions/0021-a-graph-in-a-text-file.md), [0023](../decisions/0023-the-graph-moves-through-the-page.md) |
| [index.html](../../web/index.html) | [finding-a-node.md](finding-a-node.md), [the-islands.md](the-islands.md), [writing-to-the-graph.md](writing-to-the-graph.md) | [0013](../decisions/0013-one-box-that-grows-into-an-edge.md), [0020](../decisions/0020-the-islands-list-is-an-index.md), [0024](../decisions/0024-taking-a-node-out-with-its-edges.md), [0041](../decisions/0041-the-chrome-comes-off-the-map.md) |
| [transfer.html](../../web/transfer.html) | [a-graph-as-text.md](a-graph-as-text.md) | [0023](../decisions/0023-the-graph-moves-through-the-page.md), [0030](../decisions/0030-the-graph-moves-into-the-browser.md) |
| [app.css](../../web/app.css) | [a-graph-as-text.md](a-graph-as-text.md) | [0017](../decisions/0017-the-second-view-goes.md), [0041](../decisions/0041-the-chrome-comes-off-the-map.md) |
| [vite.config.ts](../../vite.config.ts) | [a-graph-as-text.md](a-graph-as-text.md) | [0017](../decisions/0017-the-second-view-goes.md), [0023](../decisions/0023-the-graph-moves-through-the-page.md) |
| [docs-gate.py](../../scripts/docs-gate.py) | [checks.md](../checks.md) | [0014](../decisions/0014-binding-the-docs-to-the-code.md) |
| [probe.mjs](../../scripts/probe.mjs) | this page | [0034](../decisions/0034-what-reading-cannot-check.md), [0042](../decisions/0042-the-map-draws-on-a-sphere.md) |
| [drive-map.mjs](../../scripts/drive-map.mjs) | this page, [the-centre.md](the-centre.md) | [0034](../decisions/0034-what-reading-cannot-check.md) |
| [drive-join.mjs](../../scripts/drive-join.mjs) | this page, [finding-a-node.md](finding-a-node.md) | [0034](../decisions/0034-what-reading-cannot-check.md) |
| [drive-part-edge.mjs](../../scripts/drive-part-edge.mjs) | this page, [writing-to-the-graph.md](writing-to-the-graph.md) | [0034](../decisions/0034-what-reading-cannot-check.md) |
| [drive-drag-join.mjs](../../scripts/drive-drag-join.mjs) | this page, [writing-to-the-graph.md](writing-to-the-graph.md) | [0034](../decisions/0034-what-reading-cannot-check.md) |
| [drive-globe.mjs](../../scripts/drive-globe.mjs) | this page | [0034](../decisions/0034-what-reading-cannot-check.md), [0042](../decisions/0042-the-map-draws-on-a-sphere.md) |
| [hooks/pre-commit](../../scripts/hooks/pre-commit) | [checks.md](../checks.md), the README's prerequisites | [0015](../decisions/0015-bash-as-the-script-shell.md), [0016](../decisions/0016-the-gates-run-in-ci.md) |
| [ci.yml](../../.github/workflows/ci.yml) | [checks.md](../checks.md) | [0016](../decisions/0016-the-gates-run-in-ci.md) |
| [using-the-demo.md](../using-the-demo.md) | [docs/README.md](../README.md) | [0026](../decisions/0026-a-fourth-kind-of-document.md) |

Two rows stand for more than the file they name.
[0015](../decisions/0015-bash-as-the-script-shell.md) is about the shell every script is
written in, so the whole of `scripts/` carries it and the row above is only where it shows.
[0026](../decisions/0026-a-fourth-kind-of-document.md) is about this directory rather than
about the code.

Three records appear nowhere above, because nothing carries them now:
[0002](../decisions/0002-single-table-layout.md),
[0005](../decisions/0005-a-second-view-that-keeps-no-world.md) and
[0007](../decisions/0007-a-table-for-the-graph.md). 0002 was superseded by 0007 and 0007 by
[0030](../decisions/0030-the-graph-moves-into-the-browser.md); 0005 by
[0017](../decisions/0017-the-second-view-goes.md). They stay on disk as the record of what was
tried.
