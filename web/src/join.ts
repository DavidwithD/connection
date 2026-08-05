/**
 * The panel at the top of the map: two ends, and the line between them.
 *
 * It is one box until a name lands in it, and then it is an edge — two boxes joined by a
 * constant line, which is why neither carries a label. Both ends write. Naming a node while
 * the other end holds one joins them, whichever end you typed in, because the store keeps no
 * direction to tell them apart (src/graph/edge.ts). See
 * docs/decisions/0013-one-box-that-grows-into-an-edge.md, and
 * docs/design/two-ends.html for the thing itself, driveable.
 *
 * The end that fired empties, so a run of names needs no reaching. Whichever end you leave
 * alone is the anchor: hold the near end and you fan out from one node, hold the far end and
 * you fan in to one. The widget shrinks when its last name goes.
 *
 * Every pick writes immediately — no queue, no commit step. What makes that bearable is that
 * every write can be taken back: each one leaves a receipt carrying an `undo`, and taking it
 * reverses the whole write, the created node included. The panel is fast because `↵` is the
 * only key it needs, and safe because `↵` is not final. See
 * docs/decisions/0011-taking-a-write-back.md.
 *
 * A receipt names both ends, and either name loads back into the near end. That is the whole
 * of what makes a path cheap: without it every node in a chain is named twice, once as a
 * target and again as the next anchor. Loading never writes — a pick inside an end is the
 * only thing that does — so reaching back through the receipts can never cost an edge.
 *
 * Writes are strictly one at a time, however fast the keys come. Every edge from one node
 * updates that node's meta item and the graph's totals item, so two in flight together would
 * meet on both and DynamoDB would cancel one of them — the write hotspot
 * docs/decisions/0009-the-first-write-outside-the-seed.md names. Undos join the same line,
 * behind whatever is already queued, so an undo can never overtake the write it reverses.
 * Serialising costs nothing visible: a receipt sits at `·` until its turn comes.
 *
 * A name that does not exist yet is created first, in its own transaction, and only then
 * joined. Two writes, so a create that lands followed by a join that is refused leaves a
 * real node with no edges — reachable by name, attached to nothing.
 */
import {
  Refused,
  createNode,
  deleteNode,
  joinNodes,
  unjoinNodes,
  type NodeMeta,
} from "./api.js"
import { Combobox, norm, type ComboboxHooks, type Picked } from "./combobox.js"

/**
 * How long a receipt stays, and so how long its undo is reachable.
 *
 * Half a minute rather than the five seconds this started as. The panel exists so names can
 * be fired in a row, and at that rate five seconds is gone before the second name is typed
 * — an undo you have already scrolled past is not one. Refusals outlast nothing now; they
 * carry no undo, only a reason, and they are done being read sooner.
 */
const KEPT_OK_MS = 30000
const KEPT_REFUSED_MS = 12000

/** Receipts kept on screen. Past this the oldest go, undo and all. */
const MAX_RECEIPTS = 6

/**
 * What an end is holding.
 *
 * One object per naming, and a write holds the object rather than the end it came from. That
 * is what stops a retyped end redirecting an edge already in the line: the queued write keeps
 * the anchor it was fired at, while the end it came from has moved on to a new one.
 *
 * `node` is filled in by whichever write first needs it, so several targets fired at a name
 * that does not exist yet still create it once.
 */
interface Anchor {
  readonly label: string
  node: NodeMeta | null
}

/** A landed write, and everything needed to reverse it. */
interface Done {
  a: NodeMeta
  b: NodeMeta
  /** The end this write brought into existence, if it brought one. */
  created: NodeMeta | null
}

export interface EndElements {
  /** The wrapper, hidden and shown as the widget grows and shrinks. */
  field: HTMLElement
  input: HTMLInputElement
  list: HTMLUListElement
  clear: HTMLButtonElement
}

export interface PanelElements {
  near: EndElements
  far: EndElements
  link: HTMLElement
  receipts: HTMLDivElement
}

export interface PanelHooks {
  /** A node now exists in the store. Put it on the map. */
  onNode: (node: NodeMeta) => void
  /** An edge now exists in the store. Draw it, and raise both degrees. */
  onEdge: (a: NodeMeta, b: NodeMeta) => void
  /**
   * A write has been reversed in the store. Take it off the map, and lower both degrees.
   * `removed` is the node that went with it, or null if it stayed — it will have stayed if
   * something else has since been joined to it.
   */
  onUndone: (a: NodeMeta, b: NodeMeta, removed: NodeMeta | null) => void
  /**
   * An end was armed rather than fired: take the camera there.
   *
   * Arming only, never firing. The anchor is what you are working from and belongs in view;
   * the end a run of names passes through would drag the camera behind every one of them.
   */
  onArm: (node: NodeMeta) => void
  onStatus: (text: string, tone: "idle" | "busy" | "error") => void
  /** Hover text for a row, for whatever the map knows that the end does not. */
  note: (node: NodeMeta) => string
}

