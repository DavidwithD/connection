/**
 * The graph declining a write, as distinct from the write failing.
 *
 * One type for all four writes, because every caller wants the same split and none wants a
 * finer one. Anything that is not this is a genuine failure and is left to propagate.
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
