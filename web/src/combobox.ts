/**
 * A text box that hands back nodes, not text.
 *
 * The distinction is the whole reason this exists. Search is a prefix query capped at
 * twenty (src/graph/labels.ts), so several nodes can answer to what has been typed and a
 * string is never enough to say which one was meant. Every box in the app that names a node
 * therefore resolves it here first, and its caller only ever sees a `NodeMeta`.
 *
 * Two of these run, one at each end of the panel that names an edge. They differ in nothing
 * but which end they report to.
 *
 * Keyboard, because a box you have to click is a box you can only use once in a row:
 *
 *   ↑ ↓      move the highlight, wrapping at both ends
 *   ↵        take the highlighted row
 *   ⇧↵       create exactly what is typed, whatever the list shows
 *   ⌘↵       either of those, and go on from what it named
 *   Esc      close the list; again, empty the box and let the focus go
 *
 * The two Enters are the whole shape of it. `↵` takes the best match, so typing a prefix
 * and pressing it is how you reach a node that exists — the common thing, and the reason
 * this resolves names at all. Creating is a different act with a different key, and never
 * the one a half-typed name falls into: `ash` is far more often the start of `Ashanlin`
 * than a node somebody means to make.
 *
 * The one place they meet is a name matching nothing. There is no best match to take, so
 * `↵` creates too rather than doing nothing at all.
 *
 * ⌘ rides on either Enter rather than adding a third. It says nothing about which node is
 * meant — only what should happen once one is — and travels out on the pick as `chain`:
 * what going on from a name means belongs to whoever owns the box.
 */
import { Cancelled, searchLabels, type NodeMeta } from "./api.js"
import { debounce } from "./explore.js"

/**
 * How long the box waits before asking.
 *
 * Shorter than either camera settle: nothing is being drawn and no seat is at stake, so the
 * only cost of being early is a request, and the only cost of being late is a box that
 * feels slow. Roughly the gap between keystrokes at a normal typing speed.
 */
export const SEARCH_DEBOUNCE_MS = 140

/** What a pick can be. A create row carries no node, because there is not one yet. */
export type Picked =
  | { kind: "node"; node: NodeMeta }
  | { kind: "create"; label: string }

export interface ComboboxHooks {
  /**
   * A name was taken. `chain` is the ⌘ variant of taking it: the same pick, plus a request
   * to go on from what it named.
   */
  onPick: (picked: Picked, chain: boolean) => void
  onError: (message: string) => void
  /** The box was emptied by `Esc`, rather than by a pick or a blur. */
  onEmptied?: () => void
  /** Offer `+ create "…"` when nothing already carries the typed name. */
  allowCreate?: boolean
  /** Hover text for a row, for whatever the caller knows that this does not. */
  note?: (node: NodeMeta) => string
}

/** The same shallow rule as `normaliseLabel` in src/graph/keys.ts. */
export const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ")

export class Combobox {
  private rows: Picked[] = []
  private at = -1
  /** The query in the air, so a slower earlier reply cannot overwrite a later one. */
  private searching: AbortController | null = null
  private readonly run: (after?: number) => void

  constructor(
    private readonly input: HTMLInputElement,
    private readonly list: HTMLUListElement,
    private readonly hooks: ComboboxHooks,
  ) {
    this.run = debounce(() => void this.query(), SEARCH_DEBOUNCE_MS)
    input.addEventListener("input", () => this.run())
    input.addEventListener("keydown", (event) => this.onKey(event))
    // Losing focus closes the list, but not before a click on it has been delivered — the
    // rows fire on mousedown for exactly this reason.
    input.addEventListener("blur", () => setTimeout(() => this.close(), 0))
  }

  get open(): boolean {
    return this.rows.length > 0
  }

  focus(): void {
    this.input.focus()
  }

  /** Empty the box and put the list away, without asking for anything. */
  clear(): void {
    this.input.value = ""
    this.searching?.abort()
    this.close()
  }

  private close(): void {
    this.rows = []
    this.at = -1
    this.list.replaceChildren()
  }

  private take(index: number, chain: boolean): void {
    const row = this.rows[index]
    if (!row) return
    this.close()
    this.hooks.onPick(row, chain)
  }

