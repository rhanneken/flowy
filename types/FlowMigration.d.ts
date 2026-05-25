// types/FlowMigration.d.ts
// TypeScript interface for flowy migration files.
// Import in your migration: import type { FlowMigration } from '@rhanneken/flowy/types/FlowMigration';

export interface FlowMigration {
  /** Human-readable description stored in migration history. */
  description: string;

  /**
   * Optional. Flow names to check in before up() runs, creating a recoverable snapshot.
   * If absent, no automatic snapshot is taken.
   */
  flows?: string[];

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
   */
  up(scripting: any, platformClient: any): Promise<void>;

  /**
   * Optional. Roll back the migration. Required for `flowy rollback` to work.
   *
   * @param scripting        The purecloud-flow-scripting-api-sdk-javascript module,
   *                         authenticated and ready to use.
   * @param platformClient   The authenticated purecloud-platform-client-v2 module.
   */
  down?(scripting: any, platformClient: any): Promise<void>;
}
