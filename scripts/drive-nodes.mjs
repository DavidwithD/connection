#!/usr/bin/env node
/**
 * Drive the node list in a real browser, and check what it did.
 *
 *   npm run web                        # in another terminal
 *   node scripts/drive-nodes.mjs       # shots land in .shots/
 *   node scripts/drive-nodes.mjs --head  # watch it happen
 *
 * The page has three parts and this drives all three. The controls: search, the date
 * filter, the three orders, the pager. The walk: open a row's neighbours, click one that is
 * not on the page, and come back down the stack of cards. The row actions: edit, join and
 * delete a node from its own row.
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

/**
 * A pair of names, joined, one of them far wider than the list.
 *
 * Every seeded name fits on one line, so a seeded graph never shows a row growing. These two
 * are loaded through the transfer page, which writes them the way the app writes any node.
 * The edge between them is the point: it is what puts the long name on a card.
 */
const SHORT = "drive short"
const LONG =
  "drive long a name that runs on well past the width of the list and has to wrap onto a " +
  "second line before any of it can be read"

/**
 * One hub joined to forty leaves. The first name joins each of the rest, so this is one line.
 *
 * A walk in place needs a neighbour far down the same page, and a seeded graph puts nobody
 * anywhere in particular. Searching these leaves every one of them on one page. The hub sorts
 * last, so a walk from the first row lands well below the window.
 */
