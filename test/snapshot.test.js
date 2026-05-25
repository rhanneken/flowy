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
    FlowsApi: vi.fn(() => ({
      getFlows: vi.fn(async ({ name }) => ({
        entities: flowsByName[name] ? [{ name, type: 'inboundCall' }] : [],
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
    await snapshotFlows(scripting, ['MainInbound'], 'pre-migration-V001', platformClient);
    expect(scripting.factories.archFactoryFlows.checkoutAndLoadFlowByFlowNameAsync)
      .toHaveBeenCalledWith('MainInbound', 'inboundCall');
    expect(flow.checkInAsync).toHaveBeenCalledWith('pre-migration-V001');
  });

  it('does nothing when flows array is empty or absent', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const scripting = makeScripting({});
    const platformClient = makePlatformClient({});
    await snapshotFlows(scripting, [], 'label', platformClient);
    await snapshotFlows(scripting, null, 'label', platformClient);
    await snapshotFlows(scripting, undefined, 'label', platformClient);
    expect(scripting.factories.archFactoryFlows.checkoutAndLoadFlowByFlowNameAsync)
      .not.toHaveBeenCalled();
  });

  it('throws a clear error when the flow does not exist', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const scripting = makeScripting({});
    const platformClient = makePlatformClient({});
    await expect(snapshotFlows(scripting, ['NoSuchFlow'], 'label', platformClient))
      .rejects.toThrow('Flow "NoSuchFlow" not found');
  });
});
