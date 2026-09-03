/**
 * Reads the centre node's neighbours once the camera settles, and adds them to the map.
 *
 * Only the centre is read, and only on arrival. An earlier version read one hop ahead and
 * kept the replies in a cache, with an abort controller per request. All of that existed to
 * hide the cost of a network round trip. A read is now a range scan over an IndexedDB index
 * in this tab, so reading on arrival is fast enough, and a cache here would sit in front of
 * another cache.
 */
import { fetchNeighbourhood } from "./store/index.js"
import type { MapSurface } from "./map.js"
import type { World } from "./world.js"

export interface ExploreHooks {
  onChange: () => void
  onError: (message: string) => void
}

export class Explorer {
  /** Reads in flight. Nothing cancels one: a local read is cheap enough to let finish. */
  private readonly reading = new Set<string>()
  private readonly failed = new Set<string>()

  constructor(
    private readonly world: World,
    private readonly view: MapSurface,
    private readonly hooks: ExploreHooks,
  ) {}

  /** How many reads are in flight. The HUD shows this. */
  get pending(): number {
    return this.reading.size
  }

  /**
   * Read a node now, whatever the camera is doing. Used when a destination is chosen.
   *
   * This also clears the failed mark, so naming a node retries it. A node that failed once
   * is worth another attempt when someone asks for it by name.
   */
  prefetch(id: string): void {
    this.failed.delete(id)
    void this.expand(id)
  }

  /** Draw the centre's neighbourhood. Called on a settled camera. */
  loadCentre(): void {
    const centre = this.view.accent
    if (!centre) return
    if (this.world.isIncomplete(centre)) void this.expand(centre)
  }

  private async expand(id: string): Promise<void> {
    if (this.reading.has(id) || this.failed.has(id) || !this.world.isIncomplete(id)) return

    // Claimed before the read starts, so a second settle cannot double-read it.
    this.world.markExpanded(id)
    this.reading.add(id)
    this.view.loading(id, true)
    this.hooks.onChange()

    try {
      const result = await fetchNeighbourhood(id)

      const absorbed = this.world.absorb(id, result.neighbours)
      this.view.add(absorbed.nodes, absorbed.edges)
      // Anything the first pass could not place gets a second, tighter pass now. Waiting
      // for the next map change would leave those nodes unplaced on screen.
      if (absorbed.unseated.length) {
        const squeezed = this.world.seatPending(id)
        this.view.add(squeezed.nodes, squeezed.edges)
      }
      this.failed.delete(id)
    } catch (err) {
      // The read failed, so give the claim back. The node is marked incomplete again and can
      // be read on a later visit. `failed` stops it being retried on every camera settle
      // until then.
      this.world.unmarkExpanded(id)
      this.failed.add(id)
      this.hooks.onError(err instanceof Error ? err.message : String(err))
    } finally {
      this.reading.delete(id)
      this.view.loading(id, false)
      this.hooks.onChange()
    }
  }
}

/**
 * Delay `fn` until nothing has called it for `ms`. Each call may pass its own wait, because
 * how long the camera must be still before it counts as stopped depends on what moved it.
 */
export function debounce(fn: () => void, ms: number): (after?: number) => void {
  let timer: number | undefined
  return (after = ms) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(fn, after) as unknown as number
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
