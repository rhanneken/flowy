import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import chalk from 'chalk';
import { createRedactor, installSdkLogging } from '../src/sdkLogging.js';

// Minimal stand-in for the SDK: captures the registered logging callback so a
// test can invoke it the way the SDK would. authToken is what the session
// reports as its access token (undefined before login, as in the real SDK).
function makeScripting({ authToken } = {}) {
  const archLogging = {
    hook: null,
    setLoggingCallback: vi.fn((cb) => { archLogging.hook = cb; }),
  };
  return {
    environment: { archSession: { authToken } },
    services: { archLogging },
  };
}

// chalk emits no colour codes in the test worker (not a TTY). Tests that
// assert on colour turn it on; this puts it back.
const defaultChalkLevel = chalk.level;

afterEach(() => {
  vi.restoreAllMocks();
  chalk.level = defaultChalkLevel;
});

describe('createRedactor', () => {
  it('redacts the client secret from the SDK session-start note', () => {
    const redact = createRedactor(['s3cr3t-value']);
    const note = "- core environment configuration.  env: 'prod', clientId: 'abc', " +
      "clientSecret: 's3cr3t-value', isClientCredentialsOAuthClient: 'true'.";

    expect(redact(note)).toBe(
      "- core environment configuration.  env: 'prod', clientId: 'abc', " +
      "clientSecret: '[REDACTED]', isClientCredentialsOAuthClient: 'true'.",
    );
  });

  it('redacts the access token from the SDK login note', () => {
    const redact = createRedactor([]);
    expect(redact("- setting auth token 'tok-abc123'.")).toBe("- setting auth token '[REDACTED]'.");
  });

  it('redacts the auth token from the startWithAuthToken session-start note', () => {
    const redact = createRedactor([]);
    expect(redact("- core environment configuration.  env: 'prod', authToken: 'tok-abc123'."))
      .toBe("- core environment configuration.  env: 'prod', authToken: '[REDACTED]'.");
  });

  it('redacts a known secret wherever it appears, even outside a recognised note', () => {
    const redact = createRedactor(['s3cr3t-value']);
    expect(redact('request failed: body={"client_secret":"s3cr3t-value"} s3cr3t-value'))
      .toBe('request failed: body={"client_secret":"[REDACTED]"} [REDACTED]');
  });

  it('redacts a clientSecret note even when the secret was not supplied', () => {
    const redact = createRedactor([]);
    expect(redact("clientId: 'abc', clientSecret: 'whatever'")).toBe("clientId: 'abc', clientSecret: '[REDACTED]'");
  });

  it('redacts the access token from a logged OAuth response body', () => {
    const redact = createRedactor([]);
    expect(redact('- response body - {"access_token":"tok-abc123","token_type":"bearer"}.'))
      .toBe('- response body - {"access_token":"[REDACTED]","token_type":"bearer"}.');
    expect(redact('{ "access_token" : "tok-abc123" }')).toBe('{ "access_token" : "[REDACTED]" }');
  });

  it('redacts every occurrence when a message carries a credential note twice', () => {
    const redact = createRedactor([]);
    expect(redact("setting auth token 'tok-1'. setting auth token 'tok-2'."))
      .toBe("setting auth token '[REDACTED]'. setting auth token '[REDACTED]'.");
  });

  it('removes the longer secret whole when one known secret contains another', () => {
    const redact = createRedactor(['abc', 'abcdef']);
    expect(redact('value abcdef here')).toBe('value [REDACTED] here');
  });

  it('still redacts the token when a known secret is a word in the SDK note itself', () => {
    const redact = createRedactor(['token']);
    expect(redact("- setting auth token 'tok-abc123'.")).not.toContain('tok-abc123');
  });

  it('ignores empty and non-string secrets', () => {
    const redact = createRedactor(['', undefined, null]);
    expect(redact('value is null or undefined')).toBe('value is null or undefined');
  });

  it('leaves ordinary messages untouched', () => {
    const redact = createRedactor(['s3cr3t-value']);
    expect(redact("- Flow 'Main IVR' checked out.")).toBe("- Flow 'Main IVR' checked out.");
  });

  it('coerces non-string input to a string', () => {
    const redact = createRedactor([]);
    expect(redact(undefined)).toBe('undefined');
  });
});

