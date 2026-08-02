/**
 * Adding to the graph: pick a source once, then name targets at it in a row.
 *
 * Every pick writes immediately — no queue, no commit step. What makes that bearable is
 * that every write can be taken back: each one leaves a receipt carrying an `undo`, and
 * taking it reverses the whole write, the created node included. The panel is fast because
 * `↵` is the only key it needs, and safe because `↵` is not final. See
 * docs/decisions/0011-taking-a-write-back.md.
 *
 * The source stays put after each write. Adding a person's five connections is five
 * targets, not five re-pickings of the same name — the shape the panel is for.
 *
 * Writes are strictly one at a time, however fast the keys come. Every edge from one source
 * updates that source's meta item and the graph's totals item, so two in flight together
 * would meet on both and DynamoDB would cancel one of them — the write hotspot
 * docs/decisions/0009-the-first-write-outside-the-seed.md names. Undos join the same line,
 * behind whatever is already queued, so an undo can never overtake the write it reverses.
 * Serialising costs nothing visible: a receipt sits at `·` until its turn comes.
 *
 * A target that does not exist yet is created first, in its own transaction, and only then
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
import { Combobox, type Picked } from "./combobox.js"

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

/** A landed write, and everything needed to reverse it. */
interface Done {
  a: NodeMeta
  b: NodeMeta
  /** The target, if this write is what brought it into existence. */
  created: NodeMeta | null
}

export interface JoinElements {
  from: HTMLInputElement
  fromList: HTMLUListElement
  fromClear: HTMLButtonElement
  to: HTMLInputElement
  toList: HTMLUListElement
  receipts: HTMLDivElement
}

export interface JoinHooks {
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
  onStatus: (text: string, tone: "idle" | "busy" | "error") => void
  /** Hover text for a search row, for whatever the map knows that the box does not. */
  note: (node: NodeMeta) => string
}

export class JoinPanel {
  /** The resolved source, once it exists in the store. */
  private from: NodeMeta | null = null
  /** A source named but not yet created. Written on the first target, not before. */
  private fromNew: string | null = null
  /** Writes in flight, end to end. Each link catches, so one failure never stalls it. */
  private chain: Promise<void> = Promise.resolve()
  private inFlight = 0
  private readonly fromBox: Combobox
  private readonly toBox: Combobox

  constructor(
    private readonly ui: JoinElements,
    private readonly hooks: JoinHooks,
  ) {
    const shared = {
      allowCreate: true,
      note: hooks.note,
      onError: (message: string) => hooks.onStatus(`⚠ ${message}`, "error"),
    }

    this.fromBox = new Combobox(ui.from, ui.fromList, {
      ...shared,
      onPick: (picked) => this.setSource(picked),
    })
    this.toBox = new Combobox(ui.to, ui.toList, {
      ...shared,
      onPick: (picked) => this.fire(picked),
    })

    ui.fromClear.addEventListener("click", () => this.clearSource())
    // Typing over the source without picking anything would leave the box reading one name
    // while the writes still went to another. Leaving it puts back what is actually set.
    // A pick cannot be lost this way: the rows fire on mousedown, which never blurs.
    ui.from.addEventListener("blur", () => this.paintSource())
    this.paintSource()
  }

  /** Focus whichever half is the next thing to fill in. */
  focus(): void {
    if (this.from ?? this.fromNew) this.toBox.focus()
    else this.fromBox.focus()
  }

  private setSource(picked: Picked): void {
    if (picked.kind === "node") {
      this.from = picked.node
      this.fromNew = null
    } else {
      this.from = null
      this.fromNew = picked.label
    }
    this.paintSource()
    this.ui.to.focus()
  }

  private clearSource(): void {
    this.from = null
    this.fromNew = null
    this.paintSource()
    this.ui.from.focus()
  }

  private paintSource(): void {
    const name = this.from?.label ?? this.fromNew
    this.ui.from.value = name ?? ""
    // A source that has to be created still reads as chosen, but says it is not there yet.
    this.ui.from.dataset["state"] = this.fromNew ? "new" : name ? "set" : ""
    this.ui.fromClear.hidden = !name
    // Nothing to aim at without a source, and an enabled box that quietly refuses is worse
    // than one that plainly cannot be typed in.
    this.ui.to.disabled = !name
    this.ui.to.placeholder = name ? "name a node…" : "pick a source first"
  }

  /** A target was picked. Take a receipt now; do the writing when its turn comes. */
  private fire(picked: Picked): void {
    const source = this.from?.label ?? this.fromNew
    if (!source) return

    const label = picked.kind === "node" ? picked.node.label : picked.label
    if (picked.kind === "node" && this.from && picked.node.id === this.from.id) {
      this.hooks.onStatus("⚠ a node cannot be joined to itself", "error")
      return
    }
    // Only reachable before the source exists, where there is no id to compare.
    if (picked.kind === "create" && this.fromNew === picked.label) {
      this.hooks.onStatus("⚠ a node cannot be joined to itself", "error")
      return
    }

    // Empty the box now, not when the write lands: the next name is already being typed.
    this.toBox.clear()

    const receipt = this.receipt(label, picked.kind === "create")
    this.inFlight++
    this.report()
    this.enqueue(() => this.write(picked, receipt))
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

  private async write(picked: Picked, receipt: HTMLElement): Promise<void> {
    receipt.dataset["state"] = "busy"
    try {
      // The source goes in first, once, on whichever target happens to be first. It is not
      // part of what an undo reverses: it is the thing being worked from, and taking it
      // away under the box that names it would be a stranger result than leaving it.
      if (!this.from && this.fromNew) {
        const made = await createNode(this.fromNew)
        this.from = made
        this.fromNew = null
        this.hooks.onNode(made)
        this.paintSource()
      }
      const from = this.from
      if (!from) throw new Error("no source")

      const created = picked.kind === "create" ? await createNode(picked.label) : null
      const target = created ?? (picked as { node: NodeMeta }).node
      if (created) this.hooks.onNode(created)

      await joinNodes(from.id, target.id)
      this.hooks.onEdge(from, target)
      this.settle(receipt, "ok", `joined ${target.label}`)
      this.offerUndo(receipt, { a: from, b: target, created })
      this.hooks.onStatus(`joined ${from.label} and ${target.label}`, "idle")
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // A refusal is the graph answering; anything else is the write failing. Both stop
      // this target, neither stops the next one.
      this.settle(receipt, "warn", reason)
      this.hooks.onStatus(`⚠ ${reason}`, "error")
      // A source that could not be created must not be retried on every later target.
      if (!this.from && !(err instanceof Refused)) this.fromNew = null
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

  private receipt(label: string, isNew: boolean): HTMLElement {
    const chip = document.createElement("span")
    chip.className = "receipt"
    chip.dataset["state"] = "waiting"
    if (isNew) chip.dataset["new"] = "true"
    const name = document.createElement("span")
    name.textContent = label
    chip.append(name)
    this.ui.receipts.append(chip)

    // Oldest first, so what goes is what has been readable longest.
    while (this.ui.receipts.childElementCount > MAX_RECEIPTS) {
      this.ui.receipts.firstElementChild?.remove()
    }
    return chip
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
