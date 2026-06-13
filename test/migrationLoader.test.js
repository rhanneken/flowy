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

  it('throws when a flows entry is a string instead of { name, type }', async () => {
    writeMigration(
      migrationsDir,
      'V001__bad_flows.js',
      `module.exports = {
        description: 'test',
        async up() {},
        flows: ['MyFlow'],
      };`,
    );
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/flows\[0\]/);
  });

  it('accepts flows entries that are { name, type } objects', async () => {
    writeMigration(
      migrationsDir,
      'V001__good_flows.js',
      `module.exports = {
        description: 'test',
        async up() {},
        flows: [{ name: 'MyFlow', type: 'inboundcall' }],
      };`,
    );
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).not.toThrow();
  });
});

describe('loadMigrations (directory migrations)', () => {
  function writeDir(dir, dirname, indexContent) {
    const dirPath = join(dir, dirname);
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(join(dirPath, 'index.js'), indexContent);
    return dirPath;
  }

  it('discovers and loads a directory migration via index.js', async () => {
    writeDir(migrationsDir, 'V001__create_prompt', `module.exports = { description: 'create prompt', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const result = loadMigrations(migrationsDir);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('V001');
    expect(result[0].filename).toBe('V001__create_prompt');
    expect(result[0].module.description).toBe('create prompt');
  });

  it('sets filePath to the directory (not the entry point)', async () => {
    const dirPath = writeDir(migrationsDir, 'V001__create_prompt', `module.exports = { description: 'x', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const [m] = loadMigrations(migrationsDir);
    expect(m.filePath).toBe(dirPath);
    expect(m.filePath).not.toContain('index.js');
  });

  it('sorts directory and file migrations together by version number', async () => {
    writeMigration(migrationsDir, 'V001__first.js', `module.exports = { description: 'a', async up() {} };`);
    writeDir(migrationsDir, 'V003__third', `module.exports = { description: 'c', async up() {} };`);
    writeMigration(migrationsDir, 'V002__second.js', `module.exports = { description: 'b', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const result = loadMigrations(migrationsDir);
    expect(result.map((m) => m.version)).toEqual(['V001', 'V002', 'V003']);
  });

  it('throws when a directory matching the pattern has no index.js or index.ts', async () => {
    const dirPath = join(migrationsDir, 'V001__broken');
    mkdirSync(dirPath);
    writeFileSync(join(dirPath, 'helper.js'), '// not the entry point');
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/index\.js/);
  });

  it('throws on duplicate version between a file and a directory', async () => {
    writeMigration(migrationsDir, 'V001__file.js', `module.exports = { description: 'a', async up() {} };`);
    writeDir(migrationsDir, 'V001__dir', `module.exports = { description: 'b', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/duplicate/i);
  });

  it('throws when directory index.js is missing description export', async () => {
    writeDir(migrationsDir, 'V001__bad', `module.exports = { async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/description/);
  });

  it('throws when directory index.js is missing up export', async () => {
    writeDir(migrationsDir, 'V001__bad', `module.exports = { description: 'test' };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/up/);
  });

  it('ignores directories that do not match the migration naming pattern', async () => {
    mkdirSync(join(migrationsDir, 'helpers'));
    writeFileSync(join(migrationsDir, 'helpers', 'util.js'), '// shared utility');
    writeMigration(migrationsDir, 'V001__first.js', `module.exports = { description: 'a', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const result = loadMigrations(migrationsDir);
    expect(result).toHaveLength(1);
  });
});
