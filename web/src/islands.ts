/**
 * The island panel on the left. One row per connected component, each a place to go.
 *
 * Every component is listed, including the one the reader is in. Clicking a row never
 * removes it. The list is paged and the heading shows the total, because a graph can have
 * any number of components.
 */
import { fetchIslands, type IslandMeta, type IslandPage } from "./store/index.js"

export interface IslandsHooks {
  /**
   * Move the camera to this island.
   *
   * `seated` is a node of the island that is already on the map. The move is then only a
   * camera move. Null means the island has to be placed on the map first.
   */
  onCross: (island: IslandMeta, seated: string | null) => void
  /** True if this island's naming node is already on the map. */
  placed: (id: string) => boolean
}

export class IslandsPanel {
  /** One button per island, keyed by id, so a repaint does not rebuild the rows. */
  private readonly rows = new Map<string, HTMLButtonElement>()

  /**
   * The first page's island ids, joined in order. Used to detect a real change.
   *
   * Rebuilding the list resets its scroll position to the top, which loses the reader's
   * place. So the rows are built once and this key is compared after every write. Only a
   * write that changed the first page rebuilds them.
   *
   * Only the first page, because that is all a fresh read returns. A merge between two
   * islands further down the list is not visible from here and is left stale. The island
   * index already accepts the same kind of over-listing.
   */
  private key = ""

  /**
   * The island the reader is in, or null when it cannot be determined.
   *
   * This holds an island id, not a row index. A join merges two rows into one and shifts
   * every row below it. A split does the reverse. An index would then point at the wrong
   * row. The id survives both. When the id itself disappears the mark is cleared rather
   * than moved to whichever island took its place.
   */
  private current: string | null = null

  /**
   * The island the map opened in, and the node that boot placed on the map.
   *
   * `placed` asks whether an island's naming node is on the map, and the panel asks it
   * before boot has placed anything. Without this field the opening island would answer
   * "not on the map", and clicking its row would place a second copy of it. Boot supplies
   * the answer here instead. It is cleared when the components change.
   *
   * One id, not a pair. The map opens on the first row of the island page, so the component
   * and the node that names it share an id. See `Opening` in the store.
   */
  private home: string | null = null

  /** Where the next page starts, or null when the last row is loaded. */
  private cursor: string | null = null

  /** How many islands the store holds. Compared against how many rows are loaded. */
  private total = 0

  /** True while a page is being read. Stops the sentinel asking for two pages at once. */
  private loading = false

  /** The last row of the list. It asks for the next page when it scrolls into view. */
  private readonly sentinel = document.createElement("li")

  /**
   * Watches the sentinel against the list box, not the window.
   *
   * `root` is the scrolling box. The panel is short and the sentinel is below the fold from
   * the first frame, so an observer relative to the viewport would never fire.
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
      // The margin asks for the next page before the foot of the list is reached. The read
      // is the slow part, so this hides most of the wait.
      { root: this.list, rootMargin: "120px" },
    )
  }

  /**
   * Take the first page as the store last reported it.
   *
   * Called on the first frame and after every write. Most writes leave the components
   * unchanged: an edge inside one island is the common case. Those must not cost the reader
   * their scroll position or the pages already loaded.
   */
  setFirstPage(page: IslandPage, total: number): void {
    this.total = total
    this.root.hidden = page.islands.length === 0

    const key = page.islands.map((island) => island.id).join("\n")
    if (key === this.key && this.rows.size > 0) {
      // Same components in the same order. Only which of them are on the map can have
      // changed, and that is a CSS class.
      this.paint()
      return
    }
    this.key = key

    // The components changed. If a marked island is no longer listed, clear the mark. Nothing
    // here can say which island absorbed it, because union order picks the surviving name.
    const listed = (id: string): boolean => page.islands.some((island) => island.id === id)
    if (this.current !== null && !listed(this.current)) this.current = null
    if (this.home !== null && !listed(this.home)) this.home = null

    // Drop back to one page. The later pages were read against an index that has moved, and
    // there is no cursor into the middle of the new index: a page boundary is a size and an
    // id, and a write changes the size.
    const at = this.list.scrollTop
    this.rows.clear()
    this.list.replaceChildren()
    this.cursor = page.cursor
    this.append(page)
    // The browser clamps this to whatever the shorter list allows.
    this.list.scrollTop = at
  }

  /**
   * Set which island the reader is in. That island is also the way back to it.
   *
   * Only the store can answer this: finding a node's island takes a read. Boot calls this
   * once, with the answer from the first frame.
   */
  here(island: string | null): void {
    this.home = island
    this.current = island
    this.paint()
  }

  /**
   * Append one page of rows, then the sentinel if more pages remain.
   *
   * The sentinel is moved, not rebuilt, so the observer keeps watching one element across
   * every page. On the last page it is removed: left in place it would claim the list is
   * still growing.
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
        // Read this before moving the mark. `seatOf` treats the current island as reached,
        // and after this click the current island is a different one.
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

  /** Read the next page. Called when the foot of the list comes into view. */
  private async more(): Promise<void> {
    if (this.loading || !this.cursor) return
    this.loading = true
    // Stop watching while the read runs. New rows move the sentinel, and a move counts as an
    // intersection, which would request the page after this one before this one is drawn.
    this.watcher.unobserve(this.sentinel)
    this.sentinel.textContent = "loading…"

    try {
      const page = await fetchIslands(this.cursor)
      this.cursor = page.cursor
      // `append` re-observes the sentinel, or removes it on the last page. Do not re-observe
      // in a `finally` instead. After a failure the sentinel is still in view, and observing
      // an element that already intersects fires at once, which would loop on every failure.
      this.append(page)
    } catch {
      // Leave the sentinel where it is, with the cursor unspent and no observer on it. The
      // row itself becomes the retry, since it is already clickable.
      this.sentinel.textContent = "couldn't load more — click to retry"
    } finally {
      this.loading = false
    }
  }

  /**
   * A node of this island that is already on the map, or null.
   *
   * There are two ways to know one and both are needed. Usually it is the island's naming
   * node, placed by the crossing that took the reader there. Walking into an island over an
   * edge does not place that node, which is why such a row stays dim. The island the map
   * opened in is the other case, and boot answered for it through `home`.
   *
   * The answer is the island's own id either way, because both routes go through the node
   * that names it.
   */
  private seatOf(id: string): string | null {
    return this.hooks.placed(id) || this.home === id ? id : null
  }

  /**
   * Repaint the row states and the heading count. Nothing else.
   *
   * Cheap enough to run on every crossing. It sets attributes on rows that are already in
   * the document and never builds one.
   */
  paint(): void {
    for (const [id, go] of this.rows) {
      const seat = this.seatOf(id)
      go.classList.toggle("off-map", seat === null)
      // `title` says the same thing in words, for hover and for a reader who cannot see
      // the muted colour.
      go.title =
        id === this.current
          ? "you are here"
          : seat
            ? "back to it"
            : "cross to it — this seats it on the map"

      if (id === this.current) go.setAttribute("aria-current", "true")
      else go.removeAttribute("aria-current")
    }

    // Shown only when the list is capped. "12" beside twelve rows says nothing. "20 of 267"
    // says how much the panel is not showing.
    this.count.textContent =
      this.rows.size < this.total ? `${String(this.rows.size)} of ${String(this.total)}` : ""

    const mark = this.current === null ? null : (this.rows.get(this.current) ?? null)
    // `nearest` leaves a row that is already visible where it is. Scrolling on every crossing
    // would move rows out from under the pointer.
    mark?.scrollIntoView({ block: "nearest" })
  }
}
