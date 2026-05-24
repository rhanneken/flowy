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

  const platformClient = await authenticatePlatformClient(config.env);
  await ensureTable(platformClient);

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
  const migrations = loadMigrations(config.migrationsDir);
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

  const architectScripting = require('purecloud-flow-scripting-api-sdk-javascript');
  try {
    await architectScripting.run({
      clientId: config.env.clientId,
      clientSecret: config.env.clientSecret,
      region: config.env.region,
      doWork: async (architectSession) => {
        await migration.module.down(architectSession, platformClient);
      },
    });
    await updateStatus(platformClient, last.key, 'rolled_back');
    console.log(`✓ ${last.key} rolled back.`);
  } catch (err) {
    console.error(`Rollback of ${last.key} failed: ${err.message}`);
    process.exit(exitCodes.MIGRATION_FAILED);
  }
};
