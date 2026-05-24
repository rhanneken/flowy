// types/FlowMigration.d.ts
// TypeScript interface for flowy migration files.
// Import in your migration: import type { FlowMigration } from 'flowy/types/FlowMigration';

export interface FlowMigration {
  /** Human-readable description stored in migration history. */
  description: string;

  /**
   * Optional. Flow names to check in before up() runs, creating a recoverable snapshot.
   * If absent, no automatic snapshot is taken.
   */
  flows?: string[];

  /**
   * Apply the migration. Responsible for all flow validation, check-in, and publishing.
   * The migration is "applied" when this function returns without throwing.
   *
   * @param architectSession  Raw Architect Scripting SDK session object
   * @param platformClient    Authenticated purecloud-platform-client-v2 module
   */
  up(architectSession: unknown, platformClient: unknown): Promise<void>;

  /**
   * Optional. Roll back the migration. Required for `flowy rollback` to work.
   *
   * @param architectSession  Raw Architect Scripting SDK session object
   * @param platformClient    Authenticated purecloud-platform-client-v2 module
   */
  down?(architectSession: unknown, platformClient: unknown): Promise<void>;
}
