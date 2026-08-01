/**
 * When to ask for more graph.
 *
 * Fetching is triggered by a *settled* camera, never by the camera moving, so panning
 * itself never waits on the network. Everything it does is additive, so a response
 * arriving mid-gesture cannot disturb what is on screen.
 *
 * Four rules keep exploration bounded:
 *
 *   zoom gate      zoomed out, hundreds of nodes are in view and none are readable
 *                  — the centre is exempt, and so is anything `prefetch` is told to get
 *   batch cap      at most PER_SWEEP nodes expand per settle
 *   in-flight cap  at most MAX_INFLIGHT requests outstanding
 *   abandonment    a request whose node has left the viewport is aborted and released
 *
 * Nearest-to-centre goes first: what you are looking at fills in before the edges do.
 *
 * See docs/decisions/0003-graph-exploration-demo-stack.md.
 */
import { Cancelled, fetchNeighbourhood } from "./api.js"
import type { MapView } from "./map-view.js"
import type { World } from "./world.js"

const MIN_ZOOM = 0.34
const MAX_INFLIGHT = 3
const PER_SWEEP = 2
const MARGIN = 90

export interface ExploreHooks {
  onChange: () => void
  onError: (message: string) => void
}

export class Explorer {
  private readonly inflight = new Map<string, AbortController>()
  private readonly failed = new Set<string>()

  constructor(
    private readonly world: World,
    private readonly view: MapView,
    private readonly hooks: ExploreHooks,
  ) {}

  get pending(): number {
    return this.inflight.size
  }

  gate(): string {
    if (this.view.zoom() < MIN_ZOOM) return "zoomed out — zoom in to load more"
    return ""
  }

  /**
   * Load a node now, whatever the camera is doing.
   *
   * The zoom gate and the batch cap both exist to stop the *viewport* asking for more
   * than it can show. A node you are travelling to was asked for by name, so neither
   * applies — and the journey is otherwise idle time the request may as well use.
   */
  prefetch(id: string): void {
    void this.expand(id)
  }

  async expand(id: string): Promise<void> {
    if (this.inflight.has(id) || !this.world.isIncomplete(id)) return

    // Claimed before the request goes out, so a second sweep cannot double-fetch it.
    this.world.markExpanded(id)
    const control = new AbortController()
    this.inflight.set(id, control)
    this.view.loading(id, true)
    this.hooks.onChange()

    try {
      const result = await fetchNeighbourhood(id, control.signal)
      const absorbed = this.world.absorb(id, result.neighbours)
      this.view.add(absorbed.nodes, absorbed.edges)
      // Whatever the first pass could not fit gets a tighter one straight away, rather
      // than waiting for the map to change around it.
      if (absorbed.unseated.length) {
        const squeezed = this.world.seatPending(id)
        this.view.add(squeezed.nodes, squeezed.edges)
      }
      this.failed.delete(id)
    } catch (err) {
      if (!(err instanceof Cancelled)) {
        this.failed.add(id)
        this.hooks.onError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      this.inflight.delete(id)
      this.view.loading(id, false)
      this.hooks.onChange()
    }
  }

  /** Called on a settled camera. */
  sweep(): void {
    const candidates = this.view.visible(MARGIN)
    const visible = new Set(candidates.map((n) => n.id))

    for (const [id, control] of this.inflight) {
      if (!visible.has(id)) control.abort()
    }

    // The centre is exempt from the zoom gate. The gate stops the *viewport* asking for
    // more than it can show; the centre is one node, and it is the one being looked at.
    // Zoomed out past MIN_ZOOM, centring a node used to load nothing at all.
    const accent = this.view.accent
    if (accent) this.prefetch(accent)

    if (this.view.zoom() < MIN_ZOOM) return
    const slots = Math.min(PER_SWEEP, MAX_INFLIGHT - this.inflight.size)
    if (slots <= 0) return

    const centre = this.view.centre()
    const queue = candidates
      .filter((node) => !this.failed.has(node.id))
      .sort(
        (a, b) =>
          (a.x - centre.x) ** 2 +
          (a.y - centre.y) ** 2 -
          ((b.x - centre.x) ** 2 + (b.y - centre.y) ** 2),
      )
      .slice(0, slots)

    for (const node of queue) void this.expand(node.id)
  }
}

export function debounce(fn: () => void, ms: number): () => void {
  let timer: number | undefined
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(fn, ms) as unknown as number
  }
}

/** Runs at most once per frame, for work that follows the camera. */
export function perFrame(fn: () => void): () => void {
  let queued = false
  return () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      fn()
    })
  }
}
