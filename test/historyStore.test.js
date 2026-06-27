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
    postFlowsDatatableRows: vi.fn(async (id, row) => {
      rows.push({ ...row });
      return row;
    }),
    putFlowsDatatableRow: vi.fn(async (id, key, opts) => {
      const row = opts.body;
      const idx = rows.findIndex((r) => r.key === key);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      return rows[idx];
    }),
    ...overrides,
  };

  const client = {
    ArchitectApi: vi.fn(function() { return dataTablesApi; }),
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
    expect(pc._dataTablesApi.postFlowsDatatableRows).toHaveBeenCalledOnce();
  });

  it('record() updates an existing row instead of inserting a duplicate', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    const entry = {
      key: 'V001',
      description: 'Add greeting',
      filename: 'V001__add_greeting.js',
      checksum: 'abc123',
      appliedAt: '2026-05-24T00:00:00.000Z',
      appliedBy: 'developer',
      executionTime: 420,
      status: 'failed',
    };
    // First call: inserts
    await store.record(pc, entry);
    expect(pc._dataTablesApi.postFlowsDatatableRows).toHaveBeenCalledOnce();
    expect(pc._dataTablesApi.putFlowsDatatableRow).not.toHaveBeenCalled();

    // Second call with same key: updates instead of inserting
    await store.record(pc, { ...entry, status: 'applied' });
    expect(pc._dataTablesApi.postFlowsDatatableRows).toHaveBeenCalledOnce(); // still just once
    expect(pc._dataTablesApi.putFlowsDatatableRow).toHaveBeenCalledOnce();
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

  it('getAppliedVersions excludes rolled_back versions so they can be re-applied', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    await store.record(pc, { key: 'V001', description: 'd', filename: 'f', checksum: 'c',
      appliedAt: 'a', appliedBy: 'b', executionTime: 1, status: 'rolled_back' });
    const versions = await store.getAppliedVersions(pc);
    expect(versions.has('V001')).toBe(false); // rolled_back is treated as pending so it can be re-applied
  });

  it('getStoredChecksums returns a Map of version -> checksum for applied migrations', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    await store.record(pc, { key: 'V001', description: 'd', filename: 'f', checksum: 'abc',
      appliedAt: 'a', appliedBy: 'b', executionTime: 1, status: 'applied' });
    const checksums = await store.getStoredChecksums(pc);
    expect(checksums.get('V001')).toBe('abc');
  });

  it('getAllRows fetches all pages when pageCount > 1', async () => {
    const page1 = [{ key: 'V001', status: 'applied' }];
    const page2 = [{ key: 'V002', status: 'applied' }];
    let callCount = 0;
    const pc = makePlatformClient({
      getFlowsDatatableRows: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { entities: page1, pageCount: 2, pageNumber: 1 };
        return { entities: page2, pageCount: 2, pageNumber: 2 };
      }),
    });
    await store.ensureTable(pc);
    const rows = await store.getAllRows(pc);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe('V001');
    expect(rows[1].key).toBe('V002');
    expect(pc._dataTablesApi.getFlowsDatatableRows).toHaveBeenCalledTimes(2);
  });

  it('updateStatus changes the status of an existing record', async () => {
    const pc = makePlatformClient();
    await store.ensureTable(pc);
    await store.record(pc, { key: 'V001', description: 'd', filename: 'f', checksum: 'c',
      appliedAt: 'a', appliedBy: 'b', executionTime: 1, status: 'failed' });
    await store.updateStatus(pc, 'V001', 'pending');
    expect(pc._dataTablesApi.putFlowsDatatableRow).toHaveBeenCalled();
  });
});
