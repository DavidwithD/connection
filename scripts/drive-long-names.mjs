#!/usr/bin/env node
/**
 * Drive the sphere view with names far longer than a label box, and check how they are cut.
 *
 *   npm run web                              # in another terminal
 *   node scripts/drive-long-names.mjs        # or: npm run drive:long-names
 *   node scripts/drive-long-names.mjs --head # watch it happen
 *
 * The rule is ADR 0048. A ring name is at most 150 px wide and 2 lines. The name under the
 * pointer opens to at most 260 px. The centre is cut like a ring name at rest, and the pointer
 * opens it to at most 300 px with every line.
 *
 * Playwright opens a fresh profile, so this writes to a graph of its own. The graph in your
 * own browser is not touched.
 */
import { mkdirSync } from "node:fs"

import { MAP, clickOn, frame, read, stageBox, still } from "./probe.mjs"

const { chromium } = await import("playwright").catch(() => {
  console.error("✗ needs playwright: npm i -D playwright --no-save")
  process.exit(2)
})

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const SHOTS = ".shots"
const headed = process.argv.includes("--head")

const NEIGHBOUR_MAX = 150
const HOVER_MAX = 260
const SELECTED_MAX = 300
const LINE = 12 + 16 // one ring line, plus the padding: the shortest a ring label box gets

const LONG = [
  "Seoul, the capital of South Korea, sits on the Han River and has about nine million residents",
  "Busan, the second largest city in the country and its largest port, on the south-east coast",
  "서울특별시는 대한민국의 수도이며 한강을 끼고 있는 가장 큰 도시로 약 구백만 명이 산다",
  "Incheon International Airport, opened in 2001 on reclaimed land west of the city",
]
const SHORT = ["Jeju", "Daegu", "Ulsan", "Suwon"]
const HUB = "Hub"

