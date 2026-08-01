/**
 * When to ask for more graph.
 *
 * One rule: the centre fetches, and nothing else does. A node reaches the map because the
 * centre it neighbours was read, and it sits there unexpanded — wearing the dashed border
 * that says there is more behind it — until someone puts it in the middle of the screen.
 * Walking is what loads the graph, so what is drawn is the route taken and nothing besides.
 *
 * The trigger is a *settled* camera, never a moving one, so panning waits on nothing and a
 * gesture crossing six nodes reads only the one it stops on. Every reply is additive, so
 * one landing mid-gesture cannot disturb what is on screen.
 *
 * A read whose node stopped being the centre before it landed is abandoned, and its claim
 * handed back so arriving there later asks again.
 *
 * See docs/decisions/0006-only-the-centre-reads.md.
 */
import { Cancelled, fetchNeighbourhood } from "./api.js"
import type { MapView } from "./map-view.js"
import type { World } from "./world.js"

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

  /**
   * Read a node now, whatever the camera is doing — for a destination already chosen.
   *
   * Naming a node is also a retry. One that failed once deserves another attempt when
   * someone deliberately sets off for it, which nothing automatic will ever do for them.
   */
  prefetch(id: string): void {
    this.failed.delete(id)
    void this.expand(id)
  }

  /** The centre, and only the centre. Called on a settled camera. */
  loadCentre(): void {
    const centre = this.view.accent

    // A reply about somewhere that is no longer the middle of the screen is no longer
    // about anything anyone is looking at. Never during a flight: that destination was
    // asked for by name, and the centre it is about to become is still in the air.
    if (!this.view.inFlight) {
      for (const [id, control] of this.inflight) {
        if (id !== centre) control.abort()
      }
    }

    if (centre) void this.expand(centre)
  }

  private async expand(id: string): Promise<void> {
    if (this.inflight.has(id) || this.failed.has(id) || !this.world.isIncomplete(id)) return

    // Claimed before the request goes out, so a second settle cannot double-read it.
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
      // Neither a cancel nor an error is an answer, so the claim goes back: the node is
      // incomplete again, says so, and can be read properly on a later visit. `failed` is
      // what stops a broken node being retried on every settle in the meantime.
      this.world.unmarkExpanded(id)
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
