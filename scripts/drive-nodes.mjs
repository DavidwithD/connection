#!/usr/bin/env node
/**
 * Drive the node list in a real browser, and check what it did.
 *
 *   npm run web                        # in another terminal
 *   node scripts/drive-nodes.mjs       # shots land in .shots/
 *   node scripts/drive-nodes.mjs --head  # watch it happen
 *
 * The page has two halves and this drives both. The controls: search, the date filter, the
 * three orders, the pager. The walk: open a row's neighbours, click one that is not on the
 * page, and come back down the stack of cards.
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

const DAY = 86_400_000

let bad = 0
const check = (ok, said) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${said}`)
  if (!ok) bad++
}

/**
 * Build a version 1 database by hand: the old schema, and three nodes carrying no date.
 *
 * Every other leg here starts from an empty profile, where the store is created at version 2
 * and the upgrade path never runs. This is the state a reader's browser is in before they
 * load the page for the first time.
 */
const versionOne = () =>
  new Promise((ok, no) => {
    const req = indexedDB.open("connection", 1)
    req.onerror = () => no(req.error)
    req.onupgradeneeded = () => {
      const db = req.result
      const nodes = db.createObjectStore("nodes", { keyPath: "labelKey" })
      nodes.createIndex("byIsland", ["islandSize", "labelKey"])
      nodes.createIndex("byParent", "parent")
      const edges = db.createObjectStore("edges", { keyPath: ["a", "b"] })
      edges.createIndex("byEnd", "ends", { multiEntry: true })
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(["nodes", "edges"], "readwrite")
      const nodes = tx.objectStore("nodes")
      nodes.put({ labelKey: "old one", label: "Old one", degree: 1, parent: "old one", islandSize: 2 })
      nodes.put({ labelKey: "old two", label: "Old two", degree: 1, parent: "old one" })
      nodes.put({ labelKey: "old three", label: "Old three", degree: 0, parent: "old three", islandSize: 1 })
      tx.objectStore("edges").put({ a: "old one", b: "old two", ends: ["old one", "old two"] })
      tx.oncomplete = () => {
        db.close()
        ok()
      }
      tx.onerror = () => no(tx.error)
    }
  })

/** Every node as the store now holds it. Read after the page has opened the database. */
const storedNodes = () =>
  new Promise((ok, no) => {
    const req = indexedDB.open("connection")
    req.onerror = () => no(req.error)
    req.onsuccess = () => {
      const db = req.result
      const all = db.transaction("nodes").objectStore("nodes").getAll()
      all.onsuccess = () => {
        db.close()
        ok(all.result.map((node) => ({ id: node.labelKey, created: node.created })))
      }
      all.onerror = () => no(all.error)
    }
  })

/**
 * Two nodes with dates of their own, written straight into this profile's store.
 *
 * The seed writes its whole graph in one moment, so every seeded node carries the same date
 * and the date order has nothing to prove. These two are a year apart. The records are shaped
 * the way `createNode` shapes one: no edges, its own root, a component of one.
 */
const datedPair = ([early, late]) =>
  new Promise((ok, no) => {
    const req = indexedDB.open("connection")
    req.onerror = () => no(req.error)
    req.onsuccess = () => {
      const tx = req.result.transaction("nodes", "readwrite")
      for (const [label, created] of [["drive early", early], ["drive late", late]]) {
        tx.objectStore("nodes").put({
          labelKey: label,
          label,
          degree: 0,
          parent: label,
          islandSize: 1,
          created,
        })
      }
      tx.oncomplete = () => ok()
      tx.onerror = () => no(tx.error)
    }
  })

