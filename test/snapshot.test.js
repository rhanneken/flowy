import { describe, it, expect, vi } from 'vitest';

function makeSession(flowsByName = {}) {
  const flows = {};
  for (const [name, flow] of Object.entries(flowsByName)) {
    flows[name] = flow;
  }
  return {
    flows: {
      getFlowByName: vi.fn(async (name) => {
        if (!flows[name]) throw new Error(`Flow "${name}" not found`);
        return flows[name];
      }),
    },
  };
}

describe('snapshotFlows', () => {
  it('calls checkIn on each declared flow', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const flow = { checkIn: vi.fn(async () => {}) };
    const session = makeSession({ MainInbound: flow });
    await snapshotFlows(session, ['MainInbound'], 'pre-migration-V001');
    expect(session.flows.getFlowByName).toHaveBeenCalledWith('MainInbound');
    expect(flow.checkIn).toHaveBeenCalledWith('pre-migration-V001');
  });

  it('does nothing when flows array is empty or absent', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const session = makeSession({});
    await snapshotFlows(session, [], 'label');
    await snapshotFlows(session, null, 'label');
    await snapshotFlows(session, undefined, 'label');
    expect(session.flows.getFlowByName).not.toHaveBeenCalled();
  });

  it('throws when checkIn fails (e.g. flow is locked)', async () => {
    const { snapshotFlows } = await import('../src/snapshot.js');
    const flow = { checkIn: vi.fn(async () => { throw new Error('Flow is checked out'); }) };
    const session = makeSession({ LockedFlow: flow });
    await expect(snapshotFlows(session, ['LockedFlow'], 'label'))
      .rejects.toThrow('Flow is checked out');
  });
});
