import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

/**
 * `web/index.html` is the map — pan an accumulating world. `web/transfer.html` is where a
 * graph arrives as a file and leaves as one. Both talk to the Hono API in `src/server/`, and
 * the second draws nothing.
 *
 * Dev proxies `/api` rather than enabling CORS, so the browser sees a single origin and
 * the API needs no knowledge of the page's host.
 */
const page = (name: string): string =>
  fileURLToPath(new URL(`web/${name}.html`, import.meta.url))

export default defineConfig({
  root: "web",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env["PORT"] ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      // Named rather than left to default, so each bundle carries its page's own name.
      input: { map: page("index"), transfer: page("transfer") },
    },
  },
})
