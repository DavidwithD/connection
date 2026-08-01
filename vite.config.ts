import { defineConfig } from "vite"

/**
 * The demo page lives in `web/` and talks to the Hono API in `src/server/`.
 *
 * Dev proxies `/api` rather than enabling CORS, so the browser sees a single origin
 * and the API needs no knowledge of the page's host.
 */
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
  },
})
