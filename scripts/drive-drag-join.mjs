#!/usr/bin/env node
/**
 * Drive the shift-drag that joins two nodes, and check what it wrote.
 *
 *   npm run web                             # in another terminal
 *   node scripts/drive-drag-join.mjs        # --head to watch it
 *
 * A companion to drive-part-edge.mjs, and the same deal: real Chrome, nothing downloaded, shots
 * in .shots/. The gesture writes to the graph, so this asserts rather than photographs.
 *
 * It seeds a graph first, into Playwright's own throwaway profile. Nothing here can reach the
 * graph in the browser on the desktop.
 *
 * The one thing that makes this flaky if it is skipped is the pair. Two nodes are safe to join
 * only if the map holds all of both nodes' edges. So `pickPair` takes that as a condition rather
 * than hoping, because a pair the store has already joined is refused, and rightly.
 */
import { mkdirSync } from "node:fs"

const { chromium } = await import("playwright").catch(() => {
  console.error("✗ needs playwright: npm i -D playwright --no-save")
  process.exit(2)
})

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const SHOTS = ".shots"
const headed = process.argv.includes("--head")

let failures = 0
const ok = (pass, what, detail = "") => {
  console.log(`  ${pass ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

/** What the page is showing: the graph, the receipts, and the state of the drag. */
const drawn = (page) =>
  page.evaluate(() => {
    const cy = document.querySelector("#stage")?._cyreg?.cy
    if (!cy) return null
    // The gradient's ends are the arrow's ends. It is aimed with the shape, so reading it back
    // is reading where the arrow was actually drawn.
    const ink = document.querySelector("#aim-ink")
    const box = document.querySelector("#aim")
    return {
      realEdges: cy.edges().filter((e) => !e.data("ghost") && !e.data("stub")).length,
      totals: document.querySelector("#stat-total")?.textContent ?? "",
      status: document.querySelector("#status")?.textContent ?? "",
      receipts: document.querySelectorAll("#receipts .receipt").length,
      undos: document.querySelectorAll("#receipts .undo").length,
      warns: document.querySelectorAll('#receipts .receipt[data-state="warn"]').length,
      // The gesture's own state. One class carries both the arrow and the cursor.
      joining: document.body.classList.contains("joining"),
      arrowShown: box ? getComputedStyle(box).display !== "none" : false,
      // The box the arrow is drawn in. An `svg` sized by its intrinsic 300x150 shows nothing at
      // a coordinate past that, and every other check here would still pass.
      arrowBox: box
        ? `${String(Math.round(box.getBoundingClientRect().width))}x${String(Math.round(box.getBoundingClientRect().height))}`
        : "",
      viewport: `${String(innerWidth)}x${String(innerHeight)}`,
      head: ink ? `${ink.getAttribute("x2") ?? ""},${ink.getAttribute("y2") ?? ""}` : "",
      tail: ink ? `${ink.getAttribute("x1") ?? ""},${ink.getAttribute("y1") ?? ""}` : "",
      // A shape with no `d` is an arrow that was never drawn, however visible its `svg` is.
      shaped: Boolean(document.querySelector("#aim-arrow")?.getAttribute("d")),
      // The page hides the pointer for the length of the drag. A gesture that failed to disarm
      // would leave the reader with no cursor at all.
      cursor: getComputedStyle(document.querySelector("#stage")).cursor,
      aimed: cy.nodes("[?aim]").map((n) => n.id()).join(","),
      panning: cy.userPanningEnabled(),
      pan: `${String(Math.round(cy.pan().x))},${String(Math.round(cy.pan().y))}`,
    }
  })

/**
 * The centre, and a node with no edge to it. Both clear of the page's own furniture.
 *
 * The tiers are what make this sound. `setTiers` marks each node the centre holds an edge to as
 * tier 1. So tier 2 and tier 3 are the nodes it holds none to. That is the whole truth only while
 * the centre holds all of its own edges, which is what `centreHasAll` reports.
 *
 * The key check is the second half. A tier is recomputed when the centre changes. A join made
 * since then leaves a node still marked unjoined, and the element carrying the pair says so.
 */
const pickPair = (page) =>
  page.evaluate(() => {
    const NUL = String.fromCodePoint(0)
    const cy = document.querySelector("#stage")._cyreg.cy
    const box = document.querySelector("#stage").getBoundingClientRect()
    const pan = cy.pan()
    const zoom = cy.zoom()
    const at = (node) => {
      const p = node.position()
      return { x: box.left + p.x * zoom + pan.x, y: box.top + p.y * zoom + pan.y }
    }
    // Clear means the canvas is the topmost thing there. A panel over a node takes the press,
    // exactly as it would from a reader.
    const clear = (p) =>
      p.x > 0 &&
      p.y > 0 &&
      p.x < innerWidth &&
      p.y < innerHeight &&
      document.elementFromPoint(p.x, p.y)?.tagName === "CANVAS"
    const joined = (a, b) => {
      const key = a < b ? `${a}${NUL}${b}` : `${b}${NUL}${a}`
      return cy.elements().some((el) => el.id().includes(key))
    }

    const centre = cy.nodes("[tier = 0]").first()
    if (centre.empty()) return null
    const from = at(centre)
    if (!clear(from)) return null
    const far = cy
      .nodes()
      .filter((n) => !n.data("ghost") && !n.data("stub") && Number(n.data("tier")) >= 2)
      .toArray()
    for (const b of far) {
      if (joined(centre.id(), b.id())) continue
      const to = at(b)
      if (!clear(to)) continue
      return {
        centreHasAll: !centre.data("more"),
        a: { id: centre.id(), label: centre.data("label"), ...from },
        b: { id: b.id(), label: b.data("label"), ...to },
      }
    }
    return null
  })

/** A pair the graph has already joined, drawn as one line, with both ends clear. */
const pickJoined = (page) =>
  page.evaluate(() => {
    const cy = document.querySelector("#stage")._cyreg.cy
    const box = document.querySelector("#stage").getBoundingClientRect()
    const pan = cy.pan()
    const zoom = cy.zoom()
    const at = (node) => {
      const p = node.position()
      return { x: box.left + p.x * zoom + pan.x, y: box.top + p.y * zoom + pan.y }
    }
    const clear = (p) =>
      p.x > 0 &&
      p.y > 0 &&
      p.x < innerWidth &&
      p.y < innerHeight &&
      document.elementFromPoint(p.x, p.y)?.tagName === "CANVAS"
    const lines = cy.edges().filter((e) => !e.data("ghost") && !e.data("stub")).toArray()
    for (const edge of lines) {
      const [s, t] = [edge.source(), edge.target()]
      const from = at(s)
      const to = at(t)
      if (!clear(from) || !clear(to)) continue
      return {
        a: { id: s.id(), label: s.data("label"), ...from },
        b: { id: t.id(), label: t.data("label"), ...to },
      }
    }
    return null
  })

/** A point on the canvas with no element under it, for a release that should write nothing. */
const emptyPoint = (page) =>
  page.evaluate(() => {
    const cy = document.querySelector("#stage")._cyreg.cy
    const box = document.querySelector("#stage").getBoundingClientRect()
    const pan = cy.pan()
    const zoom = cy.zoom()
    const renderer = cy.renderer()
    for (let y = 80; y < innerHeight - 80; y += 40) {
      for (let x = 80; x < innerWidth - 80; x += 40) {
        if (document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue
        const near = renderer.findNearestElement(
          (x - box.left - pan.x) / zoom,
          (y - box.top - pan.y) / zoom,
          true,
          false,
        )
        if (!near) return { x, y }
      }
    }
    return null
  })

/**
 * A clear point on one of the centre's neighbours, to click and stand on.
 *
 * A map that has just opened draws the centre and its ring, and nothing else. So every node on
 * screen is joined to the centre already, and there is no pair for a drag to make. Walking one
 * step puts a second ring on the map, and the ring left behind is where a far end comes from.
 */
const stepTo = (page) =>
  page.evaluate(() => {
    const cy = document.querySelector("#stage")._cyreg.cy
    const box = document.querySelector("#stage").getBoundingClientRect()
    const pan = cy.pan()
    const zoom = cy.zoom()
    for (const node of cy.nodes("[tier = 1]").toArray()) {
      const p = node.position()
      const at = { x: box.left + p.x * zoom + pan.x, y: box.top + p.y * zoom + pan.y }
      if (at.x < 0 || at.y < 0 || at.x > innerWidth || at.y > innerHeight) continue
      if (document.elementFromPoint(at.x, at.y)?.tagName !== "CANVAS") continue
      return { id: node.id(), label: node.data("label"), ...at }
    }
    return null
  })

/**
 * Press on one point, drag to another, release. Reports what the page looked like mid-drag,
 * which is the only moment the arrow exists.
 */
async function drag(page, from, to, { shift = true, shot = null } = {}) {
  if (shift) await page.keyboard.down("Shift")
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
  const halfway = await drawn(page)
  // The arrow exists only while the button is down, so this is the one place to photograph it.
  // Halfway rather than at the end. The head is over open ground here, and under the far node's
  // own pill by the time the drag arrives.
  if (shot) await page.screenshot({ path: `${SHOTS}/${shot}.png` })
  await page.mouse.move(to.x, to.y, { steps: 6 })
  const over = await drawn(page)
  await page.mouse.up()
  if (shift) await page.keyboard.up("Shift")
  await page.waitForTimeout(700)
  return { halfway, over }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch({ channel: "chrome", headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } })

  const innerHalf = await page.evaluate(() => ({
    width: innerWidth / 2,
    height: innerHeight / 2,
  }))

  const problems = []
  page.on("pageerror", (err) => problems.push(String(err)))
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) {
      problems.push(m.text())
    }
  })

  // A fresh profile has no graph. Seed one from the transfer page, which is what the README
  // tells a reader to do. This profile is Playwright's own, not the browser on the desktop.
  console.log(`→ ${WEB}/transfer.html — seeding`)
  await page.goto(`${WEB}/transfer.html`, { waitUntil: "domcontentloaded" })
  await page.locator("#seed").click()
  const confirm = page.locator("#ask-yes")
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await page.waitForFunction(
    () => /seed|added|nodes/i.test(document.querySelector("#told")?.textContent ?? ""),
    { timeout: 30000 },
  )
  console.log(`  ${await page.locator("#told").textContent()}`)

  console.log(`→ ${WEB} — the map`)
  await page.goto(WEB, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(900)

  // ---- one step, so there is a pair to make ------------------------------------------
  console.log("\n0. walk one step, so two rings are on the map")
  const step = await stepTo(page)
  ok(!!step, "found a neighbour to stand on", step ? step.label : "none clickable")
  if (!step) {
    await browser.close()
    process.exit(1)
  }
  await page.mouse.click(step.x, step.y)
  await page.waitForFunction(
    () => !/loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(900)

  // ---- the join ----------------------------------------------------------------------
  console.log("\n1. shift-drag from one node to another")
  const before = await drawn(page)
  const pair = await pickPair(page)
  ok(
    !!pair,
    "found two nodes with no edge between them",
    pair ? `${pair.a.label} → ${pair.b.label}` : "none",
  )
  if (!pair) {
    await browser.close()
    process.exit(1)
  }
  ok(pair.centreHasAll, "the centre holds all of its edges, so the tiers can be trusted")
  const held = await drag(page, pair.a, pair.b, { shot: "drag-join-0-arrow" })
  ok(held.halfway.joining, "the gesture is in flight", `body.joining=${String(held.halfway.joining)}`)
  ok(held.halfway.arrowShown, "the arrow is drawn", `head at ${held.halfway.head}`)
  ok(held.halfway.shaped && held.over.shaped, "and the shape has a path all through the drag")
  ok(held.halfway.cursor === "none", "the pointer is hidden, so the head is what aims", held.halfway.cursor)
  ok(
    held.halfway.arrowBox === held.halfway.viewport,
    "and its box is the whole window, so the line is inside it",
    `${held.halfway.arrowBox} of ${held.halfway.viewport}`,
  )
  ok(
    held.halfway.head !== held.over.head,
    "the head follows the cursor",
    `${held.halfway.head} → ${held.over.head}`,
  )
  ok(held.over.aimed === pair.b.id, "the far node is marked", held.over.aimed || "nothing marked")
  ok(!held.halfway.panning, "panning is off while the button is held")

  const joined = await drawn(page)
  ok(
    joined.realEdges === before.realEdges + 1,
    "one line arrived",
    `${before.realEdges} → ${joined.realEdges}`,
  )
  ok(/^joined /.test(joined.status), "the status says so", joined.status)
  ok(joined.undos === 1, "the receipt carries an undo", `${joined.undos} undo button(s)`)
  ok(
    Number(joined.totals.match(/(\d+) edges/)?.[1]) ===
      Number(before.totals.match(/(\d+) edges/)?.[1]) + 1,
    "the store total went up by one",
    `${before.totals} → ${joined.totals}`,
  )
  ok(!joined.joining && !joined.arrowShown, "the arrow went with the release")
  ok(joined.panning, "panning came back")
  ok(joined.cursor === "grab", "and so did the pointer", joined.cursor)
  await page.screenshot({ path: `${SHOTS}/drag-join-1-joined.png` })

  // ---- undo --------------------------------------------------------------------------
  console.log("\n2. undo it")
  await page.locator("#receipts .undo").first().click()
  await page.waitForTimeout(800)
  const undone = await drawn(page)
  ok(
    undone.realEdges === before.realEdges,
    "the line went again",
    `${joined.realEdges} → ${undone.realEdges}`,
  )
  ok(undone.totals === before.totals, "the totals came back", undone.totals)
  ok(undone.undos === 0, "the undo button is spent", `${undone.undos} left`)

  // ---- a release over nothing --------------------------------------------------------
  console.log("\n3. shift-drag to empty space")
  const empty = await emptyPoint(page)
  const again = await pickPair(page)
  ok(
    !!empty && !!again,
    "found somewhere with no node in it",
    empty ? `${String(empty.x)},${String(empty.y)}` : "none",
  )
  const missed = await drag(page, again.a, empty)
  ok(missed.halfway.joining, "the arrow was drawn on the way out")
  const after = await drawn(page)
  ok(after.realEdges === undone.realEdges, "nothing was written", `${undone.realEdges} lines, unchanged`)
  ok(after.receipts === undone.receipts, "no receipt was opened", `${after.receipts} receipt(s)`)
  ok(after.panning, "panning came back")

  // ---- a pair the graph already holds ------------------------------------------------
  console.log("\n4. shift-drag onto a node it is already joined to")
  const twice = await pickJoined(page)
  ok(!!twice, "found a drawn pair", twice ? `${twice.a.label} — ${twice.b.label}` : "none")
  await drag(page, twice.a, twice.b)
  const refused = await drawn(page)
  ok(refused.warns === 1, "the receipt reports a refusal", `${refused.warns} warn(s)`)
  ok(/already joined/.test(refused.status), "the graph's own sentence", refused.status)
  ok(refused.realEdges === after.realEdges, "no second line", `${refused.realEdges} lines`)

  // ---- the pointer at the very start of a drag ---------------------------------------
  console.log("\n5. a press that has barely moved still draws a head")
  const before5 = await drawn(page)
  const tiny = await pickPair(page)
  const out = await emptyPoint(page)
  ok(!!tiny && !!out, "found a node to press on", tiny ? tiny.a.label : "none")
  await page.keyboard.down("Shift")
  await page.mouse.move(tiny.a.x, tiny.a.y)
  await page.mouse.down()
  // Six pixels, which is under the length that earns a shaft. Only the head is drawn here,
  // and it is the whole of what the reader has to aim with.
  await page.mouse.move(tiny.a.x + 6, tiny.a.y + 4, { steps: 2 })
  const barely = await drawn(page)
  // Out to open ground before letting go, so this cannot land as a click on the node.
  await page.mouse.move(out.x, out.y, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await page.waitForTimeout(600)
  ok(barely.cursor === "none", "the pointer is hidden from the press", barely.cursor)
  ok(barely.shaped, "and a head is already drawn, so something is aiming")
  const after5 = await drawn(page)
  ok(after5.realEdges === before5.realEdges, "the press wrote nothing", `${after5.realEdges} lines`)
  ok(after5.cursor === "grab", "and the pointer came back", after5.cursor)

  // ---- the map still pans ------------------------------------------------------------
  console.log("\n6. a plain drag still pans")
  const still = await drawn(page)
  // Aim inward from wherever the press lands, so the drag cannot leave the window.
  const inward = (at) => ({
    x: at.x < innerHalf.width ? at.x + 140 : at.x - 140,
    y: at.y < innerHalf.height ? at.y + 90 : at.y - 90,
  })

  const open = await emptyPoint(page)
  ok(!!open, "found somewhere to drag from", open ? `${String(open.x)},${String(open.y)}` : "none")
  await drag(page, open, inward(open), { shift: false })
  const panned = await drawn(page)
  ok(panned.pan !== still.pan, "a drag on the background moved the camera", `${still.pan} → ${panned.pan}`)

  // And from a node. Cytoscape pans on the background and on an edge. A press on a node is a
  // node gesture it swallows, so map-view.ts is what pans on this one.
  const onNode = await pickPair(page)
  ok(!!onNode, "found a node to drag from", onNode ? onNode.a.label : "none")
  await drag(page, onNode.a, inward(onNode.a), { shift: false })
  const panned2 = await drawn(page)
  ok(panned2.pan !== panned.pan, "a drag on a node moved it too", `${panned.pan} → ${panned2.pan}`)
  ok(panned2.realEdges === still.realEdges, "and neither wrote anything", `${panned2.realEdges} lines`)

  // ---- it is a real write ------------------------------------------------------------
  console.log("\n7. join a pair, then reload")
  const lastPair = await pickPair(page)
  ok(
    !!lastPair,
    "found another pair",
    lastPair ? `${lastPair.a.label} → ${lastPair.b.label}` : "none",
  )
  const kept = await drawn(page)
  await drag(page, lastPair.a, lastPair.b)
  const written = await drawn(page)
  ok(
    written.realEdges === kept.realEdges + 1,
    "the line arrived",
    `${kept.realEdges} → ${written.realEdges}`,
  )
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(900)
  const reloaded = await drawn(page)
  ok(
    Number(reloaded.totals.match(/(\d+) edges/)?.[1]) ===
      Number(written.totals.match(/(\d+) edges/)?.[1]),
    "the store kept it",
    `${written.totals} → ${reloaded.totals}`,
  )
  await page.screenshot({ path: `${SHOTS}/drag-join-2-reloaded.png` })

  console.log("")
  ok(problems.length === 0, "no page errors", problems.join(" · ") || "clean")
  console.log(`\n${failures ? "✗" : "✓"} ${String(failures)} failure(s) — shots in ${SHOTS}/`)
  await browser.close()
  process.exit(failures ? 1 : 0)
}

await main()
