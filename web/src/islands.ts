/**
 * The panel down the left: every island in the graph, as somewhere to go.
 *
 * The map is walked outward from one node, so a component holding nothing anyone has reached
 * is at the end of no walk however long (docs/decisions/0019-every-island-has-an-address.md).
 * Naming them is the only way in — and naming *all* of them, the one under your feet
 * included, is what makes the list an index of places rather than a list of errands. See
 * docs/decisions/0020-the-islands-list-is-an-index.md.
 *
 * A row never leaves on a click. That is the whole difference: crossing back is a click
 * rather than a name typed from memory, and the row you just used is still where it was when
 * you look for it again.
 *
 * Two rows can be clicked and mean different things. One you have been to is already seated
 * on the map, so going back is only the camera moving. One you have not seats a whole island
 * that was never there, in open water, permanently — `World` never reassigns a position. The
 * dim on an off-map row is that difference, and it is the only thing on a row besides its
 * name.
 *
 * How many islands there are is a property of the data and has no ceiling: 688 nodes of
 * vocabulary arrived as 267 components. So the list is paged, and the heading carries the
 * total — a list that stops at twenty without saying so is a list claiming to be the graph.
 */
import { fetchIslands, type IslandMeta, type IslandPage } from "./api.js"

export interface IslandsHooks {
  /**
   * Take the camera to this island.
   *
   * `seated` is a node of it known to be on the map already, and then the whole of this is
   * the camera moving. Null is an island that has to be set down first.
   */
  onCross: (island: IslandMeta, seated: string | null) => void
  /** Whether this island's naming node is already seated. */
  placed: (id: string) => boolean
}

export class IslandsPanel {
  /** One button per island, by id, so a repaint needs no rebuild. */
  private readonly rows = new Map<string, HTMLButtonElement>()

  /**
   * The first page's island ids, in order.
   *
   * Rebuilding empties a scrollable box, and an emptied box scrolls back to the top — which
   * on a list you navigate from means finding your place again after every jump. So the rows
   * are built once and compared against this after every write; only a write that moved the
   * first page makes them again.
   *
   * The first page, because it is the only part a fresh read can be compared against. A merge
   * between two islands nobody has scrolled to cannot be seen from here, and is left to drift
   * — the same over-listing ADR 0019 already accepts.
   */
  private key = ""

  /**
   * Where the reader is standing, or null when nothing can say.
   *
   * An island, never an index. A join merges two rows into one and shifts every row below it,
   * a split does the reverse, so a remembered position points somewhere else afterwards. The
   * id survives both — and when it does not, because a merge retired it or a split re-rooted
   * it, the mark goes rather than moving to whatever inherited the row.
   */
  private current: string | null = null

  /**
   * The island the map opened in, and a node of it that is certainly seated.
   *
   * `placed` asks after an island's *naming* node, and that node is whichever one won its
   * unions — rarely the well-connected one `rootId` picks. So the island under the reader on
   * the first frame answers "not on the map" to the only question the page can ask, and
   * clicking its row would berth a second copy of it in open water. This is the answer the
   * store gave instead, kept until the components move and retire it.
   */
  private home: { island: string; node: string } | null = null

  /** Where the next page starts, or null once the last row is here. */
  private cursor: string | null = null

  /** How many islands the store holds, against however many rows are loaded. */
  private total = 0

  /** One page in flight at a time: the sentinel fires again the moment rows land under it. */
  private loading = false

  /** The row at the foot that asks for the next page by coming into view. */
  private readonly sentinel = document.createElement("li")

  /**
   * Watches the sentinel against the list, not the window.
   *
   * `root` is the scrolling box: the panel is short and the sentinel is below the fold from
   * the first frame, so a viewport-relative observer would never fire at all.
   */
  private readonly watcher: IntersectionObserver

