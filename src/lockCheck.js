'use strict';

/**
 * Look up a flow by exact name and type, paging through API results until found.
 * Returns the flow entity from the Platform API, or null if not found.
 *
 * @param {object} flowsApi  Instantiated ArchitectApi
 * @param {string} name      Exact flow name
 * @param {string} type      Flow type in any case (normalised to uppercase internally)
 * @returns {Promise<object|null>}
 */
async function findFlow(flowsApi, name, type) {
  const apiType = type.toUpperCase();
  let pageNumber = 1;
  while (true) {
    const results = await flowsApi.getFlows({ name, type: apiType, pageSize: 25, pageNumber });
    const match = (results.entities || []).find(
      (f) => f.name === name && f.type === apiType,
    );
    if (match) return match;
    if (pageNumber >= (results.pageCount || 1)) break;
    pageNumber++;
  }
  return null;
}

/**
 * Verify each listed flow is unlocked before a migration runs.
 * Throws if any flow is not found, locked by a user, or locked by a client.
 * An unlocked flow is guaranteed to have a clean draft — no action is needed.
 *
 * @param {Array<{name: string, type: string}>|null|undefined} flows
 * @param {object} platformClient  Authenticated purecloud-platform-client-v2 module
 */
async function verifyFlowsUnlocked(flows, platformClient) {
  if (!flows || flows.length === 0) return;

  const flowsApi = new platformClient.ArchitectApi();

  for (const entry of flows) {
    const flowInfo = await findFlow(flowsApi, entry.name, entry.type);
    if (!flowInfo) {
      throw new Error(
        `Flow "${entry.name}" (${entry.type}) not found. Remove it from the flows array ` +
        'or ensure it exists before running this migration.',
      );
    }

    if (flowInfo.lockedUser) {
      throw new Error(
        `Flow "${entry.name}" (${entry.type}) is locked by user ${flowInfo.lockedUser.name}. ` +
        'Ask them to check in or unlock the flow, then re-run the migration.',
      );
    }

    if (flowInfo.lockedClient) {
      throw new Error(
        `Flow "${entry.name}" (${entry.type}) is locked by a client credentials application. ` +
        'If this is from a previous failed migration run, use ' +
        `\`flowy unlock "${entry.name}"\` then \`flowy repair\` and \`flowy migrate\` to retry.`,
      );
    }

    // Not locked — Genesys Cloud guarantees the draft is clean. Nothing to do.
  }
}

module.exports = { verifyFlowsUnlocked };
