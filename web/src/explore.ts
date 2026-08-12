/**
 * When to ask for more graph, and when to draw it.
 *
 * Those are two questions now, and they have different answers. Only the centre is *drawn*:
 * a node reaches the map because the centre it neighbours was read, and it sits there
 * unexpanded — wearing the dashed border that says there is more behind it — until someone
 * puts it in the middle of the screen. What is drawn is still the route taken, and nothing
 * besides.
 *
 * Reading runs one hop ahead of that. Landing somewhere also reads the ring around it and
 * keeps the replies unspent, so the next step lands on a neighbourhood already in hand
 * instead of a round trip. Nothing arrives on the map from a read-ahead reply: `World`
 * seats against the occupancy of the moment, and seating a node for a place nobody walked
 * to would freeze it against a map that never existed.
 *
 * The trigger is a *settled* camera, never a moving one, so panning waits on nothing — and
 * since a pan names no centre (docs/decisions/0028-the-centre-is-named.md), a gesture
 * crossing six nodes draws none of them. Every reply is additive, so one landing mid-gesture
 * cannot disturb what is on screen.
 *
 * A read whose node stopped being the centre before it landed is abandoned, and its claim
 * handed back so arriving there later asks again.
 *
 * Stated as an invariant in docs/design/architecture.md. The reasoning, and what the
 * read-ahead costs, is docs/decisions/0006-only-the-centre-reads.md.
 */
import { Cancelled, fetchNeighbourhood, type Neighbourhood } from "./api.js"
import type { MapView } from "./map-view.js"
import type { World } from "./world.js"

/**
 * Ring nodes read on arrival. Mean degree is ten, so a typical ring is covered whole and
 * a hub's is truncated rather than paid for — the nearest of it is what gets drawn as
 * somewhere to walk to anyway.
 *
 * Tracks the mean the graph is seeded at, a little above it. Left at eight once the mean
 * moved to ten, a fifth of every ordinary ring went unread and the step after an arrival
 * started showing a loading state that read-ahead exists to prevent.
 */
const MAX_LOOKAHEAD = 12

/** Unspent replies kept. Past this the oldest go, and are re-read if anyone walks there. */
const MAX_HELD = 64

export interface ExploreHooks {
  onChange: () => void
  onError: (message: string) => void
}

export class Explorer {
  private readonly inflight = new Map<string, AbortController>()
  private readonly failed = new Set<string>()
  /**
   * Neighbourhoods read for nodes nobody has walked to. A promise rather than a value,
   * because the case worth handling is arriving while the read is still in the air:
   * whoever gets there waits on the same request instead of opening a second one.
   */
  private readonly held = new Map<string, Promise<Neighbourhood>>()
  private reading = 0

  constructor(
    private readonly world: World,
    private readonly view: MapView,
    private readonly hooks: ExploreHooks,
  ) {}

  /** Reads somebody on screen is waiting for. */
  get pending(): number {
    return this.inflight.size
  }