  constructor(
    private readonly root: HTMLElement,
    private readonly list: HTMLUListElement,
    private readonly count: HTMLElement,
    private readonly hooks: IslandsHooks,
  ) {
    this.sentinel.className = "island-more"
    this.sentinel.addEventListener("click", () => void this.more())

    this.watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void this.more()
      },
      // A margin, so the next page is asked for as the foot of the list comes near rather
      // than when it is reached. The read is the slow part; scrolling into a spinner you
      // could have been spared is the thing this buys.
      { root: this.list, rootMargin: "120px" },
    )
  }

  /**
   * The first page, as the store last reported it.
   *
   * Called on the first frame and after every write, most of which leave the components
   * exactly as they were — an edge inside one island is the common case, and it must not cost
   * the reader their scroll position or the pages they have already pulled in.
   */
  setFirstPage(page: IslandPage, total: number): void {
    this.total = total
    this.root.hidden = page.islands.length === 0

    const key = page.islands.map((island) => island.id).join("\n")
    if (key === this.key && this.rows.size > 0) {
      // The same components in the same order at the top of the list. What can still have
      // changed is which of them are on the map, and that is a class.
      this.paint()
      return
    }
    this.key = key

    // The components moved under it. If the row it was standing on is gone, nothing here can
    // say which island inherited the ground — union order picks the name — so the mark waits
    // for the next click rather than guessing.
    const listed = (id: string): boolean => page.islands.some((island) => island.id === id)
    if (this.current !== null && !listed(this.current)) this.current = null
    if (this.home !== null && !listed(this.home.island)) this.home = null

    // Back to one page. Everything past it was read against an index that has since moved,
    // and there is no cursor into the middle of the new one — a page boundary is a size and
    // an id, and a write is exactly what changes a size.
    const at = this.list.scrollTop
    this.rows.clear()
    this.list.replaceChildren()
    this.cursor = page.cursor
    this.append(page)
    // Clamped by the browser to whatever the shorter list allows.
    this.list.scrollTop = at
  }

  /**
   * Say which island the reader is standing in, and which node of it puts them back there.
   *
   * The store is the only thing that can answer either — an island is knowable from a node
   * only by asking — so this is called once, with the first frame's answer.
   */
  here(island: string | null, node: string): void {
    this.home = island === null ? null : { island, node }
    this.current = island
    this.paint()
  }

  /**
   * Rows for a page, and the sentinel after them while there are more.
   *
   * The sentinel is moved rather than remade, so the observer keeps watching one element
   * across every page. Taken out entirely on the last one: left in place with nothing behind
   * it, it is a row that says the list is still growing when it is not.
   */
  private append(page: IslandPage): void {
    for (const island of page.islands) {
      const item = document.createElement("li")
      const go = document.createElement("button")
      go.type = "button"
      go.className = "island"

      const name = document.createElement("span")
      name.className = "island-name"
      name.textContent = island.label

      go.append(name)
      go.addEventListener("click", () => {
        // Read before the mark moves: `seatOf` treats the island you are standing in as one
        // you have reached, and after this click that is a different island.
        const seat = this.seatOf(island.id)
        this.current = island.id
        this.hooks.onCross(island, seat)
        this.paint()
      })

      item.append(go)
      this.list.append(item)
      this.rows.set(island.id, go)
    }

    if (this.cursor) {
      this.sentinel.textContent = `${String(this.total - this.rows.size)} more…`
      this.list.append(this.sentinel)
      this.watcher.observe(this.sentinel)
    } else {
      this.watcher.unobserve(this.sentinel)
      this.sentinel.remove()
    }

    this.paint()
  }

  /** The next page, asked for by the foot of the list coming into view. */
  private async more(): Promise<void> {
    if (this.loading || !this.cursor) return
    this.loading = true
    // Unobserved for the duration: rows landing under the sentinel move it, and a move is an
    // intersection, which would ask for the page after this one before this one is drawn.
    this.watcher.unobserve(this.sentinel)
    this.sentinel.textContent = "loading…"

    try {
      const page = await fetchIslands(this.cursor)
      this.cursor = page.cursor
      // Which re-observes the sentinel, or takes it out on the last page. Nothing here does
      // that on the way out: the sentinel is in view for as long as it failed there, and
      // observing an element already intersecting reports it immediately — so a re-observe
      // in a `finally` is a read loop for as long as the reads keep failing.
      this.append(page)
    } catch {
      // Kept where it is, with the cursor unspent and the row left unwatched. The row becomes
      // the retry — it is already a click, and a list that has stopped growing for no stated
      // reason is worse than one saying so.
      this.sentinel.textContent = "couldn't load more — click to retry"
    } finally {
      this.loading = false
    }
  }

  /**
   * A node of this island already on the map, or null if none is known.
   *
   * Two ways to know one, and both are needed. Usually it is the island's own naming node,
   * seated by the crossing that took the reader there — which is also why walking into an
   * island across a bridge leaves its row dim: nothing seated the node the row is named
   * after. The map's opening island is the exception, and the store answered for it.
   *
   * The naming node comes first where there is a choice, so a row goes to the node it is
   * named after wherever that node is on the map.
   */
  private seatOf(id: string): string | null {
    if (this.hooks.placed(id)) return id
    return this.home?.island === id && this.home.node ? this.home.node : null
  }

  /**
   * Repaint the two things a row says beyond its name, and the heading, and nothing else.
   *
   * Cheap enough to run on every crossing: it touches the classes of rows already in the
   * document and never builds one.
   */
  paint(): void {
    for (const [id, go] of this.rows) {
      const seat = this.seatOf(id)
      go.classList.toggle("off-map", seat === null)
      // `title` carries the same difference in words, for a pointer that hovers and for a
      // reader who cannot see the dim.
      go.title =
        id === this.current
          ? "you are here"
          : seat
            ? "back to it"
            : "cross to it — this seats it on the map"

      if (id === this.current) go.setAttribute("aria-current", "true")
      else go.removeAttribute("aria-current")
    }

    // Said only while it is worth saying. "12" beside a list of twelve rows is arithmetic the
    // reader can do; "20 of 267" is the whole of what the panel would otherwise be hiding.
    this.count.textContent =
      this.rows.size < this.total ? `${String(this.rows.size)} of ${String(this.total)}` : ""

    const mark = this.current === null ? null : (this.rows.get(this.current) ?? null)
    // `nearest` so a row already on screen is left alone. A crossing that scrolled the list
    // every time would move rows the reader is aiming at.
    mark?.scrollIntoView({ block: "nearest" })
  }
}
