'use strict';

const { computeChecksum } = require('./checksum');
const { snapshotFlows } = require('./snapshot');
const { record } = require('./historyStore');
const { getAppliedBy } = require('./appliedBy');
const { FlowyCLIError } = require('./config');
const { MIGRATION_FAILED } = require('./exitCodes');

/**
 * Core migration runner. Authenticates the Architect Scripting SDK, iterates
 * pending migrations, runs pre-snapshot, calls up(), and records history.
 *
 * @param {object} env              { clientId, clientSecret, region }
 * @param {object[]} allMigrations  Full sorted list from migrationLoader
 * @param {Set<string>} appliedVersions  Versions already recorded as 'applied'
 * @param {Map<string,string>} storedChecksums  version -> checksum from history
 * @param {object} options          { strict, target }
 * @param {object} platformClient   Authenticated purecloud-platform-client-v2 module
 * @param {object} [_archScripting] Injected for testing; defaults to require(SDK)
 */
async function runMigrations(
  env,
  allMigrations,
  appliedVersions,
  storedChecksums,
  options = {},
  platformClient,
  _archScripting,
) {
  // 1. Verify checksums of applied migrations
  for (const m of allMigrations) {
    if (!appliedVersions.has(m.version)) continue;
    const storedChecksum = storedChecksums.get(m.version);
    if (!storedChecksum) continue;
    const currentChecksum = await computeChecksum(m.filePath);
    if (currentChecksum !== storedChecksum) {
      const msg = `Checksum mismatch for applied migration ${m.version} (${m.filename}). ` +
        'The file has changed since it was applied. Run `flowy repair` to acknowledge.';
      if (options.strict) {
        throw new FlowyCLIError(msg, MIGRATION_FAILED);
      } else {
        console.warn(`WARNING: ${msg}`);
      }
    }
  }

  // 2. Filter pending migrations
  let pending = allMigrations.filter((m) => !appliedVersions.has(m.version));
  if (options.target) {
    const targetNum = parseInt(options.target.slice(1), 10);
    // Validate target exists in allMigrations
    const targetExists = allMigrations.some((m) => parseInt(m.version.slice(1), 10) === targetNum);
    if (!targetExists) {
      throw new FlowyCLIError(
        `Target version "${options.target}" not found in migrations directory.`,
        MIGRATION_FAILED,
      );
    }
    pending = pending.filter((m) => parseInt(m.version.slice(1), 10) <= targetNum);
  }

  if (pending.length === 0) {
    console.log('No pending migrations. Everything is up to date.');
    return;
  }

  console.log(`Found ${pending.length} pending migration(s).`);

  // 3. Run all pending migrations inside a single ArchScripting session
  const scripting = _archScripting || require('purecloud-flow-scripting-api-sdk-javascript');
  const archSession = scripting.environment.archSession;

  // Prevent the SDK from calling process.exit() when the session ends —
  // we manage our own exit codes in the CLI layer.
  archSession.endTerminatesProcess = false;

  // Capture any error from the callback so we can re-throw it after the
  // session ends cleanly, rather than letting it become an unhandled SDK
  // exception (which would set exit code 99).
  let callbackError = null;

  await archSession.startWithClientIdAndSecret(
    env.region,
    async (architectSession) => {
      try {
        for (const migration of pending) {
          await runOne(migration, architectSession, platformClient, options);
        }
      } catch (err) {
        callbackError = err;
      }
    },
    env.clientId,
    env.clientSecret,
    () => {},   // callbackFunctionEnd — required for the SDK to call _endSession() after our callback resolves
    true,       // isClientCredentialsOAuthClient
  );

  if (callbackError) throw callbackError;
}

async function runOne(migration, architectSession, platformClient, options) {
  console.log(`Applying ${migration.version}: ${migration.module.description}`);

  // Pre-migration snapshot
  if (migration.module.flows && migration.module.flows.length > 0) {
    await snapshotFlows(
      architectSession,
      migration.module.flows,
      `pre-migration-${migration.version}`,
    );
  }

  const checksum = await computeChecksum(migration.filePath);
  const startTime = Date.now();

  try {
    await migration.module.up(architectSession, platformClient);
    const executionTime = Date.now() - startTime;

    await record(platformClient, {
      key: migration.version,
      description: migration.module.description,
      filename: migration.filename,
      checksum,
      appliedAt: new Date().toISOString(),
      appliedBy: getAppliedBy(),
      executionTime,
      status: 'applied',
    });

    console.log(`  ✓ ${migration.version} applied in ${executionTime}ms`);
  } catch (err) {
    const executionTime = Date.now() - startTime;

    try {
      await record(platformClient, {
        key: migration.version,
        description: migration.module.description,
        filename: migration.filename,
        checksum,
        appliedAt: new Date().toISOString(),
        appliedBy: getAppliedBy(),
        executionTime,
        status: 'failed',
        error: err.message,
      });
    } catch (historyErr) {
      console.error(
        `WARNING: Migration ${migration.version} failed, and the failure could not be ` +
        `recorded in history: ${historyErr.message}\n` +
        'Run `flowy repair` after resolving the Data Table issue.',
      );
    }

    console.error(`  ✗ ${migration.version} failed: ${err.message}`);
    throw err;
  }
}

module.exports = { runMigrations };
