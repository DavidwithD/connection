/**
 * The install guard, from scripts/npm-guard.mjs.
 *
 * It runs from `preinstall`, so a guard that refuses the wrong thing stops every contributor
 * at `npm install`. CI cannot notice that. CI installs with `npm ci`, which is the one case
 * the guard has to let past.
 *
 * The npm it is checked against is read from `packageManager`. A bump to the pin then leaves
 * these testing the version the project names.
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const GUARD = fileURLToPath(new URL("../scripts/npm-guard.mjs", import.meta.url))
const PACKAGE = fileURLToPath(new URL("../package.json", import.meta.url))

/** The npm version package.json names, and one that is a major away from it. */
const pinned = (): { same: string; other: string } => {
  const field = (JSON.parse(readFileSync(PACKAGE, "utf8")) as { packageManager?: string })
    .packageManager
  const found = /^npm@((\d+)\.\d+\.\d+)/.exec(field ?? "")
  if (!found?.[1] || !found[2]) throw new Error(`packageManager names no npm: ${String(field)}`)
  return { same: found[1], other: `${String(Number(found[2]) - 1)}.0.0` }
}

const { same, other } = pinned()

/** Run the guard as npm would, with the environment npm sets. */
function guard(env: Record<string, string>): { code: number; said: string } {
  // vitest may itself have been started by npm, and those variables would answer for it.
  const clean = { ...process.env }
  delete clean["npm_command"]
  delete clean["npm_config_user_agent"]
  delete clean["npm_config_save"]
  delete clean["npm_config_package_lock"]

  const run = spawnSync(process.execPath, [GUARD], { env: { ...clean, ...env }, encoding: "utf8" })
  return { code: run.status ?? -1, said: run.stderr }
}

const agent = (version: string): string => `npm/${version} node/v24.0.0 darwin arm64`

describe("the npm install guard", () => {
  it("refuses an install from another major", () => {
    const run = guard({ npm_command: "install", npm_config_user_agent: agent(other) })
    expect(run.code).toBe(1)
    expect(run.said).toContain(`corepack npm@${same} install`)
  })

  it("allows an install from the npm the project names", () => {
    expect(guard({ npm_command: "install", npm_config_user_agent: agent(same) }).code).toBe(0)
  })

  it("allows npm ci from any npm, which is what CI runs", () => {
    expect(guard({ npm_command: "ci", npm_config_user_agent: agent(other) }).code).toBe(0)
  })

  it("allows an install that has been told to leave the lock alone", () => {
    const off = { npm_command: "install", npm_config_user_agent: agent(other) }
    expect(guard({ ...off, npm_config_save: "false" }).code).toBe(0)
    expect(guard({ ...off, npm_config_package_lock: "false" }).code).toBe(0)
  })

  it("says nothing when npm did not run it", () => {
    expect(guard({}).code).toBe(0)
  })
})
