/**
 * The graph declining a write, as distinct from the write failing.
 *
 * Four operations can refuse — creating a node, deleting one, joining two, parting two —
 * and each refuses through a condition inside its transaction rather than a check before
 * it. What comes back is a cancellation naming a *position*, which each module turns into
 * a sentence through its own table of reasons.
 *
 * One type for all four, because every caller wants the same split and none of them wants
 * a finer one. The terminal prints the sentence; the route answers 409 rather than 500,
 * because "they are already joined" is an outcome to act on and not a fault to page anyone
 * about. Anything that is not this is a genuine failure and is left to propagate.
 */
export class Refused extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "Refused"
  }
}

/**
 * Read a cancellation back into English.
 *
 * DynamoDB reports which *operation* in the transaction refused, not why in any terms the
 * graph would recognise, so each caller passes the reasons in the order its operations are
 * written. Keep the two in step: a reason at the wrong index is a sentence about the wrong
 * thing, and nothing will catch it.
 */
export function reasonFor(
  cancellations: readonly { Code?: string | undefined }[] | undefined,
  reasons: readonly string[],
  fallback: string,
): string {
  const failed = (cancellations ?? []).findIndex(
    (reason) => reason.Code === "ConditionalCheckFailed",
  )
  return failed >= 0 ? reasons[failed] ?? fallback : fallback
}
