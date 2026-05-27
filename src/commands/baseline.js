'use strict';

const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAppliedVersions, record, resetCache } = require('../historyStore');
const { authenticatePlatformClient } = require('../gcAuth');
const { computeChecksum } = require('../checksum');
const { getAppliedBy } = require('../appliedBy');
const exitCodes = require('../exitCodes');

/**
 * Given the full sorted migration list and the set of already-recorded versions,
 * return the migrations that should be baselined (i.e. unrecorded and within the
 * optional target). Throws a plain Error if the target version does not exist.
 *
 * @param {object[]} allMigrations
 * @param {Set<string>} appliedVersions
 * @param {string|undefined} target  e.g. 'V005'
 * @returns {object[]}
 */
function selectForBaseline(allMigrations, appliedVersions, target) {
  if (target) {
    const targetExists = allMigrations.some((m) => m.version === target);
    if (!targetExists) {
      throw new Error(`Target version "${target}" not found in migrations directory.`);
    }
  }

  let unrecorded = allMigrations.filter((m) => !appliedVersions.has(m.version));

  if (target) {
    const targetNum = parseInt(target.slice(1), 10);
    unrecorded = unrecorded.filter((m) => parseInt(m.version.slice(1), 10) <= targetNum);
  }

  return unrecorded;
}

async function baseline(options) {
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

  const appliedVersions = await getAppliedVersions(platformClient);
  let unrecorded;
  try {
    unrecorded = selectForBaseline(migrations, appliedVersions, options.target);
  } catch (err) {
    console.error(err.message);
    process.exit(exitCodes.CONFIG_ERROR);
  }

  if (unrecorded.length === 0) {
    console.log('All migrations are already recorded. Nothing to baseline.');
    process.exit(exitCodes.SUCCESS);
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
  process.exit(exitCodes.SUCCESS);
}

baseline.selectForBaseline = selectForBaseline;
module.exports = baseline;
