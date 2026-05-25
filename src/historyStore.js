'use strict';

const { HISTORY_STORE_ERROR } = require('./exitCodes');
const { FlowyCLIError } = require('./config');

const TABLE_NAME = '_flowy_migrations';

const TABLE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['key', 'description', 'filename', 'checksum', 'appliedAt', 'appliedBy', 'executionTime', 'status'],
  properties: {
    key:           { type: 'string',  title: 'key' },
    description:   { type: 'string',  title: 'description' },
    filename:      { type: 'string',  title: 'filename' },
    checksum:      { type: 'string',  title: 'checksum' },
    appliedAt:     { type: 'string',  title: 'appliedAt' },
    appliedBy:     { type: 'string',  title: 'appliedBy' },
    executionTime: { type: 'integer', title: 'executionTime' },
    status:        { type: 'string',  title: 'status' },
    error:         { type: 'string',  title: 'error' },
  },
};

// Cache the table ID after first lookup so we don't list tables on every call
let cachedTableId = null;

/**
 * Reset the cached table ID (used between test runs).
 */
function resetCache() {
  cachedTableId = null;
}

/**
 * Get or create the _flowy_migrations Data Table.
 * Returns the table ID.
 * @param {object} platformClient
 * @returns {Promise<string>} tableId
 */
async function ensureTable(platformClient) {
  if (cachedTableId) return cachedTableId;

  const api = new platformClient.ArchitectApi();

  try {
    const result = await api.getFlowsDatatables();
    const existing = (result.entities || []).find((t) => t.name === TABLE_NAME);

    if (existing) {
      cachedTableId = existing.id;
      return cachedTableId;
    }

    const created = await api.postFlowsDatatables({
      name: TABLE_NAME,
      schema: TABLE_SCHEMA,
    });
    cachedTableId = created.id;
    return cachedTableId;
  } catch (err) {
    if (err.exitCode) throw err;
    throw new FlowyCLIError(
      `Failed to access or create the ${TABLE_NAME} Data Table: ${err.message}\n` +
      'Ensure the OAuth client has the "architect" scope and Data Tables permissions.',
      HISTORY_STORE_ERROR
    );
  }
}

/**
 * Get a single row by key, or null if it doesn't exist.
 * @param {object} platformClient
 * @param {string} version  e.g. 'V001'
 * @returns {Promise<object|null>}
 */
async function getRow(platformClient, version) {
  const rows = await getAllRows(platformClient);
  return rows.find((r) => r.key === version) || null;
}

/**
 * Record a migration entry (insert or update).
 * @param {object} platformClient
 * @param {object} entry  { key, description, filename, checksum, appliedAt, appliedBy, executionTime, status, error? }
 */
async function record(platformClient, entry) {
  const tableId = await ensureTable(platformClient);
  const api = new platformClient.ArchitectApi();
  const existing = await getRow(platformClient, entry.key);
  if (existing) {
    await api.putFlowsDatatableRow(tableId, entry.key, { body: entry });
  } else {
    await api.postFlowsDatatableRows(tableId, entry);
  }
}

/**
 * Update the status (and optionally other fields) of an existing record.
 * @param {object} platformClient
 * @param {string} version  e.g. 'V001'
 * @param {string} status
 * @param {object} [extra]  additional fields to merge
 */
async function updateStatus(platformClient, version, status, extra = {}) {
  const tableId = await ensureTable(platformClient);
  const api = new platformClient.ArchitectApi();
  await api.putFlowsDatatableRow(tableId, version, { body: { status, ...extra } });
}

/**
 * Get all rows from the history table (handles pagination).
 * @param {object} platformClient
 * @returns {Promise<object[]>}
 */
async function getAllRows(platformClient) {
  const tableId = await ensureTable(platformClient);
  const api = new platformClient.ArchitectApi();
  const allEntities = [];
  let pageNumber = 1;
  while (true) {
    const result = await api.getFlowsDatatableRows(tableId, { pageSize: 100, pageNumber });
    const entities = result.entities || [];
    allEntities.push(...entities);
    if (!result.pageCount || pageNumber >= result.pageCount) break;
    pageNumber++;
  }
  return allEntities;
}

/**
 * Returns a Set of version strings that have been successfully applied.
 * @param {object} platformClient
 * @returns {Promise<Set<string>>}
 */
async function getAppliedVersions(platformClient) {
  const rows = await getAllRows(platformClient);
  return new Set(
    rows.filter((r) => r.status === 'applied' || r.status === 'rolled_back').map((r) => r.key)
  );
}

/**
 * Returns a Map of version -> checksum for applied migrations.
 * @param {object} platformClient
 * @returns {Promise<Map<string, string>>}
 */
async function getStoredChecksums(platformClient) {
  const rows = await getAllRows(platformClient);
  const map = new Map();
  for (const row of rows) {
    if (row.status === 'applied' && row.checksum) {
      map.set(row.key, row.checksum);
    }
  }
  return map;
}

module.exports = {
  ensureTable,
  getRow,
  record,
  updateStatus,
  getAllRows,
  getAppliedVersions,
  getStoredChecksums,
  resetCache,
  TABLE_NAME,
};
