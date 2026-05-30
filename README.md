# @rhanneken/flowy

A migration tool for [Genesys Cloud](https://www.genesys.com/genesys-cloud) flows, inspired by [Flyway](https://flywaydb.org/) and [Phinx](https://phinx.org/).

Flowy handles authentication, SDK session management, history tracking, and error handling. You write only the logic that changes your flows.

---

## Installation

```sh
npm install -g @rhanneken/flowy
```

Node.js 18 or later is required.

---

## Quick start

```sh
# 1. Scaffold a config file in your project directory
flowy init

# 2. Edit flowy.config.js with your credentials
# 3. Create your first migration
flowy create "add greeting prompt"

# 4. Edit the generated migration file, then apply it
flowy migrate
```

---

## Project structure

Flowy reads `flowy.config.js` and the `migrations/` folder from your current working directory. Nothing from flowy lives in your project — only your config and migration files.

```
my-genesys-project/
├── .env
├── flowy.config.js
└── migrations/
    ├── V001__add_greeting_prompt.js
    └── V002__add_callback_menu.ts
```

---

## Configuration

`flowy init` creates a starter `flowy.config.js`. Edit it to match your environments:

```js
// flowy.config.js
module.exports = {
  migrationsDir: './migrations',   // default; can be omitted
  defaultEnvironment: 'dev',

  environments: {
    dev: {
      clientId:     process.env.GC_CLIENT_ID,
      clientSecret: process.env.GC_CLIENT_SECRET,
      region:       'mypurecloud.com',
    },
    prod: {
      clientId:     process.env.GC_CLIENT_ID_PROD,
      clientSecret: process.env.GC_CLIENT_SECRET_PROD,
      region:       'mypurecloud.com',
    },
  },
};
```

Flowy loads `.env` automatically via [dotenv](https://github.com/motdotla/dotenv). The `--env` flag on any command overrides `defaultEnvironment`. Credentials always come from environment variables — never hardcode them in the config file.

---

## Migration files

A migration can be either a single file or a directory:

- **File:** `V<NNN>__<description>.js` (or `.ts`)
- **Directory:** `V<NNN>__<description>/` containing an `index.js` (or `index.ts`) entry point

Both styles coexist freely in the same `migrations/` folder. Use a directory when a migration involves multiple files — helper modules, audio assets, prompt scripts, etc. Files inside the directory are available via normal relative `require`/`import`. Checksums cover all files in the directory, so modifying any file (including assets) triggers the usual checksum warning.

Each migration (file or `index.js`) exports:

| Export | Required | Description |
|--------|----------|-------------|
| `description` | ✓ | Human-readable string stored in migration history |
| `up(scripting, platformClient)` | ✓ | Applies the migration |
| `down(scripting, platformClient)` | | Rolls back the migration (required for `flowy rollback`) |
| `flows` | | Array of flow names to check in before `up()` runs, creating a recoverable snapshot |

You are responsible for calling `checkInAsync()` or `publishAsync()` inside `up()`. Flowy does not call them on your behalf.

### The `scripting` argument

The first argument to `up()` and `down()` is the full [`purecloud-flow-scripting-api-sdk-javascript`](https://github.com/MyPureCloud/purecloud-flow-scripting-api-sdk-javascript) module, authenticated and ready to use. The parts you'll use most:

| Property | What it is |
|----------|-----------|
| `scripting.factories.archFactoryFlows` | Load, create, and check out flows |
| `scripting.environment.archSession` | The active session (auth token, org info, etc.) |
| `scripting.viewModels.flows` | Flow view model definitions |

Consult the [Architect Scripting SDK documentation](https://mypurecloud.github.io/purecloud-flow-scripting-api-sdk-javascript/) for the full API reference.

### JavaScript example

```js
// migrations/V001__add_greeting_prompt.js
module.exports = {
  description: 'Add greeting prompt to main inbound flow',

  // Optional. Flowy checks in these flows before calling up(),
  // creating a snapshot you can recover from if the migration fails.
  flows: ['MainInbound'],

  async up(scripting, platformClient) {
    const flows = scripting.factories.archFactoryFlows;
    const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('MainInbound', 'inboundcall');
    // ... make changes to flow ...
    await flow.publishAsync();  // validate, save, and publish — releases the lock
  },

  async down(scripting, platformClient) {
    const flows = scripting.factories.archFactoryFlows;
    const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('MainInbound', 'inboundcall');
    // ... undo changes ...
    await flow.checkInAsync();  // check in only (no publish) — releases the lock
  },
};
```

### Directory migration example

```
migrations/
└── V002__add_hold_music/
    ├── index.js          ← entry point with up() and down()
    └── hold-music.wav    ← audio asset uploaded inside up()
```

```js
// migrations/V002__add_hold_music/index.js
const { join } = require('path');

module.exports = {
  description: 'Upload hold music prompt',

  async up(scripting, platformClient) {
    const audioPath = join(__dirname, 'hold-music.wav');
    // ... upload audioPath via platformClient ...
  },

  async down(scripting, platformClient) {
    // ... delete the uploaded prompt ...
  },
};
```

### TypeScript example

```ts
// migrations/V002__add_callback_menu.ts
import type { FlowMigration } from '@rhanneken/flowy/types/FlowMigration';
import type { ArchitectScripting } from 'purecloud-flow-scripting-api-sdk-javascript';

const migration: FlowMigration = {
  description: 'Add callback menu to support flow',
  flows: ['SupportInbound'],

  async up(scripting: ArchitectScripting, platformClient: any): Promise<void> {
    const flows = scripting.factories.archFactoryFlows;
    const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('SupportInbound', 'inboundcall');
    // ... make changes to flow ...
    await flow.publishAsync();  // validate, save, and publish — releases the lock
  },

  async down(scripting: ArchitectScripting, platformClient: any): Promise<void> {
    const flows = scripting.factories.archFactoryFlows;
    const flow = await flows.checkoutAndLoadFlowByFlowNameAsync('SupportInbound', 'inboundcall');
    // ... undo changes ...
    await flow.checkInAsync();  // check in only (no publish) — releases the lock
  },
};

export default migration;
```

The `FlowMigration` interface and the `ArchitectScripting` type are both optional — you can omit them and use `any` if you prefer less verbosity. `platformClient` is typed as `any` because the Platform Client SDK's TypeScript module declaration does not export its API classes.

TypeScript support requires [`tsx`](https://github.com/privatenumber/tsx) as an optional peer dependency:

```sh
npm install -g tsx
```

Projects using only `.js` migrations have no TypeScript dependency.

---

## Commands

| Command | Description |
|---------|-------------|
| `flowy init` | Scaffold `flowy.config.js` in the current directory |
| `flowy create <description>` | Create the next migration file |
| `flowy create --ts <description>` | Create a TypeScript migration file |
| `flowy create --dir <description>` | Create a migration directory with an index.js entry point |
| `flowy create --dir --ts <description>` | Create a migration directory with an index.ts entry point |
| `flowy migrate` | Apply all pending migrations |
| `flowy migrate --target V005` | Apply migrations up to and including V005 |
| `flowy migrate --strict` | Fail (rather than warn) on checksum mismatches |
| `flowy rollback` | Undo the last applied migration |
| `flowy status` | Show applied, pending, and failed migrations |
| `flowy validate` | Check for missing version numbers or structural errors (local only) |
| `flowy repair` | Fix history table problems interactively |
| `flowy baseline` | Mark all existing migrations as applied without running them |
| `flowy baseline --target V005` | Baseline migrations up to and including V005 |
| `flowy unlock <flow-name>` | Force-unlock a flow left locked by a failed migration |

All commands that communicate with Genesys Cloud accept `--env <name>` to override `defaultEnvironment`.

---

## How it works

### Single session

Flowy authenticates once at the start of `flowy migrate` and runs all pending migrations inside a single Architect Scripting session. The session and an authenticated Platform API Client are passed into each `up()` call.

### History tracking

Flowy tracks applied migrations in a Genesys Cloud Data Table named `_flowy_migrations`, created automatically on first run. The OAuth client used by flowy needs the `architect` scope and Data Table read/write permissions.

Each row records the version, description, filename, a SHA-256 checksum of the migration file, timestamp, who applied it, execution time, and status (`applied`, `failed`, or `rolled_back`).

### Checksum validation

When you run `flowy migrate`, flowy recomputes checksums for all previously applied migration files and compares them to what was stored at apply time. If a file has changed, flowy warns and asks for confirmation before proceeding. Use `--strict` to fail outright instead.

### Pre-migration snapshots

If a migration exports a `flows` array, flowy checks in each named flow before calling `up()`. This creates a recoverable baseline even if the migration fails partway through and even if `down()` is not implemented. If a flow is locked by another user, flowy halts before running `up()` — fix the lock and re-run.

### Error handling

If `up()` throws, flowy records the migration as `failed` in history, logs the error, and halts. No subsequent migrations run. The exit code is non-zero so CI pipelines fail loudly.

If `up()` succeeds but writing to the history table fails, flowy logs a prominent warning and tells you to run `flowy repair`.

### Locked flows

The Architect Scripting SDK acquires an exclusive lock on a flow when you check it out. The lock is released when `publishAsync()` or `checkInAsync()` completes. If a migration fails between checkout and the final publish/check-in, the lock is left dangling — no subsequent session can check out that flow until the lock is cleared.

To release a stranded lock:

```sh
flowy unlock "My Flow Name"
```

Then reset the failed migration and retry:

```sh
flowy repair   # reset the failed migration to pending
flowy migrate
```

> **Note:** `flowy unlock` calls the Genesys Cloud force-unlock API, which requires **Architect Admin** permissions on the OAuth client.

### `flowy repair`

The escape hatch for history table problems:

1. **Reset a failed entry** — resets a `failed` migration to `pending` so the next `flowy migrate` retries it
2. **Update a checksum** — clears a checksum mismatch warning after a migration file was legitimately edited post-apply
3. **Create a missing entry** — records a migration that was applied successfully but never written to the history table

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Migration failed |
| `2` | Configuration error |
| `3` | History store error (Data Table unavailable or permission denied) |

---

## License

[BSD Zero Clause License](LICENSE) — do whatever you want with it.
