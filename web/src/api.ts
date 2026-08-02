/**
 * The API client, and the only place that knows the wire shape.
 *
 * Requests are cancellable so a node that has been panned away from stops being paid for.
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

export interface GraphIndex {
  rootId: string
  nodeCount: number
  edgeCount: number
}

export class Cancelled extends Error {
  constructor() {
    super("cancelled")
    this.name = "Cancelled"
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, signal ? { signal } : {})
  } catch (err) {
    if (signal?.aborted) throw new Cancelled()
    throw err
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
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
