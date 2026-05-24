# Flowy Migration Tool — Design Spec

**Date:** 2026-05-24  
**Status:** Approved

---

## Overview

`flowy` is a standalone command-line tool for managing Genesys Cloud flow migrations. It follows the conventions of database migration tools like Flyway and Phinx: migrations are versioned files, the tool tracks which have been applied, and running `flowy migrate` brings the target environment up to date.

The tool owns authentication, SDK session management, history tracking, auto-snapshotting, and error handling. Migration authors write only the logic that changes flows — nothing else.

---

## Distribution

`flowy` is distributed as a standalone CLI, installable via Homebrew or as a global npm package:

```
brew install flowy
# or
npm install -g flowy
```

Users run `flowy` commands from inside their own project directory. The tool reads `flowy.config.js` and the `migrations/` folder from the current working directory. No flowy internals live in user projects.

---

## User Project Structure

A project using flowy looks like this:

```
my-genesys-project/
├── flowy.config.js
└── migrations/
    ├── V001__add_greeting_prompt.js
    └── V002__add_callback_menu.js
```

---

## Configuration

Users create a `flowy.config.js` in their project root. It is a JavaScript file (not JSON or YAML) so environment variables, dynamic values, and comments work naturally. The file is committed to git; credentials are always provided via environment variables.

```javascript
// flowy.config.js
module.exports = {
  migrationsDir: './migrations',   // default; can be overridden
  defaultEnvironment: 'dev',

  environments: {
    dev: {
      clientId: process.env.GC_CLIENT_ID,
      clientSecret: process.env.GC_CLIENT_SECRET,
      region: 'mypurecloud.com',
    },
    prod: {
      clientId: process.env.GC_CLIENT_ID_PROD,
      clientSecret: process.env.GC_CLIENT_SECRET_PROD,
      region: 'mypurecloud.com',
    }
  }
};
```

Flowy loads `.env` automatically via `dotenv`. The `--env` flag on any command overrides `defaultEnvironment`.

---

## Migration File Format

Migration files are named `V<NNN>__<description>.js` using sequential integers (e.g. `V001__add_greeting_prompt.js`). The double underscore separates the version from the description.

Each file is a Node.js module exporting:

- **`description`** *(required)* — human-readable string stored in migration history
- **`flows`** *(optional)* — array of flow names to check in before `up()` runs (auto-snapshot)
- **`up(architectSession, platformClient)`** *(required)* — applies the migration
- **`down(architectSession, platformClient)`** *(optional)* — rolls back the migration

```javascript
// migrations/V001__add_greeting_prompt.js

module.exports = {
  description: 'Add greeting prompt to main inbound flow',

  // Optional. If provided, flowy checks in these flows before calling up(),
  // creating a recoverable snapshot. If absent, no automatic snapshot is taken.
  flows: ['MainInbound'],

  async up(architectSession, platformClient) {
    // architectSession — raw Architect Scripting SDK session (same object
    //   passed to doWork in ArchScripting.run())
    // platformClient  — authenticated Genesys Cloud Platform API Client SDK
    const flow = await architectSession.flows.getFlowByName('MainInbound');
    // ... make changes ...
    await flow.checkIn('V001: add greeting prompt');
  },

  async down(architectSession, platformClient) {
    // Optional. If absent, `flowy rollback` fails with a clear message.
    const flow = await architectSession.flows.getFlowByName('MainInbound');
    // ... undo changes ...
    await flow.checkIn('V001 rolled back');
  }
};
```

Migration authors work directly from the Architect Scripting SDK and Platform API Client SDK documentation. Flowy adds no wrapper or abstraction over the session objects.

---

## SDK Integration

Flowy uses a **single shared `ArchScripting.run()` session** for the entire `flowy migrate` command. It authenticates once, then iterates through all pending migrations sequentially inside the `doWork` callback, passing the same session into each `up()`.

The Platform API Client SDK is also authenticated once using the same credentials. Both clients are passed to migration functions as arguments.

---

## Auto-Snapshot

If a migration exports a `flows` array, flowy checks in each named flow before calling `up()`. This creates a recoverable baseline even if `down()` is not implemented and even if the migration fails partway through. Migrations that do not declare `flows` skip the snapshot step.

If a pre-migration check-in fails (e.g. a flow is checked out by another user), flowy halts before running `up()` and records nothing in history. No repair is needed — fix the lock and re-run.

