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

Run these checks when changing the sandbox asset mutation pilot:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm --filter @uagent/desktop web:build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml asset_mutation -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ue_editor_process -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1
node scripts/side-effect-scan.mjs
git diff --check
```

Real UE sandbox smoke requires a supervisor-local UE Editor project with the bridge enabled. The smoke must mutate only `/Game/UAgentSandbox/**`, verify the resulting manifest, exercise rollback, and confirm that non-sandbox paths remain blocked.

The MVP15 final product-UI smoke was completed and accepted on 2026-07-18 as `PASS_REAL_SMOKE`; this is a recorded stage result, not a substitute for future verification. Any later change to the native approval lifecycle, exact MCP asset facade, sandbox path policy, verification, rollback, replay, or related UI wiring must repeat the applicable automated matrix above and the procedure in `docs/mvp15-manual-smoke.md`. Documentation-only or presentation-only changes must mark the real smoke as skipped when the task forbids a new mutation run.
