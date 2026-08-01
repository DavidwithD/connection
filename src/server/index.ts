/**
 * The graph API the demo page talks to. Two routes, both read-only.
 *
 *   GET /api/graph            where to start, and how big the graph is
 *   GET /api/nodes/:id        one node and its neighbours, with their true degrees
 *
 * The client seats new nodes itself, so the server only ever answers "who is next to
 * this?" — one Query plus one BatchGet. Vite proxies /api here in development, so there
 * is one origin and no CORS to configure.
 *
 * See docs/decisions/0003-graph-exploration-demo-stack.md.
 */
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { describeTarget } from "../db/client.js"
import { readIndex, readNeighbourhood } from "../graph/repo.js"

const app = new Hono()

app.get("/api/graph", async (c) => {
  const index = await readIndex()
  if (!index) {
    return c.json({ error: "no graph seeded — run npm run graph:seed" }, 404)
  }
  return c.json(index)
})

app.get("/api/nodes/:id", async (c) => {
  const id = c.req.param("id")

  // An artificial floor on latency. The loading state is part of the demo, and against
  // DynamoDB Local a read returns too fast to ever see one.
  const delay = Number(process.env["GRAPH_API_DELAY_MS"] ?? 120)
  if (delay > 0) await new Promise((r) => setTimeout(r, delay))

  const result = await readNeighbourhood(id)
  if (!result) return c.json({ error: `no such node: ${id}` }, 404)
  return c.json(result)
})

app.onError((err, c) => {
  console.error("✗ request failed:", err)
  return c.json({ error: "internal error" }, 500)
})

const port = Number(process.env["PORT"] ?? 8787)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`→ ${describeTarget()}`)
  console.log(`✓ graph API on http://localhost:${info.port}`)
})
