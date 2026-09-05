# connection

> **`connection` is a working placeholder, not a chosen name.** It collides with the
> ordinary noun in prose ("the connection layer") and with plenty of existing products.
> Settling it later means touching the repo directory, the package name, and any
> published domain — so it gets more expensive after the first published artifact.

A graph you pan around like a map, stored in the browser. TypeScript, Vite, Cytoscape, and
the browser's own IndexedDB. No server, no account, and nothing to install but npm packages.

**What this page is for.** Getting the project running, and the reference tables you need
while it is. Everything here is either something you want before you can use the repo at
all — prerequisites, commands — or a table the [docs gate](docs/checks.md) holds the code to,
so that a rename cannot quietly falsify it.

Anything that explains how the thing works, why it works that way, or how to drive it lives
under [docs/](docs/) and is linked from the foot of this page. The test is the reader: this
page is for somebody who has just cloned the repo, and it stops where their questions stop
being about setup.

[![CI](https://github.com/DavidwithD/connection/actions/workflows/ci.yml/badge.svg)](https://github.com/DavidwithD/connection/actions/workflows/ci.yml)

## Prerequisites

| | Why |
|---|---|
| **Node 20.19+ or 22.12+** | Runtime. The floor is Vite's, not ours, and `engines` is held to it by the [docs gate](docs/checks.md) |
| **npm 12** | `packageManager` names it. Only the npm that writes the lock has to agree with the npm that reads it — npm 11.6.2 writes one that CI rejects |
| **A browser with IndexedDB** | Which is every current one, outside a private window. It is where the graph lives — see [ADR 0030](docs/decisions/0030-the-graph-moves-into-the-browser.md) |
| **bash** | npm runs every script through it, so the POSIX ones work on Windows too. Ships with git. See [ADR 0015](docs/decisions/0015-bash-as-the-script-shell.md) |
| **python3** | The two documentation gates. Only needed to run `npm test` |

No AWS account, no credentials, and no database process.

## Getting started

```bash
npm install
npm run web             # all three pages at :5173
```

A fresh browser holds no graph. The map says so and points at
[/transfer.html](web/transfer.html), where **Seed a demo graph** gives you something to walk
around. Driving all three pages is [docs/using-the-demo.md](docs/using-the-demo.md).

## Commands

| Command | Does |
|---|---|
| `npm run web` | The dev server, on `:5173` — all three pages |
| `npm run build` | Bundle all three pages to `dist/web/` |
| `npm run typecheck` | `tsc --noEmit` over `web/src/` and `test/` |
| `npm test` | `typecheck` + `test:unit` + `adr` + `docs` |
| `npm run test:unit` | Run the suite in `test/` — `npx vitest` for watch mode |
| `npm run adr` | Run the decision gate over `docs/decisions/` |
| `npm run docs` | Run the docs gate: the living documents against the code |
| `npm run docs:selftest` | Prove each bound check still compares something — mutates a throwaway copy |
| `npm run prose` | Lint files against the writing rule — `npm run prose -- docs/README.md` |
| `npm run prose:selftest` | Prove each writing check still fires, and still holds off |
| `npm run drive:map` | Drive the map in a real browser and photograph it into `.shots/` |
| `npm run drive:join` | Drive the join panel's keyboard and report what each Enter does |
| `npm run drive:part-edge` | Drive the right-click that parts a pair, and check what the page did |
| `npm run drive:drag-join` | Drive the shift-drag that joins two nodes, and check what it wrote |
| `npm run drive:rename` | Drive the rename, and check the edges and degrees survived it |
| `npm run drive:nodes` | Drive the node list: the controls, the walk into a neighbour, and back |
| `npm run drive:globe` | Drive the globe renderer at `/?globe`, and photograph what it draws |
| `npm run hooks:install` | Install the pre-commit hook that runs both gates on the staged tree |

## Where the graph lives

In the browser profile you opened the page with, and nowhere else.

**Clearing site data destroys it.** A different browser, a different profile or a private
window is a different graph, and the browser may evict it under storage pressure — the page
asks it not to at boot, which is a request rather than a promise.

The **Backup** download on the transfer page is the only backup there is. What that costs,
and why nothing here mitigates it, is
[docs/requirements/storing-a-graph.md](docs/requirements/storing-a-graph.md).

One tab at a time. Two tabs will not corrupt anything, but neither is told when the other
writes, so the second one drifts until you reload it.

## Layout

```
web/
  index.html    the map
  transfer.html a graph out as a file, a file in as a graph, and the whole-graph acts
  nodes.html    the node list: search, dates, order, paging, and the walk into a neighbour
  app.css       the chrome around all three
  nodes.css     the rows, the sublist and the stack of cards
web/src/
  placement.ts  seating geometry + spatial index — pure, no renderer
  projection.ts the surface the map draws on — a screen offset in, a screen offset out
  world.ts      the store: frozen positions, adjacency, degrees
  map.ts        what every renderer holds: calls, events, ids, shared numbers
  map-view.ts   Cytoscape render; additive only, no layout engine
  globe-view.ts canvas render on the projected surface; one frame loop, no library
  explore.ts    what the centre reads once the camera settles
  palette.ts    validated colour tokens, light and dark
  settings.ts   what the reader has asked the page to do, kept in the browser
  combobox.ts   a text box that hands back nodes, not text
  rename-box.ts a name, and one row saying whether the graph has it already
  writes.ts     the line every write stands in, and the receipts it leaves
  join.ts       the panel at the top: two ends, and the writes
  drag-join.ts  the drag that joins two nodes, and the arrow it draws
  islands.ts    the panel down the left: every component, as somewhere to go
  main.ts       wiring, the centre, the panels around it
  nodes.ts      the node list page: what the controls select, and what a click opens
  transfer.ts   the file page, and everything that changes a whole graph
web/src/store/
  db.ts         the schema: two object stores, three indexes, one connection
  shapes.ts     what a caller sees, as opposed to what the store holds
  keys.ts       the normalised name, and the character two of them join with
  refused.ts    the graph declining a write, and the graph having no such node
  read.ts       every read: a key, a key range, or an index range
  write.ts      create, join, part, delete — one transaction each
  islands.ts    which nodes can reach which, as union-find over the graph
  text.ts       the graph as lines of names, read and written
  load.ts       surveys a reading against the store, then adds it
  transfer.ts   a whole graph out, a whole graph in, and the checks over one
  generate.ts   Watts–Strogatz generator (pure, deterministic)
  index.ts      the seam every page reads the graph through
test/
  graph.ts               a graph in memory, for the tests that read and write one
  widgets.ts             the elements the keyboard widgets are built on
  projection.test.ts     the surface the map draws on
  placement.test.ts      seating geometry and the spatial index
  keys.test.ts           the normalised name, and the pair key
  text.test.ts           the text format, read and written
  islands.test.ts        components, derived from a whole graph
  generate.test.ts       the demo graph generator
  write.test.ts          every write, against a real IndexedDB
  read.test.ts           every read, and the island paging
  load.test.ts           a text file against the store
  transfer.test.ts       export, import, check and recount
  combobox.dom.test.ts   the box that returns nodes — needs a document
  rename-box.dom.test.ts the box that renames a node — needs a document
scripts/
  adr-gate.py          the decision gate — shape, budgets, wiring
  docs-gate.py         the docs gate — the living docs against the code
  docs-gate-selftest.py  proves each bound check still compares something
  prose-lint.py        the writing rule, on newly written text, as it is written
  prose-lint-selftest.py  proves each writing check still fires, and still holds off
  probe.mjs            how a drive script asks the map what it drew, and where
  drive-drag-join.mjs  drives the shift-drag that joins two nodes, and checks it
  drive-globe.mjs      drives the globe renderer, and photographs what it draws
  drive-join.mjs       drives the join panel's keyboard, and checks what it keeps
  drive-map.mjs        drives the map in a real browser, for screenshots
  drive-nodes.mjs      drives the node list, its controls and its walk
  drive-part-edge.mjs  drives the right-click that parts a pair, and checks it
  drive-rename.mjs     drives the rename, and checks what the store kept
  hooks/pre-commit     runs both gates on the staged tree
.github/workflows/
  ci.yml               the same gates, where they cannot be skipped
```

## Data model

One database, `connection`, at version 1. Two object stores, and three indexes over them.
[ADR 0030](docs/decisions/0030-the-graph-moves-into-the-browser.md) is why it is here rather
than in a table behind an API.

| Store | Key | Indexes |
|---|---|---|
| `nodes` | `labelKey` — the name, normalised | `byIsland` over `islandSize` + `labelKey`; `byParent` over `parent` |
| `edges` | `a` and `b` together, canonical | `byEnd` over `ends`, `multiEntry` |

`keyPath` names the property a key is read out of, so `labelKey` is the key *and* an ordinary
property rather than two things. `edges` uses an array key path, which is IndexedDB's
composite key — legal because a key may be a number, a string, a date, a buffer, or an array
of those.

An index leaves out any record that does not carry its key path, which is what makes
`byIsland` hold one entry per component rather than one per node: only a root carries
`islandSize`. `byEnd` is `multiEntry`, so one edge record is reachable from either of the two
names in `ends` — which is what a second copy of every edge used to buy.

Nothing else about a record is checked by the engine. Key uniqueness is the only constraint
it enforces, which is why the interfaces in [db.ts](web/src/store/db.ts) carry the rest, and
why **Check the graph** on the transfer page exists.

The full argument — why the name is the key, why `degree` stays denormalised, and what
`multiEntry` settled — is [docs/design/architecture.md](docs/design/architecture.md).

## The graph demo

Three pages: a map you pan around, a list of every node, and a page a graph arrives at as a
file and leaves as one. Seeding one, driving all three, and every gesture that changes a graph
are in **[docs/using-the-demo.md](docs/using-the-demo.md)**.

## Docs

- [docs/](docs/) — the map: every capability across the four kinds of document, and which
  ones get edited rather than appended to
- [Using the demo](docs/using-the-demo.md) — how to drive it: the gestures, the keys, the
  buttons
- [Requirements](docs/requirements/) — no product scope yet, and what the demo has to do
- [Design](docs/design/) — layers, boundaries, and the invariants the code protects
- [Architecture decisions](docs/decisions/) — the "why" behind these choices
- [Checks](docs/checks.md) — what binds the tables and trees on this page to the code, so
  that a rename cannot quietly falsify them
