'use strict';

const { mkdirSync, readdirSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const { loadConfig } = require('../config');

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

const TS_TEMPLATE = (version, description) => `export default {
  description: ${JSON.stringify(description)},

  // Optional: list flow names to check in before up() runs (pre-migration snapshot).
  // flows: ['MyFlow'],

  async up(scripting: any, platformClient: any): Promise<void> {
    // const flows = scripting.factories.archFactoryFlows;
    // const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('MyFlow', 'inboundcall');
    // ... make changes ...
    // await flow.publishAsync();  // validate, save, and publish (releases lock)
    // -- OR (to save a checkpoint without publishing) --
    // await flow.checkInAsync();  // check in only (releases lock)
  },

  // async down(scripting: any, platformClient: any): Promise<void> {
  //   // Optional rollback logic.
  // },
};
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
  const ext = options.ts ? 'ts' : 'js';
  const filename = `${version}__${slug}.${ext}`;
  const filePath = join(config.migrationsDir, filename);

  const template = options.ts ? TS_TEMPLATE(version, description) : JS_TEMPLATE(version, description);
  writeFileSync(filePath, template, 'utf8');
  console.log(`Created ${filePath}`);
};
