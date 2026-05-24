'use strict';

const { join, resolve } = require('path');
const { existsSync } = require('fs');
const { CONFIG_ERROR } = require('./exitCodes');

class FlowyCLIError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'FlowyCLIError';
    this.exitCode = exitCode;
  }
}

/**
 * Load and validate flowy.config.js from the given directory.
 * @param {string} cwd  Directory to look in (defaults to process.cwd())
 * @param {string|null} envName  Environment to select (null = use defaultEnvironment)
 * @returns {{ env: object, migrationsDir: string, raw: object }}
 */
function loadConfig(cwd = process.cwd(), envName = null) {
  // Load .env file if present (silently ignore if missing)
  try {
    require('dotenv').config({ path: join(cwd, '.env') });
  } catch { /* dotenv is always available as a dependency */ }

  const configPath = join(cwd, 'flowy.config.js');
  if (!existsSync(configPath)) {
    throw new FlowyCLIError(
      `No flowy.config.js found in ${cwd}. Run \`flowy init\` to create one.`,
      CONFIG_ERROR
    );
  }

  let raw;
  try {
    // Clear require cache so tests can load different configs
    delete require.cache[require.resolve(configPath)];
    raw = require(configPath);
  } catch (err) {
    throw new FlowyCLIError(
      `Failed to load flowy.config.js: ${err.message}`,
      CONFIG_ERROR
    );
  }

  const selectedEnv = envName || raw.defaultEnvironment;
  if (!selectedEnv || !raw.environments || !raw.environments[selectedEnv]) {
    throw new FlowyCLIError(
      `Environment "${selectedEnv}" not found in flowy.config.js. ` +
      `Available: ${Object.keys(raw.environments || {}).join(', ')}`,
      CONFIG_ERROR
    );
  }

  const env = raw.environments[selectedEnv];
  const required = ['clientId', 'clientSecret', 'region'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new FlowyCLIError(
      `Environment "${selectedEnv}" is missing required fields: ${missing.join(', ')}`,
      CONFIG_ERROR
    );
  }

  const migrationsDir = resolve(cwd, raw.migrationsDir || './migrations');

  return { env, migrationsDir, raw, selectedEnv };
}

module.exports = { loadConfig, FlowyCLIError };
