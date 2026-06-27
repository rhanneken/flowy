'use strict';

const { createHash } = require('crypto');
const { createReadStream, readdirSync, statSync } = require('fs');
const { join, relative } = require('path');

async function computeFileChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'params.js') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

async function computeDirectoryChecksum(dirPath) {
  const files = collectFiles(dirPath).sort();
  const outer = createHash('sha256');
  for (const file of files) {
    outer.update(relative(dirPath, file));
    outer.update(await computeFileChecksum(file));
  }
  return outer.digest('hex');
}

/**
 * Compute a SHA-256 checksum of a file or directory.
 * For directories, all files are hashed recursively (sorted for determinism);
 * relative paths are included so renaming a file changes the digest.
 * @param {string} targetPath
 * @returns {Promise<string>} 64-character hex digest
 */
async function computeChecksum(targetPath) {
  if (statSync(targetPath).isDirectory()) {
    return computeDirectoryChecksum(targetPath);
  }
  return computeFileChecksum(targetPath);
}

module.exports = { computeChecksum };
