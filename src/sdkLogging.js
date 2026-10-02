'use strict';

const REDACTED = '[REDACTED]';

// Notes the Architect Scripting SDK writes credentials into. The access token
// is minted by the SDK itself, so flowy never knows its value and can only
// recognise it by the shape of the note that carries it.
//   core environment configuration. ... clientSecret: '<secret>' ...
//   core environment configuration. ... authToken: '<token>'
//   setting auth token '<token>'
const CREDENTIAL_PATTERNS = [
  /(clientSecret: ')[^']*(')/g,
  /(authToken: ')[^']*(')/g,
  /(auth token ')[^']*(')/g,
];

/**
 * Build a function that strips credentials from SDK log text.
 *
 * @param {string[]} secrets  Known secret values to remove wherever they appear
 * @returns {(text: any) => string}
 */
function createRedactor(secrets = []) {
  const known = secrets.filter((s) => typeof s === 'string' && s !== '');
  return function redact(text) {
    let out = String(text);
    for (const secret of known) {
      out = out.split(secret).join(REDACTED);
    }
    for (const pattern of CREDENTIAL_PATTERNS) {
      out = out.replace(pattern, `$1${REDACTED}$2`);
    }
    return out;
  };
}

/**
 * Take over the Architect Scripting SDK's console output so credentials never
 * reach the terminal. The SDK skips its own console logging only when the
 * callback returns exactly `true`, so flowy prints each message itself after
 * redacting it.
 *
 * Must be called before archSession.startWith*(): the SDK logs the client
 * secret and access token during session start.
 *
 * @param {object} scripting  The purecloud-flow-scripting-api-sdk-javascript module
 * @param {string[]} secrets  Known secret values (e.g. the OAuth client secret)
 * @returns {{ errors: string[] }}  errors collects every redacted SDK error message
 */
function installSdkLogging(scripting, secrets = []) {
  const redact = createRedactor(secrets);
  const errors = [];

  scripting.services.archLogging.setLoggingCallback((logItem) => {
    // Never let this throw or return anything but true: the SDK treats both as
    // "not handled" and prints the original, unredacted message.
    try {
      const message = redact(logItem.messageFull);
      if (logItem.logType === 'error') {
        errors.push(message);
        console.error(message);
      } else if (logItem.logType === 'warning') {
        console.warn(message);
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
