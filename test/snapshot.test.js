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

/**
 * @param {Record<string, { locked?: boolean }>} flowsByName
 *   Pass `{ locked: true }` to simulate a flow that is currently checked out
 *   (has a draft). Pass `{}` or `{ locked: false }` for a cleanly checked-in flow.
 */
function makePlatformClient(flowsByName = {}) {
  return {
    ArchitectApi: vi.fn(() => ({
      getFlows: vi.fn(async ({ name }) => {
        if (!flowsByName[name]) return { entities: [] };
        const locked = flowsByName[name].locked ?? false;
        return {
          entities: [{
            name,
            type: 'INBOUNDCALL',
            // Simulate the Platform API lock fields.  A locked flow has a
            // lockedClient entry; an already-checked-in flow has neither.
            ...(locked ? { lockedClient: { id: 'some-client-id' } } : {}),
          }],
        };
      }),
    })),
  };
}

describe('snapshotFlows', () => {
  it('checks out and checks in a flow that is currently locked (has a draft)', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const flow = { checkInAsync: vi.fn(async () => {}) };
    const scripting = makeScripting({ MainInbound: flow });
    const platformClient = makePlatformClient({ MainInbound: { locked: true } });
    await snapshotFlows(scripting, ['MainInbound'], platformClient);
    expect(scripting.factories.archFactoryFlows.checkoutAndLoadFlowByFlowNameAsync)
      .toHaveBeenCalledWith('MainInbound', 'inboundcall');
    expect(flow.checkInAsync).toHaveBeenCalledWith();
  });

  it('skips checkout when the flow is already checked in (no draft)', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const scripting = makeScripting({ MainInbound: {} });
    const platformClient = makePlatformClient({ MainInbound: { locked: false } });
    await snapshotFlows(scripting, ['MainInbound'], platformClient);
    expect(scripting.factories.archFactoryFlows.checkoutAndLoadFlowByFlowNameAsync)
      .not.toHaveBeenCalled();
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
