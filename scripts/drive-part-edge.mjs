#!/usr/bin/env node
/**
 * Drive the right-click that parts a pair, and check what the page did about it.
 *
 *   npm run web                             # in another terminal
 *   node scripts/drive-part-edge.mjs        # --head to watch it
 *
 * A companion to drive-map.mjs, and the same deal: real Chrome, nothing downloaded, shots in
 * .shots/. Where that one photographs the map, this one asserts — the gesture writes to the
 * graph, and a screenshot cannot say whether the write landed.
 *
 * It seeds a graph first, into Playwright's own throwaway profile. Nothing here can reach the
 * graph in the browser on the desktop.
 *
 * Two things make it flaky if they are skipped, and both are the page being right rather than
 * the script being unlucky. The camera has to be still, because a `viewport` event closes the
 * menu on purpose. And the point aimed at has to be a point where the line is really on top:
 * a label box or a panel in front of it takes the click, exactly as it would from a reader.
 *
 * A canvas holds no element per line, so both of those are asked through probe.mjs.
 */
import { mkdirSync } from "node:fs"

import {
  MAP,
  alongLines,
  clickOn,
  frame,
  hitAll,
  read,
  reachable,
  realEdges,
  samePair,
  still,
} from "./probe.mjs"

const { chromium } = await import("playwright").catch(() => {
  console.error("✗ needs playwright: npm i -D playwright --no-save")
  process.exit(2)
})

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const SHOTS = ".shots"
const headed = process.argv.includes("--head")

/** How many lines of one kind are searched for a clear point before this gives up. */
const CANDIDATE_LINES = 20

