/**
 * The graph API the demo page talks to.
 *
 *   GET    /api/graph          where to start, how big the graph is, and its first islands
 *   GET    /api/islands        the islands after a cursor, largest first
 *   GET    /api/nodes/:id      one node and its neighbours, with their true degrees
 *   GET    /api/search?q=      nodes whose name starts with q
 *   POST   /api/nodes          create a node by name
 *   POST   /api/edges          join two nodes by id
 *   DELETE /api/nodes/:id      delete a node — ?edges=1 takes its edges with it
 *   DELETE /api/edges?a=&b=    part two nodes, for a join being taken back
 *   GET    /api/graph/text     the whole graph as lines of names, to download
 *   GET    /api/graph/export   the whole graph as JSON, to download
 *   POST   /api/graph/text     add a file of names, or say what it would add
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
 * The last three move whole graphs rather than one node, and they are the only routes here
 * that read the table with a Scan — the exception src/graph/bulk.ts already names, now
 * reachable by a click rather than by a command. What is *not* here is the other half of
 * that: restoring a JSON export drops the table, and its guard is an environment variable
 * and a rescue file written next to whoever ran it (src/graph/export.ts). Neither survives
 * being turned into a button, so that one stays a command.
 *
 * See docs/decisions/0003-graph-exploration-demo-stack.md,
 * docs/decisions/0010-writing-to-the-graph-from-the-browser.md and
 * docs/decisions/0023-the-graph-moves-through-the-page.md.
 */
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { GRAPH_TABLE_NAME, describeTarget } from "../db/client.js"
import { scanAll } from "../graph/bulk.js"
import { addEdge, removeEdge } from "../graph/edge.js"
import { EXPORT_VERSION, select, type GraphExport } from "../graph/export.js"
import { find } from "../graph/islands.js"
import { searchLabels } from "../graph/labels.js"
import { apply, survey } from "../graph/load.js"
import { createNode, deleteNode, deleteNodeWithEdges } from "../graph/node.js"
import { Refused } from "../graph/refused.js"
import { Unwritable, format, parse, type Shape } from "../graph/text.js"
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
 * Delete a node, bare or with everything it is joined to.
 *
 * The label comes from the node's own item rather than the caller. It is what the name
 * claim's key is built from, and a caller passing the wrong one would delete the node while
 * leaving its name held by nothing — a name nobody could ever use again.
 *
 * Two removals behind one path, and the flag is what picks. Unflagged is the strict one an
 * undo is built on: it refuses a node that has been joined to since, and the panel reads
 * that refusal as the node having stayed (web/src/join.ts). Flagged parts every edge first
 * and is refused by nothing but a node that is not there —
 * docs/decisions/0024-taking-a-node-out-with-its-edges.md for what that costs.
 */
