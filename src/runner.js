'use strict';

const { computeChecksum } = require('./checksum');
const { snapshotFlows } = require('./snapshot');
const { record } = require('./historyStore');
const { getAppliedBy } = require('./appliedBy');
const { FlowyCLIError } = require('./config');
const { MIGRATION_FAILED } = require('./exitCodes');
const { resolveOrgLocation } = require('./archSession');

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

  const orgLocation = resolveOrgLocation(env.region, scripting);

  // Prevent the SDK from calling process.exit() when the session ends —
  // we manage our own exit codes in the CLI layer.
  archSession.endTerminatesProcess = false;

  // Capture SDK error messages so we can report the real reason if the
  // session ends with exit code 99 instead of showing a cryptic message.
  const sdkErrors = [];
  scripting.services.archLogging.setLoggingCallback((logItem) => {
    if (logItem.logType === 'error') {
      sdkErrors.push(logItem.messageFull);
    }
  });

  // Capture any error from the callback so we can re-throw it after the
  // session ends cleanly, rather than letting it become an unhandled SDK
  // exception (which would set exit code 99).
  let callbackError = null;

  await archSession.startWithClientIdAndSecret(
    orgLocation,
    async () => {
      try {
        for (const migration of pending) {
          await runOne(migration, scripting, platformClient, options);
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

  if (archSession.endExitCode === 99) {
    const reason = sdkErrors.length > 0 ? sdkErrors.join('\n') : 'Unknown Architect Scripting error.';
    throw new FlowyCLIError(
      `Architect Scripting session failed:\n${reason}`,
      MIGRATION_FAILED,
    );
  }

  if (callbackError) {
    // The Platform Client SDK throws plain objects (not Error instances) for API
    // failures. Wrap them so callers always get an Error with a readable message.
    if (callbackError instanceof Error) throw callbackError;
    const msg =
      (callbackError.body && (callbackError.body.message || callbackError.body.error)) ||
      callbackError.text ||
      JSON.stringify(callbackError);
    throw new Error(msg);
  }
}

async function runOne(migration, scripting, platformClient, options) {
  console.log(`Applying ${migration.version}: ${migration.module.description}`);

  // Pre-migration snapshot
  if (migration.module.flows && migration.module.flows.length > 0) {
    await snapshotFlows(
      scripting,
      migration.module.flows,
      platformClient,
    );
  }

  const checksum = await computeChecksum(migration.filePath);
  const startTime = Date.now();

  try {
    await migration.module.up(scripting, platformClient);
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
    // SDK may throw strings or plain objects instead of Error instances.
    const errStr = err.message || String(err);

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
        error: errStr,
      });
    } catch (historyErr) {
      console.error(
        `WARNING: Migration ${migration.version} failed, and the failure could not be ` +
        `recorded in history: ${historyErr.message}\n` +
        'Run `flowy repair` after resolving the Data Table issue.',
      );
    }
    console.error(`  ✗ ${migration.version} failed: ${errStr}`);
    // If the flow is locked by another user or a previous session, give an actionable hint.
    // "not locked by" (our own programming error) is intentionally excluded.
    if (/locked by/i.test(errStr) && !/not locked by/i.test(errStr)) {
      console.error(
        '  Hint: a flow is locked by another user or a previous session.\n' +
        '  Run `flowy unlock "<flow-name>"` to release the lock,\n' +
        '  then `flowy repair` and `flowy migrate` to retry.',
      );
    }
    throw err;
  }
}

module.exports = { runMigrations };
