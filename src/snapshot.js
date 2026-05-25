'use strict';

/**
 * Check in each flow listed in the flows array before a migration runs.
 * This creates a recoverable snapshot in GC version history.
 *
 * Uses the Platform Client API to discover each flow's type (required by
 * the Architect Scripting SDK), then checks the flow out and checks it in.
 *
 * @param {object} scripting        The purecloud-flow-scripting-api-sdk-javascript module
 * @param {string[]|null|undefined} flows  Flow names to snapshot
 * @param {string} label            Check-in comment (e.g. 'pre-migration-V001')
 * @param {object} platformClient   Authenticated purecloud-platform-client-v2 module
 */
async function snapshotFlows(scripting, flows, label, platformClient) {
  if (!flows || flows.length === 0) return;

  const flowsApi = new platformClient.ArchitectApi();
  const archFactoryFlows = scripting.factories.archFactoryFlows;

  for (const flowName of flows) {
    // Discover the flow type via the Platform API (required by the Architect
    // Scripting SDK — it cannot load a flow by name without knowing its type).
    const results = await flowsApi.getFlows({ name: flowName });
    const flowInfo = (results.entities || []).find((f) => f.name === flowName);
    if (!flowInfo) {
      throw new Error(
        `Flow "${flowName}" not found. Cannot create pre-migration snapshot. ` +
        'Remove it from the flows array or ensure it exists before running this migration.',
      );
    }

    // Check out the flow and load it, then check it in to create the snapshot.
    // The Platform API returns flow types in uppercase (e.g. 'INBOUNDCALL'),
    // but the Architect Scripting SDK requires lowercase ('inboundcall').
    const flow = await archFactoryFlows.checkoutAndLoadFlowByFlowNameAsync(
      flowName,
      flowInfo.type.toLowerCase(),
    );
    await flow.checkInAsync(label);
  }
}

module.exports = { snapshotFlows };
