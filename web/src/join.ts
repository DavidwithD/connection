/**
 * The panel at the top of the map: two name inputs, and the writes they make.
 *
 * The panel shows one input until a name is picked, then two. The input that completed the
 * pair is emptied, so the next name can be typed without moving the caret. The other input
 * holds the anchor. `⌘↵` moves the anchor instead. `Esc` closes the panel. Every pick writes
 * at once, and every write can be undone.
 */
import {
  Refused,
  createNode,
  deleteNode,
  joinNodes,
  unjoinNodes,
  type NodeMeta,
} from "./store/index.js"
import { Combobox, norm, type ComboboxHooks, type Picked } from "./combobox.js"
import type { Receipt, Writes } from "./writes.js"

/**
 * A name held by one of the two inputs.
 *
 * One object is made per pick, and a queued write holds that object rather than the input it
 * came from. Retyping an input therefore cannot redirect a write already in the queue: the
 * write keeps the anchor it was made with, while the input has moved on to a new one.
 *
 * `node` is filled in by the first write that needs it. Several writes aimed at a name that
 * does not exist yet then create that node once.
 */
interface Anchor {
  readonly label: string
  node: NodeMeta | null
}

/** A write that landed, and what is needed to reverse it. */
interface Done {
  a: NodeMeta
  b: NodeMeta
  /** The node this write created, or null if it created none. */
  created: NodeMeta | null
}

export interface EndElements {
  /** The wrapper element. Hidden and shown as the panel grows and shrinks. */
  field: HTMLElement
  input: HTMLInputElement
  list: HTMLUListElement
  clear: HTMLButtonElement
}

export interface PanelElements {
  near: EndElements
  far: EndElements
  link: HTMLElement
}

export interface PanelHooks {
  /** A node now exists in the store. Put it on the map. */
  onNode: (node: NodeMeta) => void
  /** An edge now exists in the store. Draw it and raise both degrees. */
  onEdge: (a: NodeMeta, b: NodeMeta) => void
  /**
   * A write was reversed in the store. Remove it from the map and lower both degrees.
   * `removed` is the node deleted with it, or null if the node stayed. It stays when
   * something else has been joined to it since.
   */
  onUndone: (a: NodeMeta, b: NodeMeta, removed: NodeMeta | null) => void
  /**
   * An input became the anchor. Move the camera to that node.
   *
   * Called on becoming the anchor only, never on completing a pair. The anchor is what the
   * reader is working from and should be in view. Following every name in a fast run would
   * drag the camera after each one.
   */
  onArm: (node: NodeMeta) => void
  onStatus: (text: string, tone: "idle" | "busy" | "error") => void
  /** Hover text for a row. The map supplies what this panel does not know. */
  note: (node: NodeMeta) => string
}

/** One of the two inputs. */
class Side {
  anchor: Anchor | null = null
  readonly box: Combobox

  constructor(
    readonly ui: EndElements,
    hooks: ComboboxHooks,
  ) {
    this.box = new Combobox(ui.input, ui.list, hooks)
  }
}

export class JoinPanel {
  private readonly near: Side
  private readonly far: Side

  constructor(
    private readonly ui: PanelElements,
    private readonly hooks: PanelHooks,
    private readonly writes: Writes,
  ) {
    this.near = new Side(ui.near, this.wiring(() => this.near))
    this.far = new Side(ui.far, this.wiring(() => this.far))

    for (const side of [this.near, this.far]) {
      side.ui.clear.addEventListener("click", () => this.clear(side))
      // Typing over a name without picking anything would leave the input showing one node
      // while writes still go to another. On blur, put back what the input actually holds.
      // A pick is not lost this way: the rows fire on mousedown, which happens before blur.
      side.ui.input.addEventListener("blur", () => this.paint())
    }
    this.paint()
  }

  private wiring(self: () => Side): ComboboxHooks {
    return {
      allowCreate: true,
      note: this.hooks.note,
      onPick: (picked, chain) => this.pick(self(), picked, chain),
      onError: (message) => this.hooks.onStatus(`⚠ ${message}`, "error"),
      // Emptying the input is how a name is released. Without this the name would reappear
      // on blur, and `Esc` would look like it did nothing.
      onEmptied: () => this.collapse(),
    }
  }

  /**
   * Put the caret in the near input, ready for a name.
   *
   * This is what `/` calls from anywhere on the page. See web/src/main.ts. The text is
   * selected rather than appended to: an input already holding an anchor is one the reader
   * means to type over. Leaving without picking restores what is actually held.
   */
  focus(): void {
    this.near.ui.input.focus()
    this.near.ui.input.select()
  }

