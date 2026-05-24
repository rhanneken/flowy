# Flowy Migration Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `flowy`, a standalone CLI tool for managing versioned Genesys Cloud flow migrations, modeled after Flyway and Phinx.

**Architecture:** A single `ArchScripting.run()` session wraps all migrations in a `flowy migrate` run. The Platform API Client SDK is authenticated once up front to manage history (stored in a `_flowy_migrations` GC Data Table) and is passed as a second argument to every `up()`/`down()` function. Migration authors own all flow validation, check-in, and publishing inside their `up()` function. The migration is "applied" when `up()` returns without throwing.

**Tech Stack:** Node.js 18+, CommonJS modules, Commander (CLI parsing), Vitest (tests), `purecloud-platform-client-v2`, `purecloud-flow-scripting-api-sdk-javascript`, `dotenv`, `chalk`, `tsx` (optional peer dep for TypeScript migrations)

---

## File Map

Every file that will exist when this plan is complete:

```
package.json
vitest.config.js
bin/
  flowy.js                   # CLI entry point — commander setup, registers all commands
src/
  exitCodes.js               # Named exit code constants
  checksum.js                # SHA-256 file checksum utility
  appliedBy.js               # Resolve username or 'CI' for history records
  config.js                  # Load + validate flowy.config.js from CWD
  migrationLoader.js         # Discover, sort, parse, and require() migration files
  historyStore.js            # CRUD against the _flowy_migrations GC Data Table
  snapshot.js                # Pre-migration flow check-in
  runner.js                  # Core orchestration: auth, iterate migrations, record history
  commands/
    init.js                  # flowy init — scaffold flowy.config.js
    create.js                # flowy create — scaffold next migration file
    migrate.js               # flowy migrate
    status.js                # flowy status
    validate.js              # flowy validate (local only)
    repair.js                # flowy repair
    rollback.js              # flowy rollback
    baseline.js              # flowy baseline
test/
  config.test.js
  migrationLoader.test.js
  historyStore.test.js
  snapshot.test.js
  runner.test.js
types/
  FlowMigration.d.ts         # TypeScript interface for migration authors
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `bin/flowy.js` (stub)
- Create: `src/exitCodes.js`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "flowy",
  "version": "0.1.0",
  "description": "Genesys Cloud flow migration tool",
  "bin": { "flowy": "./bin/flowy.js" },
  "main": "src/index.js",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "dotenv": "^16.4.0",
    "purecloud-flow-scripting-api-sdk-javascript": "latest",
    "purecloud-platform-client-v2": "latest"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  },
  "peerDependenciesMeta": {
    "tsx": { "optional": true }
  },
  "peerDependencies": {
    "tsx": ">=4.0.0"
  }
}
```

- [ ] **Step 2: Create vitest.config.js**

```js
// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`  
Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Create bin/flowy.js stub**

```js
#!/usr/bin/env node
'use strict';

// Entry point — wired up fully in Task 7
console.log('flowy ok');
```

Make it executable: `chmod +x bin/flowy.js`

- [ ] **Step 5: Create src/exitCodes.js**

```js
'use strict';

module.exports = {
  SUCCESS: 0,
  MIGRATION_FAILED: 1,
  CONFIG_ERROR: 2,
  HISTORY_STORE_ERROR: 3,
};
```

- [ ] **Step 6: Verify bin runs**

Run: `node bin/flowy.js`  
Expected output: `flowy ok`

- [ ] **Step 7: Commit**

```bash
git add package.json vitest.config.js bin/flowy.js src/exitCodes.js
git commit -m "chore: project scaffold"
```

---

## Task 2: Checksum and AppliedBy Utilities

**Files:**
- Create: `src/checksum.js`
- Create: `src/appliedBy.js`
- Create: `test/checksum.test.js`

These are pure functions with no external dependencies — good to build and test first.

- [ ] **Step 1: Write failing tests for checksum.js**

```js
// test/checksum.test.js
import { describe, it, expect } from 'vitest';
import { computeChecksum } from '../src/checksum.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('computeChecksum', () => {
  it('returns a 64-character hex string for a file', async () => {
    const file = join(tmpdir(), 'flowy-test-checksum.js');
    writeFileSync(file, 'module.exports = {};');
    const result = await computeChecksum(file);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
    unlinkSync(file);
  });

  it('returns the same checksum for the same content', async () => {
    const file1 = join(tmpdir(), 'flowy-cs1.js');
    const file2 = join(tmpdir(), 'flowy-cs2.js');
    writeFileSync(file1, 'const x = 1;');
    writeFileSync(file2, 'const x = 1;');
    const [a, b] = await Promise.all([computeChecksum(file1), computeChecksum(file2)]);
    expect(a).toBe(b);
    unlinkSync(file1);
    unlinkSync(file2);
  });

  it('returns different checksums for different content', async () => {
    const file1 = join(tmpdir(), 'flowy-cs3.js');
    const file2 = join(tmpdir(), 'flowy-cs4.js');
    writeFileSync(file1, 'const x = 1;');
    writeFileSync(file2, 'const x = 2;');
    const [a, b] = await Promise.all([computeChecksum(file1), computeChecksum(file2)]);
    expect(a).not.toBe(b);
    unlinkSync(file1);
    unlinkSync(file2);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test`  
Expected: FAIL — `Cannot find module '../src/checksum.js'`

- [ ] **Step 3: Implement src/checksum.js**

```js
'use strict';

const { createHash } = require('crypto');
const { createReadStream } = require('fs');

/**
 * Compute a SHA-256 checksum of a file.
 * @param {string} filePath
 * @returns {Promise<string>} 64-character hex digest
 */
async function computeChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { computeChecksum };
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Implement src/appliedBy.js (no tests — trivial environment detection)**

```js
'use strict';

const { userInfo } = require('os');

