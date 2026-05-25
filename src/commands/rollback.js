'use strict';

const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAllRows, updateStatus, resetCache } = require('../historyStore');
const { authenticatePlatformClient } = require('../gcAuth');
const exitCodes = require('../exitCodes');

module.exports = async function rollback(options) {
  resetCache();
  let config;
  try {
    config = loadConfig(process.cwd(), options.env || null);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.CONFIG_ERROR);
  }

  let platformClient;
  try {
    platformClient = await authenticatePlatformClient(config.env);
    await ensureTable(platformClient);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.HISTORY_STORE_ERROR);
  }

  const rows = await getAllRows(platformClient);
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

  const last = applied[0];
  let migrations;
  try {
    migrations = loadMigrations(config.migrationsDir);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.CONFIG_ERROR);
  }

  const migration = migrations.find((m) => m.version === last.key);

  if (!migration) {
    console.error(`Migration file for ${last.key} not found locally.`);
    process.exit(exitCodes.CONFIG_ERROR);
  }

  if (typeof migration.module.down !== 'function') {
    console.error(
      `Migration ${last.key} does not export a down() function. Cannot roll back.\n` +
      'Write a new corrective migration instead.',
    );
    process.exit(exitCodes.MIGRATION_FAILED);
  }

  const scripting = require('purecloud-flow-scripting-api-sdk-javascript');
  const archSession = scripting.environment.archSession;
  const locations = archSession._locations || {};
  const locationEntry = Object.entries(locations)
    .find(([, loc]) => loc.host === `apps.${config.env.region}`);
  if (!locationEntry) {
    console.error(`No Architect Scripting location found for region "${config.env.region}".`);
    process.exit(exitCodes.CONFIG_ERROR);
  }
  const orgLocation = locationEntry[0];
  archSession.endTerminatesProcess = false;
  let rollbackError = null;
  try {
    await archSession.startWithClientIdAndSecret(
      orgLocation,
      async (architectSession) => {
        try {
          await migration.module.down(architectSession, platformClient);
        } catch (err) {
          rollbackError = err;
        }
      },
      config.env.clientId,
      config.env.clientSecret,
      () => {},   // callbackFunctionEnd — required for the SDK to call _endSession() after our callback resolves
      true,       // isClientCredentialsOAuthClient
    );
    if (rollbackError) throw rollbackError;
    await updateStatus(platformClient, last.key, 'rolled_back');
    console.log(`✓ ${last.key} rolled back.`);
  } catch (err) {
    console.error(`Rollback of ${last.key} failed: ${err.message}`);
    process.exit(exitCodes.MIGRATION_FAILED);
  }
};