/** One end of the edge being named. */
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
  /** Writes in flight, end to end. Each link catches, so one failure never stalls it. */
  private chain: Promise<void> = Promise.resolve()
  private inFlight = 0

  constructor(
    private readonly ui: PanelElements,
    private readonly hooks: PanelHooks,
  ) {
    this.near = new Side(ui.near, this.wiring(() => this.near))
    this.far = new Side(ui.far, this.wiring(() => this.far))

    for (const side of [this.near, this.far]) {
      side.ui.clear.addEventListener("click", () => this.clear(side))
      // Typing over a name without picking anything would leave the box reading one node
      // while the writes still went to another. Leaving puts back what is actually held. A
      // pick cannot be lost this way: the rows fire on mousedown, which never blurs.
      side.ui.input.addEventListener("blur", () => this.paint())
    }
    this.paint()
  }

  private wiring(self: () => Side): ComboboxHooks {
    return {
      allowCreate: true,
      note: this.hooks.note,
      onPick: (picked) => this.pick(self(), picked),
      onError: (message) => this.hooks.onStatus(`⚠ ${message}`, "error"),
      // Emptying the box is how a name is let go of. Without this the box would come back
      // the moment it lost focus, and `Esc` would look like a key that does nothing.
      onEmptied: () => {
        self().anchor = null
        this.paint()
      },
    }
  }

  private other(side: Side): Side {
    return side === this.near ? this.far : this.near
  }

  /** A name was taken in one end. Arm it, or fire it at whatever the other end holds. */
  private pick(side: Side, picked: Picked): void {
    const label = picked.kind === "node" ? picked.node.label : picked.label
    const anchor = this.other(side).anchor

    if (anchor && this.same(anchor, picked)) {
      this.hooks.onStatus("⚠ a node cannot be joined to itself", "error")
      return
    }

    const named: Anchor = { label, node: picked.kind === "node" ? picked.node : null }

    if (!anchor) {
      side.anchor = named
      // Set here rather than left to `paint`, which will not touch a box being typed in.
      side.ui.input.value = label
      this.paint()
      // A name nothing carries has nowhere to fly to. It gets a seat near the camera when a
      // write brings it into existence, like any other node arriving by name.
      if (named.node) this.hooks.onArm(named.node)
      return
    }

    // Empty the end that fired now, not when the write lands: the next name is already being
    // typed into it.
    side.box.clear()
    side.anchor = null
    this.paint()

    const pair: [Anchor, Anchor] = side === this.near ? [named, anchor] : [anchor, named]
    const receipt = this.receipt(pair, picked.kind === "create")
    this.inFlight++
    this.report()
    this.enqueue(() => this.write(anchor, named, receipt))
  }

  /** Whether a pick names what the other end already holds. */
  private same(anchor: Anchor, picked: Picked): boolean {
    if (picked.kind === "node") {
      return anchor.node ? anchor.node.id === picked.node.id : false
    }
    // Only reachable between two names that do not exist yet: a create row is offered only
    // when nothing already carries the name, so it cannot collide with a resolved node.
    return !anchor.node && norm(anchor.label) === norm(picked.label)
  }

  /**
   * Put a write at the back of the line.
   *
   * The catch is what keeps the line moving. A rejected link would leave `chain` rejected
   * for good, and every task appended after it would be skipped in silence — one failed
   * write turning into every later one never happening.
   */
  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch(() => undefined)
  }

  /**
   * The node behind a name, making it if this is the first write to need it.
   *
   * Cached on the anchor, so a run of targets fired at a name that does not exist yet
   * creates it once and joins to it thereafter.
   */
  private async realise(anchor: Anchor): Promise<NodeMeta> {
    if (anchor.node) return anchor.node
    const made = await createNode(anchor.label)
    anchor.node = made
    this.hooks.onNode(made)
    // It has stopped being a name and become a node, and the box that still holds it should
    // stop saying otherwise.
    this.paint()
    return made
  }

  private async write(anchor: Anchor, fired: Anchor, receipt: HTMLElement): Promise<void> {
    receipt.dataset["state"] = "busy"
    try {
      // The anchor goes in first, once. It is not part of what an undo reverses: it is the
      // thing being worked from, and taking it away under the box that names it would be a
      // stranger result than leaving it.
      const a = await this.realise(anchor)
      const fresh = !fired.node
      const b = await this.realise(fired)

      await joinNodes(a.id, b.id)
      this.hooks.onEdge(a, b)
      this.settle(receipt, "ok", `joined ${a.label} and ${b.label}`)
      this.offerUndo(receipt, { a, b, created: fresh ? b : null })
      this.hooks.onStatus(`joined ${a.label} and ${b.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // A refusal is the graph answering; anything else is the write failing. Both stop this
      // pair, neither stops the next one.
      this.settle(receipt, "warn", reason)
      this.hooks.onStatus(`⚠ ${reason}`, "error")
    } finally {
      this.inFlight--
      this.report()
    }
  }

  /**
   * Reverse a landed write.
   *
   * The edge first, then the node it brought with it — the create-then-join order, run
   * backwards, because the store will not delete a node that still has edges. If something
   * else has since been joined to that node the delete is refused, and rightly: the node is
   * no longer only this write's doing. The edge is still gone, which is what was asked for.
   */
  private async revert(receipt: HTMLElement, done: Done): Promise<void> {
    receipt.dataset["state"] = "busy"
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
      receipt.dataset["state"] = "undone"
      receipt.title = removed ? `${done.b.label} removed` : `${done.b.label} left in place`
      setTimeout(() => receipt.remove(), KEPT_REFUSED_MS)
      this.hooks.onStatus(`undid ${done.a.label} and ${done.b.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.settle(receipt, "warn", reason)
      this.hooks.onStatus(`⚠ ${reason}`, "error")
    } finally {
      this.inFlight--
      this.report()
    }
  }

  private report(): void {
    if (this.inFlight > 0) this.hooks.onStatus(`writing ${String(this.inFlight)}…`, "busy")
  }

  private paint(): void {
    for (const side of [this.near, this.far]) {
      const anchor = side.anchor
      // Never over a box being typed in: a write landing mid-word would otherwise replace
      // what is half-typed with what the end was already holding.
      if (document.activeElement !== side.ui.input) side.ui.input.value = anchor?.label ?? ""
      // A name that has to be created still reads as chosen, but says it is not there yet.
      side.ui.input.dataset["state"] = anchor ? (anchor.node ? "set" : "new") : ""
      side.ui.clear.hidden = !side.ui.input.value
    }
    // Grown while either end holds a name, not just the near one. The end that fired empties,
    // so keying this to the near end alone would collapse the widget on every fan-in — and
    // take the far end's anchor with it.
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

  private receipt(pair: [Anchor, Anchor], isNew: boolean): HTMLElement {
    const chip = document.createElement("span")
    chip.className = "receipt"
    chip.dataset["state"] = "waiting"
    if (isNew) chip.dataset["new"] = "true"

    const sep = document.createElement("i")
    sep.className = "sep"
    sep.textContent = "·"
    // Both names, because a receipt outlives the pair that made it: the widget is showing
    // something else by the time this is read.
    chip.append(this.reuse(chip, pair[0]), sep, this.reuse(chip, pair[1]))

    this.ui.receipts.append(chip)
    // Oldest first, so what goes is what has been readable longest.
    while (this.ui.receipts.childElementCount > MAX_RECEIPTS) {
      this.ui.receipts.firstElementChild?.remove()
    }
    return chip
  }

  /**
   * A name in a receipt, as the way back to that node.
   *
   * Live only while the write stands. An undone one can name a node the undo deleted
   * (0011 removes a created node along with its edge), and a refused one can name a node
   * that was never made — a dead name loaded into an end is a trap.
   */
  private reuse(chip: HTMLElement, anchor: Anchor): HTMLButtonElement {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "pick"
    button.textContent = anchor.label
    button.title = `start from ${anchor.label}`
    button.addEventListener("click", () => {
      if (chip.dataset["state"] !== "ok" || !anchor.node) return
      // Always the near end, whichever name was clicked and whatever the far end holds. A
      // rule you can predict beats one that guesses which end you meant. A fresh anchor, so
      // a queued write still holds the one it was fired at.
      this.near.anchor = { label: anchor.label, node: anchor.node }
      this.near.ui.input.value = anchor.label
      this.paint()
      this.hooks.onArm(anchor.node)
      // The far end, because the next thing to do is name what this joins to.
      this.ui.far.input.focus()
    })
    return button
  }

  private offerUndo(receipt: HTMLElement, done: Done): void {
    const undo = document.createElement("button")
    undo.type = "button"
    undo.className = "undo"
    undo.textContent = "undo"
    undo.title = done.created
      ? `part them again and delete ${done.b.label}`
      : "part them again"
    undo.addEventListener("click", () => {
      // Gone at the click, so a second one cannot queue the same reversal twice.
      undo.remove()
      this.inFlight++
      this.report()
      this.enqueue(() => this.revert(receipt, done))
    })
    receipt.append(undo)
  }

  private settle(receipt: HTMLElement, state: "ok" | "warn", why: string): void {
    receipt.dataset["state"] = state
    receipt.title = why
    setTimeout(() => receipt.remove(), state === "ok" ? KEPT_OK_MS : KEPT_REFUSED_MS)
  }
}
