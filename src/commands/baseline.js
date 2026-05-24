'use strict';

const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAppliedVersions, record, resetCache } = require('../historyStore');
const { authenticatePlatformClient } = require('../gcAuth');
const { computeChecksum } = require('../checksum');
const { getAppliedBy } = require('../appliedBy');
const exitCodes = require('../exitCodes');

module.exports = async function baseline(options) {
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

  const migrations = loadMigrations(config.migrationsDir);
  const appliedVersions = await getAppliedVersions(platformClient);
  const unrecorded = migrations.filter((m) => !appliedVersions.has(m.version));

  if (unrecorded.length === 0) {
    console.log('All migrations are already recorded. Nothing to baseline.');
    return;
  }

  for (const m of unrecorded) {
    const checksum = await computeChecksum(m.filePath);
    await record(platformClient, {
      key: m.version,
      description: m.module.description,
      filename: m.filename,
      checksum,
      appliedAt: new Date().toISOString(),
      appliedBy: getAppliedBy(),
      executionTime: 0,
      status: 'applied',
    });
    console.log(`  Baselined ${m.version}`);
  }

  console.log(`Done. ${unrecorded.length} migration(s) marked as applied.`);
};
