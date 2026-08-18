/**
 * A text box that returns nodes, not text.
 *
 *   ↑ ↓      move the highlight, wrapping at both ends
 *   ↵        take the highlighted row
 *   ⇧↵       create the typed name, unless a node already has it
 *   ⌘↵       either of those, then continue from the node it named
 *   Esc      close the list; press again to empty the box and drop focus
 *
 * Both forms of Enter run a search first if the box has no rows yet. ⌘ is a modifier on
 * both, not a third command. It does not change which node is meant, only what happens
 * afterwards, and it is passed out on the pick as `chain`.
 */
import { searchLabels, type NodeMeta } from "./store/index.js"

/** What a pick can be. A create row has no node, because that node does not exist yet. */
export type Picked =
  | { kind: "node"; node: NodeMeta }
  | { kind: "create"; label: string }

export interface ComboboxHooks {
  /**
   * A name was picked. `chain` is true for the ⌘ form: the same pick, plus a request to
   * continue from the node it named.
   */
  onPick: (picked: Picked, chain: boolean) => void
  onError: (message: string) => void
  /** The box was emptied by `Esc`, not by a pick or a blur. */
  onEmptied?: () => void
  /** Offer a `+ create "…"` row when no node has the typed name. */
  allowCreate?: boolean
  /** Hover text for a row. The caller supplies what this class does not know. */
  note?: (node: NodeMeta) => string
}

/** The same rule as `normaliseLabel` in web/src/store/keys.ts. */
export const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ")

export class Combobox {
  private rows: Picked[] = []
  private at = -1
  /**
   * Which query the current rows came from. A slow earlier reply must not overwrite a
   * later one.
   *
   * This is a counter, not an abort controller. The box used to debounce and cancel the
   * request in flight, because each keystroke was a network request. A search is now a key
   * range over IndexedDB: there is nothing to debounce, and the read cannot be cancelled.
   * Only the ordering problem is left, and the counter handles that.
   */
  private asked = 0

  constructor(
    private readonly input: HTMLInputElement,
    private readonly list: HTMLUListElement,
    private readonly hooks: ComboboxHooks,
  ) {
    input.addEventListener("input", () => void this.query())
    input.addEventListener("keydown", (event) => this.onKey(event))
    // Blur closes the list, but only after a click on a row has been delivered. That is why
    // the rows listen for mousedown rather than click.
    input.addEventListener("blur", () => setTimeout(() => this.close(), 0))
  }

  get open(): boolean {
    return this.rows.length > 0
  }

  focus(): void {
    this.input.focus()
  }

  /** Empty the box and close the list. Runs no query. */
  clear(): void {
    this.input.value = ""
    // Bump the counter so any reply still in flight is discarded.
    this.asked++
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

  /**
   * Handle both forms of Enter.
   *
   * A pick comes from the rows, and the box often has no rows: before the first search has
   * returned, and after `Esc` closed the list. So run the query first when there are none,
   * then compare the typed text against what the store returned. The create branch needs
   * this most, since without it that branch would act without checking for a duplicate.
   */
  private async enter(text: string, create: boolean, chain: boolean): Promise<void> {
    if (!this.rows.length) await this.query()
    // The box changed while the query ran. This keystroke was aimed at the old text, and a
    // search for the new text is already running.
    if (this.input.value.trim() !== text) return

    if (create) {
      if (!this.hooks.allowCreate) return
      // A name that already exists cannot be created. The store holds one node per name and
      // refuses the second. That is why `query` withholds the create row on an exact match,
      // and ⇧↵ follows the same rule here: it picks the existing node instead.
      const carried = this.rows.find(
        (row) => row.kind === "node" && norm(row.node.label) === norm(text),
      )
      this.close()
      this.hooks.onPick(carried ?? { kind: "create", label: text }, chain)
      return
    }

    if (this.at < 0) return
    this.take(this.at, chain)
  }

  private onKey(event: KeyboardEvent): void {
    // An IME fires Enter when it confirms a conversion. That keystroke belongs to the text
    // being composed, not to the list. Without this check it would pick a row mid-word.
    if (event.isComposing) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!this.rows.length) return
      // The arrows pan the camera elsewhere on the page, and move the caret inside a text
      // box. Here they do neither, so prevent both defaults.
      event.preventDefault()
      // Adding `rows.length` keeps the sum positive. `at` can be -1, and a plain modulo
      // would return a negative index for it.
      const step = event.key === "ArrowDown" ? 1 : this.rows.length - 1
      this.at = (this.at + step + this.rows.length) % this.rows.length
      this.paint()
      return
    }

    if (event.key === "Enter") {
      // ⌘ modifies both branches below rather than choosing between them, so read it first.
      // Ctrl counts too, for keyboards without a ⌘ key.
      const chain = event.metaKey || event.ctrlKey
      const text = this.input.value.trim()
      if (!text) return
      event.preventDefault()
      void this.enter(text, event.shiftKey, chain)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      // Esc does the nearest thing first: close the list. With the list already closed it
      // empties the box and drops focus. The caller handles the rest through `onEmptied`.
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
    const mine = ++this.asked
    if (!text) return this.close()

    let found: NodeMeta[]
    try {
      found = await searchLabels(text)
    } catch (err) {
      this.hooks.onError(err instanceof Error ? err.message : String(err))
      return
    }
    if (mine !== this.asked) return

    this.rows = found.map((node) => ({ kind: "node", node }) as const)
    // Offer the create row only when no node has that exact name. Otherwise the row would
    // offer a write the store is going to refuse.
    if (this.hooks.allowCreate && !found.some((n) => norm(n.label) === norm(text))) {
      this.rows.push({ kind: "create", label: text })
    }
    // The first row takes the highlight. When nothing was found the create row is the first
    // row, so ↵ and ⇧↵ do the same thing. When a real node was found the highlight is on
    // that node, and creating needs ⇧↵ or an arrow key.
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

      // mousedown, not click. The input's blur would close the list before a click landed.
      // ⌘ works here as well as on the keyboard. Ctrl does not: on a Mac, Ctrl with a click
      // is a right-click, and that would move the anchor without the user meaning to.
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
