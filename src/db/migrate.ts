/**
 * Create any table that does not exist yet, then wait until it is ACTIVE.
 *
 * Idempotent — safe to re-run. It creates missing tables but never alters or
 * drops an existing one, so it cannot destroy data. Changing an existing table
 * (new GSI, new key) is a deliberate act and should be its own migration.
 *
 *   npm run ddb:migrate
 */
import {
  CreateTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb"
import { rawClient, describeTarget } from "./client.js"
import { allTables } from "./tables.js"

async function tableExists(name: string): Promise<boolean> {
  try {
    await rawClient.send(new DescribeTableCommand({ TableName: name }))
    return true
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return false
    throw err
  }
}

async function migrate(): Promise<void> {
  console.log(`→ ${describeTarget()}`)

  for (const definition of allTables) {
    const name = definition.TableName!

    if (await tableExists(name)) {
      console.log(`  = ${name} already exists — leaving it alone`)
      continue
    }

    console.log(`  + creating ${name}…`)
    await rawClient.send(new CreateTableCommand(definition))

    // Creation is asynchronous; a table is not writable until it is ACTIVE.
    await waitUntilTableExists(
      { client: rawClient, maxWaitTime: 120 },
      { TableName: name },
    )
    console.log(`  ✓ ${name} is ACTIVE`)
  }

  const { TableNames = [] } = await rawClient.send(new ListTablesCommand({}))
  console.log(`\nTables now present: ${TableNames.join(", ") || "(none)"}`)
}

migrate().catch((err: unknown) => {
  console.error("\nMigration failed:")
  console.error(err)
  // Non-zero exit so CI and `&&` chains actually notice.
  process.exit(1)
})
