/**
 * The box that renames a node: an input, one row, and `↵`.
 *
 * The row is a verdict rather than a list. `judge` reads one key, the typed name, and the row
 * reports whether the store already holds it. A prefix match cannot block a rename, so there
 * is nothing else to show and no highlight to move.
 *
 * `Combobox` therefore stays where it is. That class searches by prefix, moves a highlight,
 * and offers to create what was typed; none of the three has a part here. Reusing it would
 * mean changing it, and it carries the join panel's keyboard.
 *
 * What it does borrow is `↻ update` as a row rather than a button. `+ create “…”` is already a
 * row that fires a write, so `↵` taking a row is a key that already means this.
 */
import { readNode } from "./store/index.js"
import { normaliseLabel } from "./store/keys.js"
import type { NodeMeta } from "./store/index.js"

export interface RenameHooks {
  /** The reader asked for this name. The caller writes it, and reports what happened. */
  onRename: (next: string) => void
  onError: (message: string) => void
}

/** What the row says, and whether `↵` does anything. */
type Verdict = "armed" | "taken" | "empty"

export class RenameBox {
  /** The node being renamed, or null while the box is closed. */
  private node: NodeMeta | null = null
  private verdict: Verdict = "empty"

  /**
   * Which query the row came from. A slow earlier reply must not paint over a later one.
   *
   * The same counter `Combobox` keeps, and for the same reason. A read of IndexedDB cannot be
   * cancelled, so ordering is the only part of the problem left to solve.
   */
  private asked = 0

  constructor(
    private readonly input: HTMLInputElement,
    private readonly row: HTMLButtonElement,
    private readonly hooks: RenameHooks,
  ) {
    this.input.addEventListener("input", () => void this.judge())
    this.input.addEventListener("keydown", (event) => this.onKey(event))
    // The row is a button so it can be clicked as well as fired from the keyboard.
    this.row.addEventListener("click", () => this.fire())
  }

  /**
   * Open on a node. The input starts at the name it already has, selected.
   *
   * No query runs. The row would say `↻ update` on a name that is not being changed yet, and
   * offering the write before anything is typed says nothing.
   */
  open(node: NodeMeta): void {
    this.node = node
    this.asked++
    this.input.value = node.label
    this.paint("empty")
    this.input.focus()
    this.input.select()
  }

  close(): void {
    this.node = null
    this.asked++
    this.input.value = ""
    this.paint("empty")
  }

  /**
   * Ask the store whether the typed name is free, and say so.
   *
   * A node never blocks itself. Typing `ASHANLIN` over `Ashanlin` is the case-only rename,
   * which the store accepts, so the row stays armed when the match found is this node.
   *
   * The verdict is advice. `renameNode` tests the name again inside its transaction, because
   * another tab can claim it between this read and that write.
   */
  private async judge(): Promise<void> {
    const node = this.node
    const key = normaliseLabel(this.input.value)
    const mine = ++this.asked
    if (!node) return
    if (!key) return this.paint("empty")

    let found: NodeMeta | null
    try {
      found = await readNode(key)
    } catch (err) {
      this.hooks.onError(err instanceof Error ? err.message : String(err))
      return
    }
    if (mine !== this.asked) return

    this.paint(found && found.id !== node.id ? "taken" : "armed")
  }

  private paint(verdict: Verdict): void {
    this.verdict = verdict
    this.row.hidden = verdict === "empty"
    this.row.dataset["state"] = verdict
    this.row.textContent = verdict === "taken" ? "is taken" : "↻ update"
    // A row that fires nothing must not be reachable by tab or answer to a click.
    this.row.disabled = verdict !== "armed"
  }

  /** Fire the rename, if the row is offering one. */
  private fire(): void {
    if (this.verdict !== "armed") return
    const next = this.input.value.trim()
    if (!next) return
    this.hooks.onRename(next)
  }

  private onKey(event: KeyboardEvent): void {
    // An IME fires Enter to confirm a conversion. That keystroke belongs to the text being
    // composed, not to the row.
    if (event.isComposing) return
    if (event.key !== "Enter") return
    event.preventDefault()
    this.fire()
  }
}
