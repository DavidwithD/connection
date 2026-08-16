/**
 * A Watts-Strogatz small-world generator. Pure, deterministic and undirected.
 *
 * The ids here belong to the generator and never reach the store. A node is keyed by its
 * name, so the caller maps them across. They exist because the three passes address nodes by
 * position: an island is a contiguous range of ids.
 */
import { edgeKey } from "./keys.js"

export interface GeneratedNode {
  id: string
  label: string
}

export interface GeneratedGraph {
  nodes: GeneratedNode[]
  /** Each pair appears once. The store holds one record per undirected edge. */
  edges: [string, string][]
}

export interface GenerateOptions {
  /** Node count. */
  n: number
  /** Mean degree. Rounded down to an even number, because the lattice is symmetric. */
  k: number
  /** Rewiring probability. Zero gives a plain ring. One gives a near-random graph. */
  p: number
  seed: number
  /** How many nodes become hubs. Zero reproduces the plain lattice exactly. */
  hubs?: number
  /** The top degree. One hub reaches this exactly. The others land between it and `k`. */
  hubK?: number
  /** How many components to split the nodes across. One gives a connected graph. */
  islands?: number
}

/**
 * Split `n` nodes across `islands` components. Each share is half the one before it.
 *
 * The shares must sum to exactly `n`, so the rounding difference is taken from the largest
 * islands. That always terminates: the smallest total the rounding can produce is one node
 * per island, and `generate` has already refused more islands than nodes.
 */
export function shares(n: number, islands: number): number[] {
  const weights = Array.from({ length: islands }, (_, i) => 0.5 ** i)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const sizes = weights.map((weight) => Math.max(1, Math.round((n * weight) / total)))

  let drift = n - sizes.reduce((sum, size) => sum + size, 0)
  if (drift > 0) sizes[0]! += drift
  for (let i = 0; drift < 0 && i < sizes.length; i++) {
    const take = Math.min(sizes[i]! - 1, -drift)
    sizes[i]! -= take
    drift += take
  }
  return sizes
}

/**
 * The lattice reach inside one island, which is not always the reach that was asked for.
 *
 * A ring needs more nodes than it has neighbours. A `k` of 10 needs at least six nodes to
 * mean anything, and the smallest share above is a pair. So the reach is whatever the island
 * can hold. An island of one node gets no edges, correctly: its only candidate neighbour is
 * itself.
 */
const reachIn = (size: number, want: number): number =>
  Math.max(1, Math.min(want, Math.floor((size - 1) / 2)))

