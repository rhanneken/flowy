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

  it('discovers and sorts .js migration files by version timestamp', async () => {
    writeMigration(migrationsDir, '20240525143022_second.js', `module.exports = { description: 'second', async up() {} };`);
    writeMigration(migrationsDir, '20240524091500_first.js', `module.exports = { description: 'first', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const result = loadMigrations(migrationsDir);
    expect(result.map(m => m.version)).toEqual(['20240524091500', '20240525143022']);
  });

  it('ignores non-migration files', async () => {
    writeMigration(migrationsDir, 'README.md', '# migrations');
    writeMigration(migrationsDir, '20240524091500_first.js', `module.exports = { description: 'first', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const result = loadMigrations(migrationsDir);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('20240524091500');
  });

  it('exposes version, filename, filePath, and module on each entry', async () => {
    writeMigration(migrationsDir, '20240524091500_add_flow.js', `module.exports = { description: 'add flow', async up() {}, async down() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    const [m] = loadMigrations(migrationsDir);
    expect(m.version).toBe('20240524091500');
    expect(m.filename).toBe('20240524091500_add_flow.js');
    expect(m.filePath).toContain('20240524091500_add_flow.js');
    expect(m.module.description).toBe('add flow');
    expect(typeof m.module.up).toBe('function');
    expect(typeof m.module.down).toBe('function');
  });

  it('throws when a migration file is missing the description export', async () => {
    writeMigration(migrationsDir, '20240524091500_bad.js', `module.exports = { async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/description/);
  });

  it('throws when a migration file is missing the up export', async () => {
    writeMigration(migrationsDir, '20240524091500_bad.js', `module.exports = { description: 'test' };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/up/);
  });

  it('throws on duplicate version timestamps', async () => {
    writeMigration(migrationsDir, '20240524091500_first.js', `module.exports = { description: 'a', async up() {} };`);
    writeMigration(migrationsDir, '20240524091500_second.js', `module.exports = { description: 'b', async up() {} };`);
    const { loadMigrations } = await import('../src/migrationLoader.js');
    expect(() => loadMigrations(migrationsDir)).toThrow(/duplicate/i);
  });
});
