import { describe, it, expect, vi } from 'vitest';

function makeScripting(flowsByName = {}) {
  return {
    factories: {
      archFactoryFlows: {
        checkoutAndLoadFlowByFlowNameAsync: vi.fn(async (name) => {
          if (!flowsByName[name]) throw new Error(`Flow "${name}" not found`);
          return flowsByName[name];
        }),
      },
    },
  };
}

function makePlatformClient(flowsByName = {}) {
  return {
    ArchitectApi: vi.fn(() => ({
      getFlows: vi.fn(async ({ name }) => ({
        // The real Platform API returns flow types in uppercase
        entities: flowsByName[name] ? [{ name, type: 'INBOUNDCALL' }] : [],
      })),
    })),
  };
}

describe('snapshotFlows', () => {
  it('checks out and checks in each declared flow', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const flow = { checkInAsync: vi.fn(async () => {}) };
    const scripting = makeScripting({ MainInbound: flow });
    const platformClient = makePlatformClient({ MainInbound: true });
    await snapshotFlows(scripting, ['MainInbound'], platformClient);
    expect(scripting.factories.archFactoryFlows.checkoutAndLoadFlowByFlowNameAsync)
      .toHaveBeenCalledWith('MainInbound', 'inboundcall');
    expect(flow.checkInAsync).toHaveBeenCalledWith();
  });

  it('does nothing when flows array is empty or absent', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const scripting = makeScripting({});
    const platformClient = makePlatformClient({});
    await snapshotFlows(scripting, [], platformClient);
    await snapshotFlows(scripting, null, platformClient);
    await snapshotFlows(scripting, undefined, platformClient);
    expect(scripting.factories.archFactoryFlows.checkoutAndLoadFlowByFlowNameAsync)
      .not.toHaveBeenCalled();
  });

  it('throws a clear error when the flow does not exist', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const scripting = makeScripting({});
    const platformClient = makePlatformClient({});
    await expect(snapshotFlows(scripting, ['NoSuchFlow'], platformClient))
      .rejects.toThrow('Flow "NoSuchFlow" not found');
  });
});
