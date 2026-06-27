'use strict';

const { readdirSync, existsSync, statSync } = require('fs');
const { join } = require('path');
const { FlowyCLIError } = require('./config');
const { CONFIG_ERROR } = require('./exitCodes');

const FILE_PATTERN = /^(V\d+)__(.+)\.(js|ts)$/;
const DIR_PATTERN  = /^(V\d+)__(.+)$/;

/**
 * Register tsx loader if TypeScript migrations are present and tsx is available.
 * Searches the user's project node_modules first (devDependencies), then falls
 * back to flowy's own resolution chain (covers globally installed tsx).
 * @param {object[]} entries  Parsed migration entries (before loading)
 */
function maybeRegisterTsx(entries) {
  const hasTs = entries.some((e) => e.entryPoint && e.entryPoint.endsWith('.ts'));
  if (!hasTs) return;
  try {
    const searchPaths = [
      join(process.cwd(), 'node_modules'),
      ...(require.resolve.paths('tsx/cjs') || []),
    ];
    const tsxPath = require.resolve('tsx/cjs', { paths: searchPaths });
    require(tsxPath); // registers tsx as a CJS loader
  } catch {
    throw new FlowyCLIError(
      'TypeScript migration files detected but `tsx` is not installed.\n' +
      'Run: npm install -g tsx  (or add tsx to your project devDependencies)',
      CONFIG_ERROR
    );
  }
}

/**
 * Resolve the entry point for a directory migration.
 * Returns the path to index.js or index.ts, or throws if neither exists.
 * @param {string} dirPath
 * @param {string} dirname  e.g. 'V006__create_prompt'
 * @returns {string}
 */
function resolveDirectoryEntryPoint(dirPath, dirname) {
  for (const name of ['index.js', 'index.ts']) {
    const candidate = join(dirPath, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new FlowyCLIError(
    `Migration directory ${dirname} must contain an index.js (or index.ts) entry point.`,
    CONFIG_ERROR
  );
}

/**
 * Load, sort, and validate all migration files and directories from migrationsDir.
 * @param {string} migrationsDir
 * @returns {Array<{ version: string, filename: string, filePath: string, module: object }>}
 */
function loadMigrations(migrationsDir, envName) {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  // Classify each entry as a file migration, directory migration, or ignored
  const entries = [];
  for (const name of readdirSync(migrationsDir)) {
    const fullPath = join(migrationsDir, name);
    const isDir = statSync(fullPath).isDirectory();

    if (!isDir && FILE_PATTERN.test(name)) {
      const [, version] = name.match(FILE_PATTERN);
      entries.push({ version, filename: name, filePath: fullPath, entryPoint: fullPath, isDir: false });
    } else if (isDir && DIR_PATTERN.test(name)) {
      const [, version] = name.match(DIR_PATTERN);
      const entryPoint = resolveDirectoryEntryPoint(fullPath, name);
      entries.push({ version, filename: name, filePath: fullPath, entryPoint, isDir: true });
    }
  }

  maybeRegisterTsx(entries);

  // Check for duplicate versions
  const versionCounts = {};
  for (const e of entries) {
    versionCounts[e.version] = (versionCounts[e.version] || 0) + 1;
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
  entries.sort((a, b) => parseInt(a.version.slice(1), 10) - parseInt(b.version.slice(1), 10));

  return entries.map(({ version, filename, filePath, entryPoint, isDir }) => {
    let mod;
    try {
      delete require.cache[require.resolve(entryPoint)];
      mod = require(entryPoint);
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

    if (mod.flows !== undefined) {
      if (!Array.isArray(mod.flows)) {
        throw new FlowyCLIError(
          `Migration ${filename}: "flows" must be an array.`,
          CONFIG_ERROR,
        );
      }
      for (let i = 0; i < mod.flows.length; i++) {
        const entry = mod.flows[i];
        if (
          typeof entry !== 'object' ||
          entry === null ||
          typeof entry.name !== 'string' ||
          typeof entry.type !== 'string'
        ) {
          throw new FlowyCLIError(
            `Migration ${filename}: flows[${i}] must be an object with name and type ` +
            `(e.g. { name: 'MyFlow', type: 'inboundcall' }), not a string.`,
            CONFIG_ERROR,
          );
        }
      }
    }

    let params;
    if (isDir && envName) {
      const paramsPath = join(filePath, 'params.js');
      if (existsSync(paramsPath)) {
        let paramsModule;
        try {
          delete require.cache[require.resolve(paramsPath)];
          paramsModule = require(paramsPath);
          if (paramsModule && paramsModule.__esModule && paramsModule.default) {
            paramsModule = paramsModule.default;
          }
        } catch (err) {
          throw new FlowyCLIError(
            `Failed to load params.js for migration ${filename}: ${err.message}`,
            CONFIG_ERROR,
          );
        }
        if (Object.prototype.hasOwnProperty.call(paramsModule, envName)) {
          params = paramsModule[envName];
        } else {
          console.warn(
            `WARNING: params.js for migration ${filename} does not define environment "${envName}". ` +
            'The third parameter will be undefined.',
          );
        }
      }
    }

    return { version, filename, filePath, module: mod, params };
  });
}

module.exports = { loadMigrations };
