/**
 * The queue every write goes through, and the receipts it leaves on screen.
 *
 * One promise chain, one write at a time, however fast the input comes. The text on a
 * receipt is set by whoever opened it, not here.
 *
 * The chain was added for a reason that no longer applies. Every write used to update one
 * shared item, and DynamoDB cancelled one of two transactions that touched it. That item is
 * gone, and IndexedDB serialises overlapping transactions instead of cancelling either. The
 * chain is kept for what is left: two fast writes land in the order they were made.
 */

/**
 * How long a receipt stays on screen. This also sets how long its undo button is reachable.
 *
 * Thirty seconds, not the five this started as. The panel is built for typing names one
 * after another. At that rate five seconds passes before the second name is typed, and the
 * undo is gone before it can be used. A refused write carries no undo, only a reason, so it
 * needs less time.
 */
const KEPT_OK_MS = 30000
const KEPT_REFUSED_MS = 12000

/** How many receipts stay on screen. Past this the oldest is removed, undo and all. */
const MAX_RECEIPTS = 6

export type Tone = "idle" | "busy" | "error"

/** One write, on screen. */
export class Receipt {
  constructor(readonly el: HTMLElement) {}

  /** True if the write landed and has not been undone. Only then is the name clickable. */
  get landed(): boolean {
    return this.el.dataset["state"] === "ok"
  }

  /**
   * Mark the write finished, whatever the result.
   *
   * `undone` means the write landed and was then reversed. It uses the shorter time, like a
   * refusal: there is nothing left to do about either.
   */
  settle(state: "ok" | "warn" | "undone", why: string): void {
    this.el.dataset["state"] = state
    this.el.title = why
    setTimeout(() => this.el.remove(), state === "ok" ? KEPT_OK_MS : KEPT_REFUSED_MS)
  }
}

export class Writes {
  /** The queue of writes. Every link catches, so one failure does not stall the rest. */
  private chain: Promise<void> = Promise.resolve()
  private inFlight = 0

  constructor(
    private readonly strip: HTMLElement,
    private readonly onStatus: (text: string, tone: Tone) => void,
  ) {}

  /** Add an empty receipt to the strip. The caller fills in its text. */
  open(): Receipt {
    const chip = document.createElement("span")
    chip.className = "receipt"
    chip.dataset["state"] = "waiting"

    this.strip.append(chip)
    // Remove the oldest first. It has been on screen the longest.
    while (this.strip.childElementCount > MAX_RECEIPTS) {
      this.strip.firstElementChild?.remove()
    }
    return new Receipt(chip)
  }

  /**
   * Add a write to the back of the queue.
   *
   * The `.catch` keeps the queue moving. Without it a rejected link would leave `chain`
   * rejected for good, and every task added after it would be skipped without a message.
   *
   * The count is incremented here, not inside the task, so a receipt that is still waiting
   * already shows in the status line. The task settles its own receipt: only it knows
   * whether the graph refused the write or the write failed, and what to say about it.
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
   * Report how many writes are queued. It never reports zero.
   *
   * Clearing the status line belongs to whoever repaints the page. An idle line could say
   * several things, and this class does not know which.
   */
  private report(): void {
    if (this.inFlight > 0) this.onStatus(`writing ${String(this.inFlight)}…`, "busy")
  }
}
