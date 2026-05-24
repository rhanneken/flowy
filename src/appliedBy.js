'use strict';

const { userInfo } = require('os');

/**
 * Returns 'CI' when running in a CI environment, otherwise the OS username.
 * @returns {string}
 */
function getAppliedBy() {
  if (
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL
  ) {
    return 'CI';
  }
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

module.exports = { getAppliedBy };
