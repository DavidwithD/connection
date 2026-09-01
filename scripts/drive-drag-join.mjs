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

import {
  MAP,
  clickOn,
  emptyPoint,
  frame,
  joined,
  read,
  reachable,
  realEdges,
  stageBox,
} from "./probe.mjs"

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

/**
 * What the page is showing: the graph, the receipts, and the state of the drag.
 *
 * Two reads rather than one. The probe answers for the map, the DOM answers for the arrow and
 * the panels, and neither can answer the other's half.
 */
const drawn = async (page) => {
  const seen = await frame(page)
  if (!seen) return null
  const chrome = await page.evaluate(() => {
    // The gradient's ends are the arrow's ends. It is aimed with the shape, so reading it back
    // is reading where the arrow was actually drawn.
    const ink = document.querySelector("#aim-ink")
    const box = document.querySelector("#aim")
    return {
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
    }
  })
  return {
    realEdges: realEdges(seen).length,
    aimed: seen.aimed ?? "",
    panning: seen.panning,
    // Where the middle of the window looks, which is the whole of this camera's position.
    pan: `${String(Math.round(seen.centre.x))},${String(Math.round(seen.centre.y))}`,
    ...chrome,
  }
}

/**
 * The centre, and a node with no edge to it. Both clear of the page's own furniture.
 *
 * The tiers are what make this sound. `setTiers` marks each node the centre holds an edge to as
 * tier 1. So tier 2 and tier 3 are the nodes it holds none to. That is the whole truth only while
 * the centre holds all of its own edges, which is what `centreHasAll` reports.
 *
 * The key check is the second half. A tier is recomputed when the centre changes. A join made
 * since then leaves a node still marked unjoined, and the map's own lines say so.
 */
const pickPair = async (page) => {
  const seen = await frame(page)
  if (!seen?.accent) return null
  const centre = read(seen).centre
  if (!centre) return null
  if ((await reachable(page, [centre]))?.id !== centre.id) return null
  const far = seen.elements.filter(
    (one) => one.kind === "node" && one.tier >= 2 && !joined(seen, centre.id, one.id),
  )
  const to = await reachable(page, far)
  if (!to) return null
  return {
    centreHasAll: !centre.more,
    a: { id: centre.id, label: centre.label, ...centre.at },
    b: { id: to.id, label: to.label, ...to.at },
  }
}

/** A pair the graph has already joined, drawn as one line, with both ends clear. */
const pickJoined = async (page) => {
  const seen = await frame(page)
  if (!seen) return null
  const by = new Map(seen.elements.map((one) => [one.id, one]))
  for (const line of realEdges(seen)) {
    const source = by.get(line.a)
    const target = by.get(line.b)
    if (!source?.at || !target?.at) continue
    // One end at a time. `reachable` returns the first of a set the pointer can reach. A
    // single call over the pair would pass a line with one end under a pill.
    if ((await reachable(page, [source]))?.id !== source.id) continue
    if ((await reachable(page, [target]))?.id !== target.id) continue
    return {
      a: { id: source.id, label: source.label, ...source.at },
      b: { id: target.id, label: target.label, ...target.at },
    }
  }
  return null
}

/**
 * Press on one point, drag to another, release. Reports what the page looked like mid-drag,
 * which is the only moment the arrow exists.
 *
 * Both points are in canvas pixels, which is what the probe answers in. `drag` converts to
 * the viewport here, so nothing above this line holds two coordinate systems.
 */
async function drag(page, from, to, { shift = true, shot = null } = {}) {
  const box = await stageBox(page)
  const move = (at, options) => page.mouse.move(box.x + at.x, box.y + at.y, options)
  if (shift) await page.keyboard.down("Shift")
  await move(from)
  await page.mouse.down()
  await move({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, { steps: 6 })
  const halfway = await drawn(page)
  // The arrow exists only while the button is down, so this is the one place to photograph it.
  // Halfway rather than at the end. The head is over open ground here, and under the far node's
  // own pill by the time the drag arrives.
  if (shot) await page.screenshot({ path: `${SHOTS}/${shot}.png` })
  await move(to, { steps: 6 })
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

  console.log(`→ ${WEB}${MAP} — the map`)
  await page.goto(`${WEB}${MAP}`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(900)

  // ---- one step, so there is a pair to make ------------------------------------------
  // A map that has just opened draws the centre and its ring, and nothing else. Every node on
  // screen is joined to the centre already, so there is no pair for a drag to make. Walking
  // one step puts a second ring on the map, and the ring left behind is where a far end comes
  // from.
  console.log("\n0. walk one step, so two rings are on the map")
  const step = await reachable(page, read(await frame(page)).ring)
  ok(!!step, "found a neighbour to stand on", step ? step.label : "none clickable")
  if (!step) {
    await browser.close()
    process.exit(1)
  }
  await clickOn(page, step.at)
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
  const stage = await stageBox(page)
  await page.keyboard.down("Shift")
  await page.mouse.move(stage.x + tiny.a.x, stage.y + tiny.a.y)
  await page.mouse.down()
  // Six pixels, which is under the length that earns a shaft. Only the head is drawn here,
  // and it is the whole of what the reader has to aim with.
  await page.mouse.move(stage.x + tiny.a.x + 6, stage.y + tiny.a.y + 4, { steps: 2 })
  const barely = await drawn(page)
  // Out to open ground before letting go, so this cannot land as a click on the node.
  await page.mouse.move(stage.x + out.x, stage.y + out.y, { steps: 6 })
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
  // Aim inward from wherever the press lands, so the drag cannot leave the canvas.
  const canvas = await stageBox(page)
  const inward = (at) => ({
    x: at.x < canvas.width / 2 ? at.x + 140 : at.x - 140,
    y: at.y < canvas.height / 2 ? at.y + 90 : at.y - 90,
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
