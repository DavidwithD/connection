#!/usr/bin/env node
/**
 * Drive the globe renderer in a real browser and photograph what it draws.
 *
 *   npm run web                          # in another terminal
 *   node scripts/drive-globe.mjs         # shots land in .shots/
 *   node scripts/drive-globe.mjs --head  # watch it happen
 *
 * The other five scripts drive Cytoscape, which registers `_cyreg` on its container and gives
 * every node a place in the scene graph. A canvas holds no element per node, so this one asks
 * `globe-view.ts` for its frame through the probe on `#stage`.
 *
 * The page opens at `/?globe`, which is what puts the globe under the map. That query goes
 * when Cytoscape does.
 *
 * Playwright is deliberately not a dependency of this project. Install it where you want it
 * and point NODE_PATH at it, or `npm i -D playwright --no-save` for one session.
 */
import { mkdirSync } from "node:fs"

const { chromium } = await import("playwright").catch(() => {
  console.error("✗ needs playwright: npm i -D playwright --no-save")
  process.exit(2)
})

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const SHOTS = ".shots"
const headed = process.argv.includes("--head")

const shot = async (page, name) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
  console.log(`  📷 ${SHOTS}/${name}.png`)
}

/** One frame, as globe-view.ts reports it. */
const frame = (page) =>
  page.evaluate(() => document.querySelector("#stage")?.__map?.report() ?? null)

/**
 * What the frame says about the doorways, in the terms the rule is written in.
 *
 * `past` is the angle between a node's box and the horizon. Both thresholds the ghost rule
 * uses are readable from it, so this script needs neither number of its own.
 */
function read(seen) {
  const by = new Map(seen.elements.map((one) => [one.id, one]))
  const ghosts = seen.elements.filter((one) => one.kind === "ghost")
  const nodes = seen.elements.filter((one) => one.kind === "node")
  const drawn = seen.elements.filter((one) => one.at !== null)
  const ring = nodes.filter((one) => one.tier === 1)

  // Split on the second NUL, as `ghostTarget` in map.ts does.
  const targetOf = (id) => {
    const cut = id.indexOf("\0", 2)
    return cut < 0 ? null : by.get(id.slice(cut + 1))
  }
  // The invariant: a name is never readable at its own position and shown as a ghost at once.
  const twins = ghosts.filter((ghost) => (targetOf(ghost.id)?.past ?? 1) <= 0)
  // A doorway the surface has turned away is one nobody can open. Panned away from, the centre
  // takes its rings with it, so every doorway being gone there is the picture working as
  // decided. A slot on the far side of an off-middle centre is past the limb for the same
  // reason: the ring sits in world space. The fault is every slot being past it while the
  // centre is drawn, which leaves the reader a centre and no way out of it.
  const centre = seen.accent ? by.get(seen.accent) : undefined
  const centreShown = centre?.at != null
  const lost = centreShown && ghosts.length && !ghosts.some((one) => one.at) ? ghosts : []

  // Slots are handed out so that no two boxes touch, so any overlap is that arithmetic being
  // wrong rather than a judgement about crowding. Measured in world units, where the slots
  // were cut.
  let collisions = 0
  for (let i = 0; i < ghosts.length; i++) {
    for (let j = i + 1; j < ghosts.length; j++) {
      const a = ghosts[i]
      const b = ghosts[j]
      if (!a.at || !b.at) continue
      const gapX = Math.abs(a.at.x - b.at.x) - (a.box.w + b.box.w) / 2
      const gapY = Math.abs(a.at.y - b.at.y) - (a.box.h + b.box.h) / 2
      if (gapX < 0 && gapY < 0) collisions++
    }
  }

  return { ghosts, nodes, drawn, ring, twins, lost, collisions, centreShown }
}

const degrees = (radians) => `${(radians * (180 / Math.PI)).toFixed(1)}°`

