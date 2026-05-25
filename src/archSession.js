'use strict';

const { FlowyCLIError } = require('./config');
const { CONFIG_ERROR } = require('./exitCodes');

/**
 * Resolve the Architect Scripting SDK location identifier (e.g. 'prod_us_west_2')
 * from the domain-based region in flowy.config.js (e.g. 'usw2.pure.cloud').
 *
 * The Architect Scripting SDK uses its own internal location identifiers that
 * differ from the Platform API Client's domain-based region format. We reverse-
 * lookup the correct identifier from the SDK's own _locations map.
 *
 * @param {string} region  e.g. 'usw2.pure.cloud'
 * @param {object} scripting  The purecloud-flow-scripting-api-sdk-javascript module
 * @returns {string} location identifier, e.g. 'prod_us_west_2'
 */
function resolveOrgLocation(region, scripting) {
  const locations = scripting.environment.archSession._locations || {};
  const entry = Object.entries(locations)
    .find(([, loc]) => loc.host === `apps.${region}`);

  if (!entry) {
    const valid = Object.values(locations)
      .map((loc) => loc.host.replace('apps.', ''))
      .filter((h) => !h.includes('inind') && !h.includes('inint')) // exclude dev/test
      .sort()
      .join('\n    ');
    throw new FlowyCLIError(
      `"${region}" is not a valid Genesys Cloud region.\n` +
      `Valid values for the region field in flowy.config.js:\n    ${valid}`,
      CONFIG_ERROR,
    );
  }

  return entry[0];
}

module.exports = { resolveOrgLocation };