/**
 * Returns 'CI' when running in a CI environment, otherwise the OS username.
 * @returns {string}
 */
function getAppliedBy() {
  if (
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL
  ) {
    return 'CI';
  }
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

module.exports = { getAppliedBy };
```

- [ ] **Step 6: Commit**

```bash
git add src/checksum.js src/appliedBy.js test/checksum.test.js
git commit -m "feat: checksum and appliedBy utilities"
```

---

## Task 3: Config Loader

**Files:**
- Create: `src/config.js`
- Create: `test/config.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/config.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test by pointing the loader at a temp directory
let testDir;

beforeEach(() => {
  testDir = join(tmpdir(), `flowy-config-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function loadConfig(dir, envName) {
  const { loadConfig } = await import('../src/config.js');
  return loadConfig(dir, envName);
}

describe('loadConfig', () => {
  it('loads a valid config and returns the selected environment', async () => {
    writeFileSync(
      join(testDir, 'flowy.config.js'),
      `module.exports = {
        migrationsDir: './migrations',
        defaultEnvironment: 'dev',
        environments: {
          dev: {
            clientId: 'id123',
            clientSecret: 'secret123',
            region: 'mypurecloud.com',
          }
        }
      };`
    );
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(testDir, 'dev');
    expect(config.env.clientId).toBe('id123');
    expect(config.env.region).toBe('mypurecloud.com');
    expect(config.migrationsDir).toBe(join(testDir, 'migrations'));
  });

  it('uses defaultEnvironment when no env is specified', async () => {
    writeFileSync(
      join(testDir, 'flowy.config.js'),
      `module.exports = {
        defaultEnvironment: 'staging',
        environments: {
          staging: { clientId: 'sid', clientSecret: 'ssecret', region: 'mypurecloud.ie' }
        }
      };`
    );
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(testDir, null);
    expect(config.env.region).toBe('mypurecloud.ie');
  });

  it('throws a CONFIG_ERROR when flowy.config.js is missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { CONFIG_ERROR } = await import('../src/exitCodes.js');
    expect(() => loadConfig(testDir, 'dev')).toThrow(
      expect.objectContaining({ exitCode: CONFIG_ERROR })
    );
  });

  it('throws a CONFIG_ERROR when the requested environment does not exist', async () => {
    writeFileSync(
      join(testDir, 'flowy.config.js'),
      `module.exports = { defaultEnvironment: 'dev', environments: { dev: { clientId: 'x', clientSecret: 'y', region: 'z' } } };`
    );
    const { loadConfig } = await import('../src/config.js');
    const { CONFIG_ERROR } = await import('../src/exitCodes.js');
    expect(() => loadConfig(testDir, 'prod')).toThrow(
      expect.objectContaining({ exitCode: CONFIG_ERROR })
    );
  });

  it('throws a CONFIG_ERROR when an environment is missing required fields', async () => {
    writeFileSync(
      join(testDir, 'flowy.config.js'),
      `module.exports = { defaultEnvironment: 'dev', environments: { dev: { clientId: 'x' } } };`
    );
    const { loadConfig } = await import('../src/config.js');
    const { CONFIG_ERROR } = await import('../src/exitCodes.js');
    expect(() => loadConfig(testDir, 'dev')).toThrow(
      expect.objectContaining({ exitCode: CONFIG_ERROR })
    );
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test`  
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: Implement src/config.js**

```js
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
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: config loader"
```

---

## Task 4: Migration Loader

**Files:**
- Create: `src/migrationLoader.js`
- Create: `test/migrationLoader.test.js`

Discovers `.js` and `.ts` migration files, sorts them by version, validates their exports, and registers `tsx` if any `.ts` files are found.

- [ ] **Step 1: Write failing tests**

```js
// test/migrationLoader.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let migrationsDir;

beforeEach(() => {
  migrationsDir = join(tmpdir(), `flowy-migrations-${Date.now()}`);
  mkdirSync(migrationsDir, { recursive: true });
});

afterEach(() => {
  rmSync(migrationsDir, { recursive: true, force: true });
});

function writeMigration(dir, filename, content) {
  writeFileSync(join(dir, filename), content);
}

describe('loadMigrations', () => {
  it('returns an empty array when migrationsDir is empty', async () => {
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const result = loadMigrations(migrationsDir);
    expect(result).toEqual([]);
  });

  it('discovers and sorts .js migration files by version number', async () => {
    writeMigration(migrationsDir, 'V002__second.js', `module.exports = { description: 'second', async up() {} };`);
    writeMigration(migrationsDir, 'V001__first.js', `module.exports = { description: 'first', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const result = loadMigrations(migrationsDir);
    expect(result.map(m => m.version)).toEqual(['V001', 'V002']);
  });

  it('ignores non-migration files', async () => {
    writeMigration(migrationsDir, 'README.md', '# migrations');
    writeMigration(migrationsDir, 'V001__first.js', `module.exports = { description: 'first', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const result = loadMigrations(migrationsDir);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('V001');
  });

  it('exposes version, filename, filePath, and module on each entry', async () => {
    writeMigration(migrationsDir, 'V001__add_flow.js', `module.exports = { description: 'add flow', async up() {}, async down() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const [m] = loadMigrations(migrationsDir);
    expect(m.version).toBe('V001');
    expect(m.filename).toBe('V001__add_flow.js');
    expect(m.filePath).toContain('V001__add_flow.js');
    expect(m.module.description).toBe('add flow');
    expect(typeof m.module.up).toBe('function');
    expect(typeof m.module.down).toBe('function');
  });

  it('throws when a migration file is missing the description export', async () => {
    writeMigration(migrationsDir, 'V001__bad.js', `module.exports = { async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/description/);
  });

  it('throws when a migration file is missing the up export', async () => {
    writeMigration(migrationsDir, 'V001__bad.js', `module.exports = { description: 'test' };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/up/);
  });

  it('throws on duplicate version numbers', async () => {
    writeMigration(migrationsDir, 'V001__first.js', `module.exports = { description: 'a', async up() {} };`);
    writeMigration(migrationsDir, 'V001__second.js', `module.exports = { description: 'b', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test`  
Expected: FAIL — `Cannot find module '../src/migrationLoader.js'`

- [ ] **Step 3: Implement src/migrationLoader.js**

```js
'use strict';

const { readdirSync, existsSync } = require('fs');
const { join, extname } = require('path');
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
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/migrationLoader.js test/migrationLoader.test.js
git commit -m "feat: migration loader with TypeScript support"
```

---

## Task 5: History Store

**Files:**
- Create: `src/historyStore.js`
- Create: `test/historyStore.test.js`

Manages the `_flowy_migrations` GC Data Table. All methods accept an already-authenticated `platformClient` module.

> **SDK note:** Verify exact method names against the `purecloud-platform-client-v2` docs for `DataTablesApi`. The calls below follow standard Genesys Cloud SDK conventions but should be confirmed. Key methods expected: `getFlowsDatatables()`, `postFlowsDatatables(body)`, `getFlowsDatatableRows(id, opts)`, `createFlowsDatatableRow(id, row)`, `updateFlowsDatatableRow(id, key, row)`.

- [ ] **Step 1: Write failing tests**

```js
// test/historyStore.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TABLE_NAME = '_flowy_migrations';

function makePlatformClient(overrides = {}) {
  const rows = [];
  let tableId = null;

  const dataTablesApi = {
    getFlowsDatatables: vi.fn(async () => ({
      entities: tableId ? [{ id: tableId, name: TABLE_NAME }] : [],
    })),
    postFlowsDatatables: vi.fn(async (body) => {
      tableId = 'table-001';
      return { id: tableId, name: body.name };
    }),
    getFlowsDatatableRows: vi.fn(async () => ({ entities: [...rows] })),
    createFlowsDatatableRow: vi.fn(async (id, row) => {
      rows.push({ ...row });
      return row;
    }),
    updateFlowsDatatableRow: vi.fn(async (id, key, row) => {
      const idx = rows.findIndex((r) => r.key === key);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      return rows[idx];
    }),
    ...overrides,
  };

  const client = {
    DataTablesApi: vi.fn(() => dataTablesApi),
    _dataTablesApi: dataTablesApi,
    _rows: rows,
    _getTableId: () => tableId,
  };

  return client;
}

describe('historyStore', () => {
  let store;

  beforeEach(async () => {
    vi.resetModules();
    store = await import('../src/historyStore.js');
  });

  it('creates the _flowy_migrations table if it does not exist', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    expect(pc._dataTablesApi.postFlowsDatatables).toHaveBeenCalledOnce();
    expect(pc._dataTablesApi.postFlowsDatatables.mock.calls[0][0].name).toBe(TABLE_NAME);
  });

  it('does not create the table if it already exists', async () => {
    const pc = makePlatformClient();
    // Simulate table already existing
    pc._dataTablesApi.getFlowsDatatables.mockResolvedValue({
      entities: [{ id: 'existing-id', name: TABLE_NAME }],
    });
    await store.ensureTable(pc);
    expect(pc._dataTablesApi.postFlowsDatatables).not.toHaveBeenCalled();
  });

  it('records a migration as applied', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    await store.record(pc, {
      key: 'V001',
      description: 'Add greeting',
      filename: 'V001__add_greeting.js',
      checksum: 'abc123',
      appliedAt: '2026-05-24T00:00:00.000Z',
      appliedBy: 'developer',
      executionTime: 420,
      status: 'applied',
    });
    expect(pc._dataTablesApi.createFlowsDatatableRow).toHaveBeenCalledOnce();
  });

  it('getAppliedVersions returns a Set of applied version strings', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    await store.record(pc, { key: 'V001', description: 'd', filename: 'f', checksum: 'c',
      appliedAt: 'a', appliedBy: 'b', executionTime: 1, status: 'applied' });
    await store.record(pc, { key: 'V002', description: 'd', filename: 'f', checksum: 'c',
      appliedAt: 'a', appliedBy: 'b', executionTime: 1, status: 'failed' });
    const versions = await store.getAppliedVersions(pc);
    expect(versions.has('V001')).toBe(true);
    expect(versions.has('V002')).toBe(false); // failed is not applied
  });

  it('getStoredChecksums returns a Map of version -> checksum for applied migrations', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    await store.record(pc, { key: 'V001', description: 'd', filename: 'f', checksum: 'abc',
      appliedAt: 'a', appliedBy: 'b', executionTime: 1, status: 'applied' });
    const checksums = await store.getStoredChecksums(pc);
    expect(checksums.get('V001')).toBe('abc');
  });

  it('updateStatus changes the status of an existing record', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    await store.record(pc, { key: 'V001', description: 'd', filename: 'f', checksum: 'c',
      appliedAt: 'a', appliedBy: 'b', executionTime: 1, status: 'failed' });
    await store.updateStatus(pc, 'V001', 'pending');
    expect(pc._dataTablesApi.updateFlowsDatatableRow).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test`  
Expected: FAIL — `Cannot find module '../src/historyStore.js'`

- [ ] **Step 3: Implement src/historyStore.js**

```js
'use strict';

const { HISTORY_STORE_ERROR } = require('./exitCodes');
const { FlowyCLIError } = require('./config');

const TABLE_NAME = '_flowy_migrations';

const TABLE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', title: 'key' },
    description: { type: 'string' },
    filename: { type: 'string' },
    checksum: { type: 'string' },
    appliedAt: { type: 'string' },
    appliedBy: { type: 'string' },
    executionTime: { type: 'integer' },
    status: { type: 'string' },
    error: { type: 'string' },
  },
};

// Cache the table ID after first lookup so we don't list tables on every call
let cachedTableId = null;

/**
 * Reset the cached table ID (used between test runs).
 */
function resetCache() {
  cachedTableId = null;
}

/**
 * Get or create the _flowy_migrations Data Table.
 * Returns the table ID.
 * @param {object} platformClient
 * @returns {Promise<string>} tableId
 */
async function ensureTable(platformClient) {
  if (cachedTableId) return cachedTableId;

  const api = new platformClient.DataTablesApi();

  try {
    const result = await api.getFlowsDatatables();
    const existing = (result.entities || []).find((t) => t.name === TABLE_NAME);

    if (existing) {
      cachedTableId = existing.id;
      return cachedTableId;
    }

    const created = await api.postFlowsDatatables({
      name: TABLE_NAME,
      schema: TABLE_SCHEMA,
    });
    cachedTableId = created.id;
    return cachedTableId;
  } catch (err) {
    if (err.exitCode) throw err;
    throw new FlowyCLIError(
      `Failed to access or create the ${TABLE_NAME} Data Table: ${err.message}\n` +
      'Ensure the OAuth client has the "architect" scope and Data Tables permissions.',
      HISTORY_STORE_ERROR
    );
  }
}

/**
 * Record a migration entry in the history table.
 * @param {object} platformClient
 * @param {object} entry  { key, description, filename, checksum, appliedAt, appliedBy, executionTime, status, error? }
 */
async function record(platformClient, entry) {
  const tableId = await ensureTable(platformClient);
  const api = new platformClient.DataTablesApi();
  await api.createFlowsDatatableRow(tableId, entry);
}

/**
 * Update the status (and optionally other fields) of an existing record.
 * @param {object} platformClient
 * @param {string} version  e.g. 'V001'
 * @param {string} status
 * @param {object} [extra]  additional fields to merge
 */
async function updateStatus(platformClient, version, status, extra = {}) {
  const tableId = await ensureTable(platformClient);
  const api = new platformClient.DataTablesApi();
  await api.updateFlowsDatatableRow(tableId, version, { status, ...extra });
}

/**
 * Get all rows from the history table.
 * @param {object} platformClient
 * @returns {Promise<object[]>}
 */
async function getAllRows(platformClient) {
  const tableId = await ensureTable(platformClient);
  const api = new platformClient.DataTablesApi();
  const result = await api.getFlowsDatatableRows(tableId, { pageSize: 500 });
  return result.entities || [];
}

/**
 * Returns a Set of version strings that have been successfully applied.
 * @param {object} platformClient
 * @returns {Promise<Set<string>>}
 */
async function getAppliedVersions(platformClient) {
  const rows = await getAllRows(platformClient);
  return new Set(
    rows.filter((r) => r.status === 'applied').map((r) => r.key)
  );
}

/**
 * Returns a Map of version -> checksum for applied migrations.
 * @param {object} platformClient
 * @returns {Promise<Map<string, string>>}
 */
async function getStoredChecksums(platformClient) {
  const rows = await getAllRows(platformClient);
  const map = new Map();
  for (const row of rows) {
    if (row.status === 'applied' && row.checksum) {
      map.set(row.key, row.checksum);
    }
  }
  return map;
}

module.exports = {
  ensureTable,
  record,
  updateStatus,
  getAllRows,
  getAppliedVersions,
  getStoredChecksums,
  resetCache,
  TABLE_NAME,
};
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/historyStore.js test/historyStore.test.js
git commit -m "feat: history store (GC Data Tables)"
```

---

## Task 6: Pre-Migration Snapshot

**Files:**
- Create: `src/snapshot.js`
- Create: `test/snapshot.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/snapshot.test.js
import { describe, it, expect, vi } from 'vitest';

function makeSession(flowsByName = {}) {
  const flows = {};
  for (const [name, flow] of Object.entries(flowsByName)) {
    flows[name] = flow;
  }
  return {
    flows: {
      getFlowByName: vi.fn(async (name) => {
        if (!flows[name]) throw new Error(`Flow "${name}" not found`);
        return flows[name];
      }),
    },
  };
}

describe('snapshotFlows', () => {
  it('calls checkIn on each declared flow', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const flow = { checkIn: vi.fn(async () => {}) };
    const session = makeSession({ MainInbound: flow });
    await snapshotFlows(session, ['MainInbound'], 'pre-migration-V001');
    expect(session.flows.getFlowByName).toHaveBeenCalledWith('MainInbound');
    expect(flow.checkIn).toHaveBeenCalledWith('pre-migration-V001');
  });

  it('does nothing when flows array is empty or absent', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const session = makeSession({});
    await snapshotFlows(session, [], 'label');
    await snapshotFlows(session, null, 'label');
    await snapshotFlows(session, undefined, 'label');
    expect(session.flows.getFlowByName).not.toHaveBeenCalled();
  });

  it('throws when checkIn fails (e.g. flow is locked)', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const flow = { checkIn: vi.fn(async () => { throw new Error('Flow is checked out'); }) };
    const session = makeSession({ LockedFlow: flow });
    await expect(snapshotFlows(session, ['LockedFlow'], 'label'))
      .rejects.toThrow('Flow is checked out');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test`  
Expected: FAIL — `Cannot find module '../src/snapshot.js'`

- [ ] **Step 3: Implement src/snapshot.js**

```js
'use strict';

/**
 * Check in each flow listed in the flows array before a migration runs.
 * This creates a recoverable snapshot in GC version history.
 *
 * @param {object} architectSession  Raw Architect Scripting SDK session
 * @param {string[]|null|undefined} flows  Flow names to snapshot
 * @param {string} label  Check-in comment (e.g. 'pre-migration-V001')
 */
async function snapshotFlows(architectSession, flows, label) {
  if (!flows || flows.length === 0) return;

  for (const flowName of flows) {
    const flow = await architectSession.flows.getFlowByName(flowName);
    await flow.checkIn(label);
  }
}

module.exports = { snapshotFlows };
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/snapshot.js test/snapshot.test.js
git commit -m "feat: pre-migration flow snapshot"
```

---

## Task 7: Migration Runner

**Files:**
- Create: `src/runner.js`
- Create: `test/runner.test.js`

This is the core orchestration module. It authenticates both SDKs, validates checksums, runs pending migrations in sequence, and records history. All SDK calls are injected so the module is fully testable without live GC credentials.

> **SDK note:** Verify the exact `ArchScripting.run()` call signature against the `purecloud-flow-scripting-api-sdk-javascript` docs. The runner imports it by name (`ArchScripting`) and calls `ArchScripting.run({ clientId, clientSecret, region, doWork })`. Adjust if the actual export or method name differs.

- [ ] **Step 1: Write failing tests**

```js
// test/runner.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test runMigrations() by injecting mocked dependencies via the _deps escape hatch.

function makePlatformClient() {
  return {
    ApiClient: { instance: { setBasePath: vi.fn(), loginClientCredentialsGrant: vi.fn(async () => {}) } },
    DataTablesApi: vi.fn(() => ({
      getFlowsDatatables: vi.fn(async () => ({ entities: [{ id: 't1', name: '_flowy_migrations' }] })),
      getFlowsDatatableRows: vi.fn(async () => ({ entities: [] })),
      createFlowsDatatableRow: vi.fn(async () => {}),
      updateFlowsDatatableRow: vi.fn(async () => {}),
    })),
  };
}

function makeArchScripting(sessionObj = {}) {
  return {
    run: vi.fn(async ({ doWork }) => {
      await doWork(sessionObj);
    }),
  };
}

describe('runMigrations', () => {
  beforeEach(() => { vi.resetModules(); });

  it('runs pending migrations in version order', async () => {
    const order = [];
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/m/V001__a.js',
        module: { description: 'a', up: vi.fn(async () => { order.push('V001'); }) } },
      { version: 'V002', filename: 'V002__b.js', filePath: '/m/V002__b.js',
        module: { description: 'b', up: vi.fn(async () => { order.push('V002'); }) } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(),          // no applied versions
      new Map(),          // no stored checksums
      { strict: false },
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(order).toEqual(['V001', 'V002']);
  });

  it('skips already-applied migrations', async () => {
    const upFn = vi.fn();
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/m/V001__a.js',
        module: { description: 'a', up: upFn } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(['V001']),  // V001 already applied
      new Map(),
      {},
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(upFn).not.toHaveBeenCalled();
  });

  it('halts after a migration failure and records it as failed', async () => {
    const v2up = vi.fn();
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/m/V001__a.js',
        module: { description: 'a', up: vi.fn(async () => { throw new Error('boom'); }) } },
      { version: 'V002', filename: 'V002__b.js', filePath: '/m/V002__b.js',
        module: { description: 'b', up: v2up } },
    ];

    const pc = makePlatformClient();
    const api = new pc.DataTablesApi();

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations,
        new Set(),
        new Map(),
        {},
        pc,
        makeArchScripting(),
      )
    ).rejects.toThrow('boom');

    expect(v2up).not.toHaveBeenCalled();
  });

  it('warns on checksum mismatch and proceeds without --strict', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/m/V001__a.js',
        module: { description: 'a', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(['V001']),           // V001 already applied
      new Map([['V001', 'old-checksum']]),  // checksum in history
      { strict: false },
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('V001'));
    warnSpy.mockRestore();
  });

  it('throws on checksum mismatch with --strict', async () => {
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/m/V001__a.js',
        module: { description: 'a', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations,
        new Set(['V001']),
        new Map([['V001', 'old-checksum']]),
        { strict: true },
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/checksum/i);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test`  
Expected: FAIL — `Cannot find module '../src/runner.js'`

- [ ] **Step 3: Implement src/runner.js**

```js
'use strict';

const { computeChecksum } = require('./checksum');
const { snapshotFlows } = require('./snapshot');
const { record } = require('./historyStore');
const { getAppliedBy } = require('./appliedBy');
const { FlowyCLIError } = require('./config');
const { MIGRATION_FAILED } = require('./exitCodes');

/**
 * Core migration runner. Authenticates the Architect Scripting SDK, iterates
 * pending migrations, runs pre-snapshot, calls up(), and records history.
 *
 * @param {object} env              { clientId, clientSecret, region }
 * @param {object[]} allMigrations  Full sorted list from migrationLoader
 * @param {Set<string>} appliedVersions  Versions already recorded as 'applied'
 * @param {Map<string,string>} storedChecksums  version -> checksum from history
 * @param {object} options          { strict, target }
 * @param {object} platformClient   Authenticated purecloud-platform-client-v2 module
 * @param {object} [_archScripting] Injected for testing; defaults to require(SDK)
 */
async function runMigrations(
  env,
  allMigrations,
  appliedVersions,
  storedChecksums,
  options = {},
  platformClient,
  _archScripting,
) {
  // 1. Verify checksums of applied migrations
  for (const m of allMigrations) {
    if (!appliedVersions.has(m.version)) continue;
    const storedChecksum = storedChecksums.get(m.version);
    if (!storedChecksum) continue;
    const currentChecksum = await computeChecksum(m.filePath);
    if (currentChecksum !== storedChecksum) {
      const msg = `Checksum mismatch for applied migration ${m.version} (${m.filename}). ` +
        'The file has changed since it was applied. Run `flowy repair` to acknowledge.';
      if (options.strict) {
        throw new FlowyCLIError(msg, MIGRATION_FAILED);
      } else {
        console.warn(`WARNING: ${msg}`);
      }
    }
  }

  // 2. Filter pending migrations
  let pending = allMigrations.filter((m) => !appliedVersions.has(m.version));
  if (options.target) {
    const targetNum = parseInt(options.target.slice(1), 10);
    pending = pending.filter((m) => parseInt(m.version.slice(1), 10) <= targetNum);
  }

  if (pending.length === 0) {
    console.log('No pending migrations. Everything is up to date.');
    return;
  }

  console.log(`Found ${pending.length} pending migration(s).`);

  // 3. Run all pending migrations inside a single ArchScripting session
  const ArchScripting = _archScripting || require('purecloud-flow-scripting-api-sdk-javascript');

  await ArchScripting.run({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    region: env.region,
    doWork: async (architectSession) => {
      for (const migration of pending) {
        await runOne(migration, architectSession, platformClient, options);
      }
    },
  });
}

async function runOne(migration, architectSession, platformClient, options) {
  console.log(`Applying ${migration.version}: ${migration.module.description}`);

  // Pre-migration snapshot
  if (migration.module.flows && migration.module.flows.length > 0) {
    await snapshotFlows(
      architectSession,
      migration.module.flows,
      `pre-migration-${migration.version}`,
    );
  }

  const checksum = await computeChecksum(migration.filePath);
  const startTime = Date.now();

  try {
    await migration.module.up(architectSession, platformClient);
    const executionTime = Date.now() - startTime;

    await record(platformClient, {
      key: migration.version,
      description: migration.module.description,
      filename: migration.filename,
      checksum,
      appliedAt: new Date().toISOString(),
      appliedBy: getAppliedBy(),
      executionTime,
      status: 'applied',
    });

    console.log(`  ✓ ${migration.version} applied in ${executionTime}ms`);
  } catch (err) {
    const executionTime = Date.now() - startTime;

    try {
      await record(platformClient, {
        key: migration.version,
        description: migration.module.description,
        filename: migration.filename,
        checksum,
        appliedAt: new Date().toISOString(),
        appliedBy: getAppliedBy(),
        executionTime,
        status: 'failed',
        error: err.message,
      });
    } catch (historyErr) {
      console.error(
        `WARNING: Migration ${migration.version} failed, and the failure could not be ` +
        `recorded in history: ${historyErr.message}\n` +
        'Run `flowy repair` after resolving the Data Table issue.',
      );
    }

    console.error(`  ✗ ${migration.version} failed: ${err.message}`);
    throw err;
  }
}

module.exports = { runMigrations };
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runner.js test/runner.test.js
git commit -m "feat: core migration runner"
```

---

## Task 8: CLI Entry Point

**Files:**
- Modify: `bin/flowy.js` (replace stub)
- Create: `src/commands/migrate.js`
- Create: `src/commands/status.js`
- Create: `src/commands/validate.js`
- Create: `src/commands/repair.js`
- Create: `src/commands/rollback.js`
- Create: `src/commands/baseline.js`
- Create: `src/commands/init.js`
- Create: `src/commands/create.js`

No unit tests for the thin command wrappers — they're integration-level and tested by running the CLI. The core logic is already tested in Tasks 2–7.

- [ ] **Step 1: Wire up bin/flowy.js with commander**

```js
#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const program = new Command();

program
  .name('flowy')
  .description('Genesys Cloud flow migration tool')
  .version('0.1.0');

program
  .command('init')
  .description('Scaffold flowy.config.js in the current directory')
  .action(require('./src/commands/init'));

program
  .command('create <description>')
  .description('Create the next migration file')
  .option('--ts', 'create a TypeScript migration (.ts)')
  .action(require('./src/commands/create'));

program
  .command('migrate')
  .description('Apply all pending migrations')
  .option('--env <name>', 'target environment')
  .option('--target <version>', 'apply migrations up to and including this version')
  .option('--strict', 'fail on checksum mismatches instead of warning')
  .action(require('./src/commands/migrate'));

program
  .command('rollback')
  .description('Undo the last applied migration (requires down())')
  .option('--env <name>', 'target environment')
  .action(require('./src/commands/rollback'));

program
  .command('status')
  .description('List applied, pending, and failed migrations')
  .option('--env <name>', 'target environment')
  .action(require('./src/commands/status'));

program
  .command('validate')
  .description('Check for local issues: duplicate versions, missing exports')
  .action(require('./src/commands/validate'));

program
  .command('repair')
  .description('Fix history table problems (reset failed, update checksum, add missing entry)')
  .option('--env <name>', 'target environment')
  .action(require('./src/commands/repair'));

program
  .command('baseline')
  .description('Mark all existing migrations as applied without running them')
  .option('--env <name>', 'target environment')
  .action(require('./src/commands/baseline'));

program.parse();
```

- [ ] **Step 2: Create the shared auth helper used by commands that talk to GC**

Create `src/gcAuth.js`:

```js
'use strict';

/**
 * Authenticate the Platform API Client singleton using client credentials.
 * Returns the authenticated platformClient module.
 * @param {{ clientId: string, clientSecret: string, region: string }} env
 * @returns {object} platformClient
 */
async function authenticatePlatformClient(env) {
  const platformClient = require('purecloud-platform-client-v2');
  platformClient.ApiClient.instance.setBasePath(`https://api.${env.region}`);
  await platformClient.ApiClient.instance.loginClientCredentialsGrant(
    env.clientId,
    env.clientSecret,
  );
  return platformClient;
}

module.exports = { authenticatePlatformClient };
```

- [ ] **Step 3: Implement src/commands/migrate.js**

```js
'use strict';

const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAppliedVersions, getStoredChecksums, resetCache } = require('../historyStore');
const { runMigrations } = require('../runner');
const { authenticatePlatformClient } = require('../gcAuth');
const exitCodes = require('../exitCodes');

module.exports = async function migrate(options) {
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

  const [appliedVersions, storedChecksums] = await Promise.all([
    getAppliedVersions(platformClient),
    getStoredChecksums(platformClient),
  ]);

  try {
    await runMigrations(
      config.env,
      migrations,
      appliedVersions,
      storedChecksums,
      { strict: options.strict, target: options.target },
      platformClient,
    );
  } catch (err) {
    console.error(err.message);
    process.exit(exitCodes.MIGRATION_FAILED);
  }
};
```

- [ ] **Step 4: Implement src/commands/status.js**

```js
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

  const migrations = loadMigrations(config.migrationsDir);
  const rows = await getAllRows(platformClient);
  const rowsByVersion = Object.fromEntries(rows.map((r) => [r.key, r]));

  const header = `${'Version'.padEnd(8)} ${'Status'.padEnd(12)} ${'Description'}`;
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const m of migrations) {
    const row = rowsByVersion[m.version];
    const statusStr = row ? row.status : 'pending';
    const line = `${m.version.padEnd(8)} ${statusStr.padEnd(12)} ${m.module.description}`;
    if (statusStr === 'applied') console.log(chalk.green(line));
    else if (statusStr === 'failed') console.log(chalk.red(line));
    else console.log(chalk.yellow(line));
  }
};
```

- [ ] **Step 5: Implement src/commands/validate.js (local only)**

```js
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
  if (gaps.length > 0) process.exit(1);
};
```

- [ ] **Step 6: Implement src/commands/rollback.js**

```js
'use strict';

const { loadConfig } = require('../config');
const { loadMigrations } = require('../migrationLoader');
const { ensureTable, getAllRows, updateStatus, resetCache } = require('../historyStore');
const { authenticatePlatformClient } = require('../gcAuth');
const { getAppliedBy } = require('../appliedBy');
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

  const platformClient = await authenticatePlatformClient(config.env);
  await ensureTable(platformClient);

  const rows = await getAllRows(platformClient);
  const applied = rows
    .filter((r) => r.status === 'applied')
    .sort((a, b) => {
      const nA = parseInt(a.key.slice(1), 10);
      const nB = parseInt(b.key.slice(1), 10);
      return nB - nA; // descending
    });

  if (applied.length === 0) {
    console.log('No applied migrations to roll back.');
    return;
  }

  const last = applied[0];
  const migrations = loadMigrations(config.migrationsDir);
  const migration = migrations.find((m) => m.version === last.key);

  if (!migration) {
    console.error(`Migration file for ${last.key} not found locally.`);
    process.exit(exitCodes.CONFIG_ERROR);
  }

  if (typeof migration.module.down !== 'function') {
    console.error(
      `Migration ${last.key} does not export a down() function. Cannot roll back.\n` +
      'Write a new corrective migration instead.',
    );
    process.exit(exitCodes.MIGRATION_FAILED);
  }

  const architectScripting = require('purecloud-flow-scripting-api-sdk-javascript');
  try {
    await architectScripting.run({
      clientId: config.env.clientId,
      clientSecret: config.env.clientSecret,
      region: config.env.region,
      doWork: async (architectSession) => {
        await migration.module.down(architectSession, platformClient);
      },
    });
    await updateStatus(platformClient, last.key, 'rolled_back');
    console.log(`✓ ${last.key} rolled back.`);
  } catch (err) {
    console.error(`Rollback of ${last.key} failed: ${err.message}`);
    process.exit(exitCodes.MIGRATION_FAILED);
  }
};
```

- [ ] **Step 7: Implement src/commands/baseline.js**

```js
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
  const config = loadConfig(process.cwd(), options.env || null);
  const platformClient = await authenticatePlatformClient(config.env);
  await ensureTable(platformClient);

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
```

- [ ] **Step 8: Implement src/commands/repair.js**

```js
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
  const config = loadConfig(process.cwd(), options.env || null);
  const platformClient = await authenticatePlatformClient(config.env);
  await ensureTable(platformClient);

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
```

- [ ] **Step 9: Implement src/commands/init.js**

```js
'use strict';

const { writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const TEMPLATE = `module.exports = {
  migrationsDir: './migrations',
  defaultEnvironment: 'dev',

  environments: {
    dev: {
      clientId: process.env.GC_CLIENT_ID,
      clientSecret: process.env.GC_CLIENT_SECRET,
      region: 'mypurecloud.com',
    },
    // prod: {
    //   clientId: process.env.GC_CLIENT_ID_PROD,
    //   clientSecret: process.env.GC_CLIENT_SECRET_PROD,
    //   region: 'mypurecloud.com',
    // },
  },
};
`;

module.exports = function init() {
  const configPath = join(process.cwd(), 'flowy.config.js');
  if (existsSync(configPath)) {
    console.log('flowy.config.js already exists. Nothing to do.');
    return;
  }
  writeFileSync(configPath, TEMPLATE, 'utf8');
  console.log('Created flowy.config.js');
  console.log('Add your credentials to .env:');
  console.log('  GC_CLIENT_ID=your-client-id');
  console.log('  GC_CLIENT_SECRET=your-client-secret');
};
```

- [ ] **Step 10: Implement src/commands/create.js**

```js
'use strict';

const { mkdirSync, readdirSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const { loadConfig } = require('../config');

const JS_TEMPLATE = (version, description) => `'use strict';

module.exports = {
  description: '${description}',

  // Optional: list flow names to check in before up() runs (pre-migration snapshot).
  // flows: ['MyFlow'],

  async up(architectSession, platformClient) {
    // Your migration logic here.
    // You are responsible for calling validate(), checkIn(), and publish() as needed.
  },

  // async down(architectSession, platformClient) {
  //   // Optional rollback logic.
  // },
};
`;

const TS_TEMPLATE = (version, description) => `export default {
  description: '${description}',

  // Optional: list flow names to check in before up() runs (pre-migration snapshot).
  // flows: ['MyFlow'],

  async up(architectSession: any, platformClient: any): Promise<void> {
    // Your migration logic here.
    // You are responsible for calling validate(), checkIn(), and publish() as needed.
  },

  // async down(architectSession: any, platformClient: any): Promise<void> {
  //   // Optional rollback logic.
  // },
};
`;

module.exports = function create(description, options) {
  let config;
  try {
    config = loadConfig(process.cwd(), null);
  } catch {
    // Use default if no config yet
    config = { migrationsDir: join(process.cwd(), 'migrations') };
  }

  mkdirSync(config.migrationsDir, { recursive: true });

  // Find the next version number
  const PATTERN = /^V(\d+)__/;
  const existing = existsSync(config.migrationsDir)
    ? readdirSync(config.migrationsDir).filter((f) => PATTERN.test(f))
    : [];
  const maxNum = existing.reduce((max, f) => {
    const [, n] = f.match(PATTERN);
    return Math.max(max, parseInt(n, 10));
  }, 0);
  const nextNum = String(maxNum + 1).padStart(3, '0');
  const version = `V${nextNum}`;

  const slug = description.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const ext = options.ts ? 'ts' : 'js';
  const filename = `${version}__${slug}.${ext}`;
  const filePath = join(config.migrationsDir, filename);

  const template = options.ts ? TS_TEMPLATE(version, description) : JS_TEMPLATE(version, description);
  writeFileSync(filePath, template, 'utf8');
  console.log(`Created ${filePath}`);
};
```

- [ ] **Step 11: Verify CLI works end-to-end**

Run: `node bin/flowy.js --help`  
Expected: commander help output listing all commands.

Run: `node bin/flowy.js validate`  
Expected: Error about missing flowy.config.js (or "0 migration files validated" if run from the project root with no migrations dir).

- [ ] **Step 12: Commit**

```bash
git add bin/flowy.js src/gcAuth.js src/commands/
git commit -m "feat: CLI entry point and all commands"
```

---

## Task 9: Type Declarations for TypeScript Migration Authors

**Files:**
- Create: `types/FlowMigration.d.ts`

No tests — this is a declaration file only.

- [ ] **Step 1: Create types/FlowMigration.d.ts**

```typescript
// types/FlowMigration.d.ts
// TypeScript interface for flowy migration files.
// Import in your migration: import type { FlowMigration } from 'flowy/types/FlowMigration';

export interface FlowMigration {
  /** Human-readable description stored in migration history. */
  description: string;

  /**
   * Optional. Flow names to check in before up() runs, creating a recoverable snapshot.
   * If absent, no automatic snapshot is taken.
   */
  flows?: string[];

  /**
   * Apply the migration. Responsible for all flow validation, check-in, and publishing.
   * The migration is "applied" when this function returns without throwing.
   *
   * @param architectSession  Raw Architect Scripting SDK session object
   * @param platformClient    Authenticated purecloud-platform-client-v2 module
   */
  up(architectSession: unknown, platformClient: unknown): Promise<void>;

  /**
   * Optional. Roll back the migration. Required for `flowy rollback` to work.
   *
   * @param architectSession  Raw Architect Scripting SDK session object
   * @param platformClient    Authenticated purecloud-platform-client-v2 module
   */
  down?(architectSession: unknown, platformClient: unknown): Promise<void>;
}
```

> **Note:** `architectSession` and `platformClient` are typed as `unknown` until the upstream SDKs ship their own TypeScript declarations. Cast to the appropriate SDK types in your migration file.

- [ ] **Step 2: Reference the types file in package.json**

Add to `package.json`:
```json
"types": "types/FlowMigration.d.ts"
```

- [ ] **Step 3: Commit**

```bash
git add types/FlowMigration.d.ts package.json
git commit -m "feat: TypeScript type declarations for migration authors"
```

---

## Task 10: Final Wiring and Self-Test

- [ ] **Step 1: Run the full test suite**

Run: `npm test`  
Expected: All tests pass. Note any failures and fix before proceeding.

- [ ] **Step 2: Smoke test the CLI against your own flowy.config.js**

```bash
node bin/flowy.js init          # should say "already exists"
node bin/flowy.js validate      # should pass with 0 migrations
node bin/flowy.js create "test migration"
node bin/flowy.js validate      # should now show V001__test_migration.js
```

Expected: `migrations/V001__test_migration.js` created with the JS template.

- [ ] **Step 3: Delete the test migration**

```bash
rm migrations/V001__test_migration.js
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final wiring and smoke test"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Standalone CLI, Homebrew/npm installable | Task 1 (package.json bin field) |
| `flowy.config.js` with named environments | Task 3 |
| `.env` loading via dotenv | Task 3 |
| `--env` flag | Task 8 (all GC commands) |
| Migration files `V001__desc.js` / `.ts` | Task 4 |
| TypeScript support via tsx | Task 4 |
| `flows` array for pre-migration snapshot | Tasks 6, 7 |
| `up(architectSession, platformClient)` | Tasks 7, 8 |
| Optional `down()` | Tasks 7, 8 |
| Single shared ArchScripting session | Task 7 |
| Platform API client authenticated and passed to migrations | Tasks 7, 8 |
| `_flowy_migrations` Data Table, auto-created | Task 5 |
| History schema (all columns including `error`) | Task 5 |
| Checksum validation with warn/--strict | Task 7 |
| `flowy migrate` with `--target` | Tasks 7, 8 |
| `flowy status` with color output | Task 8 |
| `flowy validate` (local, gaps + export checks) | Tasks 4, 8 |
| `flowy rollback` | Task 8 |
| `flowy baseline` | Task 8 |
| `flowy repair` (all 3 cases) | Task 8 |
| `flowy init` | Task 8 |
| `flowy create [--ts]` | Task 8 |
| Named exit codes | Task 1 |
| CI detection for `appliedBy` | Task 2 |
| Type declarations for TS authors | Task 9 |
| Vitest test suite | Tasks 2–7 |
