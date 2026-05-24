'use strict';

const { writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const TEMPLATE = `module.exports = {
  migrationsDir: './migrations',
  defaultEnvironment: 'dev',

  environments: {
    dev: {
      clientId: process.env.GC_CLIENT_ID,
      clientSecret: process.env.GC_CLIENT_SECRET,
      region: 'mypurecloud.com',
    },
    // prod: {
    //   clientId: process.env.GC_CLIENT_ID_PROD,
    //   clientSecret: process.env.GC_CLIENT_SECRET_PROD,
    //   region: 'mypurecloud.com',
    // },
  },
};
`;

module.exports = function init() {
  const configPath = join(process.cwd(), 'flowy.config.js');
  if (existsSync(configPath)) {
    console.log('flowy.config.js already exists. Nothing to do.');
    return;
  }
  writeFileSync(configPath, TEMPLATE, 'utf8');
  console.log('Created flowy.config.js');
  console.log('Add your credentials to .env:');
  console.log('  GC_CLIENT_ID=your-client-id');
  console.log('  GC_CLIENT_SECRET=your-client-secret');
};