  /**
   * Take a name from outside the panel. The map calls this when the centre node is clicked.
   * See web/src/main.ts.
   *
   * The name goes into whichever input is not the anchor, which is where typing it would put
   * it. The two inputs hold one anchor between them, so a name reaching the free input makes
   * a pair, and a pair is an edge. The first click sets the anchor, the second writes. After
   * that this is the panel's normal behaviour: a receipt that can reverse it, and an anchor
   * left for the next click. `⌘` moves the anchor instead, as it does on a list row.
   *
   * The caret ends up in whichever input is free afterwards, so the next name can be typed
   * or clicked without moving it.
   */
  take(node: NodeMeta, chain: boolean): void {
    this.pick(this.free(), { kind: "node", node }, chain)
    // Ask again, because the pick moved it. The input that took the name is the anchor now.
    this.free().ui.input.focus()
  }

  /**
   * Empty both inputs and shrink the panel back to one.
   *
   * Both, because the two inputs are one widget and this is how the reader leaves it.
   * Clearing only the focused input would return focus to the map with the other still set,
   * and `/` would come back to the near input, from where the next name would join to
   * whatever the far input kept. This unwrites nothing: the inputs hold names, and a write
   * that landed has its own undo.
   *
   * Focus is dropped too, because `Esc` is also how the reader leaves the panel.
   */
  private collapse(): void {
    for (const side of [this.near, this.far]) {
      side.box.clear()
      side.anchor = null
    }
    this.paint()
  }

  private other(side: Side): Side {
    return side === this.near ? this.far : this.near
  }

  /**
   * The input a name from outside goes into: the one not holding the anchor.
   *
   * The near input when neither holds one. A first name always goes there.
   */
  private free(): Side {
    return this.near.anchor ? this.far : this.near
  }

  /** A name was picked in one input. Make it the anchor, or join it to the other input. */
  private pick(side: Side, picked: Picked, chain: boolean): void {
    const label = picked.kind === "node" ? picked.node.label : picked.label
    const other = this.other(side)
    const anchor = other.anchor

    if (anchor && this.same(anchor, picked)) {
      this.hooks.onStatus("⚠ a node cannot be joined to itself", "error")
      return
    }

    const named: Anchor = { label, node: picked.kind === "node" ? picked.node : null }

    if (!anchor) {
      side.anchor = named
      // Set here rather than in `paint`, which does not touch an input being typed in.
      side.ui.input.value = label
      this.paint()
      // A name with no node behind it has nowhere for the camera to go. It gets a position
      // near the camera when a write creates it, like any other node arriving by name.
      if (named.node) this.hooks.onArm(named.node)
      return
    }

    // Empty this input now, not when the write lands. The next name is already being typed
    // into it.
    side.box.clear()
    side.anchor = null

    // ⌘ moves the anchor to the other input, the one not being typed in, so the caret stays
    // where it is. The two inputs hold one anchor, so the previous one is released.
    //
    // This stores the same object the queued write holds, not a copy. A name that write has
    // yet to create then becomes a node in both places at once. The write keeps the pair it
    // was made with either way, because it holds `anchor`, which is no longer in an input.
    if (chain) {
      other.anchor = named
      // The camera follows the anchor, and this input is the anchor now. As above, a name
      // with no node behind it has nowhere to go.
      if (named.node) this.hooks.onArm(named.node)
    }
    this.paint()

    const pair: [Anchor, Anchor] = side === this.near ? [named, anchor] : [anchor, named]
    const receipt = this.receipt(pair, picked.kind === "create")
    this.writes.run(receipt, () => this.write(anchor, named, receipt))
  }

  /** True if a pick names what the other input already holds. */
  private same(anchor: Anchor, picked: Picked): boolean {
    if (picked.kind === "node") {
      return anchor.node ? anchor.node.id === picked.node.id : false
    }
    // Only reached between two names that do not exist yet. A create row is offered only
    // when no node has that name, so it cannot match a node that does exist.
    return !anchor.node && norm(anchor.label) === norm(picked.label)
  }

  /**
   * Return the node behind a name, creating it if this is the first write to need it.
   *
   * The result is stored on the anchor, so several writes aimed at a name that does not
   * exist yet create it once and join to it after that.
   */
  private async realise(anchor: Anchor): Promise<NodeMeta> {
    if (anchor.node) return anchor.node
    const made = await createNode(anchor.label)
    anchor.node = made
    this.hooks.onNode(made)
    // It is a node now, not a pending name. Repaint so the input stops marking it as new.
    this.paint()
    return made
  }

