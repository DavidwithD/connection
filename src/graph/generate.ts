/**
 * Watts–Strogatz small-world generator.
 *
 * Chosen for the shape the demo needs rather than for realism. A ring lattice is
 * densely cyclic and gives every node the same degree; rewiring a fraction of the
 * edges then collapses the average path length, so exploring the result never
 * feels like walking down a corridor. Undirected throughout.
 *
 * What it will not give you is a hub — the degree spread stays narrow at any rewiring
 * probability worth using. A pass afterwards moves edges onto a few chosen nodes to
 * make some, holding the total edge count fixed; see `hubs` and `hubK`.
 *
 * Deterministic, because the *graph* must be reproducible across seed runs even
 * though the *layout* deliberately is not — see
 * docs/decisions/0003-graph-exploration-demo-stack.md.
 */
import { edgeKey } from "./keys.js"

export interface GeneratedNode {
  id: string
  label: string
}

export interface GeneratedGraph {
  nodes: GeneratedNode[]
  /** Each pair appears once; the storage layer writes both directions. */
  edges: [string, string][]
}

export interface GenerateOptions {
  /** Node count. */
  n: number
  /** Mean degree. Rounded down to even, since the lattice is symmetric. */
  k: number
  /** Rewiring probability. Zero is a plain ring; one is near-random. */
  p: number
  seed: number
  /** How many nodes get pulled up into hubs. Zero reproduces the plain lattice exactly. */
  hubs?: number
  /** Top degree. One hub reaches this exactly; the others land between it and `k`. */
  hubK?: number
}

/** Small fast PRNG — good enough for demo data, and seedable, unlike Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HEAD = [
  "ka", "mi", "so", "ta", "ru", "ne", "va", "lo", "zi", "hen",
  "dor", "fal", "cor", "bre", "syl", "tam", "orin", "vel", "quen", "ash",
]
const MID = ["", "", "va", "le", "an", "or", "ise", "un"]
const TAIL = [
  "ra", "no", "lin", "dis", "mar", "ta", "vel", "san", "kor", "ith",
  "wen", "dros", "mira", "vane", "quist", "holm",
]

/**
 * Readable labels, so the demo does not look like a load test.
 *
 * Three syllable slots, two of which may be empty: head × mid × tail is roughly
 * 2500 names, comfortably past the node counts this is used at. A two-slot version
 * only reached 320 and started emitting "Orinholm 13" a third of the way in.
 */
function labeller(rand: () => number): () => string {
  const used = new Set<string>()
  const pick = (list: readonly string[]): string =>
    list[Math.floor(rand() * list.length)] ?? ""
  return () => {
    for (let attempt = 0; ; attempt++) {
      const head = pick(HEAD) || "ka"
      const base = head[0]!.toUpperCase() + head.slice(1) + pick(MID) + pick(TAIL)
      const name = attempt < 64 ? base : `${base} ${attempt}`
      if (!used.has(name)) {
        used.add(name)
        return name
      }
    }
  }
}

