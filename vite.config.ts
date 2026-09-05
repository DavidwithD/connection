import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

/**
 * `web/index.html` is the map — pan an accumulating world. `web/transfer.html` is where a
 * graph arrives as a file, leaves as one, and is seeded, checked and repaired.
 * `web/nodes.html` is the list: every node at once, searched, ordered and paged. All three
 * read the graph out of the browser's own IndexedDB, so there is nothing behind them: no
 * proxy, no origin to configure, and no second process to start.
 */
const page = (name: string): string =>
  fileURLToPath(new URL(`web/${name}.html`, import.meta.url))

export default defineConfig({
  root: "web",
  server: { port: 5173 },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      // Named rather than left to default, so each bundle carries its page's own name.
      input: { map: page("index"), transfer: page("transfer"), nodes: page("nodes") },
    },
  },
})
