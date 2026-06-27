// types/FlowMigration.d.ts
// TypeScript interface for flowy migration files.
// Import in your migration: import type { FlowMigration } from '@rhanneken/flowy/types/FlowMigration';

import type { ArchitectScripting } from 'purecloud-flow-scripting-api-sdk-javascript';

export interface FlowMigration<P extends object = Record<string, unknown>> {
  /** Human-readable description stored in migration history. */
  description: string;

  /**
   * Optional. Flows to verify are unlocked before up() runs. If any listed flow is locked
   * (by a user or a previous failed migration), flowy halts with a clear error.
   * If absent, no lock check is performed.
   */
  flows?: { name: string; type: string }[];

  /**
   * Apply the migration. Responsible for all flow modifications, check-in, and/or publishing.
   *
   * Call `publishAsync()` to validate, save, and publish a flow (releases the lock).
   * Call `checkInAsync()` instead if you want to save a checkpoint without publishing.
   * Do not call both in sequence — each one releases the lock.
   *
   * The migration is recorded as "applied" when this function returns without throwing.
   *
   * @param scripting        The purecloud-flow-scripting-api-sdk-javascript module,
   *                         authenticated and ready to use. Load flows via
   *                         scripting.factories.archFactoryFlows.
   * @param platformClient   The authenticated purecloud-platform-client-v2 module.
   *                         Typed as `any` because the SDK's TypeScript module declaration
   *                         does not export the API classes (e.g. ArchitectApi); only
   *                         ApiClient and PureCloudRegionHosts are in the module type.
   * @param params           Environment-specific parameters resolved from the migration's
   *                         params.js (directory migrations only). Undefined if params.js
   *                         is absent or does not define the active environment.
   */
  up(scripting: ArchitectScripting, platformClient: any, params?: P): Promise<void>;

  /**
   * Optional. Roll back the migration. Required for `flowy rollback` to work.
   *
   * @param scripting        The purecloud-flow-scripting-api-sdk-javascript module,
   *                         authenticated and ready to use.
   * @param platformClient   The authenticated purecloud-platform-client-v2 module.
   * @param params           Environment-specific parameters resolved from the migration's
   *                         params.js (directory migrations only). Undefined if params.js
   *                         is absent or does not define the active environment.
   */
  down?(scripting: ArchitectScripting, platformClient: any, params?: P): Promise<void>;
}