export function generate({
  n,
  k,
  p,
  seed,
  hubs = 0,
  hubK = 0,
}: GenerateOptions): GeneratedGraph {
  if (n < 4) throw new Error("n must be at least 4")
  const half = Math.max(1, Math.floor(k / 2))
  if (half * 2 >= n) throw new Error("k must be well below n")
  if (hubs >= n) throw new Error("hubs must be below n")

  // Two independent streams. Sharing one would let a change to how labels are drawn
  // shift every later draw, so editing the name list would silently rewire the graph —
  // which it did, once.
  const rand = mulberry32(seed)
  const nextLabel = labeller(mulberry32(seed ^ 0x9e3779b9))
  const id = (i: number): string => `n${String(i).padStart(4, "0")}`

  const nodes: GeneratedNode[] = Array.from({ length: n }, (_, i) => ({
    id: id(i),
    label: nextLabel(),
  }))

  // Ring lattice: every node joins its `half` nearest neighbours on each side.
  // Built as a key set so rewiring can reject a duplicate in constant time, with
  // adjacency alongside it so the hub pass can read a degree without counting.
  const edges = new Set<string>()
  const adjacency: Set<number>[] = Array.from({ length: n }, () => new Set())
  const add = (a: number, b: number): boolean => {
    if (a === b) return false
    const key = edgeKey(id(a), id(b))
    if (edges.has(key)) return false
    edges.add(key)
    adjacency[a]!.add(b)
    adjacency[b]!.add(a)
    return true
  }
  const drop = (a: number, b: number): boolean => {
    if (!edges.delete(edgeKey(id(a), id(b)))) return false
    adjacency[a]!.delete(b)
    adjacency[b]!.delete(a)
    return true
  }

  for (let i = 0; i < n; i++) {
    for (let j = 1; j <= half; j++) add(i, (i + j) % n)
  }

  // Rewire one endpoint of a lattice edge with probability p. Retry a bounded
  // number of times: a rejected rewire keeps the lattice edge, which is the
  // standard degradation and cannot disconnect the ring.
  for (let i = 0; i < n; i++) {
    for (let j = 1; j <= half; j++) {
      if (rand() >= p) continue
      const from = i
      const old = (i + j) % n
      for (let attempt = 0; attempt < 16; attempt++) {
        const to = Math.floor(rand() * n)
        if (to === from) continue
        if (adjacency[from]!.has(to)) continue
        drop(from, old)
        add(from, to)
        break
      }
    }
  }

  // Hubs. The lattice hands out one degree and rewiring only nudges it a little either
  // side of `k`, at any probability worth using — so nothing in the graph is worth calling
  // well connected, and the views that size a node by its degree have nothing to say.
  //
  // Each edge a hub gains is paid for by one dropped elsewhere: an edge (v, w) becomes
  // (v, hub), so v is unchanged, w gives up one, and the total edge count — and with it
  // the mean degree — is exactly what it was.
  //
  // Two kinds of donor are refused. A node already down at `half + 1`, so the pass cannot
  // tear the ring open to feed a hub and the bottom of the degree range stays where the
  // lattice left it; and any earlier hub, which would otherwise be drained back down by
  // the hubs built after it and quietly cost the graph the top degree it was asked for.
  //
  // Those two refusals are also the ceiling on `hubs`: everything a hub gains is somebody
  // else's spare degree, so once it is spent the pass runs out of donors and the hubs
  // asked for past that point are left sitting at `k`, silently.
  if (hubs > 0 && hubK > k) {
    const chosen = new Set<number>()
    for (let h = 0; h < hubs; h++) {
      let hub = -1
      for (let attempt = 0; attempt < 64; attempt++) {
        const candidate = Math.floor(rand() * n)
        if (!chosen.has(candidate)) {
          hub = candidate
          break
        }
      }
      if (hub < 0) break
      chosen.add(hub)

      // One hub is driven to `hubK` exactly, so the top of the range is where the caller
      // asked for it. The rest are spread from just past where plain rewiring already
      // tops out, which fills the tail instead of leaving a spike at `hubK` and a gap.
      const target =
        h === 0 ? hubK : Math.min(hubK, k + 2 + Math.floor(rand() * (hubK - k - 1)))

      for (
        let attempt = 0;
        adjacency[hub]!.size < target && attempt < 64 * hubK;
        attempt++
      ) {
        const v = Math.floor(rand() * n)
        if (v === hub || adjacency[v]!.has(hub)) continue
        const donors = [...adjacency[v]!].filter(
          (w) => w !== hub && !chosen.has(w) && adjacency[w]!.size > half + 1,
        )
        const w = donors[Math.floor(rand() * donors.length)]
        if (w === undefined) continue
        drop(v, w)
        add(v, hub)
      }
    }
  }

  return {
    nodes,
    edges: [...edges].map((key) => {
      const [a, b] = key.split("~") as [string, string]
      return [a, b]
    }),
  }
}

/** Degree per node, from the undirected pair list. */
export function degrees(graph: GeneratedGraph): Map<string, number> {
  const out = new Map<string, number>()
  for (const node of graph.nodes) out.set(node.id, 0)
  for (const [a, b] of graph.edges) {
    out.set(a, (out.get(a) ?? 0) + 1)
    out.set(b, (out.get(b) ?? 0) + 1)
  }
  return out
}
