import { describe, it, expect } from 'vitest';
import { computeChecksum } from '../src/checksum.js';
import { writeFileSync, unlinkSync, mkdtempSync, mkdirSync, rmSync, renameSync } from 'fs';
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

describe('computeChecksum (directory)', () => {
  it('returns a 64-character hex string for a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const result = await computeChecksum(dir);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
    rmSync(dir, { recursive: true });
  });

  it('returns the same checksum for identical directory contents', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir1, 'index.js'), 'const x = 1;');
    writeFileSync(join(dir2, 'index.js'), 'const x = 1;');
    const [a, b] = await Promise.all([computeChecksum(dir1), computeChecksum(dir2)]);
    expect(a).toBe(b);
    rmSync(dir1, { recursive: true });
    rmSync(dir2, { recursive: true });
  });

  it('returns a different checksum when a file content changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'const x = 1;');
    const before = await computeChecksum(dir);
    writeFileSync(join(dir, 'index.js'), 'const x = 2;');
    const after = await computeChecksum(dir);
    expect(before).not.toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('returns a different checksum when a file is added', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'const x = 1;');
    const before = await computeChecksum(dir);
    writeFileSync(join(dir, 'audio.wav'), 'fake-audio-data');
    const after = await computeChecksum(dir);
    expect(before).not.toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('returns a different checksum when a file is renamed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'helper.js'), 'const x = 1;');
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const before = await computeChecksum(dir);
    renameSync(join(dir, 'helper.js'), join(dir, 'renamed.js'));
    const after = await computeChecksum(dir);
    expect(before).not.toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('produces the same checksum whether params.js is present or absent', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir1, 'index.js'), 'module.exports = {};');
    writeFileSync(join(dir2, 'index.js'), 'module.exports = {};');
    writeFileSync(join(dir1, 'params.js'), `module.exports = { sandbox: { phone: '+1555' } };`);
    // dir2 has no params.js

    const [a, b] = await Promise.all([computeChecksum(dir1), computeChecksum(dir2)]);
    expect(a).toBe(b);

    rmSync(dir1, { recursive: true });
    rmSync(dir2, { recursive: true });
  });

  it('handles subdirectories recursively', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    mkdirSync(join(dir, 'helpers'));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    writeFileSync(join(dir, 'helpers', 'util.js'), 'const x = 1;');
    const before = await computeChecksum(dir);
    writeFileSync(join(dir, 'helpers', 'util.js'), 'const x = 2;');
    const after = await computeChecksum(dir);
    expect(before).not.toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('ignores .DS_Store files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const before = await computeChecksum(dir);
    writeFileSync(join(dir, '.DS_Store'), 'mac-finder-metadata');
    const after = await computeChecksum(dir);
    expect(before).toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('ignores AppleDouble ._* files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const before = await computeChecksum(dir);
    writeFileSync(join(dir, '._index.js'), 'apple-double-resource-fork');
    const after = await computeChecksum(dir);
    expect(before).toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('ignores Thumbs.db files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const before = await computeChecksum(dir);
    writeFileSync(join(dir, 'Thumbs.db'), 'windows-thumbnail-cache');
    const after = await computeChecksum(dir);
    expect(before).toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('ignores desktop.ini files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const before = await computeChecksum(dir);
    writeFileSync(join(dir, 'desktop.ini'), '[.ShellClassInfo]');
    const after = await computeChecksum(dir);
    expect(before).toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('ignores .Spotlight-V100 directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const before = await computeChecksum(dir);
    mkdirSync(join(dir, '.Spotlight-V100'));
    writeFileSync(join(dir, '.Spotlight-V100', 'store.db'), 'spotlight-index-data');
    const after = await computeChecksum(dir);
    expect(before).toBe(after);
    rmSync(dir, { recursive: true });
  });

  it('ignores .Trashes directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowy-dir-'));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
    const before = await computeChecksum(dir);
    mkdirSync(join(dir, '.Trashes'));
    writeFileSync(join(dir, '.Trashes', 'deleted-file.js'), 'trashed-content');
    const after = await computeChecksum(dir);
    expect(before).toBe(after);
    rmSync(dir, { recursive: true });
  });
});
