#!/usr/bin/env node
/**
 * Refuse an install that would rewrite the lock file under the wrong npm.
 *
 * `packageManager` in package.json names the npm this lock was written by. Nothing in npm
 * enforces that, and two npm versions write different files. npm 11.6.2 drops the two
 * optional `@emnapi` records that npm 12.0.2 keeps. The lock then names a dependency it does
 * not carry, and `npm ci` refuses the tree on both CI legs. That failure used to arrive after
 * a push. This is what says it here instead.
 *
 * Three installs are let through, because none of them writes the lock. `npm ci` reads it.
 * `--no-save` and `--no-package-lock` both say not to touch it. The `ci` case matters most.
 * The npm bundled with each Node in the CI matrix is older than the named one, so a guard
 * that stopped `ci` would stop CI.
 *
 * Runs from `preinstall`, which is after npm has already written package-lock.json. So this
 * stops the install and names the fix. It cannot stop the file being rewritten, and the
 * message says so. Measured: an install refused here still leaves the two `@emnapi` records
 * out of the lock.
 *
 * It uses Node built-ins only, because `node_modules` may be empty or missing when it runs.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const PACKAGE = fileURLToPath(new URL("../package.json", import.meta.url))

/** The npm version `packageManager` names, as [full, major], or null if it names no npm. */
function named() {
  const field = JSON.parse(readFileSync(PACKAGE, "utf8")).packageManager ?? ""
  const found = /^npm@((\d+)\.\d+\.\d+)/.exec(field)
  return found ? { full: found[1], major: found[2] } : null
}

/** The npm running this, as [full, major], or null when npm did not run it. */
function running() {
  const found = /^npm\/((\d+)\.\d+\.\d+)/.exec(process.env["npm_config_user_agent"] ?? "")
  return found ? { full: found[1], major: found[2] } : null
}

/** True while nothing this install does can reach the lock file. */
const writesNothing = () =>
  process.env["npm_command"] === "ci" ||
  process.env["npm_config_save"] === "false" ||
  process.env["npm_config_package_lock"] === "false"

const want = named()
const have = running()

if (writesNothing() || !want || !have || want.major === have.major) process.exit(0)

console.error(`
✗ npm ${have.full} rewrites package-lock.json, and this project's lock is written by
  npm ${want.full}. The two disagree about optional records, and npm ci refuses the
  difference. Nothing was installed.

  npm writes the lock before this runs, so it has already changed. This puts it back,
  and installs:

      corepack npm@${want.full} install

  Or take that npm globally: npm i -g npm@${want.full}

  npm ci is unaffected, and so is any install passing --no-save or --no-package-lock.
`)
process.exit(1)
