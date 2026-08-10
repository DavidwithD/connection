/**
 * The line every write to the graph stands in, and the receipts it leaves.
 *
 * One item carries the graph's totals, and every write in the app updates it —
 * `createNode` and `deleteNode` its node count, `addEdge` and `removeEdge` its edge count
 * (src/graph/node.ts, src/graph/edge.ts). DynamoDB cancels one of two transactions that
 * reach for the same item at once, and a conflict carries no failed condition for
 * `reasonFor` to read back (src/graph/refused.ts) — so what a lost write shows on the page
 * is the SDK's own sentence, in a receipt that says the join simply did not happen. This is
 * what stops that: one chain, one write at a time, however fast the keys come. The cost is
 * nothing anybody sees, because a chip waits at `·` until its turn.
 *
 * Two browsers still race, and always did — docs/decisions/0011-taking-a-write-back.md.
 * This only keeps one reader from fighting themselves.
 *
 * Here rather than in the panel because the map writes too: taking a node out is fired from
 * the centre and never touches an end of the panel
 * (docs/decisions/0022-taking-a-node-out-with-its-edges.md). A queue that a second writer
 * cannot reach is a queue that does not do its job.
 *
 * What a chip *says* is left to whoever opened it. A join names both its ends and carries an
 * undo; a removal names one node and carries nothing. Neither shape belongs here.
 */

/**
 * How long a receipt stays, and so how long anything on it is reachable.
 *
 * Half a minute rather than the five seconds this started as. The panel exists so names can
 * be fired in a row, and at that rate five seconds is gone before the second name is typed
 * — an undo you have already scrolled past is not one. Refusals outlast nothing; they carry
 * no undo, only a reason, and they are done being read sooner.
 */
const KEPT_OK_MS = 30000
const KEPT_REFUSED_MS = 12000

/** Receipts kept on screen. Past this the oldest go, undo and all. */
const MAX_RECEIPTS = 6

export type Tone = "idle" | "busy" | "error"

/** One write, on screen. */
export class Receipt {
  constructor(readonly el: HTMLElement) {}

  /** Whether this write landed and stands — the one state anything hung on it may act on. */
  get landed(): boolean {
    return this.el.dataset["state"] === "ok"
  }

  /**
   * Done, however it went.
   *
   * `undone` is a write that landed and was then reversed, which is why it keeps the shorter
   * time: like a refusal, it is a state there is nothing left to do about.
   */
  settle(state: "ok" | "warn" | "undone", why: string): void {
    this.el.dataset["state"] = state
    this.el.title = why
    setTimeout(() => this.el.remove(), state === "ok" ? KEPT_OK_MS : KEPT_REFUSED_MS)
  }
}

export class Writes {
  /** Writes in flight, end to end. Each link catches, so one failure never stalls it. */
  private chain: Promise<void> = Promise.resolve()
  private inFlight = 0

  constructor(
    private readonly strip: HTMLElement,
    private readonly onStatus: (text: string, tone: Tone) => void,
  ) {}

  /** A chip in the strip, before its write has a turn. Filling it is the caller's. */
  open(): Receipt {
    const chip = document.createElement("span")
    chip.className = "receipt"
    chip.dataset["state"] = "waiting"

    this.strip.append(chip)
    // Oldest first, so what goes is what has been readable longest.
    while (this.strip.childElementCount > MAX_RECEIPTS) {
      this.strip.firstElementChild?.remove()
    }
    return new Receipt(chip)
  }

  /**
   * Put a write at the back of the line.
   *
   * The catch is what keeps the line moving. A rejected link would leave `chain` rejected
   * for good, and every task appended after it would be skipped in silence — one failed
   * write turning into every later one never happening.
   *
   * Counted from here rather than from the task, so a chip that is still waiting is already
   * part of what the status line reports. A task is expected to settle its own receipt: only
   * it knows whether the graph refused or the write failed, and what to say about either.
   */
  run(receipt: Receipt, task: () => Promise<void>): void {
    this.inFlight++
    this.report()
    this.chain = this.chain
      .then(async () => {
        receipt.el.dataset["state"] = "busy"
        await task()
      })
      .catch(() => undefined)
      .finally(() => {
        this.inFlight--
        this.report()
      })
  }

  /**
   * Say how many are in the line, and never that there are none.
   *
   * Clearing the status belongs to whoever repaints the page: an idle line is one of several
   * things it could say, and this is not the thing that knows which.
   */
  private report(): void {
    if (this.inFlight > 0) this.onStatus(`writing ${String(this.inFlight)}…`, "busy")
  }
}
