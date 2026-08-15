/**
 * The command line, for the two commands that take a file.
 *
 * The usage line stays with the caller. It names the command, and nothing here knows which
 * one is running.
 */

/** A file to work on, and whether to stop short of writing anything. */
export interface FileArgs {
  file: string
  dryRun: boolean
}

/**
 * Exactly one file, and `--dry-run`.
 *
 * A second file is refused rather than winning: a command working on a different file from
 * the one a reader sees at the end of the line is worse than a command that stops. Anything
 * else starting with `-` is refused for the same reason — an unknown flag is a misspelled
 * known one far more often than it is a path.
 */
export function parseFileArgs(argv: string[], usage: string): FileArgs {
  let file = ""
  let dryRun = false
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true
    else if (arg.startsWith("-")) throw new Error(`unknown argument: ${arg}\n${usage}`)
    else if (file) throw new Error(`two files given: ${file} and ${arg}\n${usage}`)
    else file = arg
  }
  if (!file) throw new Error(usage)
  return { file, dryRun }
}
