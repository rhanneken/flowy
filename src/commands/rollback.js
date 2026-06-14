'use strict';

const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAllRows, resetCache } = require('../historyStore');
const { authenticatePlatformClient } = require('../gcAuth');
const { runRollback } = require('../runner');
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

  let rows;
  try {
    rows = await getAllRows(platformClient);
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

  try {
    await runRollback(config.env, migrations, rows, options, platformClient);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.MIGRATION_FAILED);
  }

  process.exit(exitCodes.SUCCESS);
};
