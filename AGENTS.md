# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

```sh
npm test          # run all tests (vitest, single pass)
npm run test:watch  # vitest in watch mode

# Run a single test file
npx vitest run test/migrationLoader.test.js
```

There is no build step — the package is plain CommonJS.

## Architecture

Flowy is a CLI tool that manages Genesys Cloud flow migrations, similar to Flyway/Phinx but for Genesys Cloud Architect flows. It requires two external SDKs that make real network calls:

- **`purecloud-platform-client-v2`** — REST API client for Genesys Cloud (used for the history Data Table and flow unlock)
- **`purecloud-flow-scripting-api-sdk-javascript`** (Architect Scripting) — session-based SDK for checking out, modifying, and publishing flows; uses its own auth/session model on top of the platform client

### Source modules

| File | Responsibility |
|------|---------------|
| `bin/flowy.js` | CLI entry point (Commander.js); wires commands to handlers |
| `src/commands/*.js` | One file per CLI command; thin: loads config/auth, delegates to core modules, calls `process.exit` |
| `src/runner.js` | Exports `runMigrations` (core migration loop: checksum verification, pending filter, Architect Scripting session, calls `up()` per migration, records history) and `runRollback` (selects the newest applied migration — or a named version in scratch mode — and runs its `down()`). Both accept an injected SDK via `_archScripting` for testing and honor **scratch mode**: running a single named migration's `up()`/`down()` without writing any history |
| `src/migrationLoader.js` | Discovers and validates migration files and directories from `migrationsDir`; returns a sorted array of `{ version, filename, filePath, module }` |
| `src/historyStore.js` | CRUD against the `_flowy_migrations` Genesys Cloud Data Table; caches the table ID in a module-level variable (reset with `resetCache()`) |
| `src/checksum.js` | SHA-256 of a file or directory (directory = all files hashed recursively, sorted, with relative paths included) |
| `src/config.js` | Loads and validates `flowy.config.js`; exports `FlowyCLIError` (an Error subclass carrying `exitCode`) |
| `src/gcAuth.js` | Authenticates the platform client singleton |
| `src/archSession.js` | Reverse-maps a domain-style region (e.g. `usw2.pure.cloud`) to the Architect Scripting SDK's internal location identifier |
| `src/snapshot.js` | Pre-migration lock check: verifies listed flows are unlocked before `up()` runs |
| `src/appliedBy.js` | Returns `'CI'` in CI environments, otherwise the OS username |
| `src/exitCodes.js` | Constants: `SUCCESS=0`, `MIGRATION_FAILED=1`, `CONFIG_ERROR=2`, `HISTORY_STORE_ERROR=3` |

### Migration file conventions

Migrations can be a single file **or** a directory:

- **File:** `V<NNN>__<description>.js` (or `.ts`)
- **Directory:** `V<NNN>__<description>/` with `index.js` (or `index.ts`) as the entry point

Each migration exports `description` (string), `up(scripting, platformClient)` (required), `down(scripting, platformClient)` (optional), and `flows` (optional array of `{ name, type }` objects for pre-migration lock verification).

### History tracking

Applied migrations are recorded in a Genesys Cloud Data Table named `_flowy_migrations`. The `historyStore` module talks to this table via `ArchitectApi`. Status values: `'applied'`, `'failed'`, `'rolled_back'`. Only `'applied'` rows are treated as done — `'rolled_back'` rows are re-queued as pending on the next `flowy migrate`.

**Scratch mode** (`migrate --scratch <version>` / `rollback --scratch <version>`) is the deliberate exception: it runs a single named migration's `up()`/`down()` against the org but writes **no** history row, for local iteration on a not-yet-merged migration. To keep the ledger an honest mirror of shared state, scratch refuses any version already recorded as `'applied'` (the guard lives in `runMigrations`/`runRollback`). It is not a dry run — flow mutations are real; it simply records nothing.

### Testing patterns

Tests use **Vitest** with ESM imports (`import`) against the CommonJS source files. The test config is in `vitest.config.mjs` (`.mjs` to avoid the Vite CJS deprecation warning).

- `historyStore.test.js` and `migrationLoader.test.js` create fake `platformClient` objects and real temp directories — no `vi.mock` needed because the modules accept dependencies as parameters or work with real fs
- `runner.test.js` injects a mock Architect Scripting session via the `_archScripting` parameter; it covers both `runMigrations` and `runRollback`. `makePlatformClientWithSpies()` returns a client whose `postFlowsDatatableRows`/`putFlowsDatatableRow` spies are stable across `ArchitectApi()` instantiations, so tests can assert history was (or, in scratch mode, was not) written
- `baseline.test.js` tests `selectForBaseline` (exported as `baseline.selectForBaseline`) — a pure function extracted specifically for testability
- `vi.mock` does **not** reliably intercept `require()` calls in this CJS project; prefer extracting pure functions and testing those directly
- `historyStore` has module-level state (`cachedTableId`); tests call `resetCache()` or use `vi.resetModules()` between cases