function report(what, seen) {
  if (!seen) return console.log(`  ${what}: no globe on the page`)
  const it = read(seen)
  const behind = it.nodes.filter((one) => one.at === null).length
  console.log(
    `  ${what}: zoom ${seen.zoom.toFixed(2)} · R ${Math.round(seen.radius)}px` +
      ` · horizon ${degrees(seen.horizon)}` +
      ` · ${String(it.drawn.length)} of ${String(seen.elements.length)} drawn` +
      ` · ${String(behind)} past the limb` +
      ` · ring ${String(it.ring.length)}` +
      ` · ${String(it.ghosts.filter((one) => one.at).length)}` +
      ` of ${String(it.ghosts.length)} doorways drawn` +
      (it.centreShown ? "" : " · centre out of frame") +
      (it.twins.length ? ` · ⚠ drawn twice: ${it.twins.map((g) => g.label).join(", ")}` : "") +
      (it.lost.length ? " · ⚠ every doorway is past the limb" : "") +
      (it.collisions ? ` · ⚠ ${String(it.collisions)} overlapping doorway pair(s)` : ""),
  )
  return seen
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })

  const browser = await chromium.launch({ channel: "chrome", headless: !headed })
  // A context of its own, not `browser.newPage`, so the storage-blocked leg at the end can open
  // a second page beside this one. Both pages then share the store this script seeds.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const problems = []
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
      problems.push(message.text())
    }
  })
  page.on("pageerror", (err) => problems.push(String(err)))
  page.on("requestfailed", (req) => problems.push(`${req.method()} ${req.url()} failed`))
  page.on("response", (res) => {
    if (res.status() >= 400) problems.push(`${String(res.status())} ${res.url()}`)
  })

  console.log(`→ ${WEB}/?globe`)

  // Playwright opens a fresh profile every run, so there is nothing to draw until this writes
  // a graph. Through the page's own buttons, because that is the only seam a browser has.
  await page.goto(`${WEB}/transfer.html`, { waitUntil: "domcontentloaded" })
  await page.locator("#seed").click()
  await page.locator("#ask-yes").click()
  await page.waitForFunction(
    () => /Seeded/.test(document.querySelector("#told")?.textContent ?? ""),
    { timeout: 30000 },
  )
  console.log(`  seeded: ${(await page.locator("#told").textContent())?.trim() ?? ""}`)

  await page.goto(`${WEB}/?globe`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await page.waitForTimeout(500)

  const first = await frame(page)
  if (!first) {
    console.log("  ✗ #stage has no probe — the page is not on the globe renderer")
    await browser.close()
    process.exit(1)
  }
  report("landed", first)
  await shot(page, "globe-1-landed")

  /** Click where the probe says an element is drawn. A canvas has nothing to address by name. */
  const clickOn = async (element) => {
    const box = await page.locator("#stage").boundingBox()
    await page.mouse.click(box.x + element.at.x, box.y + element.at.y)
  }

  // Walk three steps out from the opening node, so the map holds more than one neighbourhood.
  // A read runs for the centre only, on arrival, so clicking is the only way to grow it.
  for (let step = 0; step < 3; step++) {
    const seen = await frame(page)
    const next = read(seen).ring.find((one) => one.at !== null)
    if (!next) break
    await clickOn(next)
    await page.waitForTimeout(900)
  }
  report("walked", await frame(page))

  // The pointer, at the simplest picture this script will see. A disc under the pointer draws
  // as its name, so the footprint the renderer reports for it grows from a disc to a pill.
  {
    const stage = await page.locator("#stage").boundingBox()
    const seen = await frame(page)
    const disc = seen.elements.find((one) => one.kind === "node" && one.tier >= 2 && one.at)
    if (!disc) {
      console.log("  hover: no distant node drawn, so nothing to point at")
    } else {
      await page.mouse.move(stage.x + disc.at.x, stage.y + disc.at.y)
      await page.waitForTimeout(250)
      const after = (await frame(page)).elements.find((one) => one.id === disc.id)
      const named = after.box.w > disc.box.w
      console.log(
        `  hover: ${disc.label} ${disc.box.w.toFixed(0)} → ${after.box.w.toFixed(0)} wide` +
          (named ? " · named" : " · ⚠ the pointer opened no name"),
      )
      await page.mouse.move(stage.x + 12, stage.y + stage.height - 12)
      await page.waitForTimeout(200)
    }
  }

  // The right-click. Only the centre opens a menu, and that is main.ts's rule rather than this
  // renderer's. What is under test here is a right-click finding the node it landed on.
  {
    const stage = await page.locator("#stage").boundingBox()
    const seen = await frame(page)
    const centre = seen.elements.find((one) => one.id === seen.accent)
    await page.mouse.click(stage.x + centre.at.x, stage.y + centre.at.y, { button: "right" })
    await page.waitForTimeout(250)
    const open = await page.locator("#map-menu").isVisible()
    const row = (await page.locator("#map-remove").textContent()) ?? ""
    console.log(
      `  right-click the centre: ${open ? `opened — ${row}` : "⚠ nothing opened"}`,
    )
    await page.keyboard.press("Escape")
    await page.waitForTimeout(200)
  }

  // The shift-drag that joins two nodes. Every press event the page hears is in this one
  // gesture. The press on a node, the moves under it, the crossing onto a second, the release.
  {
    const stage = await page.locator("#stage").boundingBox()
    const seen = await frame(page)
    const ring = read(seen).ring.filter((one) => one.at)
    const [from, to] = [ring[0], ring[ring.length - 1]]
    const edges = async () => Number(await page.locator("#stat-edges").textContent())
    if (!from || !to || from.id === to.id) {
      console.log("  shift-drag: fewer than two neighbours drawn, so no pair to join")
    } else {
      const before = await edges()
      await page.keyboard.down("Shift")
      await page.mouse.move(stage.x + from.at.x, stage.y + from.at.y)
      await page.mouse.down()
      await page.mouse.move(stage.x + (from.at.x + to.at.x) / 2, stage.y + (from.at.y + to.at.y) / 2)
      await page.waitForTimeout(120)
      const drawing = await page.evaluate(() => document.body.classList.contains("joining"))
      await page.mouse.move(stage.x + to.at.x, stage.y + to.at.y)
      await page.waitForTimeout(120)
      await page.mouse.up()
      await page.keyboard.up("Shift")
      await page.waitForTimeout(700)
      const after = await edges()
      console.log(
        `  shift-drag: ${from.label} → ${to.label}` +
          ` · arrow ${drawing ? "drawn" : "⚠ not drawn"}` +
          ` · ${String(before)} → ${String(after)} edges` +
          (after > before ? " · joined" : " · ⚠ nothing written"),
      )
      // Undone, so the legs below read the graph this script was handed.
      const undo = page.locator("#receipts button").first()
      if (await undo.isVisible()) {
        await undo.click()
        await page.waitForTimeout(600)
      }
    }
  }

  // Zoomed out, every neighbour is legible at its own seat and nothing should be standing in
  // for one. Zoomed in, most of a neighbourhood has left the screen and the doorways are what
  // is left of it.
  const zoom = async (button, times) => {
    for (let i = 0; i < times; i++) {
      await page.locator(`#${button}`).click()
      await page.waitForTimeout(300)
    }
    await page.waitForTimeout(400)
  }

  await zoom("zoom-out", 5)
  report("zoomed out", await frame(page))
  await shot(page, "globe-2-zoomed-out")

  await zoom("zoom-in", 9)
  report("zoomed in", await frame(page))
  await shot(page, "globe-3-zoomed-in")

  // Recentred first, so the pan below starts from a picture this script chose.
  await page.locator("#home").click()
  await page.waitForTimeout(900)

  /** Pan by whole keyboard steps, and report what is standing afterwards. */
  const nudge = async (key, presses) => {
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(key)
      await page.waitForTimeout(90)
    }
    await page.waitForTimeout(400)
    return read(await frame(page))
  }

  // Doorways appear as the ring crosses the horizon. Counted per step rather than asserted at
  // one distance, because which step raises the first one depends on the seeded graph.
  const climb = []
  let steps = 0
  while (steps < 12) {
    const seen = await nudge("ArrowRight", 1)
    steps++
    climb.push(seen.ghosts.length)
    if (seen.ghosts.length) break
  }
  const peak = read(await frame(page))
  console.log(
    `  doorways out: ${climb.join(" → ")} after ${String(steps)} nudge(s)` +
      ` · ${String(peak.ghosts.filter((one) => one.at).length)} of ${String(peak.ghosts.length)} drawn` +
      (peak.centreShown ? "" : " · centre out of frame") +
      (peak.ghosts.length ? "" : " · ⚠ nothing stood in for a neighbour past the limb"),
  )
  report("panned", await frame(page))
  await shot(page, "globe-4-doorways")

  // A nudge and the nudge back have to land on the same picture. `GHOST_MARGIN` is the dead
  // band that holds it: without one, a node sitting on the horizon flips on every pan.
  const standing = (seen) =>
    read(seen)
      .ghosts.map(
        (g) => `${g.label}@${String(Math.round(g.at?.x ?? -1))},${String(Math.round(g.at?.y ?? -1))}`,
      )
      .sort()
  if (peak.ghosts.length) {
    const before = standing(await frame(page))
    for (const key of ["ArrowRight", "ArrowLeft"]) {
      await page.keyboard.press(key)
      await page.waitForTimeout(300)
    }
    const after = standing(await frame(page))
    // Every doorway standing before the nudge has to be in the same place after it. The set
    // may grow. The two thresholds are not opposites: a neighbour that crossed the margin on
    // the way out keeps its doorway until it is back in view. What may not happen is a doorway
    // moving, because nothing on this map moves.
    const moved = before.filter((one) => !after.includes(one))
    console.log(
      `  nudge and back: ${String(before.length)} → ${String(after.length)} standing` +
        (moved.length ? ` · ⚠ moved under it: ${moved.join(" ")}` : " · none moved"),
    )
  }

  // And back the way it came, where every neighbour is legible at its own seat again. A
  // doorway left standing there would be the same name twice.
  {
    const back = await nudge("ArrowLeft", steps)
    console.log(
      `  doorways back: ${String(peak.ghosts.length)} → ${String(back.ghosts.length)}` +
        (back.ghosts.length ? " · ⚠ one is still standing over a neighbour in view" : " · lowered"),
    )
  }

  // A click on a doorway flies to the node it names, and the map is naming that node when the
  // camera lands. The click is at the pixel the probe says the doorway is drawn at, because a
  // canvas has nothing to address by name.
  {
    const seen = await nudge("ArrowRight", steps)
    const doorway = seen.ghosts.find((one) => one.at !== null)
    if (!doorway) {
      console.log("  flight: no doorway drawn, so nothing to fly to")
    } else {
      const before = await page.locator("#stat-centre").textContent()
      await clickOn(doorway)
      await page.waitForTimeout(1800)
      const after = await page.locator("#stat-centre").textContent()
      console.log(
        `  flight: ${before} → ${after} (clicked ${doorway.label})` +
          (after === doorway.label ? " · landed" : " · ⚠ the camera did not name the doorway's node"),
      )
      await shot(page, "globe-5-flown")
    }
  }

  // A map worth measuring on. A read runs for the centre only, on arrival, so the map grows
  // one click at a time. **Walk by pan** does not help: the camera outruns the frontier, and a
  // middle with nothing near it names no centre and reads nothing.
  await page.locator("#home").click()
  await page.waitForTimeout(700)
  await zoom("zoom-out", 4)
  for (let step = 0; step < 90; step++) {
    const ring = read(await frame(page)).ring.filter((one) => one.at)
    if (!ring.length) break
    // Not the same slot every time, so the walk spreads instead of going back and forth over
    // ground already read.
    await clickOn(ring[(step * 3) % ring.length])
    await page.waitForTimeout(420)
  }
  await page.waitForTimeout(900)
  report("walked out", await frame(page))
  await shot(page, "globe-6-crowded")

  // The frame rate, counted off the renderer's own draws rather than off rAF. A dirty-flag
  // loop skips a frame it has nothing to redraw for, so rAF would report the display's rate
  // whatever the map did. Measured over a camera flight, which redraws every frame for its
  // whole duration — a drag would measure how fast Playwright dispatches a pointer move.
  {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("ArrowRight")
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(500)
    await page.locator("#home").click()
    // Both readings inside the flight, so the click and the first evaluate are outside the
    // window rather than counted as frames nobody drew.
    await page.waitForTimeout(80)
    const began = Date.now()
    const before = await frame(page)
    await page.waitForTimeout(500)
    const after = await frame(page)
    const ms = Date.now() - began
    const drew = after.frames - before.frames
    // The cost of one frame, off the renderer's own clock, and what that leaves room for. A
    // headless browser runs rAF at its own rate rather than a screen's. So the count over the
    // window is reported, and the threshold below is on the cost.
    const cost = (after.drawMs - before.drawMs) / Math.max(1, drew)
    console.log(
      `  flying: ${String(drew)} draws in ${String(ms)}ms · ${cost.toFixed(1)}ms each` +
        ` · room for ${(1000 / Math.max(0.1, cost)).toFixed(0)} a second` +
        ` over ${String(after.elements.length)} elements` +
        ` (${String(after.elements.filter((one) => one.at).length)} drawn)` +
        (cost <= 16 ? "" : " · ⚠ a draw costs more than 16ms"),
    )
  }

  /** A curvature no default would land on, so the two legs below can tell a read from a guess. */
  const STORED = 2.4

  /** Move the slider as a drag does, and hand back the frame that followed. */
  const curve = async (value) => {
    await page.evaluate((to) => {
      const slider = document.querySelector("#curvature")
      slider.value = String(to)
      slider.dispatchEvent(new Event("input"))
    }, value)
    await page.waitForTimeout(70)
    return frame(page)
  }

  // Every value the slider can produce, and what each one draws. `R` is the only thing the
  // setting reaches, so the radius the probe reports is what says the map heard the slider.
  {
    const ends = await page.evaluate(() => {
      const slider = document.querySelector("#curvature")
      return slider ? [Number(slider.min), Number(slider.max), Number(slider.step)] : null
    })
    // The slider is in the guide panel, and that panel is a popover. So this opens it the way a
    // reader does before asking whether the row is visible.
    await page.locator("#guide-toggle").click()
    await page.waitForTimeout(200)
    const shown = await page.locator("#curvature-row").isVisible()
    await shot(page, "globe-7-panel")
    await page.keyboard.press("Escape")
    await page.waitForTimeout(200)
    if (!ends || !shown) {
      problems.push("no curvature slider on the page at /?globe")
      console.log("  curvature: ⚠ the slider is not on the page")
    } else {
      const [low, high, step] = ends
      const box = await page.locator("#stage").boundingBox()
      // What `radius` in projection.ts computes: the shorter half-span, times the setting.
      const halfSpan = Math.min(box.width, box.height) / 2
      const stops = Math.round((high - low) / step)
      const blank = []
      const off = []
      for (let i = 0; i <= stops; i++) {
        const value = Number((low + i * step).toFixed(4))
        const seen = await curve(value)
        if (!read(seen).drawn.length) blank.push(value.toFixed(2))
        if (Math.abs(seen.radius - value * halfSpan) > 1) off.push(value.toFixed(2))
      }
      console.log(
        `  curvature: ${String(stops + 1)} values from ${low.toFixed(2)} to ${high.toFixed(2)}` +
          ` · R ${Math.round(low * halfSpan)} → ${Math.round(high * halfSpan)}px` +
          (blank.length ? ` · ⚠ drew nothing at ${blank.join(", ")}` : " · every one drew") +
          (off.length ? ` · ⚠ R did not follow the slider at ${off.join(", ")}` : ""),
      )
      for (const [name, value] of [
        ["curved", low],
        ["flat", high],
      ]) {
        const seen = await curve(value)
        report(`curvature ${value.toFixed(2)}`, seen)
        await shot(page, `globe-7-${name}`)
      }
    }
  }

  // Both themes, at the map the walk above left. The palette is a page-wide setting, so this
  // sets the attribute rather than the browser's own preference.
  await curve(1)
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value
    }, theme)
    await page.waitForTimeout(250)
    await shot(page, `globe-8-${theme}`)
  }

  // The setting outlives the tab, which is the only reason it is stored. Last, because the
  // reload takes down the map the legs above walked out.
  {
    await curve(STORED)
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
      { timeout: 20000 },
    )
    await page.waitForTimeout(600)
    const seen = await frame(page)
    const box = await page.locator("#stage").boundingBox()
    const want = STORED * (Math.min(box.width, box.height) / 2)
    const back = Number(await page.locator("#curvature").inputValue())
    console.log(
      `  reloaded: the slider is at ${back.toFixed(2)} · R ${Math.round(seen?.radius ?? 0)}px` +
        (back === STORED ? "" : ` · ⚠ ${STORED.toFixed(2)} was stored`) +
        (Math.abs((seen?.radius ?? 0) - want) <= 1 ? " · drawn at it" : " · ⚠ drawn at another"),
    )
  }

  // A browser with site data blocked still runs the page. Chrome throws on the localStorage
  // property rather than on the call, which is the throw settings.ts wraps. The value that comes
  // up is checked against the stored one, which it must not be.
  {
    const shut = await context.newPage()
    shut.on("pageerror", (err) => problems.push(`site data blocked: ${String(err)}`))
    shut.on("console", (message) => {
      if (message.type() === "error") problems.push(`site data blocked: ${message.text()}`)
    })
    await shut.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("site data blocked")
        },
      })
    })
    await shut.goto(`${WEB}/?globe`, { waitUntil: "domcontentloaded" })
    await shut.waitForFunction(
      () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
      { timeout: 20000 },
    )
    await shut.waitForTimeout(600)
    const seen = await frame(shut)
    const value = Number(await shut.locator("#curvature").inputValue())
    const drawn = seen ? read(seen).drawn.length : 0
    console.log(
      `  site data blocked: the slider is at ${value.toFixed(2)} · ${String(drawn)} drawn` +
        (drawn ? "" : " · ⚠ the map drew nothing") +
        (value === STORED ? " · ⚠ it read the stored value" : ""),
    )
    await shut.close()
  }

  console.log(problems.length ? `  ⚠ ${String(problems.length)} page problem(s)` : "  no page errors")
  for (const problem of problems.slice(0, 10)) console.log(`    ${problem}`)

  await browser.close()
  process.exit(problems.length ? 1 : 0)
}

await main()
