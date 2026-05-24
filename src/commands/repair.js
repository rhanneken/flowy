'use strict';

const readline = require('readline');
const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAllRows, updateStatus, record, resetCache } = require('../historyStore');
const { authenticatePlatformClient } = require('../gcAuth');
const { computeChecksum } = require('../checksum');
const { getAppliedBy } = require('../appliedBy');
const exitCodes = require('../exitCodes');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

module.exports = async function repair(options) {
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
  const migrations = loadMigrations(config.migrationsDir);
  const rowsByVersion = Object.fromEntries(rows.map((r) => [r.key, r]));

  let repaired = 0;

  for (const m of migrations) {
    const row = rowsByVersion[m.version];
    const currentChecksum = await computeChecksum(m.filePath);

    // Case 1: Failed migration — reset to pending
    if (row && row.status === 'failed') {
      const answer = await prompt(
        `${m.version} is failed. Reset to pending so it will be retried? [y/N] `,
      );
      if (answer === 'y') {
        await updateStatus(platformClient, m.version, 'pending');
        console.log(`  Reset ${m.version} to pending.`);
        repaired++;
      }
      continue;
    }

    // Case 2: Applied migration with checksum mismatch — update checksum
    if (row && row.status === 'applied' && row.checksum !== currentChecksum) {
      const answer = await prompt(
        `${m.version} has been modified after being applied. Update stored checksum? [y/N] `,
      );
      if (answer === 'y') {
        await updateStatus(platformClient, m.version, 'applied', { checksum: currentChecksum });
        console.log(`  Updated checksum for ${m.version}.`);
        repaired++;
      }
      continue;
    }

    // Case 3: No history entry at all — create a missing entry
    if (!row) {
      const answer = await prompt(
        `${m.version} has no history record. Was it already applied successfully? [y/N] `,
      );
      if (answer === 'y') {
        await record(platformClient, {
          key: m.version,
          description: m.module.description,
          filename: m.filename,
          checksum: currentChecksum,
          appliedAt: new Date().toISOString(),
          appliedBy: getAppliedBy(),
          executionTime: 0,
          status: 'applied',
        });
        console.log(`  Created missing history entry for ${m.version}.`);
        repaired++;
      }
    }
  }

  console.log(`Repair complete. ${repaired} record(s) updated.`);
};