/** A small fast PRNG. Good enough for demo data, and seedable, unlike `Math.random`. */
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
 * Generate readable names, so the demo graph does not look like a load test.
 *
 * Three syllable slots, two of which may be empty. head x mid x tail gives about 2500 names,
 * well past the node counts this is used at. A two-slot version reached only 320 and started
 * emitting "Orinholm 13" a third of the way through.
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
  islands = 1,
}: GenerateOptions): GeneratedGraph {
  if (n < 4) throw new Error("n must be at least 4")
  if (islands < 1) throw new Error("islands must be at least one")
  if (islands > n) throw new Error("islands must not exceed n")
  const half = Math.max(1, Math.floor(k / 2))
  if (hubs >= n) throw new Error("hubs must be below n")

  // Islands are contiguous id ranges. Finding a node's island is then arithmetic rather than
  // a lookup, and the ids in one island read consecutively. Every edge below stays inside one
  // range: the lattice, the rewiring and the hub pass each have their own way of crossing an
  // island boundary, and an island joined to another is one the page cannot show as separate.
  const sizes = shares(n, islands)
  const starts: number[] = []
  for (let at = 0, i = 0; i < sizes.length; at += sizes[i]!, i++) starts.push(at)
  // The map opens on the largest island, so that is the one `k` has to mean something for.
  // The smaller ones use whatever reach they can hold. See `reachIn`.
  if (half * 2 >= sizes[0]!) throw new Error("k must be well below the largest island")

  // Two independent random streams. With one stream, a change to how labels are drawn would
  // shift every later draw, so editing the name list would silently rewire the graph. That
  // happened once.
  const rand = mulberry32(seed)
  const nextLabel = labeller(mulberry32(seed ^ 0x9e3779b9))
  const id = (i: number): string => `n${String(i).padStart(4, "0")}`

  const nodes: GeneratedNode[] = Array.from({ length: n }, (_, i) => ({
    id: id(i),
    label: nextLabel(),
  }))

  // Ring lattice: every node joins its `half` nearest neighbours on each side.
  //
  // Edges are held in a Map keyed by `edgeKey`, so rewiring rejects a duplicate in constant
  // time. The adjacency sets beside it let the hub pass read a degree without counting. The
  // pair is stored next to its key rather than recovered by splitting the key.
  const edges = new Map<string, [string, string]>()
  const adjacency: Set<number>[] = Array.from({ length: n }, () => new Set())
  const add = (a: number, b: number): boolean => {
    if (a === b) return false
    const key = edgeKey(id(a), id(b))
    if (edges.has(key)) return false
    edges.set(key, [id(a), id(b)])
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

  // One ring per island. The modulus is the island's size, not the graph's. That is what
  // keeps the islands apart: a ring that wrapped at `n` would close through the next island
  // and join the two.
  sizes.forEach((size, island) => {
    const start = starts[island]!
    const reach = reachIn(size, half)
    for (let i = 0; i < size; i++) {
      for (let j = 1; j <= reach; j++) add(start + i, start + ((i + j) % size))
    }
  })

  // Rewire one end of each lattice edge with probability p. Retries are bounded. A rewire
  // that fails leaves the lattice edge in place, which is the standard behaviour and cannot
  // disconnect the ring.
  sizes.forEach((size, island) => {
    const start = starts[island]!
    const reach = reachIn(size, half)
    for (let i = 0; i < size; i++) {
      for (let j = 1; j <= reach; j++) {
        if (rand() >= p) continue
        const from = start + i
        const old = start + ((i + j) % size)
        for (let attempt = 0; attempt < 16; attempt++) {
          // Pick the new end inside this island. A shortcut then shortens a path that
          // already exists, instead of joining two components that must stay apart.
          const to = start + Math.floor(rand() * size)
          if (to === from) continue
          if (adjacency[from]!.has(to)) continue
          drop(from, old)
          add(from, to)
          break
        }
      }
    }
  })

  // Hubs. Every edge a hub gains is paid for by one removed elsewhere, so the total edge
  // count does not change. Two kinds of donor are rejected: a node already at the ring's
  // minimum degree, and any node already made a hub. Both ends stay in the hub's own island.
  if (hubs > 0 && hubK > k) {
    const chosen = new Set<number>()
    // A lookup table for which island each node is in. Built once, because the hub pass asks
    // thousands of times.
    const islandOf = new Array<number>(n)
    sizes.forEach((size, island) => {
      for (let i = 0; i < size; i++) islandOf[starts[island]! + i] = island
    })

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
      const home = islandOf[hub]!
      const floor = reachIn(sizes[home]!, half) + 1

      // The first hub is driven to `hubK` exactly, so the top of the degree range is where
      // the caller asked for it. The rest are spread from just above where plain rewiring
      // tops out, which fills the tail instead of leaving a spike at `hubK` and a gap below.
      const target =
        h === 0 ? hubK : Math.min(hubK, k + 2 + Math.floor(rand() * (hubK - k - 1)))

      for (
        let attempt = 0;
        adjacency[hub]!.size < target && attempt < 64 * hubK;
        attempt++
      ) {
        // Draw the other end from the hub's own island. Picking across the whole graph and
        // rejecting the misses would waste most attempts once the island is small, and a
        // small island is exactly the one whose few edges must not be taken away.
        const v = starts[home]! + Math.floor(rand() * sizes[home]!)
        if (v === hub || adjacency[v]!.has(hub)) continue
        const donors = [...adjacency[v]!].filter(
          (w) => w !== hub && !chosen.has(w) && adjacency[w]!.size > floor,
        )
        const w = donors[Math.floor(rand() * donors.length)]
        if (w === undefined) continue
        drop(v, w)
        add(v, hub)
      }
    }
  }

  return { nodes, edges: [...edges.values()] }
}
