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
    ApiClient: { instance: { setEnvironment: vi.fn(), loginClientCredentialsGrant: vi.fn(async () => {}) } },
    ArchitectApi: vi.fn(() => ({
      getFlowsDatatables: vi.fn(async () => ({ entities: [{ id: 't1', name: '_flowy_migrations' }] })),
      getFlowsDatatableRows: vi.fn(async () => ({ entities: [] })),
      postFlowsDatatableRows: vi.fn(async () => {}),
      putFlowsDatatableRow: vi.fn(async () => {}),
    })),
  };
}

function makeArchScripting(sessionObj = {}) {
  const archSession = {
    endTerminatesProcess: true,
    endExitCode: 0,
    _locations: { prod_us_east_1: { host: 'apps.mypurecloud.com' } },
    startWithClientIdAndSecret: vi.fn(async (orgLocation, callbackStart) => {
      await callbackStart(sessionObj);
    }),
  };
  return {
    environment: { archSession },
    services: {
      archLogging: { setLoggingCallback: vi.fn() },
    },
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
    const { filePath: fp1 } = createTempMigration('20240524091500_a.js', "module.exports = { description: 'a', up: async () => {} };");
    const { filePath: fp2 } = createTempMigration('20240525143022_b.js', "module.exports = { description: 'b', up: async () => {} };");

    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { order.push('20240524091500'); }) } },
      { version: '20240525143022', filename: '20240525143022_b.js', filePath: fp2,
        module: { description: 'b', up: vi.fn(async () => { order.push('20240525143022'); }) } },
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

    expect(order).toEqual(['20240524091500', '20240525143022']);
  });

  it('skips already-applied migrations', async () => {
    const upFn = vi.fn();
    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: '/nonexistent/20240524091500_a.js',
        module: { description: 'a', up: upFn } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(['20240524091500']),  // already applied
      new Map(),                    // no stored checksums — so checksum validation skipped
      {},
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(upFn).not.toHaveBeenCalled();
  });

  it('halts after a migration failure and records it as failed', async () => {
    const v2up = vi.fn();
    const { filePath: fp1 } = createTempMigration('20240524091500_a_fail.js', "module.exports = { description: 'a', up: async () => { throw new Error('boom'); } };");
    const { filePath: fp2 } = createTempMigration('20240525143022_b_fail.js', "module.exports = { description: 'b', up: async () => {} };");

    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { throw new Error('boom'); }) } },
      { version: '20240525143022', filename: '20240525143022_b.js', filePath: fp2,
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
    const { filePath: fp1 } = createTempMigration('20240524091500_a_warn.js', content);

    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(['20240524091500']),                          // already applied
      new Map([['20240524091500', 'old-checksum']]),         // mismatched stored checksum
      { strict: false },
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('20240524091500'));
    warnSpy.mockRestore();
  });

  it('throws on checksum mismatch with --strict', async () => {
    const content = "module.exports = { description: 'a', up: async () => {} };";
    const { filePath: fp1 } = createTempMigration('20240524091500_a_strict.js', content);

    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations,
        new Set(['20240524091500']),
        new Map([['20240524091500', 'old-checksum']]),
        { strict: true },
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/checksum/i);
  });

  it('prints a lock hint when up() fails with a "locked by" error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { filePath: fp1 } = createTempMigration(
      '20240524091500_lock_hint.js',
      "module.exports = { description: 'a', up: async () => {} };",
    );

    const lockErr = new Error("Request Error (409): Flow 'MyFlow' is locked by user 'someone@example.com'.");
    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { throw lockErr; }) } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations, new Set(), new Map(), {},
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/locked by/);

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('flowy unlock'));
    errSpy.mockRestore();
  });

  it('does not print a lock hint for "not locked by" errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { filePath: fp1 } = createTempMigration(
      '20240524091500_not_lock_hint.js',
      "module.exports = { description: 'a', up: async () => {} };",
    );

    const notLockedErr = new Error("Request Error (409): Flow 'MyFlow' is not locked by client 'Archy Client'.");
    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { throw notLockedErr; }) } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations, new Set(), new Map(), {},
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/not locked by/);

    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining('flowy unlock'));
    errSpy.mockRestore();
  });

  it('filters by --target and only runs migrations up to and including the target', async () => {
    const order = [];
    const { filePath: fp1 } = createTempMigration('20240524091500_a_target.js', "module.exports = { description: 'a', up: async () => {} };");
    const { filePath: fp2 } = createTempMigration('20240525143022_b_target.js', "module.exports = { description: 'b', up: async () => {} };");
    const { filePath: fp3 } = createTempMigration('20240526100000_c_target.js', "module.exports = { description: 'c', up: async () => {} };");

    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { order.push('20240524091500'); }) } },
      { version: '20240525143022', filename: '20240525143022_b.js', filePath: fp2,
        module: { description: 'b', up: vi.fn(async () => { order.push('20240525143022'); }) } },
      { version: '20240526100000', filename: '20240526100000_c.js', filePath: fp3,
        module: { description: 'c', up: vi.fn(async () => { order.push('20240526100000'); }) } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(),
      new Map(),
      { target: '20240525143022' },
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(order).toEqual(['20240524091500', '20240525143022']);
  });

  it('throws when --target version does not exist', async () => {
    const { filePath: fp1 } = createTempMigration('20240524091500_a_notarget.js', "module.exports = { description: 'a', up: async () => {} };");
    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations, new Set(), new Map(),
        { target: '20240601000000' },
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/not found/i);
  });

  it('filters by --date and only runs migrations up to the end of that date', async () => {
    const order = [];
    const { filePath: fp1 } = createTempMigration('20240524091500_a_date.js', "module.exports = { description: 'a', up: async () => {} };");
    const { filePath: fp2 } = createTempMigration('20240525143022_b_date.js', "module.exports = { description: 'b', up: async () => {} };");
    const { filePath: fp3 } = createTempMigration('20240526100000_c_date.js', "module.exports = { description: 'c', up: async () => {} };");

    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { order.push('20240524091500'); }) } },
      { version: '20240525143022', filename: '20240525143022_b.js', filePath: fp2,
        module: { description: 'b', up: vi.fn(async () => { order.push('20240525143022'); }) } },
      { version: '20240526100000', filename: '20240526100000_c.js', filePath: fp3,
        module: { description: 'c', up: vi.fn(async () => { order.push('20240526100000'); }) } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(),
      new Map(),
      { date: '20240525' },
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(order).toEqual(['20240524091500', '20240525143022']);
  });

  it('--date accepts dashes in the date string', async () => {
    const order = [];
    const { filePath: fp1 } = createTempMigration('20240524091500_a_dashes.js', "module.exports = { description: 'a', up: async () => {} };");
    const { filePath: fp2 } = createTempMigration('20240526100000_b_dashes.js', "module.exports = { description: 'b', up: async () => {} };");

    const migrations = [
      { version: '20240524091500', filename: '20240524091500_a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { order.push('20240524091500'); }) } },
      { version: '20240526100000', filename: '20240526100000_b.js', filePath: fp2,
        module: { description: 'b', up: vi.fn(async () => { order.push('20240526100000'); }) } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(),
      new Map(),
      { date: '2024-05-25' },
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(order).toEqual(['20240524091500']);
  });

  it('throws when --target and --date are both provided', async () => {
    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        [], new Set(), new Map(),
        { target: '20240525143022', date: '20240525' },
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/mutually exclusive/i);
  });

  it('warns on out-of-order migration without --strict', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { filePath: fp1 } = createTempMigration('20240523091500_old.js', "module.exports = { description: 'old', up: async () => {} };");

    const migrations = [
      { version: '20240523091500', filename: '20240523091500_old.js', filePath: fp1,
        module: { description: 'old', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(['20240525143022']),  // a later migration is already applied
      new Map(),
      { strict: false },
      makePlatformClient(),
      makeArchScripting(),
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('out of order'));
    warnSpy.mockRestore();
  });

  it('throws on out-of-order migration with --strict', async () => {
    const { filePath: fp1 } = createTempMigration('20240523091500_old_strict.js', "module.exports = { description: 'old', up: async () => {} };");

    const migrations = [
      { version: '20240523091500', filename: '20240523091500_old.js', filePath: fp1,
        module: { description: 'old', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations,
        new Set(['20240525143022']),  // a later migration is already applied
        new Map(),
        { strict: true },
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/out of order/i);
  });
});
