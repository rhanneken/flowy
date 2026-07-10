#!/usr/bin/env node
'use strict';

// global-agent doesn't set TLS servername for https.request() calls that omit
// `secureEndpoint` (e.g. the Architect Scripting SDK's raw requests), so the
// CONNECT-tunneled TLS handshake gets validated against the proxy's own
// hostname instead of the real target and fails with a cert altname mismatch.
// proxy-agent (https-proxy-agent under the hood) sets it correctly.
if (
  process.env.HTTP_PROXY || process.env.HTTPS_PROXY
  || process.env.http_proxy || process.env.https_proxy
  || process.env.GLOBAL_AGENT_HTTP_PROXY || process.env.GLOBAL_AGENT_HTTPS_PROXY
) {
  if (!process.env.HTTP_PROXY && !process.env.http_proxy && process.env.GLOBAL_AGENT_HTTP_PROXY) {
    process.env.HTTP_PROXY = process.env.GLOBAL_AGENT_HTTP_PROXY;
  }
  if (!process.env.HTTPS_PROXY && !process.env.https_proxy && process.env.GLOBAL_AGENT_HTTPS_PROXY) {
    process.env.HTTPS_PROXY = process.env.GLOBAL_AGENT_HTTPS_PROXY;
  }
  if (!process.env.NO_PROXY && !process.env.no_proxy && process.env.GLOBAL_AGENT_NO_PROXY) {
    process.env.NO_PROXY = process.env.GLOBAL_AGENT_NO_PROXY;
  }

  const { ProxyAgent } = require('proxy-agent');
  const proxyAgent = new ProxyAgent();
  require('http').globalAgent = proxyAgent;
  require('https').globalAgent = proxyAgent;
}

const { Command } = require('commander');
const program = new Command();

program
  .name('flowy')
  .description('Genesys Cloud flow migration tool')
  .version(require('../package.json').version);

program
  .command('init')
  .description('Scaffold flowy.config.js in the current directory')
  .action(require('../src/commands/init'));

program
  .command('create <description>')
  .description('Create the next migration file')
  .option('--ts', 'create a TypeScript migration (.ts)')
  .option('--dir', 'create a migration directory with an index.js entry point')
  .action(require('../src/commands/create'));

program
  .command('migrate')
  .description('Apply all pending migrations')
  .option('--env <name>', 'target environment')
  .option('--target <version>', 'apply migrations up to and including this version')
  .option('--strict', 'fail on checksum mismatches instead of warning')
  .option('--scratch <version>', 'apply a single migration without recording it (local iteration)')
  .action(require('../src/commands/migrate'));

program
  .command('rollback')
  .description('Undo the last applied migration (requires down())')
  .option('--env <name>', 'target environment')
  .option('--scratch <version>', "run a single migration's down() without recording it (local iteration)")
  .action(require('../src/commands/rollback'));

program
  .command('status')
  .description('List applied, pending, and failed migrations')
  .option('--env <name>', 'target environment')
  .action(require('../src/commands/status'));

program
  .command('validate')
  .description('Check for local issues: duplicate versions, missing exports')
  .action(require('../src/commands/validate'));

program
  .command('repair')
  .description('Fix history table problems (reset failed, update checksum, add missing entry)')
  .option('--env <name>', 'target environment')
  .action(require('../src/commands/repair'));

program
  .command('baseline')
  .description('Mark all existing migrations as applied without running them')
  .option('--env <name>', 'target environment')
  .option('--target <version>', 'baseline migrations up to and including this version')
  .action(require('../src/commands/baseline'));

program
  .command('unlock <flow-name>')
  .description('Force-unlock a flow left locked by a failed migration (requires Architect Admin)')
  .option('--env <name>', 'target environment')
  .action(require('../src/commands/unlock'));

program.parse();
