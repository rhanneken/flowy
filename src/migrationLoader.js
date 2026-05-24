'use strict';

const { readdirSync, existsSync } = require('fs');
const { join } = require('path');
const { FlowyCLIError } = require('./config');
const { CONFIG_ERROR } = require('./exitCodes');

const MIGRATION_PATTERN = /^(V\d+)__(.+)\.(js|ts)$/;

/**
 * Register tsx loader if TypeScript migrations are present and tsx is available.
 * @param {string[]} filenames
 */
function maybeRegisterTsx(filenames) {
  const hasTs = filenames.some((f) => f.endsWith('.ts'));
  if (!hasTs) return;
  try {
    require('tsx/cjs'); // registers tsx as a CJS loader
  } catch {
    throw new FlowyCLIError(
      'TypeScript migration files detected but `tsx` is not installed.\n' +
      'Run: npm install -g tsx  (or add tsx to your project devDependencies)',
      CONFIG_ERROR
    );
  }
}

/**
 * Load, sort, and validate all migration files from migrationsDir.
 * @param {string} migrationsDir
 * @returns {Array<{ version: string, filename: string, filePath: string, module: object }>}
 */
function loadMigrations(migrationsDir) {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const filenames = readdirSync(migrationsDir).filter((f) => MIGRATION_PATTERN.test(f));

  maybeRegisterTsx(filenames);

  // Check for duplicate versions
  const versionCounts = {};
  for (const filename of filenames) {
    const [, version] = filename.match(MIGRATION_PATTERN);
    versionCounts[version] = (versionCounts[version] || 0) + 1;
  }
  const duplicates = Object.entries(versionCounts)
    .filter(([, count]) => count > 1)
    .map(([v]) => v);
  if (duplicates.length > 0) {
    throw new FlowyCLIError(
      `Duplicate migration version(s) detected: ${duplicates.join(', ')}`,
      CONFIG_ERROR
    );
  }

  // Sort by version number
  filenames.sort((a, b) => {
    const [, vA] = a.match(MIGRATION_PATTERN);
    const [, vB] = b.match(MIGRATION_PATTERN);
    return parseInt(vA.slice(1), 10) - parseInt(vB.slice(1), 10);
  });

  return filenames.map((filename) => {
    const [, version] = filename.match(MIGRATION_PATTERN);
    const filePath = join(migrationsDir, filename);

    let mod;
    try {
      // Clear cache so tests can reload modules
      delete require.cache[require.resolve(filePath)];
      mod = require(filePath);
      // Handle ES module default exports (tsx may produce these)
      if (mod && mod.__esModule && mod.default) mod = mod.default;
    } catch (err) {
      throw new FlowyCLIError(
        `Failed to load migration ${filename}: ${err.message}`,
        CONFIG_ERROR
      );
    }

    if (!mod.description) {
      throw new FlowyCLIError(
        `Migration ${filename} must export a "description" string.`,
        CONFIG_ERROR
      );
    }
    if (typeof mod.up !== 'function') {
      throw new FlowyCLIError(
        `Migration ${filename} must export an "up" async function.`,
        CONFIG_ERROR
      );
    }

    return { version, filename, filePath, module: mod };
  });
}

module.exports = { loadMigrations };
