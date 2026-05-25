'use strict';

const chalk = require('chalk');
const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAllRows, resetCache } = require('../historyStore');
const { authenticatePlatformClient } = require('../gcAuth');
const exitCodes = require('../exitCodes');

module.exports = async function status(options) {
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

  const rows = await getAllRows(platformClient);
  const rowsByVersion = Object.fromEntries(rows.map((r) => [r.key, r]));

  const header = `${'Version'.padEnd(16)} ${'Status'.padEnd(12)} ${'Description'}`;
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const m of migrations) {
    const row = rowsByVersion[m.version];
    const statusStr = row ? row.status : 'pending';
    const line = `${m.version.padEnd(16)} ${statusStr.padEnd(12)} ${m.module.description}`;
    if (statusStr === 'applied') console.log(chalk.green(line));
    else if (statusStr === 'failed') console.log(chalk.red(line));
    else console.log(chalk.yellow(line));
  }

  process.exit(exitCodes.SUCCESS);
};
