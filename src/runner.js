'use strict';

const { computeChecksum } = require('./checksum');
const { verifyFlowsUnlocked } = require('./lockCheck');
const { record, updateStatus } = require('./historyStore');
const { getAppliedBy } = require('./appliedBy');
const { FlowyCLIError } = require('./config');
const { MIGRATION_FAILED, CONFIG_ERROR } = require('./exitCodes');
const { resolveOrgLocation } = require('./archSession');

/**
 * Core migration runner. Authenticates the Architect Scripting SDK, iterates
 * pending migrations, verifies listed flows are unlocked, calls up(), and records history.
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
  let pending;
  if (options.scratch) {
    // Scratch mode: run a single named migration without recording it. Used for
    // local iteration on a migration that has not been applied yet. The guard
    // below keeps scratch confined to the not-applied space so it can never
    // re-run or de-sync a migration the shared ledger considers settled.
    const m = allMigrations.find((mig) => mig.version === options.scratch);
    if (!m) {
      throw new FlowyCLIError(
        `Migration "${options.scratch}" not found in migrations directory.`,
        MIGRATION_FAILED,
      );
    }
    if (appliedVersions.has(m.version)) {
      throw new FlowyCLIError(
        `${m.version} is already applied and recorded in history. --scratch is for ` +
        'iterating on migrations that have not been applied yet.\n' +
        'To re-run it, roll it back first, or write a corrective migration.',
        MIGRATION_FAILED,
      );
    }
    pending = [m];
    console.log(`Running ${m.version} in scratch mode — history will NOT be recorded.`);
  } else {
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
    pending = allMigrations.filter((m) => !appliedVersions.has(m.version));
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
  }

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
  const scratch = Boolean(options.scratch);
  console.log(
    `Applying ${migration.version}: ${migration.module.description}` +
    (scratch ? ' (scratch)' : ''),
  );

  // Pre-migration lock check
  if (migration.module.flows && migration.module.flows.length > 0) {
    await verifyFlowsUnlocked(migration.module.flows, platformClient);
  }

  const checksum = await computeChecksum(migration.filePath);
  const startTime = Date.now();

  try {
    await migration.module.up(scripting, platformClient, migration.params);
    const executionTime = Date.now() - startTime;

    // Scratch mode mutates the org but intentionally records nothing, so the
    // shared ledger stays an honest record of only applied, merged migrations.
    if (!scratch) {
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
    }

    console.log(
      `  ✓ ${migration.version} applied in ${executionTime}ms` +
      (scratch ? ' (not recorded)' : ''),
    );
  } catch (err) {
    const executionTime = Date.now() - startTime;
    // SDK may throw strings or plain objects instead of Error instances.
    const errStr = err.message || String(err);

    if (!scratch) {
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
    }
    console.error(`  ✗ ${migration.version} failed: ${errStr}`);
    // If the flow is locked by another user or a previous session, give an actionable hint.
    // "not locked by" (our own programming error) is intentionally excluded.
    if (/locked by/i.test(errStr) && !/not locked by/i.test(errStr)) {
      // In scratch mode nothing was recorded, so `flowy repair` does not apply
      // and the retry is the same scratch invocation.
      const retry = scratch
        ? `  then \`flowy migrate --scratch ${migration.version}\` to retry.`
        : '  then `flowy repair` and `flowy migrate` to retry.';
      console.error(
        '  Hint: a flow is locked by another user or a previous session.\n' +
        '  Run `flowy unlock "<flow-name>"` to release the lock,\n' +
        retry,
      );
    }
    throw err;
  }
}

/**
 * Roll back a single migration's down(). Ledger-addressed by default (undo the
 * newest applied migration); version-addressed in scratch mode (run a named
 * migration's down() without recording it). Throws FlowyCLIError on user errors
 * so the command wrapper can translate them into exit codes.
 *
 * @param {object} env              { clientId, clientSecret, region }
 * @param {object[]} migrations     Full sorted list from migrationLoader
 * @param {object[]} rows           All history rows (from getAllRows)
 * @param {object} options          { scratch }
 * @param {object} platformClient   Authenticated purecloud-platform-client-v2 module
 * @param {object} [_archScripting] Injected for testing; defaults to require(SDK)
 */
async function runRollback(env, migrations, rows, options, platformClient, _archScripting) {
  const scratch = options.scratch;

  let version;
  if (scratch) {
    // Scratch mode: roll back a single named migration without recording it.
    // Refuse anything recorded as applied — reverting it without un-recording
    // would leave the shared ledger claiming a migration that is no longer live.
    version = scratch;
    if (rows.some((r) => r.key === version && r.status === 'applied')) {
      throw new FlowyCLIError(
        `${version} is recorded as applied. Rolling it back with --scratch would revert ` +
        'it in the org without updating history, leaving the ledger out of sync.\n' +
        "Use 'flowy rollback' (no --scratch) to roll back a recorded migration.",
        MIGRATION_FAILED,
      );
    }
  } else {
    const applied = rows
      .filter((r) => r.status === 'applied')
      .sort((a, b) => {
        const nA = parseInt(a.key.slice(1), 10);
        const nB = parseInt(b.key.slice(1), 10);
        return nB - nA; // descending
      });

    if (applied.length === 0) {
      console.log('No applied migrations to roll back.');
      return;
    }

    version = applied[0].key;
  }

  const migration = migrations.find((m) => m.version === version);
  if (!migration) {
    throw new FlowyCLIError(`Migration file for ${version} not found locally.`, CONFIG_ERROR);
  }

  if (typeof migration.module.down !== 'function') {
    throw new FlowyCLIError(
      `Migration ${version} does not export a down() function. Cannot roll back.\n` +
      'Write a new corrective migration instead.',
      MIGRATION_FAILED,
    );
  }

  const scripting = _archScripting || require('purecloud-flow-scripting-api-sdk-javascript');
  const orgLocation = resolveOrgLocation(env.region, scripting);
  const archSession = scripting.environment.archSession;
  archSession.endTerminatesProcess = false;

  let rollbackError = null;
  try {
    await archSession.startWithClientIdAndSecret(
      orgLocation,
      async () => {
        try {
          await migration.module.down(scripting, platformClient, migration.params);
        } catch (err) {
          rollbackError = err;
        }
      },
      env.clientId,
      env.clientSecret,
      () => {},   // callbackFunctionEnd — required for the SDK to call _endSession() after our callback resolves
      true,       // isClientCredentialsOAuthClient
    );
    if (rollbackError) throw rollbackError;

    // Scratch mode reverts the org but records nothing, keeping the shared
    // ledger an honest record of only applied, merged migrations.
    if (scratch) {
      console.log(`✓ ${version} rolled back (not recorded).`);
    } else {
      await updateStatus(platformClient, version, 'rolled_back');
      console.log(`✓ ${version} rolled back.`);
    }
  } catch (err) {
    throw new FlowyCLIError(`Rollback of ${version} failed: ${err.message}`, MIGRATION_FAILED);
  }
}

module.exports = { runMigrations, runRollback };
