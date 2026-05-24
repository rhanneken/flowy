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

  // Check for version number gaps
  const nums = migrations.map((m) => parseInt(m.version.slice(1), 10));
  const gaps = [];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) {
      gaps.push(`V${String(nums[i - 1] + 1).padStart(3, '0')}`);
    }
  }

  if (gaps.length > 0) {
    console.warn(`WARNING: Missing version(s) in sequence: ${gaps.join(', ')}`);
  }

  console.log(`Validated ${migrations.length} migration file(s). No structural errors found.`);
  if (gaps.length > 0) process.exit(exitCodes.CONFIG_ERROR);
};