  private onKey(event: KeyboardEvent): void {
    // An IME confirming a conversion fires Enter too. That keystroke belongs to the text
    // being composed, not to the list — without this it would pick a row mid-word.
    if (event.isComposing) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!this.rows.length) return
      // The arrows pan the camera everywhere else, and inside a text box they move the
      // caret. Here they do neither, so both defaults have to go.
      event.preventDefault()
      // The extra length keeps the sum positive: `at` starts at -1 whenever the only row
      // is a create row, and a bare modulo would hand back -0 for it.
      const step = event.key === "ArrowDown" ? 1 : this.rows.length - 1
      this.at = (this.at + step + this.rows.length) % this.rows.length
      this.paint()
      return
    }

    if (event.key === "Enter") {
      // ⌘ modifies both branches below rather than choosing between them, so it is read
      // before either. Ctrl with it, for a keyboard that has no ⌘ to hold.
      const chain = event.metaKey || event.ctrlKey

      // Shift means create, and it does not care what is highlighted or whether the list
      // has even opened yet — it is the one gesture that says what it does on its own.
      if (event.shiftKey) {
        const text = this.input.value.trim()
        if (!this.hooks.allowCreate || !text) return
        event.preventDefault()
        this.close()
        this.hooks.onPick({ kind: "create", label: text }, chain)
        return
      }
      if (this.at < 0) return
      event.preventDefault()
      this.take(this.at, chain)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      // Two meanings, nearest first: put the list away, or empty the box and let the focus
      // go — what else that costs is the caller's to say, through `onEmptied`.
      if (this.rows.length) this.close()
      else {
        this.input.value = ""
        this.hooks.onEmptied?.()
        this.input.blur()
      }
    }
  }

  private async query(): Promise<void> {
    const text = this.input.value.trim()
    this.searching?.abort()
    if (!text) return this.close()

    const control = new AbortController()
    this.searching = control

    let found: NodeMeta[]
    try {
      found = await searchLabels(text, control.signal)
    } catch (err) {
      if (err instanceof Cancelled) return
      this.hooks.onError(err instanceof Error ? err.message : String(err))
      return
    }
    if (control.signal.aborted) return

    this.rows = found.map((node) => ({ kind: "node", node }) as const)
    // Offered only when nothing already carries that exact name — otherwise the row would
    // promise something the store is bound to refuse.
    if (this.hooks.allowCreate && !found.some((n) => norm(n.label) === norm(text))) {
      this.rows.push({ kind: "create", label: text })
    }
    // The best match takes the highlight. With nothing found there is no best match, and
    // the create row is the only thing `↵` could sensibly mean, so it takes it instead —
    // the one case where the two Enters agree. Whenever a real node is on offer the
    // highlight is on that, and creating stays behind `⇧↵` or a deliberate `↑`.
    this.at = this.rows.length ? 0 : -1
    this.paint(text)
  }

  private paint(query = this.input.value.trim()): void {
    this.list.replaceChildren()

    if (!this.rows.length) {
      const empty = document.createElement("li")
      empty.className = "empty"
      empty.textContent = `nothing starts with “${query}”`
      this.list.append(empty)
      return
    }

    this.rows.forEach((row, i) => {
      const button = document.createElement("button")
      button.type = "button"
      button.dataset["on"] = String(i === this.at)

      if (row.kind === "create") {
        const made = document.createElement("span")
        made.className = "create"
        made.textContent = `+ create “${row.label}”`
        button.append(made)
        button.title = "a node with this name does not exist yet"
      } else {
        const name = document.createElement("span")
        name.textContent = row.node.label
        const degree = document.createElement("span")
        degree.className = "degree"
        degree.textContent = String(row.node.degree)
        degree.title = this.hooks.note?.(row.node) ?? `${String(row.node.degree)} edges`
        button.append(name, degree)
      }

      // mousedown, not click: the input's blur would close the list out from under a click
      // before it landed. ⌘ carries here too — a row and the key that takes it are the same
      // act, and a reader who has learned the modifier will hold it over either. Not Ctrl:
      // holding that over a click is how a Mac asks for the other button, and a secondary
      // click quietly moving the anchor would put the next edge somewhere nobody meant.
      button.addEventListener("mousedown", (event) => {
        event.preventDefault()
        this.take(i, event.metaKey)
      })

      const item = document.createElement("li")
      item.append(button)
      this.list.append(item)
    })
  }
}
