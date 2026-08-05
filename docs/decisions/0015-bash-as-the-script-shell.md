# 0015 — Bash as the npm script shell

**Status:** 🔵 Proposed
**Date:** 2026-08-05
**Deciders:** David HL

## Context
Every script in [package.json](../../package.json) is POSIX: a `VAR=value cmd` prefix, a
`./scripts/…` path, an `&` with a `trap` behind it. npm on Windows hands those to cmd.exe,
which parses none of it, and Windows is where this repo is written.

So most of them were dead on the platform. `npm run adr` never once ran the gate it names,
and every `ddb:*` script died on its first token. The [README](../../README.md) lists all of
them with no note that half do not work.

## Decision
[.npmrc](../../.npmrc) sets `script-shell=bash`. npm then runs every script through bash,
on every platform, and the scripts stay as they are.

bash joins the prerequisites. It arrives with git, which working here already requires, so
the new demand falls on people who have already met it.

## Alternatives considered
- **Rewriting the scripts for cmd.exe.** `cross-env` covers the variable prefixes and
  nothing else: `./scripts/dynamodb-local.sh` still wants a shell, so the shell scripts
  would have to become node programs. That is a rewrite of working code to please an
  interpreter nobody picked.
- **`npm config set script-shell` on each machine.** Identical effect, recorded nowhere,
  and gone again on the next clone.
- **Leaving the platform unsupported.** It is the one the work happens on.

## Consequences
bash is now required rather than merely usual. Somebody without it cannot run any script,
and what they see is a spawn error naming a shell instead of a sentence naming the cause.

The prerequisites table grows a row, which is the honest price of the fix.

`demo` backgrounds a process and traps the exit to clean it up. That worked on POSIX and
silently did not here, and this is what makes the two the same.

## Assumptions and unknowns
- **Assumed every contributor has git-bash on PATH.** True of everyone to date, which is
  one person, so it is barely evidence.
- **Assumed bare `bash` resolves the same on a runner and a workstation.** Only the two
  in use have been tried.

## Revisit when
- A contributor arrives without bash on PATH.
- A script needs something bash cannot express on every platform.
- npm changes how a bare command name in `script-shell` is resolved.
