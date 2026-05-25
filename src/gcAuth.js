'use strict';

/**
 * Authenticate the Platform API Client singleton using client credentials.
 * Returns the authenticated platformClient module.
 * @param {{ clientId: string, clientSecret: string, region: string }} env
 * @returns {object} platformClient
 */
async function authenticatePlatformClient(env) {
  const platformClient = require('purecloud-platform-client-v2');
  platformClient.ApiClient.instance.setEnvironment(env.region);
  await platformClient.ApiClient.instance.loginClientCredentialsGrant(
    env.clientId,
    env.clientSecret,
  );
  return platformClient;
}

module.exports = { authenticatePlatformClient };