  private async write(anchor: Anchor, fired: Anchor, receipt: Receipt): Promise<void> {
    try {
      // Create the anchor first, and only once. It is not part of what an undo reverses:
      // it is what the reader is working from, and deleting it would empty the input that
      // still names it.
      const a = await this.realise(anchor)
      const fresh = !fired.node
      const b = await this.realise(fired)

      await joinNodes(a.id, b.id)
      this.hooks.onEdge(a, b)
      receipt.settle("ok", `joined ${a.label} and ${b.label}`)
      this.offerUndo(receipt, { a, b, created: fresh ? b : null })
      this.hooks.onStatus(`joined ${a.label} and ${b.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // A refusal is the graph saying no. Anything else is the write failing. Both stop this
      // pair. Neither stops the next one, because `Writes.run` catches.
      receipt.settle("warn", reason)
      this.hooks.onStatus(`⚠ ${reason}`, "error")
    }
  }

  /**
   * Reverse a write that landed.
   *
   * The edge first, then the node it created. That is the create-then-join order run
   * backwards, and it is required: the store refuses to delete a node that still has edges.
   * If something else has been joined to that node since, the delete is refused and the node
   * stays. The edge is still removed, which is what was asked for.
   */
  private async revert(receipt: Receipt, done: Done): Promise<void> {
    try {
      await unjoinNodes(done.a.id, done.b.id)

      let removed: NodeMeta | null = null
      if (done.created) {
        try {
          await deleteNode(done.created.id)
          removed = done.created
        } catch (err) {
          if (!(err instanceof Refused)) throw err
        }
      }

      this.hooks.onUndone(done.a, done.b, removed)
      // The deleted name may still be in an input, because `⌘↵` puts it there. Release it.
      // `reuse` blocks the same dead name for the same reason.
      if (removed) this.forget(removed)
      const fate = removed ? `${done.b.label} removed` : `${done.b.label} left in place`
      receipt.settle("undone", fate)
      this.hooks.onStatus(`undid ${done.a.label} and ${done.b.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      receipt.settle("warn", reason)
      this.hooks.onStatus(`⚠ ${reason}`, "error")
    }
  }

  /**
   * Release a node that is no longer in the store, from whichever input holds it.
   *
   * Two things delete a node: the undo above, and deleting the centre node on the map. See
   * web/src/main.ts. Both call this.
   */
  forget(node: NodeMeta): void {
    for (const side of [this.near, this.far]) {
      if (side.anchor?.node?.id !== node.id) continue
      side.anchor = null
      // Never clear an input being typed in, the same rule `paint` follows. The anchor is
      // what has to go. Half-typed text belongs to whoever is typing it.
      if (document.activeElement !== side.ui.input) side.box.clear()
    }
    this.paint()
  }

  private paint(): void {
    for (const side of [this.near, this.far]) {
      const anchor = side.anchor
      // Never write over an input being typed in. A write landing mid-word would replace
      // half-typed text with whatever the input held before.
      if (document.activeElement !== side.ui.input) side.ui.input.value = anchor?.label ?? ""
      // A name still to be created shows as chosen, and marked as not in the graph yet.
      side.ui.input.dataset["state"] = anchor ? (anchor.node ? "set" : "new") : ""
      side.ui.clear.hidden = !side.ui.input.value
    }
    // Expanded while either input holds a name, not only the near one. The input that
    // completed the pair is emptied, so testing the near input alone would collapse the
    // panel on every write and take the far input's anchor with it.
    const grown = Boolean(this.near.anchor ?? this.far.anchor)
    this.ui.far.field.hidden = !grown
    this.ui.link.hidden = !grown
  }

  private clear(side: Side): void {
    side.box.clear()
    side.anchor = null
    this.paint()
    side.ui.input.focus()
  }

  private receipt(pair: [Anchor, Anchor], isNew: boolean): Receipt {
    const chip = this.writes.open()
    if (isNew) chip.el.dataset["new"] = "true"

    const sep = document.createElement("i")
    sep.className = "sep"
    sep.textContent = "·"
    // Both names, because a receipt outlives the pair that made it. The inputs are showing
    // something else by the time it is read.
    chip.el.append(this.reuse(chip, pair[0]), sep, this.reuse(chip, pair[1]))
    return chip
  }

  /**
   * A name in a receipt, as a way back to that node.
   *
   * Clickable only while the write stands. An undone write can name a node the undo deleted:
   * ADR 0011 removes a created node along with its edge. A refused write can name a node
   * that was never created. Loading either into an input would point it at nothing.
   */
  private reuse(chip: Receipt, anchor: Anchor): HTMLButtonElement {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "pick"
    button.textContent = anchor.label
    button.title = `start from ${anchor.label}`
    button.addEventListener("click", () => {
      if (!chip.landed || !anchor.node) return
      // Always the near input, whichever name was clicked and whatever the far input holds.
      // A fixed rule is easier to predict than one that guesses. A new Anchor object, so a
      // queued write keeps the one it was made with.
      this.near.anchor = { label: anchor.label, node: anchor.node }
      this.near.ui.input.value = anchor.label
      this.paint()
      this.hooks.onArm(anchor.node)
      // Focus the far input, because the next step is naming what this joins to.
      this.ui.far.input.focus()
    })
    return button
  }

  private offerUndo(receipt: Receipt, done: Done): void {
    const undo = document.createElement("button")
    undo.type = "button"
    undo.className = "undo"
    undo.textContent = "undo"
    undo.title = done.created
      ? `part them again and delete ${done.b.label}`
      : "part them again"
    undo.addEventListener("click", () => {
      // Remove the button on click, so a second click cannot queue the same undo twice.
      undo.remove()
      this.writes.run(receipt, () => this.revert(receipt, done))
    })
    receipt.el.append(undo)
  }
}
