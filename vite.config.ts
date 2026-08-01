import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

/**
 * Two demo pages live in `web/` and talk to the same Hono API in `src/server/`.
 *
 *   index.html    the map — pan an accumulating world  (ADR 0003, ADR 0004)
 *   orbit.html    one node and its ring at a time      (ADR 0005)
 *
 * Dev proxies `/api` rather than enabling CORS, so the browser sees a single origin
 * and the API needs no knowledge of the page's host. Dev serves both pages with no
 * further configuration; only the build has to be told the second entry exists.
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
      input: { map: page("index"), orbit: page("orbit") },
    },
  },
})
