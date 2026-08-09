/**
 * The graph API the demo page talks to.
 *
 *   GET    /api/graph          where to start, how big the graph is, and its first islands
 *   GET    /api/islands        the islands after a cursor, largest first
 *   GET    /api/nodes/:id      one node and its neighbours, with their true degrees
 *   GET    /api/search?q=      nodes whose name starts with q
 *   POST   /api/nodes          create a node by name
 *   POST   /api/edges          join two nodes by id
 *   DELETE /api/nodes/:id      delete a node, for a create being taken back
 *   DELETE /api/edges?a=&b=    part two nodes, for a join being taken back
 *
 * The client seats new nodes itself, so a read only ever answers "who is next to this?" —
 * one Query plus one BatchGet. Vite proxies /api here in development, so there is one
 * origin and no CORS to configure.
 *
 * The two writes are the same functions the terminal runs, imported rather than
 * reimplemented, so a refusal reads identically from either. Both are thin on purpose:
 * every rule that matters is a condition inside the transaction, and these routes only
 * decide which status number carries it back. A refusal is 409 and not 500 — a taken name
 * or an existing edge is an answer, not a fault.
 *
 * Edges are joined by id, never by label. The browser has already resolved a name to a
 * node through the search box, and resolving it again here would reintroduce exactly the
 * ambiguity that box exists to remove.
 *
 * See docs/decisions/0003-graph-exploration-demo-stack.md and
 * docs/decisions/0010-writing-to-the-graph-from-the-browser.md.
 */
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { GRAPH_TABLE_NAME, describeTarget } from "../db/client.js"
import { addEdge, removeEdge } from "../graph/edge.js"
import { find } from "../graph/islands.js"
import { searchLabels } from "../graph/labels.js"
import { createNode, deleteNode } from "../graph/node.js"
import { Refused } from "../graph/refused.js"
import {
  ISLAND_LIMIT,
  isIslandCursor,
  readIndex,
  readIslandCount,
  readIslandPage,
  readMetas,
  readNeighbourhood,
  type IslandCursor,
} from "../graph/repo.js"

const app = new Hono()

/**
 * Every write, wrapped the same way.
 *
 * A refusal is the graph answering and a 409; anything else is a fault and falls through
 * to the handler at the bottom, which logs it and says nothing else. Having one of these
 * rather than four try/catches is what keeps a route from quietly inventing its own idea
 * of which failures are the caller's fault.
 */
async function write<T>(run: () => Promise<T>): Promise<T | Refused> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof Refused) return err
    throw err
  }
}

/**
 * Where a page of islands stopped, as something a URL can carry.
 *
 * The store's key, opaque on the wire. Base64 rather than the keys spelled out as query
 * parameters, because what DynamoDB needs back is whatever it handed over — the table's keys
 * and the index's, four attributes today — and a client picking those apart would be a client
 * that breaks when the index gains one.
 */
const encodeCursor = (key: IslandCursor | null): string | null =>
  key ? Buffer.from(JSON.stringify(key), "utf8").toString("base64url") : null

/**
 * Null for anything that is not a cursor this served — see the 400 at the route.
 *
 * Decoding is not the whole of it: a value that is base64 of valid JSON can still be an
 * object the index cannot start a Query from, and handing one on unchecked spends the
 * caller's mistake as a fault of the store. Which attributes make a key is the store's own
 * question, so it is asked there.
 */
function decodeCursor(raw: string): IslandCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    return isIslandCursor(parsed) ? parsed : null
  } catch {
    return null
  }
}

app.get("/api/graph", async (c) => {
  // Together, because the page needs all of it to draw its first frame and none of it
  // depends on the rest. The first page of islands rides on this rather than waiting for a
  // call of its own: boot already makes this one, and a second would be a second round trip
  // to the same answer. The pages after it are the route below.
  const [index, first, islandCount] = await Promise.all([
    readIndex(),
    readIslandPage(),
    readIslandCount(),
  ])
  // No index item at all, which is a table nothing has prepared rather than a graph with
  // nothing in it. `graph:init` is the answer either way and takes nothing with it; the
  // seed is named second because it replaces whatever is there.
  if (!index) {
    return c.json(
      { error: "no index item — run npm run graph:init, or npm run graph:seed for a demo one" },
      404,
    )
  }
  // Every component, the one the map starts in included. The page lists them as places
  // rather than as errands, so the ground under the reader's feet belongs on the list —
  // it is the only row that can say where they are standing.
  //
  // Which component that is has to be asked, because the node naming an island is whichever
  // node won its unions and is rarely the best-connected one `rootId` picks. Named rather
  // than filtered out: the page marks it, and answering here costs the same read either way.
  const home = index.rootId ? await find(index.rootId) : null

  return c.json({
    ...index,
    islands: first.islands,
    islandCursor: encodeCursor(first.cursor),
    islandCount,
    homeIslandId: home?.root ?? null,
  })
})

