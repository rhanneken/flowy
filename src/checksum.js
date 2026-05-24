'use strict';

const { createHash } = require('crypto');
const { createReadStream } = require('fs');

/**
 * Compute a SHA-256 checksum of a file.
 * @param {string} filePath
 * @returns {Promise<string>} 64-character hex digest
 */
async function computeChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { computeChecksum };
