/**
 * The page a graph moves through: a file out, and a file in.
 *
 * Two steps for the way in, not one. `npm run graph:load` has `--dry-run` because a
 * misspelled name is a new node and looks exactly like one somebody meant to add
 * (docs/decisions/0021-a-graph-in-a-text-file.md), and a page needs that reading shown back
 * more than a terminal does: there is no file on disk to check afterwards, and no scrollback
 * saying what was written. So choosing a file only surveys it, and the button that writes
 * appears once there is something to write.
 *
 * What the survey found is three numbers and, folded away under them, the pairs it read.
 * Reachable because a line's reading is not visible in the line (src/graph/text.ts), and
 * folded because the numbers are the answer nine times out of ten.
 *
 * Nothing here draws a graph. It shares the stylesheet and the API client with the map and
 * none of its machinery, which is what keeps a second page from being the duplication
 * docs/decisions/0017-the-second-view-goes.md deleted one for.
 *
 * See docs/decisions/0023-the-graph-moves-through-the-page.md.
 */
import { Refused, loadGraphText, previewGraphText, type LoadPlan } from "./api.js"

/** How many names or pairs are listed before the rest become a count. */
const SHOWN = 200

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`missing element: #${id}`)
  return found as T
}

const chooser = el<HTMLInputElement>("file")
const drop = el<HTMLLabelElement>("drop")
const dropName = el<HTMLElement>("drop-name")
const dropHint = el<HTMLElement>("drop-hint")
const faults = el<HTMLUListElement>("faults")
const tally = el<HTMLDivElement>("tally")
const detail = el<HTMLDetailsElement>("detail")
const detailBody = el<HTMLDivElement>("detail-body")
const applyButton = el<HTMLButtonElement>("apply")
const said = el<HTMLParagraphElement>("said")

const counts = {
  nodes: el<HTMLElement>("n-nodes"),
  edges: el<HTMLElement>("n-edges"),
  known: el<HTMLElement>("n-known"),
}

/**
 * The text of the file that was surveyed, or null when there is nothing to apply.
 *
 * The file itself is not sent back — the server parses and surveys it again on the write,
 * because a plan that made the round trip is a plan the page could have edited.
 */
let chosen: string | null = null

function say(text: string, tone: "idle" | "busy" | "error"): void {
  said.textContent = text
  said.dataset["tone"] = tone
}

/** Everything the last file put on the page, taken back off it. */
function clear(): void {
  chosen = null
  faults.hidden = true
  faults.replaceChildren()
  tally.hidden = true
  detail.hidden = true
  detail.open = false
  detailBody.replaceChildren()
  applyButton.hidden = true
}

/**
 * Rows for a list, with whatever will not fit left as a count rather than dropped in silence.
 *
 * Rows, and not a list around them, because the two callers own different lists: the faults
 * box is in the page already, and the detail builds its own as it goes.
 */
function rows(items: string[]): HTMLLIElement[] {
  const out = items.slice(0, SHOWN).map((text) => {
    const li = document.createElement("li")
    li.textContent = text
    return li
  })
  if (items.length > SHOWN) {
    const li = document.createElement("li")
    li.textContent = `… and ${String(items.length - SHOWN)} more`
    out.push(li)
  }
  return out
}

function section(heading: string, items: string[]): void {
  if (!items.length) return
  const h3 = document.createElement("h3")
  h3.textContent = `${heading} (${String(items.length)})`
  const ul = document.createElement("ul")
  ul.append(...rows(items))
  detailBody.append(h3, ul)
}

/**
 * What the file would do, and whether there is a button for it.
 *
 * A fault stops the file whole — the loader refuses all of it rather than the line — so
 * faults are all that is shown when there are any. Everything else is a file that can be
 * applied, including one that would write nothing, which is what a second run of an
 * unedited file looks like and is worth saying plainly.
 */
function render(plan: LoadPlan, text: string): void {
  clear()

  if (plan.faults.length) {
    faults.hidden = false
    faults.append(...rows(plan.faults))
    say("Nothing will be written until those are fixed.", "error")
    return
  }

  counts.nodes.textContent = String(plan.fresh.length)
  counts.edges.textContent = String(plan.joins.length)
  counts.known.textContent = String(plan.joined)
  tally.hidden = false

  section("New names", plan.fresh)
  section(
    "Joins",
    plan.joins.map(([a, b]) => `${a} — ${b}`),
  )
  detail.hidden = !detailBody.childNodes.length

  if (plan.over) {
    say(
      `Too big for one request (${String(plan.fresh.length + plan.joins.length)} writes, ` +
        `limit ${String(plan.limit)}). Load it with: npm run graph:load`,
      "error",
    )
    return
  }
  if (!plan.fresh.length && !plan.joins.length) {
    say("The graph already holds all of it.", "idle")
    return
  }

  chosen = text
  applyButton.hidden = false
  say(plan.fresh.length ? "A misspelled name looks exactly like a new one." : "", "idle")
}

/** The box, once it is holding something. */
function named(file: File | null): void {
  drop.classList.toggle("filled", file !== null)
  dropName.textContent = file ? file.name : "Drop a .txt file here"
  dropHint.textContent = file
    ? `${(file.size / 1024).toFixed(1)} kB · click to choose another`
    : "or click to choose"
}

async function chose(file: File): Promise<void> {
  named(file)
  say("Reading it…", "busy")
  try {
    const text = await file.text()
    render(await previewGraphText(text), text)
  } catch (err) {
    say(err instanceof Error ? err.message : String(err), "error")
  }
}

function take(file: File | undefined): void {
  clear()
  if (!file) {
    named(null)
    say("", "idle")
    return
  }
  void chose(file)
}

chooser.addEventListener("change", () => {
  take(chooser.files?.[0])
})

// Dragging a file onto the box is the same act as choosing one, so it lands in the same
// place. Both `dragover` and `drop` have to be taken back off the browser, which would
// otherwise navigate to the file and lose the page.
drop.addEventListener("dragover", (event) => {
  event.preventDefault()
  drop.classList.add("over")
})
drop.addEventListener("dragleave", () => {
  drop.classList.remove("over")
})
drop.addEventListener("drop", (event) => {
  event.preventDefault()
  drop.classList.remove("over")
  const file = event.dataTransfer?.files[0]
  // Put where the picker would have put it, so "choose another" reaches this file too.
  if (file && event.dataTransfer) chooser.files = event.dataTransfer.files
  take(file)
})

applyButton.addEventListener("click", () => {
  if (chosen === null) return
  applyButton.disabled = true
  say("Writing it…", "busy")

  loadGraphText(chosen)
    .then((done) => {
      clear()
      chooser.value = ""
      named(null)
      say(
        `Added ${String(done.created)} node(s) and ${String(done.joined)} edge(s). ` +
          "Anything new is its own island until something joins it — find it on the map " +
          "under islands.",
        "idle",
      )
    })
    .catch((err: unknown) => {
      // A refusal is the graph answering, and it leaves whatever came before it written —
      // the file is a patch and there is no transaction over one. Running it again finishes
      // the rest, which is what makes saying so useful rather than alarming.
      say(
        err instanceof Refused
          ? `${err.message}. What was written before it stayed — the same file again will ` +
              "carry on from there."
          : err instanceof Error
            ? err.message
            : String(err),
        "error",
      )
    })
    .finally(() => {
      applyButton.disabled = false
    })
})
