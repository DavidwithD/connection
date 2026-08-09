/**
 * The API client, and the only place that knows the wire shape.
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
 */
export interface IslandMeta extends NodeMeta {
  size: number
}

export interface GraphIndex {
  rootId: string
  nodeCount: number
  edgeCount: number
  /** Components no walk from `rootId` reaches, largest first. Its own is never here. */
  islands: IslandMeta[]
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

/** The error body both sides agree on, unwrapped once for every route. */
async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  const reason = body.error ?? `${String(res.status)} ${res.statusText}`
  throw res.status === 409 ? new Refused(reason) : new Error(reason)
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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
