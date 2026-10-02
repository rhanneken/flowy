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
| `bin/flowy.js` | CLI entry point (Commander.js); wires commands to handlers. Also bootstraps HTTP(S) proxy support (via `proxy-agent`) before any other module loads, since the Architect Scripting SDK's raw `https.request()` calls don't auto-detect a proxy the way axios (used by `purecloud-platform-client-v2`) does. Use `proxy-agent`, not `global-agent` — global-agent only sets TLS `servername` when the request options carry `secureEndpoint: true`, which Node never sets for this SDK's calling style, causing a cert altname mismatch through a CONNECT-tunneled proxy |
| `src/commands/*.js` | One file per CLI command; thin: loads config/auth, delegates to core modules, calls `process.exit` |
| `src/runner.js` | Exports `runMigrations` (core migration loop: checksum verification, pending filter, Architect Scripting session, calls `up()` per migration, records history) and `runRollback` (selects the newest applied migration — or a named version in scratch mode — and runs its `down()`). Both accept an injected SDK via `_archScripting` for testing and honor **scratch mode**: running a single named migration's `up()`/`down()` without writing any history |
| `src/migrationLoader.js` | Discovers, validates, and (when `envName` is provided) loads params for migration files and directories from `migrationsDir`; returns a sorted array of `{ version, filename, filePath, module, params }` |
| `src/historyStore.js` | CRUD against the `_flowy_migrations` Genesys Cloud Data Table; caches the table ID in a module-level variable (reset with `resetCache()`) |
| `src/checksum.js` | SHA-256 of a file or directory (directory = all files hashed recursively, sorted, with relative paths included; `params.js` and OS-generated junk files — `.DS_Store`, `._*`, `.Spotlight-V100`, `.Trashes`, `Thumbs.db`, `desktop.ini` — are excluded from directory checksums) |
| `src/config.js` | Loads and validates `flowy.config.js`; exports `FlowyCLIError` (an Error subclass carrying `exitCode`) |
| `src/gcAuth.js` | Authenticates the platform client singleton |
| `src/archSession.js` | Reverse-maps a domain-style region (e.g. `usw2.pure.cloud`) to the Architect Scripting SDK's internal location identifier |
| `src/lockCheck.js` | Pre-migration lock check: verifies listed flows are unlocked before `up()` runs |
| `src/sdkLogging.js` | Takes over the Architect Scripting SDK's console output so credentials are redacted. `installSdkLogging(scripting, secrets)` registers an `archLogging.setLoggingCallback` hook that redacts each message (known secrets by value, including the live session token, plus patterns for the SDK's credential notes), prints it itself the way the SDK would (`console.log`; warnings yellow, errors red), and returns `true`. `installSdkLogging` itself returns `{ errors }`, an array of the redacted SDK error messages. The SDK logs the OAuth client secret and access token as notes during session start and suppresses its own console output **only** when the hook returns exactly `true` — a hook that throws or returns anything else makes the SDK print the original message. Must be installed before every `archSession.startWith*()` call. A migration that calls `setLoggingCallback` itself replaces the hook for the rest of the run. `archLogging.lastError`/`lastNote` still hold unredacted text — use the returned `errors` instead |
| `src/appliedBy.js` | Returns `'CI'` in CI environments, otherwise the OS username |
| `src/exitCodes.js` | Constants: `SUCCESS=0`, `MIGRATION_FAILED=1`, `CONFIG_ERROR=2`, `HISTORY_STORE_ERROR=3` |

### Migration file conventions

Migrations can be a single file **or** a directory:

- **File:** `V<NNN>__<description>.js` (or `.ts`)
- **Directory:** `V<NNN>__<description>/` with `index.js` (or `index.ts`) as the entry point

Each migration exports `description` (string), `up(scripting, platformClient, params)` (required), `down(scripting, platformClient, params)` (optional), and `flows` (optional array of `{ name, type }` objects for pre-migration lock verification). Directory migrations may also include an optional `params.js` file that exports an environment-keyed object; flowy resolves the active environment's sub-object and passes it as the third argument to `up()` and `down()`. `flowy validate` loads `params.js` for each directory migration (using the active environment), so a broken `params.js` is caught before `flowy migrate` runs.

### History tracking

Applied migrations are recorded in a Genesys Cloud Data Table named `_flowy_migrations`. The `historyStore` module talks to this table via `ArchitectApi`. Status values: `'applied'`, `'failed'`, `'rolled_back'`. Only `'applied'` rows are treated as done — `'rolled_back'` rows are re-queued as pending on the next `flowy migrate`.

**Scratch mode** (`migrate --scratch <version>` / `rollback --scratch <version>`) is the deliberate exception: it runs a single named migration's `up()`/`down()` against the org but writes **no** history row, for local iteration on a not-yet-merged migration. To keep the ledger an honest mirror of shared state, scratch refuses any version already recorded as `'applied'` (the guard lives in `runMigrations`/`runRollback`). It is not a dry run — flow mutations are real; it simply records nothing.

### Testing patterns

Tests use **Vitest** with ESM imports (`import`) against the CommonJS source files. The test config is in `vitest.config.mjs` (`.mjs` to avoid the Vite CJS deprecation warning).

- `historyStore.test.js` and `migrationLoader.test.js` create fake `platformClient` objects and real temp directories — no `vi.mock` needed because the modules accept dependencies as parameters or work with real fs
- `runner.test.js` injects a mock Architect Scripting session via the `_archScripting` parameter; it covers both `runMigrations` and `runRollback`. `makePlatformClientWithSpies()` returns a client whose `postFlowsDatatableRows`/`putFlowsDatatableRow` spies are stable across `ArchitectApi()` instantiations, so tests can assert history was (or, in scratch mode, was not) written
- `makeArchScripting()` in `runner.test.js` returns a fake whose `archLogging` mirrors the real SDK: it prints a message to the console itself unless the registered callback returns exactly `true`. Pass `{ leakCredentials: true }` to make session start emit the SDK's credential-bearing notes (plus the client secret in a shape no pattern knows, so a test fails if the runner stops passing the secret to `installSdkLogging`), or `{ sessionError: '...' }` to emit an SDK error and end the session with exit code 99
- `sdkLogging.test.js` unit-tests the redactor and callback with a hand-rolled fake, and also runs tests against the **real** Architect Scripting SDK (no network — no session is started) to pin the callback-suppression contract, plus a check that the SDK bundle still contains the three credential-note strings the redaction patterns anchor on; if an SDK upgrade breaks any of these, credentials may be leaking again
- `baseline.test.js` tests `selectForBaseline` (exported as `baseline.selectForBaseline`) — a pure function extracted specifically for testability
- `vi.mock` does **not** reliably intercept `require()` calls in this CJS project; prefer extracting pure functions and testing those directly
- `historyStore` has module-level state (`cachedTableId`); tests call `resetCache()` or use `vi.resetModules()` between cases
