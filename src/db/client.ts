/**
 * The single DynamoDB client for the process.
 *
 * One env var decides which backend you get: set `DYNAMODB_ENDPOINT` and every
 * call goes to DynamoDB Local; leave it unset and the SDK's default credential
 * chain points you at real AWS. No code changes between the two.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

/** Empty string is treated as unset — a blank env var should not mean "local". */
const endpoint = process.env.DYNAMODB_ENDPOINT?.trim() || undefined

export const isLocal = endpoint !== undefined

export const region = process.env.AWS_REGION?.trim() || "us-east-1"

/** Table name, overridable per environment (dev / staging / prod). */
export const TABLE_NAME = process.env.DYNAMODB_TABLE?.trim() || "connection"

const rawClient = new DynamoDBClient({
  region,
  ...(endpoint ? { endpoint } : {}),
  // DynamoDB Local ignores credentials under -sharedDb, but the SDK will not
  // sign a request without them. Supply throwaway values so local dev needs no
  // AWS setup at all. Against real AWS we pass nothing and the default chain
  // (env, SSO, profile, instance/task role) resolves as usual.
  ...(endpoint
    ? { credentials: { accessKeyId: "local", secretAccessKey: "local" } }
    : {}),
})

/**
 * Document client — reads and writes plain JS objects instead of DynamoDB's
 * `{ S: "..." }` attribute-value wire format.
 */
export const db = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    // Leave `undefined` fields out of the item rather than erroring.
    removeUndefinedValues: true,
    // Store empty strings as-is; DynamoDB has allowed them since 2020.
    convertEmptyValues: false,
  },
  unmarshallOptions: {
    // Return big numbers as strings instead of losing precision silently.
    wrapNumbers: false,
  },
})

/** Escape hatch for the few control-plane calls the document client lacks. */
export { rawClient }

export function describeTarget(): string {
  return isLocal
    ? `DynamoDB Local at ${endpoint} (table: ${TABLE_NAME})`
    : `AWS DynamoDB in ${region} (table: ${TABLE_NAME})`
}
