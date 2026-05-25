'use strict';

/**
 * Check in each flow listed in the flows array before a migration runs,
 * but only if the flow currently has a draft (is locked/checked out).
 * If the flow is already cleanly checked in, its most recent checked-in
 * version already serves as the snapshot — no checkout+checkin needed.
 *
 * Uses the Platform Client API to discover each flow's type and lock state
 * (required by the Architect Scripting SDK), then conditionally checks the
 * flow out and back in to create a recoverable version.
 *
 * @param {object} scripting        The purecloud-flow-scripting-api-sdk-javascript module
 * @param {string[]|null|undefined} flows  Flow names to snapshot
 * @param {object} platformClient   Authenticated purecloud-platform-client-v2 module
 */
async function snapshotFlows(scripting, flows, platformClient) {
  if (!flows || flows.length === 0) return;

  const flowsApi = new platformClient.ArchitectApi();
  const archFactoryFlows = scripting.factories.archFactoryFlows;

  for (const flowName of flows) {
    // Discover the flow's type and current lock state via the Platform API.
    const results = await flowsApi.getFlows({ name: flowName });
    const flowInfo = (results.entities || []).find((f) => f.name === flowName);
    if (!flowInfo) {
      throw new Error(
        `Flow "${flowName}" not found. Cannot create pre-migration snapshot. ` +
        'Remove it from the flows array or ensure it exists before running this migration.',
      );
    }

    // If the flow is not checked out by anyone, the most recent checked-in
    // version is already a clean recovery point — skip the checkout+checkin.
    if (!flowInfo.lockedUser && !flowInfo.lockedClient) {
      continue;
    }

    // The flow has a draft (it is locked/checked out). Check it in now so
    // there is a recoverable snapshot before up() runs.
    // The Platform API returns flow types in uppercase (e.g. 'INBOUNDCALL'),
    // but the Architect Scripting SDK requires lowercase ('inboundcall').
    // checkInAsync() takes an optional boolean (ensureSearchable) — there is
    // no label/comment parameter.
    const flow = await archFactoryFlows.checkoutAndLoadFlowByFlowNameAsync(
      flowName,
      flowInfo.type.toLowerCase(),
    );
    await flow.checkInAsync();
  }
}

module.exports = { snapshotFlows };
