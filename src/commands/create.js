'use strict';

const { mkdirSync, readdirSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const { loadConfig } = require('../config');

const JS_FILE_TEMPLATE = (version, description) => `'use strict';

module.exports = {
  description: ${JSON.stringify(description)},

  // Optional: list flows to verify are unlocked before up() runs.
  // flows: [{ name: 'MyFlow', type: 'inboundcall' }],

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

const JS_DIR_TEMPLATE = (version, description) => `'use strict';

module.exports = {
  description: ${JSON.stringify(description)},

  // Optional: list flows to verify are unlocked before up() runs.
  // flows: [{ name: 'MyFlow', type: 'inboundcall' }],

  async up(scripting, platformClient, params) {
    // const flows = scripting.factories.archFactoryFlows;
    // const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('MyFlow', 'inboundcall');
    // ... make changes ...
    // await flow.publishAsync();  // validate, save, and publish (releases lock)
    // -- OR (to save a checkpoint without publishing) --
    // await flow.checkInAsync();  // check in only (releases lock)
  },

  // async down(scripting, platformClient, params) {
  //   // Optional rollback logic.
  // },
};
`;

const TS_FILE_TEMPLATE = (version, description) => `import type { FlowMigration } from '@rhanneken/flowy/types/FlowMigration';
import type { ArchitectScripting } from 'purecloud-flow-scripting-api-sdk-javascript';

const migration: FlowMigration = {
  description: ${JSON.stringify(description)},

  // Optional: list flows to verify are unlocked before up() runs.
  // flows: [{ name: 'MyFlow', type: 'inboundcall' }],

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

const TS_DIR_TEMPLATE = (version, description) => `import type { FlowMigration } from '@rhanneken/flowy/types/FlowMigration';
import type { ArchitectScripting } from 'purecloud-flow-scripting-api-sdk-javascript';

// Replace Record<string, unknown> with your params shape, e.g. { phoneNumber: string }
const migration: FlowMigration<Record<string, unknown>> = {
  description: ${JSON.stringify(description)},

  // Optional: list flows to verify are unlocked before up() runs.
  // flows: [{ name: 'MyFlow', type: 'inboundcall' }],

  async up(scripting: ArchitectScripting, platformClient: any, params): Promise<void> {
    // const flows = scripting.factories.archFactoryFlows;
    // const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('MyFlow', 'inboundcall');
    // ... make changes ...
    // await flow.publishAsync();  // validate, save, and publish (releases lock)
    // -- OR (to save a checkpoint without publishing) --
    // await flow.checkInAsync();  // check in only (releases lock)
  },

  // async down(scripting: ArchitectScripting, platformClient: any, params): Promise<void> {
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

  // Find the next version number
  const PATTERN = /^V(\d+)__/;
  const existing = existsSync(config.migrationsDir)
    ? readdirSync(config.migrationsDir).filter((f) => PATTERN.test(f))
    : [];
  const maxNum = existing.reduce((max, f) => {
    const [, n] = f.match(PATTERN);
    return Math.max(max, parseInt(n, 10));
  }, 0);
  const nextNum = String(maxNum + 1).padStart(3, '0');
  const version = `V${nextNum}`;

  const slug = description.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const template = options.dir
    ? (options.ts ? TS_DIR_TEMPLATE(version, description) : JS_DIR_TEMPLATE(version, description))
    : (options.ts ? TS_FILE_TEMPLATE(version, description) : JS_FILE_TEMPLATE(version, description));

  if (options.dir) {
    const dirPath = join(config.migrationsDir, `${version}__${slug}`);
    const entryFile = options.ts ? 'index.ts' : 'index.js';
    const filePath = join(dirPath, entryFile);
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(filePath, template, 'utf8');
    console.log(`Created ${filePath}`);
  } else {
    const ext = options.ts ? 'ts' : 'js';
    const filePath = join(config.migrationsDir, `${version}__${slug}.${ext}`);
    writeFileSync(filePath, template, 'utf8');
    console.log(`Created ${filePath}`);
  }
};