  /** Replies read ahead and not yet walked into. */
  get ready(): number {
    // An eviction can drop a read still in the air, so the two counters can cross.
    return Math.max(0, this.held.size - this.reading)
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

  /** Draw the centre's neighbourhood, read the ring's. Called on a settled camera. */
  loadCentre(): void {
    const centre = this.view.accent

    // A reply about somewhere that is no longer the centre is no longer about anything anyone
    // is looking at. Never during a flight: that destination was asked for by name, and the
    // centre it is about to become is still in the air.
    if (!this.view.inFlight) {
      for (const [id, control] of this.inflight) {
        if (id !== centre) control.abort()
      }
    }

    if (!centre) return
    // Boot seats the root's ring itself, and a centre walked to before is complete
    // already. Neither goes through `expand`, so neither has ever asked for its ring —
    // but arriving is still arriving, and the lookahead runs from here for both.
    if (this.world.isIncomplete(centre)) void this.expand(centre)
    else this.readAhead(centre)
  }

  private async expand(id: string): Promise<void> {
    if (this.inflight.has(id) || this.failed.has(id) || !this.world.isIncomplete(id)) return

    // Claimed before the request goes out, so a second settle cannot double-read it.
    this.world.markExpanded(id)
    // A reply read on the last arrival is spent here instead of asked for again. It has
    // usually landed already, so the ring is drawn a microtask after the settle and the
    // step costs no round trip at all.
    const held = this.held.get(id)
    const control = new AbortController()
    this.inflight.set(id, control)
    this.view.loading(id, true)
    this.hooks.onChange()

    try {
      const result = await (held ?? fetchNeighbourhood(id, control.signal))
      // A held reply belongs to nobody, so no abort reaches it. The centre can still have
      // moved on while it was in the air, and drawing it then would be drawing a ring
      // around a node that is no longer the centre.
      if (control.signal.aborted) throw new Cancelled()

      const absorbed = this.world.absorb(id, result.neighbours)
      this.view.add(absorbed.nodes, absorbed.edges)
      // Whatever the first pass could not fit gets a tighter one straight away, rather
      // than waiting for the map to change around it.
      if (absorbed.unseated.length) {
        const squeezed = this.world.seatPending(id)
        this.view.add(squeezed.nodes, squeezed.edges)
      }
      this.held.delete(id)
      this.failed.delete(id)
      this.readAhead(id)
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

  /**
   * Read the ring the arrival just drew, and draw none of it.
   *
   * Arriving is the strongest available signal about where the next step goes: one of the
   * nodes now around the centre, chosen over a settle and a walk. That time is otherwise
   * idle, and spending it on the ring's own neighbourhoods is what lets the step after
   * this one land on something already in hand.
   *
   * Nearest first, so the cap keeps the neighbours drawn close enough to be walked to
   * rather than the ones standing in as ghosts on the far side of the map.
   */
  private readAhead(centre: string): void {
    this.world
      .neighbours(centre)
      .filter((id) => this.worthHolding(id))
      .sort((a, b) => this.world.span(centre, a) - this.world.span(centre, b))
      .slice(0, MAX_LOOKAHEAD)
      .forEach((id) => this.hold(id))
  }

  private worthHolding(id: string): boolean {
    return (
      this.world.isIncomplete(id) &&
      !this.held.has(id) &&
      !this.inflight.has(id) &&
      !this.failed.has(id)
    )
  }

  /**
   * Read a node for later. Nothing on screen is waiting on it, so it wears no loading
   * mark, raises no error, and never enters `failed` — a read-ahead that does not arrive
   * leaves the node exactly as it was, to be asked for properly by whoever walks there.
   *
   * Uncancellable on purpose. The read is already gated by a settled camera, so it is only
   * ever about somewhere someone stopped, and abandoning it the moment the centre moves on
   * would throw away the request in the one case it exists for: the next step.
   */
  private hold(id: string): void {
    this.reading++
    const done = fetchNeighbourhood(id)
      .catch((err: unknown) => {
        this.held.delete(id)
        throw err
      })
      .finally(() => {
        this.reading--
        this.hooks.onChange()
      })
    // Nothing awaits an unspent reply, and a rejection nobody can act on is not an error.
    // Claiming it here is what keeps it from surfacing as an unhandled one.
    done.catch(() => {})

    this.held.set(id, done)
    // Insertion order, so the first out is the furthest back along the route.
    while (this.held.size > MAX_HELD) {
      const oldest = this.held.keys().next().value
      if (oldest === undefined) break
      this.held.delete(oldest)
    }
    this.hooks.onChange()
  }
}

/**
 * The default wait can be overridden per call, because how long a camera has to be still
 * before it counts as stopped depends on what moved it.
 */
export function debounce(fn: () => void, ms: number): (after?: number) => void {
  let timer: number | undefined
  return (after = ms) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(fn, after) as unknown as number
  }
}
