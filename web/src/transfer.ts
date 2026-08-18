/**
 * The transfer page. It moves, replaces and repairs a whole graph.
 *
 * It used to do one thing: preview a text file, then write it on a second click. The
 * downloads were links to server routes, and everything else was a command-line script.
 * There is no command line now, so seeding, importing, checking and recounting are here too.
 *
 * Nothing on this page draws a graph.
 */
import {
  Refused,
  loadGraphText,
  persist,
  previewGraphText,
  whenEvicted,
  type LoadPlan,
} from "./store/index.js"
import {
  buildSeed,
  checkGraph,
  exportGraph,
  readExport,
  readWholeGraph,
  recountIslands,
  replaceGraph,
  pairsOf,
} from "./store/transfer.js"
import { format, Unwritable, type Shape } from "./store/text.js"

/** How many names, pairs or faults are listed. The rest are shown as a count. */
const SHOWN = 200

/** How many nodes the demo graph holds. Named, because `hubs` below is derived from it. */
const SEED_N = 600

/**
 * The settings for **Seed a demo graph**.
 *
 * These were environment variables, read by the command that generated the graph. There is
 * no command now, so they are constants. The reasons for the values have not changed.
 */
const SEED = {
  n: SEED_N,
  k: 10,
  p: 0.08,
  seed: 20260729,
  // A fifth of the nodes, not a fixed count, so raising `n` does not make hubs rare. At a
  // fiftieth a walk met one hub and then saw only average nodes, which made the opening node
  // look like the only interesting one.
  hubs: Math.max(1, Math.round(SEED_N / 5)),
  hubK: 20,
  // Ten islands. With one island the map has nothing the reader cannot walk to, and the
  // island panel has nothing to show.
  islands: 10,
}

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
const downloaded = el<HTMLParagraphElement>("downloaded")

const jsonIn = el<HTMLInputElement>("in-json")
const ask = el<HTMLDivElement>("ask")
const askWhat = el<HTMLParagraphElement>("ask-what")
const report = el<HTMLUListElement>("report")
const told = el<HTMLParagraphElement>("told")

const counts = {
  nodes: el<HTMLElement>("n-nodes"),
  edges: el<HTMLElement>("n-edges"),
  known: el<HTMLElement>("n-known"),
}

type Tone = "idle" | "busy" | "error"

/** The text of the previewed file, or null when there is nothing to apply. */
let chosen: string | null = null

function say(text: string, tone: Tone): void {
  said.textContent = text
  said.dataset["tone"] = tone
}

function tell(text: string, tone: Tone): void {
  told.textContent = text
  told.dataset["tone"] = tone
}

/** Show the faults a whole-graph action found. An empty list hides the box. */
function listed(items: string[]): void {
  report.replaceChildren()
  report.hidden = items.length === 0
  if (items.length) report.append(...rows(items))
}

// ------------------------------------------------------------------- downloads

/**
 * Hand a file to the browser.
 *
 * The object URL is revoked on the next tick, not immediately, because the click has to
 * happen first. Never revoking it would keep a copy of the whole graph in memory for the
 * life of the tab.
 */
function download(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: `${type}; charset=utf-8` }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** A timestamp for a filename, so a second backup does not overwrite the first. */
const stamped = (): string => new Date().toISOString().replace(/[:.]/g, "-")

async function downloadText(shape: Shape): Promise<void> {
  downloaded.textContent = ""
  const { nodes, edges } = await readWholeGraph()
  if (!nodes.length) {
    downloaded.textContent = "There is no graph here to write down."
    return
  }
  download(
    shape === "names" ? "graph-names.txt" : "graph.txt",
    format(nodes, pairsOf(edges), shape),
    "text/plain",
  )
  downloaded.textContent =
    shape === "names"
      ? `${String(nodes.length)} name(s), and none of the edges.`
      : `${String(nodes.length)} node(s) and ${String(edges.length)} edge(s).`
}

async function downloadJson(): Promise<void> {
  downloaded.textContent = ""
  const payload = await exportGraph()
  if (!payload.counts.nodes) {
    downloaded.textContent = "There is no graph here to back up."
    return
  }
  download(`graph-export-${stamped()}.json`, JSON.stringify(payload, null, 2), "application/json")
  downloaded.textContent =
    `${String(payload.counts.nodes)} node(s) and ${String(payload.counts.edges)} edge(s). ` +
    "Keep it somewhere that is not this browser."
}

// ------------------------------------------------------------ confirm before replacing

/** What the confirmation will run, or null when nothing is waiting on one. */
let pending: (() => Promise<void>) | null = null

/**
 * Ask the question and offer the backup with it.
 *
 * The backup download is one of the three buttons on purpose. Someone who has to go
 * elsewhere to take a copy will not take one, and after this there is no copy to take.
 */
function confirmThen(what: string, run: () => Promise<void>): void {
  pending = run
  askWhat.textContent = what
  ask.hidden = false
  listed([])
  tell("", "idle")
}

el<HTMLButtonElement>("ask-save").addEventListener("click", () => {
  void downloadJson().catch(fail)
})
el<HTMLButtonElement>("ask-no").addEventListener("click", () => {
  pending = null
  ask.hidden = true
  tell("Nothing was changed.", "idle")
})
el<HTMLButtonElement>("ask-yes").addEventListener("click", () => {
  const run = pending
  pending = null
  ask.hidden = true
  if (run) void run().catch(fail)
})

/**
 * Report a failure to the reader.
 *
 * The case worth distinguishing is the store being unable to answer. An import refused for
 * lack of disk space leaves the graph unchanged, and reading that as a fault in the file
 * would send someone off to edit the file. `Unavailable` in db.ts writes its own message for
 * that, so showing the message is enough.
 */
