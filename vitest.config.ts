import { defineConfig } from "vitest/config"

/**
 * The test runner's own config, separate from vite.config.ts.
 *
 * vite.config.ts sets `root: "web"`, because that is where the two pages are. Vitest would
 * read that root and look for tests under `web/`. The tests live in `test/`, so they need a
 * config with the repo root in it.
 *
 * docs/decisions/0045-a-runner-for-the-browser-code.md is why Vitest rather than
 * `node --test`, and why the major is pinned.
 *
 * Two projects, split by filename. Most of these tests are pure functions and pay nothing
 * for a document they never touch. The widgets need one, and they say so by being named
 * `*.dom.test.ts`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "pure",
          include: ["test/**/*.test.ts"],
          exclude: ["**/node_modules/**", "test/**/*.dom.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "dom",
          include: ["test/**/*.dom.test.ts"],
          environment: "happy-dom",
        },
      },
    ],
  },
})
