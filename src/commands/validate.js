'use strict';

const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const exitCodes = require('../exitCodes');

module.exports = function validate() {
  let config;
  try {
    config = loadConfig(process.cwd(), null);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.CONFIG_ERROR);
  }

  let migrations;
  try {
    migrations = loadMigrations(config.migrationsDir);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.CONFIG_ERROR);
  }

  console.log(`Validated ${migrations.length} migration file(s). No structural errors found.`);
};