let failures = 0
const ok = (pass, what, detail = "") => {
  console.log(`  ${pass ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}

/**
 * What the map is drawing right now, read off the renderer's own probe and the page's controls.
 *
 * Two reads rather than one. The probe answers for the map, the DOM answers for the panels
 * around it, and neither can answer the other's half.
 */
const drawn = async (page) => {
  const seen = await frame(page)
  if (!seen) return null
  const it = read(seen)
  const pageState = await page.evaluate(() => ({
    status: document.querySelector("#status")?.textContent ?? "",
    undos: document.querySelectorAll("#write-log .undo").length,
    menuOpen: !document.querySelector("#map-menu")?.hidden,
    menuRow: document.querySelector("#map-remove")?.textContent ?? "",
  }))
  return {
    selected: seen.selected,
    selectedLabel: it.selected?.label ?? null,
    zoom: Number(seen.zoom.toFixed(2)),
    neighbours: it.neighbours.length,
    // Past the visible limit by any amount, which is the sphere view's own answer to "off screen".
    offScreen: it.neighbours.filter((node) => node.past > 0).length,
    edges: seen.lines.length,
    realEdges: realEdges(seen).length,
    markerLines: seen.lines.filter((line) => line.kind === "marker").length,
    ...pageState,
  }
}

/**
 * Right-click one drawn line of a given kind, and report the pair it joins.
 *
 * Aims where the line is actually on top. A label box can cover a line's midpoint, and the page
 * hands a right-click to whatever is in front — which is what a reader sees too. So every
 * candidate point is put to the probe first, and the first one the probe answers with this
 * line is the one clicked.
 *
 * Under `dry` nothing is clicked. That is for the leg looking for a camera where an off-screen
 * marker's lead can be reached at all.
 */
const rightClickEdge = async (page, kind, dry = false) => {
  const seen = await frame(page)
  if (!seen?.selected) return null
  const selected = seen.selected
  const touches = (line) => line.a === selected || line.b === selected
  const pick = seen.lines.filter((line) => {
    if (kind === "marker") return line.kind === "marker" && touches(line)
    if (kind === "away") return line.kind === "edge" && !touches(line)
    return line.kind === "edge" && touches(line)
  })
  if (!pick.length) return null

  // A bounded search. `away` can name hundreds of lines on a walked map, and one clear point
  // is all this needs.
  const candidates = pick.slice(0, CANDIDATE_LINES)
  const runs = await alongLines(page, candidates.map((line) => [line.a, line.b]))
  const points = candidates.flatMap((line, index) =>
    (runs[index] ?? []).map((at) => ({ line, at })),
  )
  if (!points.length) return null
  const answers = (await hitAll(page, points.map((one) => one.at))) ?? []
  const found = points.findIndex(
    (one, index) =>
      answers[index]?.clear &&
      answers[index].line &&
      samePair(answers[index].line, [one.line.a, one.line.b]),
  )

  // Nothing on any of these lines is in front anywhere along it. Aim at the first candidate
  // anyway and let the report say what was under the pointer.
  const dropTarget = points[found < 0 ? 0 : found]
  const { line, at } = dropTarget
  const there = answers[found < 0 ? 0 : found]
  if (!dry) await clickOn(page, at, { button: "right" })
  return {
    clear: Boolean(there?.clear),
    source: line.a,
    target: line.b,
    marker: line.kind === "marker",
    at: `${String(Math.round(at.x))},${String(Math.round(at.y))}`,
    inWindow: Boolean(there?.inWindow),
    under: there?.under ?? "nothing",
    nearest: there?.node ?? (there?.line ? there.line.join(" — ") : "nothing"),
  }
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
  // Unconditionally, because `confirmThen` reads the store before it shows the box. A
  // visibility test runs before that read lands and skips the click. See transfer.ts.
  await page.locator("#ask-yes").click()
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
  await page.waitForTimeout(600)

  // ---- a line into the centre -------------------------------------------------------
  console.log("\n1. right-click a line into the selected")
  await still(page)
  const before = await drawn(page)
  const dropTarget = await rightClickEdge(page, "line")
  await page.waitForTimeout(200)
  const opened = await drawn(page)
  ok(!!dropTarget, "found a line at the selected", dropTarget ? `${dropTarget.source} — ${dropTarget.target}` : "none drawn")
  ok(opened.menuOpen, "the menu opened", opened.menuRow)
  ok(/^part .+ and .+/.test(opened.menuRow), "the row offers a part", opened.menuRow)
  ok(
    opened.menuRow.includes(before.selectedLabel),
    "the selected is named first",
    `selected is ${before.selectedLabel}`,
  )
  await page.screenshot({ path: `${SHOTS}/part-1-menu.png` })

  await page.locator("#map-remove").click()
  await page.waitForTimeout(700)
  const parted = await drawn(page)
  ok(parted.realEdges === before.realEdges - 1, "one line went", `${before.realEdges} → ${parted.realEdges}`)
  ok(/parted /.test(parted.status), "the status says so", parted.status)
  ok(parted.undos === 1, "the entry carries an undo", `${parted.undos} undo button(s)`)
  await page.screenshot({ path: `${SHOTS}/part-2-parted.png` })

  // ---- undo -------------------------------------------------------------------------
  console.log("\n2. undo it")
  await page.locator("#write-log .undo").first().click()
  await page.waitForTimeout(700)
  const back = await drawn(page)
  ok(back.realEdges === before.realEdges, "the line came back", `${parted.realEdges} → ${back.realEdges}`)
  ok(back.undos === 0, "the undo button is spent", `${back.undos} left`)

  // ---- an off-screen marker's dashed lead
  // ---------------------------------------------------------
  console.log("\n3. right-click a marker's dashed lead")
  // An off-screen marker stands for a neighbour the surface has turned away from. Two things have
  // to be true before one is reachable, and neither is true on the map this opened.
  //
  // The camera has to be off the centre. `MARKER_MARGIN` is a length in screen pixels, so on a
  // curved surface it is an angle, and a zoom alone never crosses it.
  //
  // The centre has to hold a wide neighbourhood. Its off-screen marker slots sit in world space
  // around it, so a tight ring leaves every one of them past the visible limit. Walking out is what
  // widens the neighbourhood.
  for (let step = 0; step < 3; step++) {
    const next = await reachable(page, read(await frame(page)).neighbours)
    if (!next) break
    await clickOn(page, next.at)
    await page.waitForTimeout(900)
  }
  for (let i = 0; i < 9; i++) {
    await page.locator("#zoom-in").click()
    await page.waitForTimeout(160)
  }
  let nudges = 0
  const climb = []
  for (let step = 0; step < 12 && !nudges; step++) {
    await page.keyboard.press("ArrowRight")
    await page.waitForTimeout(120)
    await still(page)
    const seen = await drawn(page)
    climb.push(seen.markerLines)
    if (!seen.markerLines) continue
    const found = await rightClickEdge(page, "marker", true)
    if (found?.clear) nudges = step + 1
  }
  console.log(`  connectorLines after each nudge: ${climb.join(" -> ")}`)
  ok(
    nudges > 0,
    "a camera where a marker's lead can be clicked",
    nudges ? `${String(nudges)} nudge(s)` : "none in twelve",
  )
  const zoomed = await drawn(page)
  ok(
    zoomed.markerLines > 0,
    "markers are standing",
    `${zoomed.markerLines} lead(s) · zoom ${zoomed.zoom} · neighbours ${zoomed.neighbours} · ${zoomed.offScreen} off screen`,
  )
  if (!zoomed.markerLines) {
    console.log("  (no markers to click — skipping 3 and 4)")
    await browser.close()
    process.exit(failures ? 1 : 0)
  }
  await still(page)
  const markerHit = await rightClickEdge(page, "marker")
  await page.waitForTimeout(200)
  const markerMenu = await drawn(page)
  ok(!!markerHit, "found a marker lead")
  ok(markerMenu.menuOpen, "the menu opened on it", markerMenu.menuRow)
  ok(/^part .+ and .+/.test(markerMenu.menuRow), "the row offers a part", markerMenu.menuRow)
  await page.screenshot({ path: `${SHOTS}/part-3-marker-menu.png` })

  await page.locator("#map-remove").click()
  await page.waitForTimeout(900)
  const markerGone = await drawn(page)
  ok(
    markerGone.markerLines === zoomed.markerLines - 1,
    "the marker and its lead went with the edge",
    `${zoomed.markerLines} → ${markerGone.markerLines}`,
  )
  ok(/parted /.test(markerGone.status), "the status says so", markerGone.status)
  await page.screenshot({ path: `${SHOTS}/part-4-marker-parted.png` })

  console.log("\n4. undo the marker's edge")
  await page.locator("#write-log .undo").first().click()
  await page.waitForTimeout(900)
  const markerBack = await drawn(page)
  ok(
    markerBack.markerLines === zoomed.markerLines,
    "the marker came back with the edge",
    `${markerGone.markerLines} → ${markerBack.markerLines}`,
  )

  // ---- a line away from the centre ---------------------------------------------------
  console.log("\n5. right-click a line that misses the selected")
  // The leg above left the camera off its centre with off-screen markers standing. Clicking a
  // neighbour that is drawn puts the mark on a node in view, and the zoom-out then brings its
  // neighbourhood on screen. A line that misses the centre needs both.
  await still(page)
  const step = await reachable(page, read(await frame(page)).neighbours)
  ok(!!step, "found a neighbour to stand on", step ? step.label : "none clickable")
  if (step) await clickOn(page, step.at)
  await still(page)
  for (let i = 0; i < 9; i++) {
    await page.locator("#zoom-out").click()
    await page.waitForTimeout(200)
  }
  await still(page)
  const away = await rightClickEdge(page, "away")
  await page.waitForTimeout(200)
  const quiet = await drawn(page)
  ok(!!away, "found a line away from the selected")
  ok(!quiet.menuOpen, "nothing opened", quiet.menuRow)

  // ---- the menu on a still camera, then a reload --------------------------------------
  console.log("\n6. part one, then reload")
  // The camera has to be still first. A `viewport` event closes the menu, which is what it is
  // for, and the zoom above is still settling.
  await still(page)
  // Put the centre back in the middle of the window. After the zoom it can sit under the
  // status line, and no part of its lines is then clickable.
  await page.locator("#go-to-selected").click()
  await still(page)
  const last = await rightClickEdge(page, "line")
  await page.waitForTimeout(300)
  const lastMenu = await drawn(page)
  ok(!!last?.clear, "found a clickable line at the selected again", last ? `${last.source} — ${last.target}` : "none")
  ok(lastMenu.menuOpen, "the menu stayed open on a still camera", lastMenu.menuRow)
  if (!lastMenu.menuOpen) {
    await browser.close()
    process.exit(1)
  }
  await page.locator("#map-remove").click()
  await page.waitForTimeout(800)
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(500)

  console.log(
    problems.length ? `\n⚠ ${String(problems.length)} console problem(s):\n  ${problems.join("\n  ")}` : "\n✓ no console errors",
  )
  await browser.close()
  console.log(failures ? `\n✗ ${String(failures)} check(s) failed` : "\n✓ every check passed")
  process.exit(failures || problems.length ? 1 : 0)
}

await main()
