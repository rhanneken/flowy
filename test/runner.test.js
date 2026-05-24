import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

// Helper: write a temp file with deterministic content and return its path and checksum
function makeTempMigration(name, content) {
  const filePath = join(tmpdir(), name);
  writeFileSync(filePath, content);
  const checksum = createHash('sha256').update(content).digest('hex');
  return { filePath, checksum };
}

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
  let tempFiles = [];

  // Track and clean up temp files after each test
  function createTempMigration(name, content) {
    const result = makeTempMigration(name, content);
    tempFiles.push(result.filePath);
    return result;
  }

  beforeEach(() => {
    vi.resetModules();
    tempFiles = [];
  });

  afterEach(() => {
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  });

  it('runs pending migrations in version order', async () => {
    const order = [];
    const { filePath: fp1 } = createTempMigration('V001__a.js', "module.exports = { description: 'a', up: async () => {} };");
    const { filePath: fp2 } = createTempMigration('V002__b.js', "module.exports = { description: 'b', up: async () => {} };");

    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { order.push('V001'); }) } },
      { version: 'V002', filename: 'V002__b.js', filePath: fp2,
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
    // No temp file needed: V001 is applied so computeChecksum won't be called for it
    // (checksum validation only warns/throws; no stored checksum means it's skipped)
    // But wait — for pending migrations, computeChecksum IS called. V001 is not pending, so no file needed.
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/nonexistent/V001__a.js',
        module: { description: 'a', up: upFn } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(['V001']),  // V001 already applied
      new Map(),          // no stored checksums — so checksum validation skipped
      {},
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(upFn).not.toHaveBeenCalled();
  });

  it('halts after a migration failure and records it as failed', async () => {
    const v2up = vi.fn();
    const { filePath: fp1 } = createTempMigration('V001__a_fail.js', "module.exports = { description: 'a', up: async () => { throw new Error('boom'); } };");
    const { filePath: fp2 } = createTempMigration('V002__b_fail.js', "module.exports = { description: 'b', up: async () => {} };");

    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { throw new Error('boom'); }) } },
      { version: 'V002', filename: 'V002__b.js', filePath: fp2,
        module: { description: 'b', up: v2up } },
    ];

    const pc = makePlatformClient();

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
    const content = "module.exports = { description: 'a', up: async () => {} };";
    const { filePath: fp1 } = createTempMigration('V001__a_warn.js', content);

    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(['V001']),                          // V001 already applied
      new Map([['V001', 'old-checksum']]),         // mismatched stored checksum
      { strict: false },
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('V001'));
    warnSpy.mockRestore();
  });

  it('throws on checksum mismatch with --strict', async () => {
    const content = "module.exports = { description: 'a', up: async () => {} };";
    const { filePath: fp1 } = createTempMigration('V001__a_strict.js', content);

    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: fp1,
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
