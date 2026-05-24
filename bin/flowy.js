#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const program = new Command();

program
  .name('flowy')
  .description('Genesys Cloud flow migration tool')
  .version('0.1.0');

program
  .command('init')
  .description('Scaffold flowy.config.js in the current directory')
  .action(require('../src/commands/init'));

program
  .command('create <description>')
  .description('Create the next migration file')
  .option('--ts', 'create a TypeScript migration (.ts)')
  .action(require('../src/commands/create'));

program
  .command('migrate')
  .description('Apply all pending migrations')
  .option('--env <name>', 'target environment')
  .option('--target <version>', 'apply migrations up to and including this version')
  .option('--strict', 'fail on checksum mismatches instead of warning')
  .action(require('../src/commands/migrate'));

program
  .command('rollback')
  .description('Undo the last applied migration (requires down())')
  .option('--env <name>', 'target environment')
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
  .action(require('../src/commands/baseline'));

program.parse();