const STAR = [
  "drive walk hub",
  ...Array.from({ length: 40 }, (_, at) => `drive walk ${String(at + 1).padStart(2, "0")}`),
]

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

  /**
   * Put one line of names through the transfer page's loader, and come back to the list.
   *
   * The nodes and the edges between them are then written the way the app writes any of them.
   * The list reads every node once at boot, so the new ones need the fresh load at the end.
   */
  const load = async (name, line) => {
    await page.goto(`${WEB}/transfer.html`, { waitUntil: "domcontentloaded" })
    await page.setInputFiles("#file", {
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`${line}\n`),
    })
    await page.waitForSelector("#apply:not([hidden])")
    await page.click("#apply")
    await page.waitForFunction(() =>
      /^Added/.test(document.querySelector("#said")?.textContent ?? ""),
    )
    await page.goto(`${WEB}/nodes.html`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("#list-view .rows > li")
  }

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
  // The top card is the only one in normal flow, and a button is as wide as its own text. So
  // measure it: it has to reach the right edge of the bar, and the bar has to be its height.
  const bar = await page.$eval("#list-view .stack", (box) => {
    const rect = box.getBoundingClientRect()
    return { right: rect.right, height: rect.height }
  })
  const onTop = await page.$eval("#list-view .stack .card.top", (box) => {
    const rect = box.getBoundingClientRect()
    return { right: rect.right, height: rect.height }
  })
  check(Math.abs(bar.right - onTop.right) < 1, "the top card reaches the right edge of the bar")
  check(Math.abs(bar.height - onTop.height) < 1, "the bar is as tall as the top card")
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
  // A new page starts at the top, so turn one from the foot of this page.
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
  })
  const wasDown = await page.evaluate(() => window.scrollY)
  await page.click("#list-next")
  await page.waitForFunction(
    (was) => document.querySelector("#list-view .rows > li > .row .name")?.textContent !== was,
    wasFirst,
  )
  console.log(`10 paging: ${firstPage} → ${await page.textContent("#list-page")}`)
  check((await page.textContent("#list-page")).startsWith("page 2 of "), "next turns the page")
  check(!(await page.isDisabled("#list-prev")), "previous is on now")
  check(wasDown > 0, `a page of 25 is longer than the window (${String(wasDown)}px of scroll)`)
  check((await page.evaluate(() => window.scrollY)) === 0, "turning the page goes to the top")
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

  // ------------------------------------------------- the sublist does not shrink

  // Open a closed row, and measure the sublist while it is still placeholders, then once the
  // names are in. A placeholder reserves one line per neighbour. A name that wraps takes more.
  // So the sublist may grow, and it must never shrink: the page below it would jump up.
  const closed = await page.$("#list-view .rows > li:not(:has(.subrows)) > .row")
  await closed.click()
  await page.waitForSelector(".subrows[aria-busy]")
  const reading = await page.$eval(".subrows", (box) => box.getBoundingClientRect().height)
  await page.waitForSelector(".subrows .row, .subrows .empty")
  const read = await page.$eval(".subrows", (box) => box.getBoundingClientRect().height)
  console.log(`12 height: ${reading.toFixed(1)}px reading, ${read.toFixed(1)}px read`)
  check(read >= reading - 1, "the sublist keeps at least its height when the names land")
  await shot("12-no-jump")

  // ------------------------------------------------- a name that does not fit on a line

  await load("drive-long.txt", `${SHORT} | ${LONG}`)
  await page.fill("#list-search", LONG.slice(0, 12))
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length === 1)
  const grown = await page.$eval("#list-view .rows > li > .row", (box) =>
    box.getBoundingClientRect().height,
  )
  await shot("13-long-name")
  await page.fill("#list-search", "")
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length > 1)
  const plain = await page.$$eval("#list-view .rows > li > .row", (all) =>
    Math.min(...all.map((one) => one.getBoundingClientRect().height)),
  )
  console.log(`13 long name: ${grown.toFixed(1)}px against ${plain.toFixed(1)}px`)
  check(grown > plain, "a name too wide for the list grows its row")

  // --------------------------------------------------- the same name, on a card

  // Search for the short one. The long one is its only neighbour, and it is off the page, so
  // clicking it puts that name on top of a stack.
  await page.fill("#list-search", SHORT)
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length === 1)
  await page.click("#list-view .rows > li:nth-child(1) > .row")
  await page.waitForSelector(".subrows .row")
  await page.click(".subrows > li:nth-child(1) > .row")
  await page.waitForSelector("#list-view .stack .card.top")
  const tall = await page.$eval("#list-view .stack", (box) => box.getBoundingClientRect().height)
  console.log(`14 long card: the bar is ${tall.toFixed(1)}px`)
  check(tall > plain, "a name too wide for the card grows the bar")
  check((await cards()).slice(-1)[0] === LONG, "the long name is the card on top")
  await shot("14-long-card")
  // Clearing the search box leaves the stack standing. The clear button is what drops it.
  await page.click("#list-clear")
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length > 1)

  // --------------------------------------------- the list comes back where it left

  await page.selectOption("#list-size", "100")
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length === 100)

  // Open a row far enough down the page that reaching it scrolls the list. Keep going until
  // one of them has a neighbour to walk off to.
  let off = null
  for (let at = 30; at <= 60 && !off; at++) {
    await page.click(`#list-view .rows > li:nth-child(${String(at)}) > .row`)
    await page.waitForSelector(".subrows .row, .subrows .empty")
    off = await pickAway()
  }
  check(Boolean(off), "a row down the page has a neighbour off the page")
  if (off) {
    // Scroll it into view here rather than inside the click, so this is the offset the list
    // is on at the moment it leaves.
    await off.scrollIntoViewIfNeeded()
    const left = await page.evaluate(() => window.scrollY)
    await off.click()
    await page.waitForSelector("#list-view .stack .card")
    await page.waitForSelector(".subrows .row, .subrows .empty")
    const stacked = await page.evaluate(() => window.scrollY)
    await page.click("#list-view .stack .card", { position: { x: 8, y: 18 } })
    await page.waitForSelector("#list-view .rows > li")
    await page.waitForSelector(".subrows .row, .subrows .empty")
    const back = await page.evaluate(() => window.scrollY)
    console.log(`15 scroll: left at ${String(left)}px, ${String(stacked)}px in the stack, ` +
      `back at ${String(back)}px`)
    check(left > 0, "reaching that row scrolled the list")
    check(Math.abs(back - left) <= 2, "the list comes back at the offset it left on")
    await shot("15-back-where-it-left")
  }

  // ------------------------------------- a walk in place brings the row into view

  await load("drive-star.txt", STAR.join(" | "))
  await page.fill("#list-search", "drive walk")
  await page.waitForFunction(
    (rows) => document.querySelectorAll("#list-view .rows > li").length === rows,
    STAR.length,
  )
  check(
    (await page.$eval("#list-view .rows > li:last-child .name", (el) => el.textContent)) ===
      STAR[0],
    `the hub is the last of the ${String(STAR.length)} rows`,
  )
  // How far below the window the hub's row starts. The walk has to close that.
  const below = await page.$eval(
    "#list-view .rows > li:last-child > .row",
    (box) => box.getBoundingClientRect().top - window.innerHeight,
  )
  check(below > 0, `the hub's row starts ${below.toFixed(0)}px below the window`)

  // The first row's only neighbour is the hub, and the hub is on this page. So this walks in
  // place, from the top of the list to the foot of it.
  await page.click("#list-view .rows > li:nth-child(1) > .row")
  await page.waitForSelector(".subrows .row")
  await page.click(".subrows > li:nth-child(1) > .row")
  await page.waitForFunction(
    () => document.querySelector("#list-view .rows > li:last-child .subrows .row") !== null,
  )
  const landed = await page.$eval("#list-view .rows > li:last-child > .row", (box) => {
    const rect = box.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, window: window.innerHeight }
  })
  console.log(
    `16 in view: the hub's row was ${below.toFixed(0)}px below the window, ` +
      `now ${landed.top.toFixed(0)}px from its top`,
  )
  check(
    landed.top >= -1 && landed.bottom <= landed.window + 1,
    "the walk brought the row it opened into view",
  )
  await shot("16-walk-in-view")

  // -------------------------------------------------------------- edit, join, delete

  // `:has(> .row .name …)` reaches only the li's own row, not a neighbour of the same name
  // sitting in an open sublist underneath it.
  const rowByName = (name) => page.locator(`#list-view .rows > li:has(> .row .name:text-is("${name}"))`)

  // A fresh load, not the controls cleared by hand. The walk above left a row open, and
  // that row's id can collide with whichever one these checks open next.
  await page.goto(`${WEB}/nodes.html`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#list-view .rows > li")
  await page.selectOption("#list-size", "50")
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length <= 50)

  const onPage = await names()
  const editTarget = onPage[0]
  const editedName = `${editTarget} edited`

  let row = rowByName(editTarget)
  await row.hover()
  await row.locator(".row-actions .icon").nth(0).click()
  await page.waitForSelector(".row-inline input")
  await page.fill(".row-inline input", editedName)
  await page.click(".row-inline .verdict")
  await page.waitForFunction(
    (want) => document.querySelector("#list-status")?.textContent?.includes(want),
    `renamed ${editTarget} to ${editedName}`,
  )
  console.log(`17 edit: ${await status()}`)
  // Renaming the first row by name can sort it anywhere, including off this page. Search
  // finds it wherever it landed, so this proves the store kept the new name, not just the
  // screen in front of the click.
  await page.fill("#list-search", editedName)
  // The count, not just a name match. The renamed node already sorted first before the
  // filter landed, so a name match alone proves nothing.
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length === 1)
  check((await names())[0] === editedName, "searching the new name finds exactly the renamed row")
  await shot("17-edit")
  await page.fill("#list-search", "")
  await page.waitForFunction(() => document.querySelectorAll("#list-view .rows > li").length > 1)

  const afterEdit = await names()
  const joinA = afterEdit.find((name) => name !== editedName)
  const joinB = afterEdit.find((name) => name !== editedName && name !== joinA)
  row = rowByName(joinA)
  await row.hover()
  await row.locator(".row-actions .icon").nth(1).click()
  await page.waitForSelector(".row-inline input")
  await page.fill(".row-inline input", joinB.slice(0, 4))
  await page.waitForSelector(".row-inline .suggestions button")
  await page.locator(".row-inline .suggestions button", { hasText: joinB }).click()
  await page.waitForFunction(
    (want) => document.querySelector("#list-status")?.textContent?.includes(want),
    `joined ${joinA} and ${joinB}`,
  )
  console.log(`18 join: ${await status()}`)
  await shot("18-join")

  // The status line reports success either way. Opening the row checks the store, not
  // just the message.
  await rowByName(joinA).locator(".row").first().click()
  await page.waitForSelector(".subrows .row, .subrows .empty")
  const neighbours = await page.$$eval(".subrows .row .name", (all) => all.map((one) => one.textContent))
  check(neighbours.includes(joinB), "the joined row now lists its new neighbour")
  await rowByName(joinA).locator(".row").first().click()

  row = rowByName(joinA)
  await row.hover()
  const del = row.locator(".row-actions .delete")
  await del.click()
  await page.waitForFunction(() => document.querySelector(".row-actions .delete[data-armed]") !== null)
  console.log(`19 delete armed: ${await del.textContent()}`)
  await del.click()
  await page.waitForFunction(
    (gone) =>
      ![...document.querySelectorAll("#list-view .rows > li .name")].some((el) => el.textContent === gone),
    joinA,
  )
  console.log(`20 delete: ${await status()}`)
  await page.fill("#list-search", joinA)
  // Not the status line: a note from the delete sticks there until something else writes
  // over it, the same way a `reveal` note does. The empty row is what the search landed.
  await page.waitForSelector("#list-view .rows > li.empty")
  check((await names()).length === 0, "searching the deleted name finds nothing")
  await shot("20-delete")
  await page.fill("#list-search", "")

  await browser.close()
  console.log(bad ? `\n✗ ${String(bad)} failed` : "\n✓ all checks passed")
  process.exit(bad ? 1 : 0)
}

await main()
