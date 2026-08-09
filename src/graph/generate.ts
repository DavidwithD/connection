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
 * Nor will it give you a graph in pieces: a rewired ring lattice is connected and stays so at
 * every probability. `islands` is what does, by building one ring per component rather than
 * one across the whole node list. All three passes have their own way out of a component —
 * the ring can wrap past the end of one, a shortcut can land in the next, a hub can take its
 * edge from anywhere — so all three are held inside an island, because a component this
 * quietly joins to another is one the page can never offer as somewhere else to go.
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
  /** Components to split the nodes across. One is a single connected graph. */
  islands?: number
}

/**
 * How the nodes divide between islands: halving shares, largest first.
 *
 * Even shares would make the tail as big as the continent and leave nothing to notice about
 * the order they are offered in. Halving gives one component worth exploring, a few worth
 * crossing to, and — at the end of it — the ones that matter most for exercising this: a
 * pair and a lone node, which is what somebody making nodes by hand actually produces.
 *
 * These must sum to exactly `n`, and that is the part worth being careful about rather than
 * the weights: a node in no island is a node outside every range this builds, with no ring
 * to join and no component to belong to. Rounding moves the total either way and the floor
 * of one moves it up, so the difference is settled against the largest islands — the only
 * ones with nodes to spare, and the only ones a few either way says nothing about. Taking
 * from them always terminates, because the smallest total the floor can produce is one per
 * island and `generate` has already refused more islands than nodes.
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
 * The lattice's reach inside one island, which is not always the one that was asked for.
 *
 * A ring needs more nodes than it has neighbours: `k` of 10 wants six before it means
 * anything, and the small end of the halving above is a pair. So the reach is whatever the
 * island can hold, and an island of one comes out with no edges at all — correctly, since
 * every candidate neighbour is itself.
 */
const reachIn = (size: number, want: number): number =>
  Math.max(1, Math.min(want, Math.floor((size - 1) / 2)))

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
  islands = 1,
}: GenerateOptions): GeneratedGraph {
  if (n < 4) throw new Error("n must be at least 4")
  if (islands < 1) throw new Error("islands must be at least one")
  if (islands > n) throw new Error("islands must not exceed n")
  const half = Math.max(1, Math.floor(k / 2))
  if (hubs >= n) throw new Error("hubs must be below n")

  // Contiguous ranges, so which island a node is in is an arithmetic question rather than a
  // lookup — and so the ids in one island read consecutively, which makes a seeded graph
  // legible in the table. Every edge below is confined to one of these: the lattice, the
  // rewiring, and the hub pass each have their own way of leaving an island, and an island
  // this generator connects to another is one the page can never show as separate.
  const sizes = shares(n, islands)
  const starts: number[] = []
  for (let at = 0, i = 0; i < sizes.length; at += sizes[i]!, i++) starts.push(at)
  // The largest island is the one the map boots into, so it is the one `k` has to mean
  // something for. The rest give up whatever they cannot hold, quietly and by construction.
  if (half * 2 >= sizes[0]!) throw new Error("k must be well below the largest island")

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

  // One ring per island. The modulus is the island's size rather than the graph's, which is
  // the whole of what keeps them apart: a ring that wrapped at `n` would close through the
  // next island and make the two one.
  sizes.forEach((size, island) => {
    const start = starts[island]!
    const reach = reachIn(size, half)
    for (let i = 0; i < size; i++) {
      for (let j = 1; j <= reach; j++) add(start + i, start + ((i + j) % size))
    }
  })

  // Rewire one endpoint of a lattice edge with probability p. Retry a bounded
  // number of times: a rejected rewire keeps the lattice edge, which is the
  // standard degradation and cannot disconnect the ring.
  sizes.forEach((size, island) => {
    const start = starts[island]!
    const reach = reachIn(size, half)
    for (let i = 0; i < size; i++) {
      for (let j = 1; j <= reach; j++) {
        if (rand() >= p) continue
        const from = start + i
        const old = start + ((i + j) % size)
        for (let attempt = 0; attempt < 16; attempt++) {
          // Inside this island, so a shortcut shortens a path that exists rather than
          // creating one between components that are meant to have none.
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
  //
  // With islands, this is the pass that most wants to escape one: it takes an edge from
  // wherever it finds it and hangs it on the hub. Both ends are held to the hub's island
  // below, which also means the hubs asked for land where the nodes are — an island of two
  // has no spare degree to give anybody, and contributes none.
  if (hubs > 0 && hubK > k) {
    const chosen = new Set<number>()
    // Which island a node is in, by the ranges above. Read once per candidate rather than
    // recomputed, since the hub pass asks for it thousands of times.
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
        // Drawn from the hub's own island. Picking across the whole graph and rejecting
        // the misses would waste most attempts once the tail is small, and the small
        // islands are exactly the ones whose few edges must not be moved away.
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