let faults = 0
const check = (ok, said) => {
  console.log(`  ${ok ? "✓" : "⚠"} ${said}`)
  if (!ok) faults++
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch({ channel: "chrome", headless: !headed })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

  const problems = []
  page.on("pageerror", (err) => problems.push(String(err)))

  // One star: a hub that joins every name, so the hub's ring holds long and short names.
  const text = [HUB, ...LONG, ...SHORT].map((name, i) => (i ? `${HUB} | ${name}` : name)).join("\n")
  await page.goto(`${WEB}/transfer.html`, { waitUntil: "domcontentloaded" })
  await page.setInputFiles("#file", {
    name: "long-names.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  })
  await page.locator("#apply").click()
  await page.waitForFunction(() => /Added|added/.test(document.querySelector("#said")?.textContent ?? ""), {
    timeout: 30000,
  })

  await page.goto(`${WEB}${MAP}`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await still(page)

  // Centre the hub, whichever node the page opened on.
  let seen = await frame(page)
  const hub = seen.elements.find((one) => one.kind === "node" && one.label === HUB)
  if (hub && hub.id !== seen.selected && hub.at) {
    await clickOn(page, hub.at)
    await still(page)
    seen = await frame(page)
  }
  await page.screenshot({ path: `${SHOTS}/long-1-neighbours.png` })

  const neighbours = read(seen).neighbours
  const long = neighbours.filter((one) => LONG.includes(one.label))
  check(long.length === LONG.length, `the neighbour circle holds all ${String(LONG.length)} long names (${String(long.length)})`)
  check(
    neighbours.every((one) => one.box.w <= NEIGHBOUR_MAX + 0.5),
    `no neighbour label box is wider than ${String(NEIGHBOUR_MAX)} (widest ${Math.max(...neighbours.map((one) => one.box.w)).toFixed(0)})`,
  )
  check(
    long.every((one) => one.box.h > LINE),
    "every long name takes more than one line",
  )
  check(
    long.every((one) => one.box.h <= 12 + 12 * 1.25 + 16 + 0.5),
    "no long name takes more than two lines",
  )
  const short = neighbours.filter((one) => SHORT.includes(one.label))
  check(
    short.every((one) => Math.abs(one.box.h - LINE) < 0.5),
    "a short name keeps its one-line height",
  )

  // The pointer opens a ring name to every line.
  const target = long.find((one) => one.at)
  if (target) {
    const stage = await stageBox(page)
    await page.mouse.move(stage.x + target.at.x, stage.y + target.at.y)
    await page.waitForTimeout(300)
    const open = (await frame(page)).elements.find((one) => one.id === target.id)
    check(
      open.box.w > target.box.w && open.box.w <= HOVER_MAX + 0.5,
      `the pointer opens a neighbour's name: ${target.box.w.toFixed(0)} → ${open.box.w.toFixed(0)} wide`,
    )
    check(open.box.h > target.box.h, `and its height: ${target.box.h.toFixed(0)} → ${open.box.h.toFixed(0)}`)
    // Still on the opened name, one step in from its edge, it has not closed.
    // The box is in world units. The pointer moves in screen pixels.
    const scale = (await frame(page)).zoom * target.k
    await page.mouse.move(stage.x + target.at.x + (open.box.w / 2 - 6) * scale, stage.y + target.at.y)
    await page.waitForTimeout(200)
    const held = (await frame(page)).elements.find((one) => one.id === target.id)
    check(held.box.w === open.box.w, "it stays open with the pointer near its far edge")
    await page.screenshot({ path: `${SHOTS}/long-2-hover.png` })
    await page.mouse.move(stage.x + 12, stage.y + stage.height - 12)
    await page.waitForTimeout(200)
  } else {
    check(false, "a long name is drawn to point at")
  }

  // A long name as the centre is cut like a ring name at rest, and opens under the pointer.
  if (target) {
    await clickOn(page, target.at)
    await still(page)
    // The click moved no camera, so the pointer is still on the node it centred. Its name is
    // open without a move.
    const stage = await stageBox(page)
    const held = (await frame(page)).elements.find((one) => one.id === target.id)
    check(
      held.box.w > NEIGHBOUR_MAX,
      `a clicked node opens as the selected without a move (${held.box.w.toFixed(0)} wide)`,
    )
    // The pointer goes to a corner, so the centre closes.
    await page.mouse.move(stage.x + 12, stage.y + stage.height - 12)
    await page.waitForTimeout(200)
    const after = await frame(page)
    const selected = after.elements.find((one) => one.id === after.selected)
    check(selected?.label === target.label, "the click centres the long name")
    check(
      selected.box.w <= NEIGHBOUR_MAX + 0.5,
      `at rest the selected is ${selected.box.w.toFixed(0)} wide (cap ${String(NEIGHBOUR_MAX)})`,
    )
    check(selected.box.h <= 15 + 15 * 1.25 + 16 + 0.5, `and ${selected.box.h.toFixed(0)} tall, at most 2 lines`)
    await page.screenshot({ path: `${SHOTS}/long-3-selected-rest.png` })

    await page.mouse.move(stage.x + selected.at.x, stage.y + selected.at.y)
    await page.waitForTimeout(300)
    const open = (await frame(page)).elements.find((one) => one.id === after.selected)
    check(
      open.box.w > NEIGHBOUR_MAX && open.box.w <= SELECTED_MAX + 0.5,
      `the pointer opens the selected to ${open.box.w.toFixed(0)} wide (cap ${String(SELECTED_MAX)})`,
    )
    check(open.box.h > selected.box.h, `and ${open.box.h.toFixed(0)} tall, so it shows every line`)
    await page.screenshot({ path: `${SHOTS}/long-4-selected-open.png` })
  }

  check(problems.length === 0, `no page errors${problems.length ? `: ${problems.join("; ")}` : ""}`)
  await browser.close()
  if (faults) {
    console.log(`✗ ${String(faults)} check(s) failed`)
    process.exit(1)
  }
  console.log("✓ all checks passed")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
