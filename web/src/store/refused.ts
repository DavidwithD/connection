/**
 * Two error types: the graph refusing a write, and the graph having no such node.
 *
 * They are separate types because a refusal is shown beside the name it concerns and the
 * page carries on. A failure is not.
 */

export class Refused extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "Refused"
  }
}

/**
 * A read that found nothing.
 *
 * Its own type for the same reason `Refused` is: it is an answer to act on, not a failure to
 * report. Another tab can delete a node the reader walked to, and the page has to tell that
 * apart from the store breaking.
 */
export class Missing extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "Missing"
  }
}

/**
 * The two refusals a caller may treat as a normal outcome. A bulk load meets names that
 * already exist and pairs that are already joined, and counts them as skipped. See load.ts.
 *
 * They are named constants so that load.ts compares against these strings rather than copies
 * of them. These messages are shown to people, and two of them are also read by code.
 */
export const NAME_TAKEN = "that name is taken"
export const ALREADY_JOINED = "they are already joined"
