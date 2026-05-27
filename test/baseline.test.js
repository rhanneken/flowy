import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { selectForBaseline } = require('../src/commands/baseline.js');

function makeMigration(version) {
  return {
    version,
    filename: `${version}__desc.js`,
    filePath: `/fake/${version}__desc.js`,
    module: { description: 'desc' },
  };
}

describe('selectForBaseline', () => {
  const all = [makeMigration('V001'), makeMigration('V002'), makeMigration('V003')];

  it('returns all unrecorded migrations when no target is given', () => {
    const result = selectForBaseline(all, new Set(), undefined);
    expect(result.map((m) => m.version)).toEqual(['V001', 'V002', 'V003']);
  });

  it('returns only migrations up to and including the target', () => {
    const result = selectForBaseline(all, new Set(), 'V002');
    expect(result.map((m) => m.version)).toEqual(['V001', 'V002']);
  });

  it('excludes already-applied migrations', () => {
    const result = selectForBaseline(all, new Set(['V001']), undefined);
    expect(result.map((m) => m.version)).toEqual(['V002', 'V003']);
  });

  it('excludes already-applied migrations even with a target', () => {
    const result = selectForBaseline(all, new Set(['V001']), 'V002');
    expect(result.map((m) => m.version)).toEqual(['V002']);
  });

  it('returns an empty array when all migrations up to the target are already recorded', () => {
    const result = selectForBaseline(all, new Set(['V001', 'V002']), 'V002');
    expect(result).toHaveLength(0);
  });

  it('throws when the target version does not exist', () => {
    expect(() => selectForBaseline(all, new Set(), 'V999')).toThrow(
      'Target version "V999" not found in migrations directory.',
    );
  });
});
