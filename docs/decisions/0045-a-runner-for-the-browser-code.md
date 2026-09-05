# 0045 — A runner for the browser code

**Status:** 🔵 Proposed
**Date:** 2026-09-05
**Deciders:** David HL

## Context
`npm test` runs a typecheck and two documentation gates. None of them executes a line of
[web/src/](../../web/src/). [ADR 0034](0034-what-reading-cannot-check.md) settled the drive
scripts as tools somebody runs by hand. Nothing automated runs one. It left the rest of
the browser code checked by reading alone.

An earlier branch answered this with `node --test`. It rejected Vitest as a toolchain in
place of two flags. Two things have changed since. The graph moved into IndexedDB
([ADR 0030](0030-the-graph-moves-into-the-browser.md)), so the store can be tested without
a server. Vite is a dependency, so Vitest costs less than the TypeScript loader
`node --test` needs on the Node 20 floor.

## Decision
Vitest over `test/`, pinned to version 4, in `npm test` and in CI.

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| The runner | Vitest 4 | Reuses the installed Vite: 6 MB, against 11 MB for `tsx`. |
| The version | `^4`, not 5 | Vitest 5 drops Node 20, which `engines` and CI still name. |
| The document | happy-dom | A stub recording `focus()` cannot say where the caret went. |
| The store | fake-indexeddb | Exercises db.ts instead of replacing it. 680 KB. |
| What is covered | Pure functions, the store, two widgets | The canvas is out. See below. |
| Where it runs | `npm test`, and CI | A contributor cannot skip what the one command runs. |

## Alternatives considered
- **`node --test` with `tsx`.** What the earlier branch chose. Node 20.19 cannot strip
  types, so it buys a TypeScript loader and a second toolchain beside Vite's own.
- **Vitest 5.** Its `engines` are `^22.12 || ^24 || >=26`. Taking it means dropping the
  Node 20 leg of the CI matrix.
- **jsdom.** The reference implementation, at several times the dependency tree, for
  fidelity past what these tests reach.
- **Vitest browser mode.** It proves Chrome agrees, which no runner can. It needs
  Playwright, and ADR 0034 refused that price twice.

## Consequences
250 tests run in two seconds. The store's transaction rules are under test for the first
time, and writing them found a fault: `readExport(null)` threw where a fault list was
wanted.

The cost is 27 MB of devDependencies and a document that is not a browser. Nothing here
proves Chrome agrees with happy-dom past the events these tests fire. A green suite can
therefore sit on a page that does not work. The canvas keeps that gap whole. happy-dom
ships no 2D context, so [globe-view.ts](../../web/src/globe-view.ts) is still read by the
drive scripts alone.

## Assumptions and unknowns
- **Assumed happy-dom moves focus the way a browser does.** Wrong, and the suite passes
  while the page fails. Driving Chrome by hand is what tells the difference.
- **Assumed Node 20.19 runs Vitest 4.** Its `engines` say so. Nothing has held that
  runtime to it yet.
- Unknown whether the pure tests catch anything a reader would not have.
- Unknown how much of the map's behaviour a test could reach without a canvas.

## Revisit when
- A test passes while the same gesture is broken in Chrome.
- Node 20 leaves the CI matrix, which frees the pin on Vitest 4.
- The map's drawing needs a check nobody has to remember to run.
- Playwright becomes a dependency for another reason.
