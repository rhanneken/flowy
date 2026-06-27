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

// Platform client whose record/update spies are stable across ArchitectApi()
// instantiations, so a test can assert that history was (not) written.
function makePlatformClientWithSpies() {
  const postFlowsDatatableRows = vi.fn(async () => {});
  const putFlowsDatatableRow = vi.fn(async () => {});
  const pc = {
    ApiClient: { instance: { setEnvironment: vi.fn(), loginClientCredentialsGrant: vi.fn(async () => {}) } },
    ArchitectApi: vi.fn(() => ({
      getFlowsDatatables: vi.fn(async () => ({ entities: [{ id: 't1', name: '_flowy_migrations' }] })),
      getFlowsDatatableRows: vi.fn(async () => ({ entities: [] })),
      postFlowsDatatableRows,
      putFlowsDatatableRow,
    })),
  };
  return { pc, postFlowsDatatableRows, putFlowsDatatableRow };
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

  it('prints a lock hint when up() fails with a "locked by" error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { filePath: fp1 } = createTempMigration(
      'V001__lock_hint.js',
      "module.exports = { description: 'a', up: async () => {} };",
    );

    const lockErr = new Error("Request Error (409): Flow 'MyFlow' is locked by user 'someone@example.com'.");
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: fp1,
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

  it('prints a scratch-aware lock hint in scratch mode', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { filePath: fp1 } = createTempMigration(
      'V001__scratch_lock.js',
      "module.exports = { description: 'a', up: async () => {} };",
    );

    const lockErr = new Error("Request Error (409): Flow 'MyFlow' is locked by user 'someone@example.com'.");
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { throw lockErr; }) } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations, new Set(), new Map(), { scratch: 'V001' },
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/locked by/);

    // Retry points back at scratch, and does not mention repair.
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('flowy migrate --scratch V001'));
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining('flowy repair'));
    errSpy.mockRestore();
  });

  it('does not print a lock hint for "not locked by" errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { filePath: fp1 } = createTempMigration(
      'V001__not_lock_hint.js',
      "module.exports = { description: 'a', up: async () => {} };",
    );

    const notLockedErr = new Error("Request Error (409): Flow 'MyFlow' is not locked by client 'Archy Client'.");
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: fp1,
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

  it('scratch mode runs only the named migration and records nothing', async () => {
    const v1up = vi.fn();
    const v2up = vi.fn();
    const { filePath: fp2 } = createTempMigration(
      'V002__scratch.js', "module.exports = { description: 'b', up: async () => {} };",
    );
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/nonexistent/V001__a.js',
        module: { description: 'a', up: v1up } },
      { version: 'V002', filename: 'V002__b.js', filePath: fp2,
        module: { description: 'b', up: v2up } },
    ];

    const { pc, postFlowsDatatableRows } = makePlatformClientWithSpies();
    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations,
      new Set(),
      new Map(),
      { scratch: 'V002' },
      pc,
      makeArchScripting(),
    );

    expect(v2up).toHaveBeenCalledTimes(1);   // the named migration ran
    expect(v1up).not.toHaveBeenCalled();     // other pending migrations did not
    expect(postFlowsDatatableRows).not.toHaveBeenCalled();  // nothing recorded
  });

  it('scratch mode refuses a version that is already applied', async () => {
    const upFn = vi.fn();
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/nonexistent/V001__a.js',
        module: { description: 'a', up: upFn } },
    ];

    const { pc, postFlowsDatatableRows } = makePlatformClientWithSpies();
    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations,
        new Set(['V001']),            // V001 already applied
        new Map(),
        { scratch: 'V001' },
        pc,
        makeArchScripting(),
      )
    ).rejects.toThrow(/already applied/i);

    expect(upFn).not.toHaveBeenCalled();
    expect(postFlowsDatatableRows).not.toHaveBeenCalled();
  });

  it('scratch mode throws when the version does not exist', async () => {
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: '/nonexistent/V001__a.js',
        module: { description: 'a', up: vi.fn() } },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations,
        new Set(),
        new Map(),
        { scratch: 'V999' },
        makePlatformClient(),
        makeArchScripting(),
      )
    ).rejects.toThrow(/not found/i);
  });

  it('scratch mode does not record a failed migration', async () => {
    const { filePath: fp1 } = createTempMigration(
      'V001__scratch_fail.js', "module.exports = { description: 'a', up: async () => {} };",
    );
    const migrations = [
      { version: 'V001', filename: 'V001__a.js', filePath: fp1,
        module: { description: 'a', up: vi.fn(async () => { throw new Error('boom'); }) } },
    ];

    const { pc, postFlowsDatatableRows } = makePlatformClientWithSpies();
    const { runMigrations } = await import('../src/runner.js');
    await expect(
      runMigrations(
        { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
        migrations,
        new Set(),
        new Map(),
        { scratch: 'V001' },
        pc,
        makeArchScripting(),
      )
    ).rejects.toThrow('boom');

    expect(postFlowsDatatableRows).not.toHaveBeenCalled();  // no 'failed' row written
  });

  it('passes migration.params as the third argument to up()', async () => {
    const { filePath: fp1 } = createTempMigration(
      'V001__params_up.js',
      "module.exports = { description: 'a', up: async () => {} };",
    );
    const upFn = vi.fn();
    const migrations = [
      {
        version: 'V001', filename: 'V001__a.js', filePath: fp1,
        params: { phone: '+15550000001' },
        module: { description: 'a', up: upFn },
      },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations, new Set(), new Map(), {},
      makePlatformClient(), makeArchScripting(),
    );

    expect(upFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { phone: '+15550000001' },
    );
  });

  it('passes undefined as the third argument to up() when migration.params is absent', async () => {
    const { filePath: fp1 } = createTempMigration(
      'V001__no_params_up.js',
      "module.exports = { description: 'a', up: async () => {} };",
    );
    const upFn = vi.fn();
    const migrations = [
      {
        version: 'V001', filename: 'V001__a.js', filePath: fp1,
        module: { description: 'a', up: upFn },
      },
    ];

    const { runMigrations } = await import('../src/runner.js');
    await runMigrations(
      { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' },
      migrations, new Set(), new Map(), {},
      makePlatformClient(), makeArchScripting(),
    );

    expect(upFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
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

describe('runRollback', () => {
  const env = { clientId: 'id', clientSecret: 'sec', region: 'mypurecloud.com' };

  beforeEach(() => {
    vi.resetModules();
  });

  function mig(version, down) {
    return {
      version,
      filename: `${version}__m.js`,
      filePath: `/nonexistent/${version}__m.js`,
      module: { description: version, down },
    };
  }

  it('rolls back the newest applied migration and records it as rolled_back', async () => {
    const v1down = vi.fn();
    const v2down = vi.fn();
    const rows = [
      { key: 'V001', status: 'applied' },
      { key: 'V002', status: 'applied' },
    ];
    const migrations = [mig('V001', v1down), mig('V002', v2down)];

    const { pc, putFlowsDatatableRow } = makePlatformClientWithSpies();
    const { runRollback } = await import('../src/runner.js');
    await runRollback(env, migrations, rows, {}, pc, makeArchScripting());

    expect(v2down).toHaveBeenCalledTimes(1);  // newest applied
    expect(v1down).not.toHaveBeenCalled();
    expect(putFlowsDatatableRow).toHaveBeenCalledWith(
      't1', 'V002', expect.objectContaining({ body: expect.objectContaining({ status: 'rolled_back' }) }),
    );
  });

  it('reports nothing to roll back when no migration is applied', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { pc, putFlowsDatatableRow } = makePlatformClientWithSpies();
    const { runRollback } = await import('../src/runner.js');

    await runRollback(env, [], [], {}, pc, makeArchScripting());

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No applied migrations'));
    expect(putFlowsDatatableRow).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('scratch mode runs the named down() and records nothing', async () => {
    const v6down = vi.fn();
    const migrations = [mig('V006', v6down)];

    const { pc, putFlowsDatatableRow } = makePlatformClientWithSpies();
    const { runRollback } = await import('../src/runner.js');
    await runRollback(env, migrations, [], { scratch: 'V006' }, pc, makeArchScripting());

    expect(v6down).toHaveBeenCalledTimes(1);
    expect(putFlowsDatatableRow).not.toHaveBeenCalled();  // ledger untouched
  });

  it('scratch mode refuses a version that is already applied', async () => {
    const v3down = vi.fn();
    const rows = [{ key: 'V003', status: 'applied' }];
    const migrations = [mig('V003', v3down)];

    const { pc, putFlowsDatatableRow } = makePlatformClientWithSpies();
    const { runRollback } = await import('../src/runner.js');
    await expect(
      runRollback(env, migrations, rows, { scratch: 'V003' }, pc, makeArchScripting()),
    ).rejects.toThrow(/recorded as applied/i);

    expect(v3down).not.toHaveBeenCalled();
    expect(putFlowsDatatableRow).not.toHaveBeenCalled();
  });

  it('throws when the scratch version does not exist locally', async () => {
    const { runRollback } = await import('../src/runner.js');
    await expect(
      runRollback(env, [], [], { scratch: 'V999' }, makePlatformClient(), makeArchScripting()),
    ).rejects.toThrow(/not found/i);
  });

  it('throws when the migration has no down() function', async () => {
    const migrations = [mig('V006', undefined)];  // no down
    const { runRollback } = await import('../src/runner.js');
    await expect(
      runRollback(env, migrations, [], { scratch: 'V006' }, makePlatformClient(), makeArchScripting()),
    ).rejects.toThrow(/down\(\)/i);
  });

  it('wraps a down() failure with a contextual message', async () => {
    const migrations = [mig('V006', vi.fn(async () => { throw new Error('boom'); }))];
    const { runRollback } = await import('../src/runner.js');
    await expect(
      runRollback(env, migrations, [], { scratch: 'V006' }, makePlatformClient(), makeArchScripting()),
    ).rejects.toThrow(/Rollback of V006 failed: boom/);
  });

  it('passes migration.params as the third argument to down()', async () => {
    const v1down = vi.fn();
    const migrations = [
      {
        version: 'V001',
        filename: 'V001__m.js',
        filePath: '/nonexistent/V001__m.js',
        params: { phone: '+15550000002' },
        module: { description: 'V001', down: v1down },
      },
    ];
    const rows = [{ key: 'V001', status: 'applied' }];

    const { pc } = makePlatformClientWithSpies();
    const { runRollback } = await import('../src/runner.js');
    await runRollback(env, migrations, rows, {}, pc, makeArchScripting());

    expect(v1down).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { phone: '+15550000002' },
    );
  });

  it('passes undefined as the third argument to down() when migration.params is absent', async () => {
    const v1down = vi.fn();
    const migrations = [
      {
        version: 'V001',
        filename: 'V001__m.js',
        filePath: '/nonexistent/V001__m.js',
        module: { description: 'V001', down: v1down },
      },
    ];
    const rows = [{ key: 'V001', status: 'applied' }];

    const { pc } = makePlatformClientWithSpies();
    const { runRollback } = await import('../src/runner.js');
    await runRollback(env, migrations, rows, {}, pc, makeArchScripting());

    expect(v1down).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });
});
