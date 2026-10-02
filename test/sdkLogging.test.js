import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRedactor, installSdkLogging } from '../src/sdkLogging.js';

// Minimal stand-in for the SDK's archLogging service: captures the registered
// callback so a test can invoke it the way the SDK would.
function makeScripting() {
  const archLogging = {
    hook: null,
    setLoggingCallback: vi.fn((cb) => { archLogging.hook = cb; }),
  };
  return { services: { archLogging } };
}

afterEach(() => {
  vi.restoreAllMocks();
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

  it('ignores empty and non-string secrets', () => {
    const redact = createRedactor(['', undefined, null]);
    expect(redact('nothing to see here')).toBe('nothing to see here');
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

  it('prints warnings to console.warn and errors to console.error, redacted', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scripting = makeScripting();
    installSdkLogging(scripting, ['s3cr3t-value']);

    scripting.services.archLogging.hook({ logType: 'warning', messageFull: '- WARNING! s3cr3t-value.' });
    scripting.services.archLogging.hook({ logType: 'error', messageFull: '- ERROR! s3cr3t-value.' });

    expect(warnSpy).toHaveBeenCalledWith('- WARNING! [REDACTED].');
    expect(errSpy).toHaveBeenCalledWith('- ERROR! [REDACTED].');
  });

  it('collects redacted error messages in the returned errors array', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
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
});

// These run against the real SDK (no network: nothing here starts a session)
// to pin down the contract flowy depends on. If an SDK upgrade changes how the
// logging callback suppresses console output, these fail.
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

  it('prints SDK notes redacted and stops the SDK printing them raw', async () => {
    const scripting = await loadSdk();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    installSdkLogging(scripting, ['s3cr3t-value']);
    scripting.services.archLogging.logNote("clientId: 'abc', clientSecret: 's3cr3t-value'");
    scripting.services.archLogging.logNote("setting auth token 'tok-abc123'");
    scripting.services.archLogging.logWarning('careful with s3cr3t-value');
    scripting.services.archLogging.logError('failed with s3cr3t-value');

    const all = printed(logSpy, warnSpy, errSpy);
    expect(all).not.toContain('s3cr3t-value');
    expect(all).not.toContain('tok-abc123');
    expect(all).toContain("clientSecret: '[REDACTED]'");
    expect(all).toContain("setting auth token '[REDACTED]'");
    expect(printed(warnSpy)).toContain('careful with [REDACTED]');
    expect(printed(errSpy)).toContain('failed with [REDACTED]');
  });
});