---

## History Tracking

Flowy tracks applied migrations in a Genesys Cloud Data Table named `_flowy_migrations`. The table is created automatically on first run if it does not exist. If the user lacks Data Table permissions, flowy fails fast with a clear error explaining exactly what permission is needed.

### Table Schema

| Column | Type | Description |
|---|---|---|
| `key` | String (row key) | Migration version, e.g. `V001` |
| `description` | String | From the migration's `description` export |
| `filename` | String | e.g. `V001__add_greeting_prompt.js` |
| `checksum` | String | SHA-256 of the migration file at time of apply |
| `appliedAt` | String | ISO 8601 timestamp |
| `appliedBy` | String | `os.userInfo().username`, or `CI` if a CI environment is detected |
| `executionTime` | String | Duration in milliseconds |
| `status` | String | `applied`, `failed`, or `rolled_back` |

Flowy computes a SHA-256 checksum of each migration file when it is first applied. On subsequent runs, checksums are recomputed and compared. If a file has changed, flowy warns and requests confirmation before proceeding (or fails outright with `--strict`).

---

## CLI Commands

Commands that communicate with Genesys Cloud (`migrate`, `rollback`, `status`, `repair`, `baseline`) require valid credentials for the target environment. Commands that are purely local (`init`, `create`, `validate`) do not.

```
flowy init                         # scaffold flowy.config.js in current directory
flowy create <description>         # create the next migration file (e.g. V003__description.js)
flowy migrate [--env <name>]       # apply all pending migrations
flowy migrate --target V005        # apply migrations up to and including V005
flowy rollback [--env <name>]      # undo the last applied migration (requires down())
flowy status [--env <name>]        # list applied, pending, and failed migrations
flowy validate                     # check for checksum mismatches or out-of-order versions
flowy repair [--env <name>]        # fix history table problems (see below)
flowy baseline [--env <name>]      # mark all existing migrations as applied without running them
```

### `flowy status` output

Applied migrations are shown in green, pending in yellow, failed in red.

### `flowy repair`

`flowy repair` is the single escape hatch for all history table problems:

1. **Reset failed entry** — a migration is stuck in `failed` status; resets it to `pending` so the next `flowy migrate` retries it. Use after fixing whatever caused the failure.
2. **Update checksum** — a migration file was legitimately edited after being applied; updates the stored checksum to match the current file, clearing the `flowy validate` warning.
3. **Create missing entry** — `up()` succeeded but writing to the Data Table failed, leaving no history record. After resolving the Data Table issue, `flowy repair` detects the missing entry, prompts for confirmation that the migration was successfully applied, and creates the record.

---

## Error Handling

**General philosophy:** fail fast, fail loudly, never silently skip. Every error message names the migration that caused it and tells the user what command to run next.

### During `up()`
If `up()` throws, flowy catches the error, records the migration as `failed` in history (including the error message), logs the error clearly, and halts. No subsequent migrations run. The exit code is non-zero so CI pipelines fail loudly.

### During history recording
If `up()` succeeds but writing to the Data Table fails, flowy logs a prominent warning:

> *"Migration V003 applied successfully but could not be recorded in history. Run `flowy repair` after resolving the Data Table issue."*

The flow changes are live in GC; only the record is missing.

### Checksum mismatches
Checked before opening the SDK session. If any applied migration file has changed, flowy warns and asks for confirmation before proceeding (or fails with `--strict`).

### Exit codes
- `0` — success
- `1` — migration failed
- `2` — configuration error
- `3` — history store error (Data Table unavailable or permission denied)

---

## Testing

**Unit tests** cover purely local logic: config loading and validation, migration file discovery and sorting, version number parsing, checksum computation, and CLI argument parsing.

**Integration tests** cover the runner and history store against mocked SDK clients. Because both `architectSession` and `platformClient` are passed as arguments to `up()` and `down()`, they are natural injection points — test implementations can be substituted without any additional setup.

Tests assert that migrations run in correct order, that a failure in V002 prevents V003 from running, that history is written correctly, that `repair` handles all three problem scenarios, etc.

**End-to-end tests** against a live GC org are valuable but require a dedicated test org and credentials. They are optional and left to the project maintainer's discretion.

**Test runner:** Vitest. The project ships with `npm test` running unit and integration tests.
