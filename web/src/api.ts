/**
 * The API client: every call a page makes, and the shape of what comes back.
 *
 * With one exception, and it is worth knowing about. The two downloads on
 * web/transfer.html are `href`s in the markup, because a download is a URL the browser
 * follows rather than a call anything here makes — which also means they are the only
 * paths in the client that nothing checks. The docs gate reads this file against the
 * routes (docs/checks.md); a route renamed out from under those two anchors breaks them
 * quietly.
 *
 * Reads are cancellable so a node that has been panned away from stops being paid for.
 * Writes are not, and the asymmetry is deliberate: abandoning a read costs a reply nobody
 * wanted, while abandoning a write leaves nobody able to say whether it landed.
 */

export interface NodeMeta {
  id: string
  label: string
  /** Degree in the stored graph, not the count of edges loaded. */
  degree: number
}

export interface Neighbourhood {
  node: NodeMeta
  neighbours: NodeMeta[]
  /** True when the node has more edges than the read returned. */
  truncated: boolean
}

/**
 * A component of the graph, named by one of its nodes.
 *
 * The map is walked outward from wherever you are, so a component holding nothing you have
 * reached cannot be found by walking at all. This is the address of one: somewhere to be
 * taken to, and how much graph is waiting when you arrive.
 *
 * Which node names it is decided by the order the unions happened in, so the name is stable
 * only while nothing merges or splits the component — see 0020.
 */
export interface IslandMeta extends NodeMeta {
  size: number
}

/**
 * Islands, and where to ask for the next of them.
 *
 * A graph can be in any number of pieces, so this is a page and says so: `cursor` is null
 * only when the last row is here. It is opaque — the store's own key, and picking it apart
 * is how a client comes to break when the index changes shape.
 */
export interface IslandPage {
  islands: IslandMeta[]
  cursor: string | null
}

export interface GraphIndex {
  rootId: string
  nodeCount: number
  edgeCount: number
  /** The first page of components, largest first — the one holding `rootId` included. */
  islands: IslandMeta[]
  /** Where to carry on from, or null when `islands` is all of them. */
  islandCursor: string | null
  /** How many there are in total, which is the one thing a page of them cannot say. */
  islandCount: number
  /** Which component holds `rootId`, so the first frame knows where it is standing. */
  homeIslandId: string | null
}

export class Cancelled extends Error {
  constructor() {
    super("cancelled")
    this.name = "Cancelled"
  }
}

/**
 * The graph declining a write, as opposed to the write failing — a 409.
 *
 * Worth its own type on this side too. "They are already joined" is something to show
 * beside the name it concerns and then carry on from; a 500 is not, and the two would be
 * indistinguishable as bare Errors.
 */
export class Refused extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "Refused"
  }
}

/**
 * The graph having no such node — a 404.
 *
 * Worth its own type for the reason `Refused` is: a read that finds nothing is an answer to
 * act on rather than a fault to report. `rootId` is derived and nothing maintains it through
 * a removal (src/graph/init.ts), so the one node the page reads before it can draw anything
 * is exactly the one that is allowed to have gone.
 */
export class Missing extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "Missing"
  }
}

/** The error body both sides agree on, unwrapped once for every route. */
async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  const reason = body.error ?? `${String(res.status)} ${res.statusText}`
  if (res.status === 409) throw new Refused(reason)
  if (res.status === 404) throw new Missing(reason)
  throw new Error(reason)
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, signal ? { signal } : {})
  } catch (err) {
    if (signal?.aborted) throw new Cancelled()
    throw err
  }
  if (!res.ok) await fail(res)
  return (await res.json()) as T
}

/**
 * A body that is already a string is a file, and goes as one.
 *
 * The alternative is multipart, which would mean a parser on the other side for a request
 * that carries one thing and no metadata about it.
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  const text = typeof body === "string"
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": text ? "text/plain; charset=utf-8" : "application/json" },
    body: text ? body : JSON.stringify(body),
  })
  if (!res.ok) await fail(res)
  return (await res.json()) as T
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE" })
  if (!res.ok) await fail(res)
  return (await res.json()) as T
}

export const fetchIndex = (signal?: AbortSignal): Promise<GraphIndex> =>
  get<GraphIndex>("/api/graph", signal)

/** The islands after `cursor`. Only ever called by the list running out of rows. */
export const fetchIslands = (cursor: string, signal?: AbortSignal): Promise<IslandPage> =>
  get<IslandPage>(`/api/islands?after=${encodeURIComponent(cursor)}`, signal)

export const fetchNeighbourhood = (
  id: string,
  signal?: AbortSignal,
): Promise<Neighbourhood> =>
  get<Neighbourhood>(`/api/nodes/${encodeURIComponent(id)}`, signal)

/** Nodes whose name starts with `q`. Empty for a blank query, without asking the server. */
export const searchLabels = (q: string, signal?: AbortSignal): Promise<NodeMeta[]> =>
  q.trim()
    ? get<NodeMeta[]>(`/api/search?q=${encodeURIComponent(q.trim())}`, signal)
    : Promise.resolve([])

/** A node with no edges yet. Throws `Refused` if the name is taken. */
export const createNode = (label: string): Promise<NodeMeta> =>
  post<NodeMeta>("/api/nodes", { label })

/** Join two nodes. Throws `Refused` if they are already joined or one is gone. */
export const joinNodes = (a: string, b: string): Promise<{ a: string; b: string }> =>
  post<{ a: string; b: string }>("/api/edges", { a, b })

/** Part two nodes. Throws `Refused` if they were not joined. */
export const unjoinNodes = (a: string, b: string): Promise<{ a: string; b: string }> =>
  del<{ a: string; b: string }>(
    `/api/edges?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
  )

/** Delete a node. Throws `Refused` unless it has no edges left. */
export const deleteNode = (id: string): Promise<{ id: string }> =>
  del<{ id: string }>(`/api/nodes/${encodeURIComponent(id)}`)

/**
 * Delete a node and everything joined to it.
 *
 * Answers the neighbours it parted, and the map has to be driven from that rather than
 * from what it has drawn: a read can be `truncated`, so the picture is allowed to hold
 * fewer edges than the node had.
 */
export const deleteNodeWithEdges = (id: string): Promise<{ id: string; parted: string[] }> =>
  del<{ id: string; parted: string[] }>(`/api/nodes/${encodeURIComponent(id)}?edges=1`)

/**
 * What a text file would do to the graph, read off the table and written nowhere.
 *
 * `faults` is a file that cannot be applied at all; everything else describes one that can.
 * The pairs ride along because a line's reading is not visible in the line — src/graph/text.ts.
 */
export interface LoadPlan {
  /** Lines that said something — comments and blanks are not counted. */
  lines: number
  faults: string[]
  /** Names the graph does not hold yet. Every one is a node, and a misspelling looks the same. */
  fresh: string[]
  joins: [string, string][]
  /** Pairs already joined, which a second run of the same file would skip. */
  joined: number
  /** True when applying it would be more writes than one request will hold. */
  over: boolean
  limit: number
}

export const previewGraphText = (text: string): Promise<LoadPlan> =>
  post<LoadPlan>("/api/graph/text?dry=1", text)

/** Add the file. Throws `Refused` if the graph declines a write it has to make. */
export const loadGraphText = (text: string): Promise<{ created: number; joined: number }> =>
  post<{ created: number; joined: number }>("/api/graph/text", text)
