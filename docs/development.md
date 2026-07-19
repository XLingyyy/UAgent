# UAgent Development Guide

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Git

### Native Build (optional)

To run the Tauri 2 native desktop build (`pnpm --filter @uagent/desktop dev` or `tauri build`), you also need:

- Rust toolchain (`rustc` / `cargo`) — install via https://rustup.rs
- Platform-specific WebView runtime (WebView2 on Windows, WebKit on macOS/Linux)

The web frontend builds and runs without Rust.

## Getting Started

```bash
# Clone and install
git clone <repo-url> uagent
cd uagent
pnpm install

# Start web dev server (browser preview, no Rust needed)
pnpm --filter @uagent/desktop web:dev

# Start Tauri native dev (requires Rust)
pnpm --filter @uagent/desktop dev

# Run all checks
pnpm typecheck
pnpm lint
pnpm test
```

## Development Commands

| Command                                         | Description                                   |
| ----------------------------------------------- | --------------------------------------------- |
| `pnpm --filter @uagent/desktop web:dev`         | Start Vite dev server on port 1420            |
| `pnpm --filter @uagent/desktop web:build`       | Build web frontend to `apps/desktop/web/dist` |
| `pnpm --filter @uagent/desktop dev`             | Start Tauri native dev (requires Rust)        |
| `pnpm --filter @uagent/desktop tauri --version` | Verify Tauri CLI is installed                 |
| `pnpm typecheck`                                | TypeScript type checking across all packages  |
| `pnpm lint`                                     | ESLint static analysis                        |
| `pnpm lint:fix`                                 | Auto-fix lint issues                          |
| `pnpm format`                                   | Format code with Prettier                     |
| `pnpm format:check`                             | Check code formatting                         |
| `pnpm test`                                     | Run all tests with Vitest                     |

## Project Structure

```text
uagent/
├── apps/
│   └── desktop/                  # Tauri 2 + React + Vite desktop app
│       ├── src-tauri/            # Tauri native shell (Rust)
│       │   ├── src/              # Rust entry points
│       │   ├── capabilities/     # Tauri permission capabilities
│       │   ├── Cargo.toml        # Rust manifest
│       │   └── tauri.conf.json   # Tauri configuration
│       ├── web/                  # React + Vite frontend
│       │   ├── src/
│       │   │   ├── app/          # Root App and UI providers
│       │   │   ├── shell/        # AppShell, TitleBar, MainLayout, GlobalOverlays
│       │   │   ├── sidebar/      # LeftSidebar
│       │   │   ├── workspace/    # Workspace (viewport + composer dock)
│       │   │   ├── inspector/    # InspectorPane
│       │   │   ├── components/   # Reusable presentational components
│       │   │   ├── stores/       # UI state stores (placeholder)
│       │   │   ├── styles/       # tokens, theme, animations, globals
│       │   │   └── types/        # UI type definitions
│       │   ├── index.html
│       │   ├── vite.config.ts
│       │   └── tsconfig.json
│       ├── vitest.config.ts
│       └── package.json
├── packages/
│   ├── shared/                   # Shared types and utilities
│   ├── runtime/                  # Agent runtime engine
│   └── mcp-client/               # MCP client abstraction
├── docs/
│   ├── architecture.md
│   ├── mvp-roadmap.md
│   └── development.md
├── package.json                  # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.json                 # Base TypeScript config
└── eslint.config.mjs             # Flat ESLint config
```

## Technology Stack

- **Runtime**: Node.js >= 20
- **Language**: TypeScript 5.5+
- **Desktop**: Tauri 2 + React 18 + Vite 5
- **Package Manager**: pnpm 9+
- **Linting**: ESLint 9 (flat config) + Prettier
- **Testing**: Vitest + Testing Library

## UI Styling

All visual tokens are centralized in `apps/desktop/web/src/styles/`:

- **`tokens.css`** — raw design values (colors, radius, spacing, typography, layout dimensions).
- **`theme.css`** — semantic tokens (`--ua-bg`, `--ua-text`, `--ua-accent`, etc.) mapped to the dark theme.
- **`animations.css`** — motion tokens with `prefers-reduced-motion` support.
- **`globals.css`** — reset and base element styles.

Components should only reference semantic tokens from `theme.css`, not raw values from `tokens.css`.

## Adding a New Package

1. Create directory under `packages/` or `apps/`
2. Add `package.json` with `@uagent/*` name and workspace dependencies
3. Add `tsconfig.json` extending `../../tsconfig.json`
4. Run `pnpm install` from root to link the workspace

## Code Style

- 2-space indentation
- Double quotes for strings
- Trailing commas
- Max 100 characters per line
- Strict TypeScript mode
- No unused locals or parameters

## Testing

Each package contains its own test suite using Vitest:

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @uagent/desktop test