describe('installSdkLogging', () => {
  it('registers a callback that returns true so the SDK skips its own console output', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const scripting = makeScripting();

    installSdkLogging(scripting, ['s3cr3t-value']);

    expect(scripting.services.archLogging.setLoggingCallback).toHaveBeenCalledTimes(1);
    expect(scripting.services.archLogging.hook({ logType: 'info', messageFull: '- a note.' })).toBe(true);
  });

  it('prints notes to console.log with credentials redacted', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const scripting = makeScripting();
    installSdkLogging(scripting, ['s3cr3t-value']);

    scripting.services.archLogging.hook({
      logType: 'info',
      messageFull: "- clientId: 'abc', clientSecret: 's3cr3t-value'.",
    });

    expect(logSpy).toHaveBeenCalledWith("- clientId: 'abc', clientSecret: '[REDACTED]'.");
  });

  it('rejects secrets that are not an array', () => {
    expect(() => installSdkLogging(makeScripting(), 's3cr3t-value')).toThrow(TypeError);
    expect(() => installSdkLogging(makeScripting(), null)).toThrow(TypeError);
  });

  it('prints warnings in yellow and errors in red through console.log, as the SDK does, redacted', () => {
    chalk.level = 1;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const scripting = makeScripting();
    installSdkLogging(scripting, ['s3cr3t-value']);

    scripting.services.archLogging.hook({ logType: 'warning', messageFull: '- WARNING! s3cr3t-value.' });
    scripting.services.archLogging.hook({ logType: 'error', messageFull: '- ERROR! s3cr3t-value.' });

    expect(logSpy).toHaveBeenNthCalledWith(1, '\u001b[33m- WARNING! [REDACTED].\u001b[39m');
    expect(logSpy).toHaveBeenNthCalledWith(2, '\u001b[31m- ERROR! [REDACTED].\u001b[39m');
  });

  it('redacts the live session token from a message of any shape', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const scripting = makeScripting();
    installSdkLogging(scripting, []);

    // The SDK only holds a token after login, which happens after install.
    scripting.environment.archSession.authToken = 'tok-live-xyz';
    scripting.services.archLogging.hook({ logType: 'info', messageFull: '- request header Authorization=bearer tok-live-xyz.' });

    expect(logSpy).toHaveBeenCalledWith('- request header Authorization=bearer [REDACTED].');
  });

  it('still redacts when the session token cannot be read', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const scripting = makeScripting();
    delete scripting.environment;
    installSdkLogging(scripting, ['s3cr3t-value']);

    expect(scripting.services.archLogging.hook({ logType: 'info', messageFull: '- s3cr3t-value.' })).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('- [REDACTED].');
  });

  it('collects redacted, uncoloured error messages in the returned errors array', () => {
    chalk.level = 1;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const scripting = makeScripting();
    const { errors } = installSdkLogging(scripting, ['s3cr3t-value']);

    scripting.services.archLogging.hook({ logType: 'info', messageFull: '- a note.' });
    scripting.services.archLogging.hook({ logType: 'error', messageFull: '- ERROR! bad s3cr3t-value.' });

    expect(errors).toEqual(['- ERROR! bad [REDACTED].']);
  });

  it('still returns true when printing throws, so the SDK never falls back to raw output', () => {
    vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('EPIPE'); });
    const scripting = makeScripting();
    installSdkLogging(scripting, ['s3cr3t-value']);

    expect(scripting.services.archLogging.hook({ logType: 'info', messageFull: '- a note.' })).toBe(true);
  });

  it('still returns true when the SDK passes something that is not a log item', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const scripting = makeScripting();
    installSdkLogging(scripting, ['s3cr3t-value']);

    expect(scripting.services.archLogging.hook(undefined)).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

// These run against the real SDK (no network: nothing here starts a session)
// to pin down what flowy depends on: that a callback returning true suppresses
// the SDK's own console output, and that the SDK still words its credential
// notes the way the redaction patterns expect. If an SDK upgrade changes
// either, these fail.
//
// Loading the SDK prints two lines, defines a handful of globals, and leaves
// flowy's callback on the SDK's singleton archLogging. That is contained by
// Vitest's default per-file isolation.
describe('installSdkLogging against the real Architect Scripting SDK', () => {
  async function loadSdk() {
    const mod = await import('purecloud-flow-scripting-api-sdk-javascript');
    return mod.default || mod;
  }

  function printed(...spies) {
    return spies.flatMap((spy) => spy.mock.calls).map((args) => args.join(' ')).join('\n');
  }

  it('control: the SDK prints a note itself when the callback does not return true', async () => {
    const scripting = await loadSdk();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    scripting.services.archLogging.setLoggingCallback(() => {});
    scripting.services.archLogging.logNote("setting auth token 'tok-abc123'");

    expect(printed(logSpy)).toContain('tok-abc123');
  });

  it('control: the SDK prints a note itself when the callback throws', async () => {
    const scripting = await loadSdk();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    scripting.services.archLogging.setLoggingCallback(() => { throw new Error('callback blew up'); });
    scripting.services.archLogging.logNote("setting auth token 'tok-abc123'");

    expect(printed(logSpy)).toContain('tok-abc123');
  });

  // The access token is unknown to flowy when the SDK first logs it, so that
  // note is caught only by its wording. If this fails after an SDK upgrade,
  // the SDK has changed how (or whether) it logs credentials: re-check
  // CREDENTIAL_PATTERNS in src/sdkLogging.js against the new bundle.
  it('still words its credential notes the way the redaction patterns expect', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('purecloud-flow-scripting-api-sdk-javascript'), 'utf8');

    expect(bundle).toContain("setting auth token '");
    expect(bundle).toContain("clientSecret: '");
    expect(bundle).toContain("authToken: '");
  });

  it('prints SDK notes redacted and stops the SDK printing them raw', async () => {
    const scripting = await loadSdk();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    installSdkLogging(scripting, ['s3cr3t-value']);
    scripting.services.archLogging.logNote("clientId: 'abc', clientSecret: 's3cr3t-value'");
    scripting.services.archLogging.logNote("setting auth token 'tok-abc123'");
    scripting.services.archLogging.logWarning('careful with s3cr3t-value');
    scripting.services.archLogging.logError('failed with s3cr3t-value');

    const all = printed(logSpy);
    expect(all).not.toContain('s3cr3t-value');
    expect(all).not.toContain('tok-abc123');
    expect(all).toContain("clientSecret: '[REDACTED]'");
    expect(all).toContain("setting auth token '[REDACTED]'");
    expect(all).toContain('careful with [REDACTED]');
    expect(all).toContain('failed with [REDACTED]');
  });
});