function fail(err: unknown): void {
  tell(err instanceof Error ? err.message : String(err), "error")
}

// --------------------------------------------------------------- the whole-graph actions

el<HTMLButtonElement>("out-joins").addEventListener("click", () => {
  void downloadText("joins").catch((err: unknown) => {
    // A name containing the separator or the comment character cannot be written to a text
    // file. That is the format refusing, not a failure.
    downloaded.textContent = err instanceof Unwritable ? err.message : String(err)
  })
})
el<HTMLButtonElement>("out-names").addEventListener("click", () => {
  void downloadText("names").catch((err: unknown) => {
    downloaded.textContent = err instanceof Unwritable ? err.message : String(err)
  })
})
el<HTMLButtonElement>("out-json").addEventListener("click", () => {
  void downloadJson().catch(fail)
})

el<HTMLButtonElement>("seed").addEventListener("click", () => {
  confirmThen(
    "Seeding writes a generated graph over whatever is stored. There is no way back to " +
      "what is here now except a file you already have.",
    async () => {
      tell("Generating…", "busy")
      const built = buildSeed(SEED)
      listed(built.faults)
      if (built.faults.length) {
        tell("The generated graph did not check out, so nothing was written.", "error")
        return
      }
      tell("Writing…", "busy")
      await replaceGraph(built.nodes, built.edges)
      tell(
        `Seeded ${String(built.nodes.length)} node(s) and ${String(built.edges.length)} ` +
          "edge(s). Open the map.",
        "idle",
      )
    },
  )
})

jsonIn.addEventListener("change", () => {
  const file = jsonIn.files?.[0]
  jsonIn.value = ""
  if (!file) return

  confirmThen(
    `Importing ${file.name} replaces the whole graph. It lands in one transaction, so it ` +
      "either replaces it or leaves it exactly as it is.",
    async () => {
      tell("Reading it…", "busy")
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch (err) {
        tell(`${file.name} is not JSON this can read: ${String(err)}`, "error")
        return
      }

      const { nodes, edges, faults } = readExport(parsed)
      listed(faults)
      if (faults.length) {
        tell(
          `${String(faults.length)} fault(s) in ${file.name} — the graph has not been touched.`,
          "error",
        )
        return
      }

      tell("Writing…", "busy")
      await replaceGraph(nodes, edges)
      tell(
        `Imported ${String(nodes.length)} node(s) and ${String(edges.length)} edge(s).`,
        "idle",
      )
    },
  )
})

el<HTMLButtonElement>("check").addEventListener("click", () => {
  listed([])
  tell("Reading every record…", "busy")
  void checkGraph()
    .then((result) => {
      listed(result.faults)
      tell(
        result.faults.length
          ? `${String(result.faults.length)} fault(s) across ${String(result.nodes)} node(s).`
          : `Clean: ${String(result.nodes)} node(s), ${String(result.edges)} edge(s), ` +
              `${String(result.islands)} island(s).`,
        result.faults.length ? "error" : "idle",
      )
    })
    .catch(fail)
})

el<HTMLButtonElement>("recount").addEventListener("click", () => {
  // The one whole-graph action with no confirmation. It only rewrites the island index,
  // which is derived from the nodes and edges, so the worst it can do is rewrite it as is.
  listed([])
  tell("Reckoning the components…", "busy")
  void recountIslands()
    .then(({ islands, changed }) => {
      tell(
        changed
          ? `${String(islands)} island(s); ${String(changed)} record(s) were behind.`
          : `${String(islands)} island(s), and nothing was out of date.`,
        "idle",
      )
    })
    .catch(fail)
})

// ------------------------------------------------------------------ the text file in

/**
 * Build `<li>` rows. Anything past SHOWN becomes a final "… and N more" row rather than
 * being dropped without a word.
 *
 * This returns rows, not a list, because the callers use different lists. The faults box is
 * already in the page, and the detail section builds its own.
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

/** Remove everything the last file put on the page. */
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

function section(heading: string, items: string[]): void {
  if (!items.length) return
  const h3 = document.createElement("h3")
  h3.textContent = `${heading} (${String(items.length)})`
  const ul = document.createElement("ul")
  ul.append(...rows(items))
  detailBody.append(h3, ul)
}

/**
 * Show what the file would do, and whether the apply button is offered.
 *
 * One fault stops the whole file: the loader refuses all of it, not just the bad line. So
 * when there are faults, the faults are all that is shown. Otherwise the file can be
 * applied, including a file that would write nothing. That is what running an unedited file
 * a second time looks like, and it is worth saying so.
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

  if (!plan.fresh.length && !plan.joins.length) {
    say("The graph already holds all of it.", "idle")
    return
  }

  chosen = text
  applyButton.hidden = false
  say(plan.fresh.length ? "A misspelled name looks exactly like a new one." : "", "idle")
}

/** Update the drop box to show the chosen file, or the empty prompt for null. */
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
    // The text is not checked here. `previewGraphText` rejects an oversized file before it
    // parses anything, and the catch below already shows its message.
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

// Dragging a file onto the box does the same thing as choosing one, so it calls `take` too.
// Both `dragover` and `drop` must call preventDefault. Otherwise the browser navigates to the
// dropped file and the page is lost.
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
  // Put the file where the picker would have put it, so "choose another" starts from it.
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
      // A refusal is the graph saying no. What was written before it stays: the file is
      // applied line by line, not in one transaction. Running the same file again continues
      // from where it stopped, so say that.
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

// Ask for persistent storage, as the map page does. This page writes a whole graph, so asking
// after the write would be too late.
void persist()

whenEvicted((reason) => {
  tell(`${reason}`, "error")
})
