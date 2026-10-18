/**
 * The component panel on the left. One row per connected component, each a place to go.
 *
 * Every component is listed, including the one the reader is in. Clicking a row never
 * removes it. The list is paged and the heading shows the total, because a graph can have
 * any number of components.
 *
 * The panel is a side panel at the left edge, and its list scrolls without a scrollbar. What the
 * bar used to say is said by the sentinel row and by `markMore` below. See ADR 0041.
 */
import { fetchComponents, type ComponentMeta, type ComponentPage } from "./store/index.js"

export interface ComponentsHooks {
  /**
   * Move the camera to this component.
   *
   * `placedId` is a node of the component that is already on the map. The move is then only a
   * camera move. Null means the component has to be placed on the map first.
   */
  onCross: (component: ComponentMeta, placedId: string | null) => void
  /** True if this component's naming node is already on the map. */
  placed: (id: string) => boolean
}

export class ComponentsPanel {
  /** One button per component, keyed by id, so a repaint does not rebuild the rows. */
  private readonly rows = new Map<string, HTMLButtonElement>()

  /**
   * The first page's component ids, joined in order. Used to detect a real change.
   *
   * Rebuilding the list resets its scroll position to the top, which loses the reader's
   * place. So the rows are built once and this key is compared after every write. Only a
   * write that changed the first page rebuilds them.
   *
   * Only the first page, because that is all a fresh read returns. A merge between two
   * components further down the list is not visible from here and is left stale. The component
   * index already accepts the same kind of over-listing.
   */
  private key = ""

  /**
   * The component the reader is in, or null when it cannot be determined.
   *
   * This holds a component id, not a row index. A join merges two rows into one and shifts
   * every row below it. A split does the reverse. An index would then point at the wrong
   * row. The id survives both. When the id itself disappears the mark is cleared rather
   * than moved to whichever component took its place.
   */
  private current: string | null = null

  /**
   * The component the map opened in, and the node that boot placed on the map.
   *
   * `placed` asks whether a component's naming node is on the map, and the panel asks it
   * before boot has placed anything. Without this field the opening component would answer
   * "not on the map", and clicking its row would place a second copy of it. Boot supplies
   * the answer here instead. It is cleared when the components change.
   *
   * One id, not a pair. The map opens on the first row of the component page, so the component
   * and the node that names it share an id. See `Opening` in the store.
   */
  private start: string | null = null

  /** Where the next page starts, or null when the last row is loaded. */
  private cursor: string | null = null

  /** How many components the store holds. Compared against how many rows are loaded. */
  private total = 0

  /** True while a page is being read. Stops the sentinel asking for two pages at once. */
  private loading = false

  /** The last row of the list. It asks for the next page when it scrolls into view. */
  private readonly sentinel = document.createElement("li")

  /**
   * Watches the sentinel against the list box, not the window.
   *
   * `root` is the scrolling box. The list scrolls inside the side panel, so the sentinel can sit
   * far below the fold and inside the viewport at once. An observer against the viewport would
   * never fire on it.
   */
  private readonly watcher: IntersectionObserver

  constructor(
    private readonly root: HTMLElement,
    private readonly list: HTMLUListElement,
    private readonly count: HTMLElement,
    private readonly hooks: ComponentsHooks,
  ) {
    this.sentinel.className = "component-more"
    this.sentinel.addEventListener("click", () => void this.more())

    // The list has no scrollbar, so nothing else on the panel says rows continue below the
    // fold. app.css draws the fade off the attribute `markMore` sets.
    //
    // Three things move the answer and none of them implies the others. A scroll changes where
    // the fold is. A resized window changes how much of the list is shown. Appending rows
    // changes how much there is, and `append` calls it for that.
    this.list.addEventListener("scroll", () => this.markMore(), { passive: true })
    new ResizeObserver(() => this.markMore()).observe(this.list)

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
   * unchanged: an edge inside one component is the common case. Those must not cost the reader
   * their scroll position or the pages already loaded.
   */
  setFirstPage(page: ComponentPage, total: number): void {
    this.total = total
    this.root.hidden = page.components.length === 0

    const key = page.components.map((component) => component.id).join("\n")
    if (key === this.key && this.rows.size > 0) {
      // Same components in the same order. Only which of them are on the map can have
      // changed, and that is a CSS class.
      this.paint()
      return
    }
    this.key = key

    // The components changed. If a marked component is no longer listed, clear the mark. Nothing
    // here can say which component absorbed it, because union order picks the surviving name.
    const listed = (id: string): boolean => page.components.some((component) => component.id === id)
    if (this.current !== null && !listed(this.current)) this.current = null
    if (this.start !== null && !listed(this.start)) this.start = null

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
   * Set which component the reader is in. That component is also the way back to it.
   *
   * Only the store can answer this: finding a node's component takes a read. Boot calls this
   * once, with the answer from the first frame.
   */
  here(component: string | null): void {
    this.start = component
    this.current = component
    this.paint()
  }

  /**
   * Append one page of rows, then the sentinel if more pages remain.
   *
   * The sentinel is moved, not rebuilt, so the observer keeps watching one element across
   * every page. On the last page it is removed: left in place it would claim the list is
   * still growing.
   */
  private append(page: ComponentPage): void {
    for (const component of page.components) {
      const item = document.createElement("li")
      const go = document.createElement("button")
      go.type = "button"
      go.className = "component"

      const name = document.createElement("span")
      name.className = "component-name"
      name.textContent = component.label

      go.append(name)
      go.addEventListener("click", () => {
        // Read this before moving the mark. `placedIdOf` treats the current component as reached,
        // and after this click the current component is a different one.
        const placedId = this.placedIdOf(component.id)
        this.current = component.id
        this.hooks.onCross(component, placedId)
        this.paint()
      })

      item.append(go)
      this.list.append(item)
      this.rows.set(component.id, go)
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
    this.markMore()
  }

  /**
   * Say whether rows sit past the foot of the list.
   *
   * Read rather than inferred from the cursor: rows already loaded can be below the fold with
   * no page left to load. A list scrolled to its end says no, so the fade never covers the
   * last row.
   */
  private markMore(): void {
    const more = this.list.scrollTop + this.list.clientHeight < this.list.scrollHeight - 1
    if (more) this.root.dataset["more"] = "true"
    else delete this.root.dataset["more"]
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
      const page = await fetchComponents(this.cursor)
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
   * A node of this component that is already on the map, or null.
   *
   * There are two ways to know one and both are needed. Usually it is the component's naming
   * node, placed by the crossing that took the reader there. Walking into a component over an
   * edge does not place that node, which is why such a row stays dim. The component the map
   * opened in is the other case, and boot answered for it through `start`.
   *
   * The answer is the component's own id either way, because both routes go through the node
   * that names it.
   */
  private placedIdOf(id: string): string | null {
    return this.hooks.placed(id) || this.start === id ? id : null
  }

  /**
   * Repaint the row states and the heading count. Nothing else.
   *
   * Cheap enough to run on every crossing. It sets attributes on rows that are already in
   * the document and never builds one.
   */
  paint(): void {
    for (const [id, go] of this.rows) {
      const placedId = this.placedIdOf(id)
      go.classList.toggle("off-map", placedId === null)
      // `title` says the same thing in words, for hover and for a reader who cannot see
      // the muted colour.
      go.title =
        id === this.current
          ? "you are here"
          : placedId
            ? "back to it"
            : "cross to it. This places it on the map"

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
