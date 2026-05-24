import { describe, it, expect } from 'vitest';
import { computeChecksum } from '../src/checksum.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('computeChecksum', () => {
  it('returns a 64-character hex string for a file', async () => {
    const file = join(tmpdir(), 'flowy-test-checksum.js');
    writeFileSync(file, 'module.exports = {};');
    const result = await computeChecksum(file);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
    unlinkSync(file);
  });

  it('returns the same checksum for the same content', async () => {
    const file1 = join(tmpdir(), 'flowy-cs1.js');
    const file2 = join(tmpdir(), 'flowy-cs2.js');
    writeFileSync(file1, 'const x = 1;');
    writeFileSync(file2, 'const x = 1;');
    const [a, b] = await Promise.all([computeChecksum(file1), computeChecksum(file2)]);
    expect(a).toBe(b);
    unlinkSync(file1);
    unlinkSync(file2);
  });

  it('returns different checksums for different content', async () => {
    const file1 = join(tmpdir(), 'flowy-cs3.js');
    const file2 = join(tmpdir(), 'flowy-cs4.js');
    writeFileSync(file1, 'const x = 1;');
    writeFileSync(file2, 'const x = 2;');
    const [a, b] = await Promise.all([computeChecksum(file1), computeChecksum(file2)]);
    expect(a).not.toBe(b);
    unlinkSync(file1);
    unlinkSync(file2);
  });
});
