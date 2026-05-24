'use strict';

/**
 * Check in each flow listed in the flows array before a migration runs.
 * This creates a recoverable snapshot in GC version history.
 *
 * @param {object} architectSession  Raw Architect Scripting SDK session
 * @param {string[]|null|undefined} flows  Flow names to snapshot
 * @param {string} label  Check-in comment (e.g. 'pre-migration-V001')
 */
async function snapshotFlows(architectSession, flows, label) {
  if (!flows || flows.length === 0) return;

  for (const flowName of flows) {
    const flow = await architectSession.flows.getFlowByName(flowName);
    await flow.checkIn(label);
  }
}

module.exports = { snapshotFlows };
