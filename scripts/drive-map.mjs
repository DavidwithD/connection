#!/usr/bin/env node
/**
 * Drive the map page in a real browser and photograph what it does.
 *
 *   npm run demo                       # in another terminal
 *   node scripts/drive-map.mjs         # shots land in .shots/
 *   node scripts/drive-map.mjs --head  # watch it happen
 *
 * There is no test runner here and this is not one: it is the way to *see* the page, for
 * changes whose whole result is visual. A typecheck cannot tell you an island landed on top
 * of the graph it was supposed to be clear of.
 *
 * Uses the Chrome already on the machine (`channel: "chrome"`) rather than downloading a
 * browser, so this costs nothing to run the first time.
 *
 * Playwright is deliberately *not* a dependency of this project — it is a hundred megabytes
 * to make screenshots of a demo, which everything else here runs without. Install it where
 * you want it and point NODE_PATH at it, or `npm i -D playwright --no-save` for one session.
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

async function main() {
  mkdirSync(SHOTS, { recursive: true })

  const browser = await chromium.launch({ channel: "chrome", headless: !headed })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  const problems = []
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text())
  })
  page.on("pageerror", (err) => problems.push(String(err)))

  console.log(`→ ${WEB}`)
  await page.goto(WEB, { waitUntil: "domcontentloaded" })

  // The map draws its first frame from two reads, so wait for the HUD to stop saying
  // "starting…" rather than for a fixed time.
  await page.waitForFunction(
    () => !/starting|loading/.test(document.querySelector("#status")?.textContent ?? ""),
    { timeout: 20000 },
  )
  await shot(page, "1-landed")

  const elsewhere = page.locator("#elsewhere")
  const listed = await elsewhere.isVisible()
  console.log(`  elsewhere visible: ${listed}`)

  if (listed) {
    const names = await page.locator("#elsewhere .island-name").allTextContents()
    const sizes = await page.locator("#elsewhere .island-size").allTextContents()
    console.log(`  islands: ${names.map((n, i) => `${n} (${sizes[i]})`).join(", ")}`)

    // A list capped in pixels clips whatever row the cap lands in the middle of, which
    // reads as a broken panel rather than as something to scroll. Worth knowing on every
    // run, since the number of islands is a property of the data and not of the layout.
    const fit = await page.evaluate(() => {
      const list = document.querySelector("#elsewhere ul")
      const row = document.querySelector("#elsewhere li")
      return {
        row: row?.getBoundingClientRect().height ?? 0,
        shown: list?.clientHeight ?? 0,
        needed: list?.scrollHeight ?? 0,
      }
    })
    const spare = fit.shown % fit.row
    console.log(
      `  list: ${String(fit.rows ?? names.length)} rows of ${fit.row.toFixed(1)}px, ` +
        `${fit.shown}px shown of ${fit.needed}px` +
        (fit.needed > fit.shown
          ? ` — scrolls, ${spare < 1 || fit.row - spare < 1 ? "cleanly" : `clipping a row at ${spare.toFixed(1)}px`}`
          : " — fits"),
    )
    await page.locator("#elsewhere .island").first().click()

    // The flight is a camera animation, so the centre changes a beat after the click.
    await page.waitForFunction(
      (want) => document.querySelector("#stat-centre")?.textContent === want,
      names[0],
      { timeout: 10000 },
    )
    console.log(`  centre is now: ${await page.locator("#stat-centre").textContent()}`)
    await shot(page, "2-crossed")

    console.log(`  elsewhere after crossing: ${await elsewhere.isVisible()}`)
    await shot(page, "3-after")
  }

  if (problems.length) {
    console.log(`\n✗ ${problems.length} console error(s):`)
    for (const problem of problems.slice(0, 10)) console.log(`  ${problem}`)
  } else {
    console.log("\n✓ no console errors")
  }

  await browser.close()
  process.exitCode = problems.length ? 1 : 0
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
