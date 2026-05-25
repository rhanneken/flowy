'use strict';

const { loadConfig } = require('../config');
const { authenticatePlatformClient } = require('../gcAuth');
const exitCodes = require('../exitCodes');

module.exports = async function unlock(flowName, options) {
  let config;
  try {
    config = loadConfig(process.cwd(), options.env || null);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.CONFIG_ERROR);
  }

  let platformClient;
  try {
    platformClient = await authenticatePlatformClient(config.env);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? exitCodes.MIGRATION_FAILED);
  }

  const api = new platformClient.ArchitectApi();

  // Look up the flow by name to get its ID
  let flowId;
  try {
    const result = await api.getFlows({ name: flowName });
    const match = (result.entities || []).find((f) => f.name === flowName);
    if (!match) {
      console.error(`Flow "${flowName}" not found.`);
      process.exit(exitCodes.CONFIG_ERROR);
    }
    flowId = match.id;
  } catch (err) {
    const msg = (err.body && (err.body.message || err.body.error)) || err.message || JSON.stringify(err);
    console.error(`Failed to look up flow "${flowName}": ${msg}`);
    process.exit(exitCodes.MIGRATION_FAILED);
  }

  // Force-unlock the flow.
  // Note: postFlowsActionsUnlock requires Architect Admin permissions.
  try {
    await api.postFlowsActionsUnlock(flowId);
    console.log(`Unlocked "${flowName}".`);
  } catch (err) {
    const msg = (err.body && (err.body.message || err.body.error)) || err.message || JSON.stringify(err);
    console.error(`Failed to unlock "${flowName}": ${msg}`);
    if (/permission|admin|forbidden|unauthorized/i.test(msg)) {
      console.error('Note: force-unlocking a flow requires Architect Admin permissions.');
    }
    process.exit(exitCodes.MIGRATION_FAILED);
  }

  process.exit(exitCodes.SUCCESS);
};
