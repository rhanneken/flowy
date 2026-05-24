import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test by pointing the loader at a temp directory
let testDir;

beforeEach(() => {
  testDir = join(tmpdir(), `flowy-config-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function loadConfig(dir, envName) {
  const { loadConfig } = await import('../src/config.js');
  return loadConfig(dir, envName);
}

describe('loadConfig', () => {
  it('loads a valid config and returns the selected environment', async () => {
    writeFileSync(
      join(testDir, 'flowy.config.js'),
      `module.exports = {
        migrationsDir: './migrations',
        defaultEnvironment: 'dev',
        environments: {
          dev: {
            clientId: 'id123',
            clientSecret: 'secret123',
            region: 'mypurecloud.com',
          }
        }
      };`
    );
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(testDir, 'dev');
    expect(config.env.clientId).toBe('id123');
    expect(config.env.region).toBe('mypurecloud.com');
    expect(config.migrationsDir).toBe(join(testDir, 'migrations'));
  });

  it('uses defaultEnvironment when no env is specified', async () => {
    writeFileSync(
      join(testDir, 'flowy.config.js'),
      `module.exports = {
        defaultEnvironment: 'staging',
        environments: {
          staging: { clientId: 'sid', clientSecret: 'ssecret', region: 'mypurecloud.ie' }
        }
      };`
    );
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig(testDir, null);
    expect(config.env.region).toBe('mypurecloud.ie');
  });

  it('throws a CONFIG_ERROR when flowy.config.js is missing', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { CONFIG_ERROR } = await import('../src/exitCodes.js');
    expect(() => loadConfig(testDir, 'dev')).toThrow(
      expect.objectContaining({ exitCode: CONFIG_ERROR })
    );
  });

  it('throws a CONFIG_ERROR when the requested environment does not exist', async () => {
    writeFileSync(
      join(testDir, 'flowy.config.js'),
      `module.exports = { defaultEnvironment: 'dev', environments: { dev: { clientId: 'x', clientSecret: 'y', region: 'z' } } };`
    );
    const { loadConfig } = await import('../src/config.js');
    const { CONFIG_ERROR } = await import('../src/exitCodes.js');
    expect(() => loadConfig(testDir, 'prod')).toThrow(
      expect.objectContaining({ exitCode: CONFIG_ERROR })
    );
  });

  it('throws a CONFIG_ERROR when an environment is missing required fields', async () => {
    writeFileSync(
      join(testDir, 'flowy.config.js'),
      `module.exports = { defaultEnvironment: 'dev', environments: { dev: { clientId: 'x' } } };`
    );
    const { loadConfig } = await import('../src/config.js');
    const { CONFIG_ERROR } = await import('../src/exitCodes.js');
    expect(() => loadConfig(testDir, 'dev')).toThrow(
      expect.objectContaining({ exitCode: CONFIG_ERROR })
    );
  });
});
