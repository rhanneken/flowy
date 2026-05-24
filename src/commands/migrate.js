'use strict';

const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAppliedVersions, getStoredChecksums, resetCache } = require('../historyStore');
const { runMigrations } = require('../runner');
const { authenticatePlatformClient } = require('../gcAuth');
const exitCodes = require('../exitCodes');

module.exports = async function migrate(options) {
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

  let migrations;
  try {
    migrations = loadMigrations(config.migrationsDir);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.CONFIG_ERROR);
  }

  const [appliedVersions, storedChecksums] = await Promise.all([
    getAppliedVersions(platformClient),
    getStoredChecksums(platformClient),
  ]);

  try {
    await runMigrations(
      config.env,
      migrations,
      appliedVersions,
      storedChecksums,
      { strict: options.strict, target: options.target },
      platformClient,
    );
  } catch (err) {
    console.error(err.message);
    process.exit(exitCodes.MIGRATION_FAILED);
  }
};
