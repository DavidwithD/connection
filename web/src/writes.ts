/**
 * The queue every write goes through, and the write log entries it leaves on screen.
 *
 * One promise chain, one write at a time, however fast the input comes. The text on a
 * write log entry is set by whoever opened it, not here.
 *
 * IndexedDB serialises overlapping transactions on its own. The chain is kept for ordering:
 * two fast writes land in the order they were made.
 */

/**
 * How long a write log entry stays on screen. This also sets how long its undo button is reachable.
 *
 * Thirty seconds, not the five this started as. The panel is built for typing names one
 * after another. At that rate five seconds passes before the second name is typed, and the
 * undo is gone before it can be used. A refused write carries no undo, only a reason, so it
 * needs less time.
 */
const KEPT_OK_MS = 30000
const KEPT_REFUSED_MS = 12000

/** How many write log entries stay on screen. Past this the oldest is removed, undo and all. */
const MAX_LOG_ENTRIES = 6

export type Tone = "idle" | "busy" | "error"

/** One write, on screen. */
export class LogEntry {
  constructor(readonly el: HTMLElement) {}

  /** True if the write landed and has not been undone. Only then is the name clickable. */
  get written(): boolean {
    return this.el.dataset["state"] === "ok"
  }

  /**
   * Mark the write finished, whatever the result.
   *
   * `undone` means the write landed and was then reversed. It uses the shorter time, like a
   * refusal: there is nothing left to do about either.
   */
  finish(state: "ok" | "warn" | "undone", why: string): void {
    this.el.dataset["state"] = state
    this.el.title = why
    setTimeout(() => this.el.remove(), state === "ok" ? KEPT_OK_MS : KEPT_REFUSED_MS)
  }

  /**
   * Add an undo button to this write log entry.
   *
   * The button removes itself on the first click, so the same undo cannot be queued twice.
   * The queue is not known here: the caller passes what to run, and puts it in the line
   * itself. Two things offer an undo — the join panel and the map — and this is the one
   * place the button is built.
   */
  offerUndo(title: string, back: () => void): void {
    const undo = document.createElement("button")
    undo.type = "button"
    undo.className = "undo"
    undo.textContent = "undo"
    undo.title = title
    undo.addEventListener("click", () => {
      undo.remove()
      back()
    })
    this.el.append(undo)
  }
}

export class Writes {
  /** The queue of writes. Every link catches, so one failure does not stall the rest. */
  private chain: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(
    private readonly log: HTMLElement,
    private readonly onStatus: (text: string, tone: Tone) => void,
  ) {}

  /** Add an empty write log entry to the strip. The caller fills in its text. */
  open(): LogEntry {
    const chip = document.createElement("span")
    chip.className = "log-entry"
    chip.dataset["state"] = "waiting"

    this.log.append(chip)
    // Remove the oldest first. It has been on screen the longest.
    while (this.log.childElementCount > MAX_LOG_ENTRIES) {
      this.log.firstElementChild?.remove()
    }
    return new LogEntry(chip)
  }

  /**
   * Add a write to the back of the queue.
   *
   * The `.catch` keeps the queue moving. Without it a rejected link would leave `chain`
   * rejected for good, and every task added after it would be skipped without a message.
   *
   * The count is incremented here, not inside the task, so a write log entry that is still waiting
   * already shows in the status line. The task settles its own write log entry: only it knows
   * whether the graph refused the write or the write failed, and what to say about it.
   */
  run(entry: LogEntry, task: () => Promise<void>): void {
    this.pending++
    this.report()
    this.chain = this.chain
      .then(async () => {
        entry.el.dataset["state"] = "busy"
        await task()
      })
      .catch(() => undefined)
      .finally(() => {
        this.pending--
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
    if (this.pending > 0) this.onStatus(`writing ${String(this.pending)}…`, "busy")
  }
}
