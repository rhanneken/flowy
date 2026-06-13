import { describe, it, expect, vi } from 'vitest';

/**
 * Build a mock platformClient whose ArchitectApi.getFlows returns flow data
 * keyed by "name|UPPERCASE_TYPE" (e.g. 'MainInbound|INBOUNDCALL').
 *
 * Config object shape per key:
 *   lockedUser?:  { name: string }   — simulate user-owned lock
 *   lockedClient?: { id: string }    — simulate client-credentials lock
 *   onPage?:      number             — which page the flow appears on (default 1)
 *   pageCount?:   number             — total pages (default 1)
 */
function makePlatformClient(flowsByKey = {}) {
  return {
    ArchitectApi: vi.fn(() => ({
      getFlows: vi.fn(async ({ name, type, pageNumber = 1 }) => {
        const key = `${name}|${type}`;   // type is already UPPERCASE from findFlow
        const config = flowsByKey[key];
        if (!config) return { entities: [], pageCount: 1 };

        const onPage = config.onPage ?? 1;
        const pageCount = config.pageCount ?? 1;
        if (pageNumber !== onPage) return { entities: [], pageCount };

        const entity = { name, type };
        if (config.lockedUser) entity.lockedUser = config.lockedUser;
        if (config.lockedClient) entity.lockedClient = config.lockedClient;
        return { entities: [entity], pageCount };
      }),
    })),
  };
}

describe('snapshotFlows', () => {
  it('does nothing when flows array is empty or absent', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const platformClient = makePlatformClient({});
    await snapshotFlows([], platformClient);
    await snapshotFlows(null, platformClient);
    await snapshotFlows(undefined, platformClient);
    expect(platformClient.ArchitectApi).not.toHaveBeenCalled();
  });

  it('resolves without error when listed flow is not locked', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const platformClient = makePlatformClient({
      'MainInbound|INBOUNDCALL': {},
    });
    await expect(
      snapshotFlows([{ name: 'MainInbound', type: 'inboundcall' }], platformClient),
    ).resolves.toBeUndefined();
  });

  it('throws a clear error when the flow does not exist', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const platformClient = makePlatformClient({});
    await expect(
      snapshotFlows([{ name: 'NoSuchFlow', type: 'inboundcall' }], platformClient),
    ).rejects.toThrow('Flow "NoSuchFlow" (inboundcall) not found');
  });

  it('throws a user-lock error when lockedUser is set', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const platformClient = makePlatformClient({
      'MainInbound|INBOUNDCALL': { lockedUser: { name: 'Jane Doe' } },
    });
    await expect(
      snapshotFlows([{ name: 'MainInbound', type: 'inboundcall' }], platformClient),
    ).rejects.toThrow('locked by user Jane Doe');
  });

  it('throws a client-lock error when lockedClient is set', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const platformClient = makePlatformClient({
      'MainInbound|INBOUNDCALL': { lockedClient: { id: 'some-client-id' } },
    });
    await expect(
      snapshotFlows([{ name: 'MainInbound', type: 'inboundcall' }], platformClient),
    ).rejects.toThrow('flowy unlock');
  });

  it('paginates across pages to find the matching flow', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');

    const getFlows = vi.fn()
      .mockResolvedValueOnce({ entities: [], pageCount: 2 })
      .mockResolvedValueOnce({
        entities: [{ name: 'MainInbound', type: 'INBOUNDCALL' }],
        pageCount: 2,
      });

    const platformClient = { ArchitectApi: vi.fn(() => ({ getFlows })) };

    await expect(
      snapshotFlows([{ name: 'MainInbound', type: 'inboundcall' }], platformClient),
    ).resolves.toBeUndefined();

    expect(getFlows).toHaveBeenCalledTimes(2);
    expect(getFlows).toHaveBeenNthCalledWith(1, expect.objectContaining({ pageNumber: 1 }));
    expect(getFlows).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageNumber: 2 }));
  });
});