/**
 * The islands after the first page.
 *
 * Its own route because it is the only read here that is asked for by scrolling rather than
 * by arriving: `/api/graph` is one call at boot, and hanging "twenty more" off it would mean
 * re-reading the totals and re-walking to the root's island for every scroll.
 *
 * A bad cursor is a 400 and not a 500. It is a value the caller handed back, so a truncated
 * or edited one is the caller being wrong, and the page can recover by starting again.
 */
app.get("/api/islands", async (c) => {
  const after = c.req.query("after")
  const start = after ? decodeCursor(after) : null
  if (after && !start) return c.json({ error: "bad cursor" }, 400)

  const page = await readIslandPage(ISLAND_LIMIT, start ?? undefined)
  return c.json({ islands: page.islands, cursor: encodeCursor(page.cursor) })
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

app.get("/api/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? ""
  if (!q) return c.json({ error: "q is required" }, 400)

  // No artificial delay here. The floor above exists to make a loading state visible; a
  // box that answers as you type wants the opposite.
  return c.json(await searchLabels(q))
})

/**
 * Create a node.
 *
 * No delay here either, and no read before the write: whether the name is free is decided
 * by a condition inside the transaction, not by asking first and hoping the answer holds.
 */
app.post("/api/nodes", async (c) => {
  const body = await c.req.json<{ label?: unknown }>().catch(() => ({ label: undefined }))
  const label = typeof body.label === "string" ? body.label : ""
  if (!label.trim()) return c.json({ error: "label is required" }, 400)

  const made = await write(() => createNode(label))
  return made instanceof Refused ? c.json({ error: made.message }, 409) : c.json(made, 201)
})

/**
 * Delete a node, for a create being taken back.
 *
 * The label comes from the node's own item rather than the caller. It is what the name
 * claim's key is built from, and a caller passing the wrong one would delete the node while
 * leaving its name held by nothing — a name nobody could ever use again.
 */
app.delete("/api/nodes/:id", async (c) => {
  const id = c.req.param("id")
  const node = (await readMetas([id])).get(id)
  if (!node) return c.json({ error: `no such node: ${id}` }, 404)

  const gone = await write(() => deleteNode(id, node.label))
  return gone instanceof Refused ? c.json({ error: gone.message }, 409) : c.json({ id })
})

/** The two ids an edge route needs, or the sentence saying why there are not two. */
function pair(c: { req: { query: (k: string) => string | undefined } }): [string, string] | string {
  const a = c.req.query("a")?.trim() ?? ""
  const b = c.req.query("b")?.trim() ?? ""
  return a && b ? [a, b] : "a and b are required"
}

/** Join two nodes. Both must already exist; the transaction is what enforces it. */
app.post("/api/edges", async (c) => {
  const body = await c.req
    .json<{ a?: unknown; b?: unknown }>()
    .catch(() => ({ a: undefined, b: undefined }))
  const a = typeof body.a === "string" ? body.a.trim() : ""
  const b = typeof body.b === "string" ? body.b.trim() : ""
  if (!a || !b) return c.json({ error: "a and b are required" }, 400)

  const joined = await write(() => addEdge(a, b))
  return joined instanceof Refused
    ? c.json({ error: joined.message }, 409)
    : c.json({ a, b })
})

/**
 * Part two nodes, for a join being taken back.
 *
 * Ids ride in the query rather than a body: a DELETE with a body is legal and widely
 * mishandled, and two ids fit in a URL.
 */
app.delete("/api/edges", async (c) => {
  const ids = pair(c)
  if (typeof ids === "string") return c.json({ error: ids }, 400)

  const parted = await write(() => removeEdge(ids[0], ids[1]))
  return parted instanceof Refused
    ? c.json({ error: parted.message }, 409)
    : c.json({ a: ids[0], b: ids[1] })
})

app.onError((err, c) => {
  console.error("✗ request failed:", err)
  return c.json({ error: "internal error" }, 500)
})

const port = Number(process.env["PORT"] ?? 8787)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`→ ${describeTarget(GRAPH_TABLE_NAME)}`)
  console.log(`✓ graph API on http://localhost:${info.port}`)
})
