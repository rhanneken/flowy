'use strict';

const { mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');
const { loadConfig } = require('../config');

/**
 * Format a Date as a 14-character YYYYMMDDHHMMSS string for use as a migration version.
 * @param {Date} d
 * @returns {string}
 */
function formatTimestamp(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('');
}

const JS_TEMPLATE = (version, description) => `'use strict';

module.exports = {
  description: ${JSON.stringify(description)},

  // Optional: list flow names to check in before up() runs (pre-migration snapshot).
  // flows: ['MyFlow'],

  async up(scripting, platformClient) {
    // const flows = scripting.factories.archFactoryFlows;
    // const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('MyFlow', 'inboundcall');
    // ... make changes ...
    // await flow.publishAsync();  // validate, save, and publish (releases lock)
    // -- OR (to save a checkpoint without publishing) --
    // await flow.checkInAsync();  // check in only (releases lock)
  },

  // async down(scripting, platformClient) {
  //   // Optional rollback logic.
  // },
};
`;

const TS_TEMPLATE = (version, description) => `import type { FlowMigration } from '@rhanneken/flowy/types/FlowMigration';
import type { ArchitectScripting } from 'purecloud-flow-scripting-api-sdk-javascript';

const migration: FlowMigration = {
  description: ${JSON.stringify(description)},

  // Optional: list flow names to check in before up() runs (pre-migration snapshot).
  // flows: ['MyFlow'],

  async up(scripting: ArchitectScripting, platformClient: any): Promise<void> {
    // const flows = scripting.factories.archFactoryFlows;
    // const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('MyFlow', 'inboundcall');
    // ... make changes ...
    // await flow.publishAsync();  // validate, save, and publish (releases lock)
    // -- OR (to save a checkpoint without publishing) --
    // await flow.checkInAsync();  // check in only (releases lock)
  },

  // async down(scripting: ArchitectScripting, platformClient: any): Promise<void> {
  //   // Optional rollback logic.
  // },
};

export default migration;
`;

module.exports = function create(description, options) {
  let config;
  try {
    config = loadConfig(process.cwd(), null);
  } catch {
    // Use default if no config yet
    config = { migrationsDir: join(process.cwd(), 'migrations') };
  }

  mkdirSync(config.migrationsDir, { recursive: true });

  const version = formatTimestamp(new Date());
  const slug = description.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const ext = options.ts ? 'ts' : 'js';
  const filename = `${version}_${slug}.${ext}`;
  const filePath = join(config.migrationsDir, filename);

  const template = options.ts ? TS_TEMPLATE(version, description) : JS_TEMPLATE(version, description);
  writeFileSync(filePath, template, 'utf8');
  console.log(`Created ${filePath}`);
};
