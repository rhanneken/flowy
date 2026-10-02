'use strict';

const chalk = require('chalk');

const REDACTED = '[REDACTED]';

// Notes the Architect Scripting SDK writes credentials into. The access token
// is minted by the SDK itself, so when it is first logged flowy does not know
// its value and can only recognise it by the shape of the note that carries it.
//   core environment configuration. ... clientSecret: '<secret>' ...
//   core environment configuration. ... authToken: '<token>'
//   setting auth token '<token>'
//   response body - {"access_token":"<token>", ...}
// The last one is the OAuth response, logged only when a migration turns on
// archLogging.logNetworkActivity.
const CREDENTIAL_PATTERNS = [
  /(clientSecret: ')[^']*(')/g,
  /(authToken: ')[^']*(')/g,
  /(auth token ')[^']*(')/g,
  /("access_token"\s*:\s*")[^"]*(")/g,
];

/**
 * Build a function that strips credentials from SDK log text.
 *
 * @param {string[]} secrets  Known secret values to remove wherever they appear
 * @returns {(text: any) => string}
 */
function createRedactor(secrets = []) {
  // Longest first, so a secret that contains another one is removed whole.
  const known = secrets
    .filter((s) => typeof s === 'string' && s !== '')
    .sort((a, b) => b.length - a.length);
  return function redact(text) {
    let out = String(text);
    // Patterns run first: they anchor on the SDK's own wording, which a
    // literal replacement could otherwise break up.
    for (const pattern of CREDENTIAL_PATTERNS) {
      out = out.replace(pattern, `$1${REDACTED}$2`);
    }
    for (const secret of known) {
      out = out.split(secret).join(REDACTED);
    }
    return out;
  };
}

// The access token of the running session, or undefined before login. Once
// the SDK holds a token, flowy can remove it by value from a message of any
// shape instead of relying on the patterns above.
function sessionToken(scripting) {
  try {
    return scripting.environment.archSession.authToken;
  } catch {
    return undefined;
  }
}

/**
 * Take over the Architect Scripting SDK's console output so credentials never
 * reach the terminal. The SDK skips its own console logging only when the
 * callback returns exactly `true`, so flowy prints each message itself after
 * redacting it, the same way the SDK would: everything through console.log,
 * warnings in yellow and errors in red.
 *
 * Must be called before archSession.startWith*(): the SDK logs the client
 * secret and access token during session start.
 *
 * @param {object} scripting  The purecloud-flow-scripting-api-sdk-javascript module
 * @param {string[]} secrets  Known secret values (e.g. the OAuth client secret)
 * @returns {{ errors: string[] }}  errors collects every redacted SDK error message
 */
function installSdkLogging(scripting, secrets = []) {
  // Fail loudly here rather than inside the callback, where an error would
  // silently drop every SDK message.
  if (!Array.isArray(secrets)) {
    throw new TypeError('installSdkLogging: secrets must be an array');
  }
  const errors = [];

  scripting.services.archLogging.setLoggingCallback((logItem) => {
    // Never let this throw or return anything but true: the SDK treats both as
    // "not handled" and prints the original, unredacted message.
    try {
      const redact = createRedactor([...secrets, sessionToken(scripting)]);
      const message = redact(logItem.messageFull);
      if (logItem.logType === 'error') {
        errors.push(message);
        console.log(chalk.red(message));
      } else if (logItem.logType === 'warning') {
        console.log(chalk.yellow(message));
      } else {
        console.log(message);
      }
    } catch {
      // Dropping a log line is better than leaking a credential.
    }
    return true;
  });

  return { errors };
}

module.exports = { createRedactor, installSdkLogging };