app.delete("/api/nodes/:id", async (c) => {
  const id = c.req.param("id")
  const node = (await readMetas([id])).get(id)
  if (!node) return c.json({ error: `no such node: ${id}` }, 404)

  if (c.req.query("edges") === "1") {
    const parted = await write(() => deleteNodeWithEdges(id))
    if (parted instanceof Refused) return c.json({ error: parted.message }, 409)
    // Null is the node having gone between the read above and the write, which is the
    // asked-for state arriving from somewhere else. Nothing was parted here, and the
    // caller is told exactly that.
    return c.json({ id, parted: parted ?? [] })
  }

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

/**
 * How much of a file one request will write.
 *
 * A load is one round trip per new name and four per new pair, in series and by design
 * (docs/decisions/0021-a-graph-in-a-text-file.md), so a large file is not slow here in the
 * way a slow query is slow — it is a request that stays open for minutes and cannot be
 * resumed if the browser gives up on it. The command has no such ceiling: it prints as it
 * goes, and nobody is waiting on a socket.
 */
const LOAD_LIMIT = 500

/**
 * And how much text is taken in at all.
 *
 * Checked after the body is in memory, which is where a limit this side of a reverse proxy
 * can be checked at all — what it saves is the parse and the survey, not the read.
 */
const MAX_CHARS = 1_000_000

/** Both downloads name their file here, so a saved graph is not called `text`. */
const attachment = (name: string): Record<string, string> => ({
  "content-disposition": `attachment; filename="${name}"`,
})

/**
 * The whole graph as lines of names.
 *
 * Every node, not only the ones made by hand: which items a *backup* should hold is a
 * question about surviving a re-seed, and this is the graph written down
 * (src/graph/text.ts). `select` still runs, because a subset of a graph is not automatically
 * one and its half-edge rule is the reason.
 *
 * A name holding `|` or `#` cannot be written at all, and that comes back as a 409 — the
 * graph declining, which the page already knows how to show, rather than a fault.
 */
app.get("/api/graph/text", async (c) => {
  const asked = c.req.query("shape") ?? "joins"
  if (asked !== "joins" && asked !== "names") {
    return c.json({ error: "shape must be joins or names" }, 400)
  }
  const shape: Shape = asked

  const items = await scanAll(null)
  if (!items.length) return c.json({ error: "the table is empty — nothing to export" }, 404)

  try {
    const selection = select(items, () => true)
    return c.text(format(selection.items, shape), 200, {
      "content-type": "text/plain; charset=utf-8",
      ...attachment(shape === "names" ? "graph-names.txt" : "graph.txt"),
    })
  } catch (err) {
    if (!(err instanceof Unwritable)) throw err
    return c.json({ error: err.message }, 409)
  }
})

/**
 * The whole graph as JSON — the file `graph:restore` reads.
 *
 * The same payload the command writes, from the same `select`, so a graph taken out here
 * goes back in there. Putting it back is still a command: see the header.
 */
app.get("/api/graph/export", async (c) => {
  const items = await scanAll(null)
  if (!items.length) return c.json({ error: "the table is empty — nothing to export" }, 404)

  const selection = select(items, () => true)
  const payload: GraphExport = {
    version: EXPORT_VERSION,
    table: GRAPH_TABLE_NAME,
    exportedAt: new Date().toISOString(),
    items: selection.items,
    counts: selection.counts,
  }
  return c.json(payload, 200, attachment("graph-export.json"))
})

/**
 * Add a file of names to the graph, or say what adding it would do.
 *
 * `?dry=1` is the whole reason this is two calls rather than one. The command has a dry run
 * because a misspelled name is a new node and looks exactly like one you meant
 * (docs/decisions/0021-a-graph-in-a-text-file.md); a page needs it more, not less, since
 * there is no file on disk to read back afterwards.
 *
 * The file arrives as a plain text body — `await file.text()` in the browser — so there is
 * no multipart parser here and nothing new to depend on. It is parsed and surveyed again on
 * every call: a plan the page hands back is a plan the page could have edited, and the two
 * reads it costs are batched.
 */
app.post("/api/graph/text", async (c) => {
  const text = await c.req.text()
  if (text.length > MAX_CHARS) {
    return c.json({ error: `that file is over ${String(MAX_CHARS)} characters`, big: true }, 413)
  }

  const reading = parse(text)
  // A file with a fault in it is refused whole, so there is no plan to make and no reason to
  // read the table for one — which is the order the command puts them in as well.
  const plan = reading.faults.length ? null : await survey(reading)
  const writes = plan ? plan.fresh.length + plan.joins.length : 0
  const over = writes > LOAD_LIMIT

  if (c.req.query("dry") === "1") {
    return c.json({
      lines: reading.lines,
      faults: reading.faults,
      fresh: plan?.fresh ?? [],
      // The pairs as they were read, for the reason src/graph/text.ts gives: a line's
      // reading is not visible in the line.
      joins: plan?.joins ?? [],
      joined: plan?.joined ?? 0,
      // Said before the button is pressed rather than after, so the answer to a file too
      // big is not a request that has already been running for a minute.
      over,
      limit: LOAD_LIMIT,
    })
  }

  if (!plan) {
    return c.json({ error: `${String(reading.faults.length)} fault(s) — nothing written` }, 400)
  }
  if (over) {
    return c.json(
      {
        error:
          `${String(writes)} writes is past what one request will hold — ` +
          `load it with: npm run graph:load -- <file>`,
        big: true,
      },
      413,
    )
  }

  const done = await write(() => apply(plan))
  return done instanceof Refused
    ? c.json({ error: done.message }, 409)
    : c.json({ created: done.created, joined: done.joined })
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