# Watch mode
pnpm --filter @uagent/desktop test:watch
```

The desktop app includes UI shell smoke tests using Testing Library (`@testing-library/react`) with a jsdom environment.

### MVP15 Asset Mutation Checks

Run the complete fresh ledger from the repository root when changing the sandbox asset mutation pilot or its authority boundary:

```bash
git status --short
git diff --name-only
git diff --stat
git diff --check
pnpm typecheck
pnpm lint
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm test
pnpm --filter @uagent/desktop web:build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml asset_mutation -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ue_editor_process -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1
node scripts/side-effect-scan.mjs
```

The side-effect scan includes five C11 structural categories for native trust, observation authority, the native gate, transaction liveness, and pre-trust root mapping. Its Rust checks target only the production authority files; legacy TS/JS keyword categories do not broadly scan Rust implementation text.

11A lifecycle tests must remain deterministic: observation races use explicit hooks/barriers and Rust registry suites run with `--test-threads=1`; MCP facade races use deferred promises. Any local rejection after an accepted native guard must settle the no-side-effect outcome before returning, and any stale unpublished registration must verify token-bound native cancellation rather than relying on TTL cleanup.

### MVP15 Task-owned UE Readiness-only Check

A readiness-only check is an environment containment step, not product acceptance. Use a verified disposable or retained task copy, keep its configured task listener isolated, and place the writable DDC inside that copy. Set `UE-LocalDataCachePath` only in the task UE child environment and pass both `-ddc=NoZenLocalFallback` and `-LocalDataCachePath=<task-ddc>` through an argument-list API with `shell=false`. Do not alter permanent environment variables, shared Zen, the source project, or copied Config/Content/Plugins/Binaries. C13D proved that `PYTHONDONTWRITEBYTECODE=1` does not suppress this embedded-runtime cache surface, so it must not be treated as a cleanliness assertion or pass condition.

For the retained task copy, validate the exact generated-cache state before launch and after process exit:

```powershell
node scripts/mvp15-python-cache-surface.mjs --plugins-root <absolute-task-copy-Plugins> --contract scripts/mvp15-python-cache-contract.json --cache-state generated --json
```

The validator must report the contracted full, business, and cache aggregates with zero errors and zero unclassified paths. Only the 28 literal cache/source pairs and four literal cache directories in the contract are accepted. A 29th cache, changed ABI/header, missing or moved source, changed business/cache bytes, duplicate/case-colliding contract path, or link/reparse substitution fails closed. Never replace this with a broad `.pyc` or `__pycache__` ignore.

Use a monotonic 600-second deadline with lightweight process/module/port/log/immutable-state and contracted-cache polls every five seconds. Do not run full DDC/business aggregate workers while UE is live. Record the first simultaneous readiness time before evidence serialization, immediately close only positively identified task processes on first-ready or failure, and run the full validator and DDC/business aggregates after process exit. Independently recheck process/port/user UE/shared Zen/source/task state; any access error, unclassified cache, or business/cache contract change must fail closed and remain preserved. Do not start UAgent, Connect/Discover, call MCP/native routes, register approvals/tokens, or mutate assets in this phase.

C13C reused a warm task-local DDC and observed readiness at `+33.408s`, then generated 28 Python bytecode cache files. C13D exactly removed that residue, restored the 163-file Plugins baseline, and observed readiness at `+115.030s` with one child-only `PYTHONDONTWRITEBYTECODE=1` launch and zero retries; the embedded UE runtime regenerated the same 28 files. C13E retained that surface and produced exact 163-business/28-cache inventories through one `+94.338s` launch, with clean process/port closeout. C13E1 repairs the validator without another UE launch: any `lstat` or native `realpath` inspection error produces stable `PATH_INSPECTION_FAILED` output and a nonzero exit, while short/magic/flags/kind/source-metadata header failures all produce `header.valid: false`. The expanded 23-test matrix and fresh retained-copy read-only run pass, with the 28 cache path/size/SHA/mtime values unchanged.

Real UE sandbox smoke requires a supervisor-local disposable project and explicit process ownership. Start the task-owned UAgent native app from a dedicated PowerShell session with the strict native gate set only for that process:

```powershell
$env:UAGENT_ENABLE_ASSET_MUTATION = "1"
pnpm --filter @uagent/desktop tauri:dev
```

Unset or omit the variable for the required gate-OFF negative smoke. Values other than the exact string `1` are OFF. UI sandbox state remains an additional restriction and cannot enable a native-OFF process. Do not place project paths, process ids, tokens, credential-bearing endpoints, or other local facts in repository documents.

The smoke must use product UI `validate -> add -> confirmTrust`, attach a live observation, mutate only `/Game/UAgentSandbox/<run-id>/**`, verify external Content evidence, cross the original token TTL without crossing the transaction cap, exercise inverse rollback, and confirm replay delta zero and non-sandbox stability. Follow `docs/mvp15-manual-smoke.md` and record the plugin identity/fingerprint required by `docs/mvp15-ue-mcp-plugin-baseline.md`.

The 2026-07-18 MVP15C / 09Z `PASS_REAL_SMOKE` result is historical happy-path evidence, not current authority verification. Current acceptance is `BLOCKED`; task-owned warm readiness and an implementation-candidate fail-closed dual-aggregate validator exist, but supervisor acceptance and the fresh product-UI lifecycle remain open. The active UE/build/module bytes are known, while authoritative official mapping and product-adapter live discovery remain `BLOCKED_BY_MCP_SCHEMA`. Never convert a readiness-only, skipped, unavailable, blocked, or supervisor-rejected run into a product-smoke pass.