async function main() {
  mkdirSync(SHOTS, { recursive: true })

  const browser = await chromium.launch({ channel: "chrome", headless: !headed })
  const page = await browser.newPage({ viewport: { width: 980, height: 1000 } })
  page.on("pageerror", (err) => {
    console.log(`  FAIL page error: ${String(err)}`)
    bad++
  })

  const shot = async (name) => {
    await page.screenshot({ path: `${SHOTS}/nodes-${name}.png` })
  }
  const names = () =>
    page.$$eval("#list-view .rows > li > .row .name", (all) => all.map((one) => one.textContent))
  const cards = () =>
    page.$$eval("#list-view .stack .card .name", (all) => all.map((one) => one.textContent))
  const status = () => page.textContent("#list-status")

  /** A neighbour in the open sublist that is on none of the rows or cards on screen. */
  const pickAway = async () => {
    const here = new Set([...(await names()), ...(await cards())])
    for (const one of await page.$$(".subrows .row")) {
      const name = await one.$eval(".name", (el) => el.textContent)
      if (!here.has(name)) return one
    }
    return null
  }

  console.log(`→ ${WEB}/nodes.html`)

  // ------------------------------------------------- the upgrade from version 1

  // A stylesheet is a document on the same origin, and it runs none of the app. So this
  // reaches the store before any page has opened it at version 2.
  await page.goto(`${WEB}/app.css`, { waitUntil: "domcontentloaded" })
  await page.evaluate(versionOne)
  await page.goto(`${WEB}/nodes.html`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#list-view .rows > li")

  const upgraded = await page.evaluate(storedNodes)
  const stamps = new Set(upgraded.map((node) => node.created))
  console.log(
    `0 upgrade: ${String(upgraded.length)} version 1 nodes, ` +
      `now dated ${new Date([...stamps][0]).toISOString().slice(0, 10)}`,
  )
  check(upgraded.length === 3, "the upgrade kept every node")
  check(
    upgraded.every((node) => typeof node.created === "number"),
    "every node came out with a date",
  )
  check(stamps.size === 1, "they all share the one stamp")
  check((await names()).length === 3, "the page lists them")
  await shot("0-upgraded")

  // The graph lives in this profile's IndexedDB, and Playwright opens a fresh profile every
  // run. Seed through the transfer page's own buttons, as the other drive scripts do.
  await page.goto(`${WEB}/transfer.html`, { waitUntil: "domcontentloaded" })
  await page.locator("#seed").click()
  await page.locator("#ask-yes").click()
  await page.waitForFunction(
    () => /Seeded/.test(document.querySelector("#told")?.textContent ?? ""),
    { timeout: 30000 },
  )
  const now = Date.now()
  await page.evaluate(datedPair, [now - 365 * DAY, now])
  console.log(`  seeded, plus two nodes a year apart`)

  await page.goto(`${WEB}/nodes.html`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#list-view .rows > li")

  // ---------------------------------------------------------------- the list

  console.log(`\n1 list: ${await status()} · ${await page.textContent("#list-page")}`)
  console.log(`  ${await page.textContent("#list-read")}`)
  const first = await names()
  check(first.length === 50, `the first page holds 50 rows, not ${String(first.length)}`)
  check(
    first.every((name, i) => i === 0 || name.localeCompare(first[i - 1]) >= 0),
    "by name, the rows run A to Z",
  )
  await shot("1-list")

  // ------------------------------------------------- open a node, and the stack

  // By position, not by handle. Opening a row redraws the list, and every handle taken
  // before that click is attached to a row the page has thrown away.
  let opened = null
  for (let at = 1; at <= first.length; at++) {
    await page.click(`#list-view .rows > li:nth-child(${String(at)}) > .row`)
    await page.waitForSelector(".subrows .row, .subrows .empty")
    if (await page.$(".subrows .row")) {
      opened = first[at - 1]
      break
    }
  }
  check(Boolean(opened), `a row opens its neighbours (${String(opened)})`)
  console.log(`2 open: ${(await page.$$(".subrows .row")).length} neighbours of ${opened}`)
  await shot("2-open")

  const away = await pickAway()
  check(Boolean(away), "a neighbour off this page is there to walk to")
  await away.click()
  await page.waitForSelector("#list-view .stack .card")
  await page.waitForSelector(".subrows .row, .subrows .empty")
  console.log(`3 stack: ${(await cards()).join(" > ")}`)
  check((await cards()).length === 2, "two cards")
  await shot("3-stack")

  const deeper = await pickAway()
  if (deeper) {
    await deeper.click()
    await page.waitForFunction(
      () => document.querySelectorAll("#list-view .stack .card").length >= 3,
    )
    await page.waitForSelector(".subrows .row, .subrows .empty")
    console.log(`4 deeper: ${(await cards()).join(" > ")}`)
    check((await cards()).length === 3, "three cards")
    await shot("4-deeper")
  }

  // The cards above it cover its middle, so this click lands on the strip at its left edge.
  await page.click("#list-view .stack .card", { position: { x: 8, y: 18 } })
  await page.waitForSelector("#list-view .rows > li")
  await page.waitForSelector(".subrows .row, .subrows .empty")
  console.log(`5 back: ${await status()}`)
  check(!(await page.$("#list-view .stack .card")), "the first card goes back to the list")
  check(Boolean(await page.$(".subrows")), "the row it came back to is open")
  await shot("5-back")

  // -------------------------------------------------------------- the controls

  const needle = first[0].slice(0, 3).toLowerCase()
  await page.fill("#list-search", needle)
  await page.waitForFunction(
    (want) =>
      [...document.querySelectorAll("#list-view .rows > li > .row .name")].every((one) =>
        one.textContent.toLowerCase().includes(want),
      ),
    needle,
  )
  console.log(`6 search "${needle}": ${await status()}`)
  check((await names()).length > 0, "the search leaves something")
  await shot("6-search")
  await page.fill("#list-search", "")
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length === 50)

  // Every seeded node was written in one moment, so today's bound keeps them and drops the
  // node dated a year back.
  const today = new Date(now).toISOString().slice(0, 10)
  await page.fill("#list-from", today)
  await page.waitForFunction(() =>
    / of \d+ nodes$/.test(document.querySelector("#list-status").textContent),
  )
  const kept = await page.$$eval("#list-view .rows > li > .row", (all) =>
    all.map((one) => one.dataset.created),
  )
  console.log(`7 made on or after ${today}: ${await status()}`)
  check(/ of /.test(await status()), "the date filter drops rows")
  check(kept.every((date) => date >= today), "every row left was made today or later")
  await shot("7-dates")
  await page.click("#list-clear")
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length === 50)

  await page.selectOption("#list-order", "date")
  await page.waitForFunction(
    () => document.querySelector("#list-view .rows > li > .row .name")?.textContent === "drive late",
  )
  const dates = await page.$$eval("#list-view .rows > li > .row", (all) =>
    all.map((one) => one.dataset.created),
  )
  console.log(`8 by date: newest ${dates[0]}, oldest on this page ${dates.at(-1)}`)
  check(
    dates.every((date, i) => i === 0 || date <= dates[i - 1]),
    "by date, the rows run newest first",
  )
  await shot("8-by-date")

  await page.selectOption("#list-order", "random")
  await page.waitForFunction(() => !document.querySelector("#list-shuffle").disabled)
  const roll = (await names()).slice(0, 5).join(",")
  await page.click("#list-shuffle")
  await page.waitForTimeout(100)
  const reroll = (await names()).slice(0, 5).join(",")
  console.log(`9 at random: ${roll.split(",")[0]} … then ${reroll.split(",")[0]} …`)
  check(roll !== reroll, "shuffle gives a different order")
  await shot("9-random")

  // ------------------------------------------------------------------- paging

  await page.selectOption("#list-order", "label")
  await page.selectOption("#list-size", "25")
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length === 25)
  const firstPage = await page.textContent("#list-page")
  check(await page.isDisabled("#list-prev"), "previous is off on the first page")
  // Read the first row before the click. Read after it, and the wait compares page two
  // against itself.
  const wasFirst = (await names())[0]
  await page.click("#list-next")
  await page.waitForFunction(
    (was) => document.querySelector("#list-view .rows > li > .row .name")?.textContent !== was,
    wasFirst,
  )
  console.log(`10 paging: ${firstPage} → ${await page.textContent("#list-page")}`)
  check((await page.textContent("#list-page")).startsWith("page 2 of "), "next turns the page")
  check(!(await page.isDisabled("#list-prev")), "previous is on now")
  await shot("10-page-2")

  // ----------------------------------------------- a neighbour on the same page

  let inPlace = null
  const rows = await names()
  for (let at = 1; at <= Math.min(10, rows.length); at++) {
    await page.click(`#list-view .rows > li:nth-child(${String(at)}) > .row`)
    await page.waitForSelector(".subrows .row, .subrows .empty")
    const here = new Set(await names())
    const subs = await page.$$eval(".subrows .row .name", (all) =>
      all.map((one) => one.textContent),
    )
    const found = subs.findIndex((name) => here.has(name))
    if (found >= 0) {
      inPlace = { at: found + 1, name: subs[found] }
      break
    }
  }
  if (!inPlace) {
    console.log("11 in place: no neighbour of the first ten rows is on this page — skipped")
  } else {
    await page.click(`.subrows > li:nth-child(${String(inPlace.at)}) > .row`)
    await page.waitForSelector(".subrows .row, .subrows .empty")
    const open = await page.$eval("#list-view .rows > li:has(.subrows) > .row .name", (el) =>
      el.textContent,
    )
    console.log(`11 in place: clicked ${inPlace.name}, open row is ${open}`)
    check(!(await page.$("#list-view .stack .card")), "a neighbour on this page opens no card")
    check(open === inPlace.name, "the open row moved to it")
    await shot("11-in-place")
  }

  // ------------------------------------------------- the sublist does not jump

  // Open a closed row, and measure the sublist while it is still placeholders, then once the
  // names are in. The two have to be the same height, or the page moves under the reader.
  const closed = await page.$("#list-view .rows > li:not(:has(.subrows)) > .row")
  await closed.click()
  await page.waitForSelector(".subrows[aria-busy]")
  const reading = await page.$eval(".subrows", (box) => box.getBoundingClientRect().height)
  await page.waitForSelector(".subrows .row, .subrows .empty")
  const read = await page.$eval(".subrows", (box) => box.getBoundingClientRect().height)
  console.log(`12 height: ${reading.toFixed(1)}px reading, ${read.toFixed(1)}px read`)
  check(Math.abs(reading - read) < 1, "the sublist keeps its height when the names land")
  await shot("12-no-jump")

  await browser.close()
  console.log(bad ? `\n✗ ${String(bad)} failed` : "\n✓ all checks passed")
  process.exit(bad ? 1 : 0)
}

await main()
