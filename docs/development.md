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
pnpm install --frozen-lockfile

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

## Desktop and native builds

Windows native development requires Rust, Microsoft C++ build tools and WebView2. The checked-in Tauri configuration uses `../web/dist` as its local frontend directory, with port 1420 for development. A directory intended for `frontendDist` must be a local resource path, not a file URL.

```powershell
pnpm --filter @uagent/desktop tauri:dev
pnpm --filter @uagent/desktop tauri:build --debug --no-bundle
```

`apps/desktop/src-tauri/build.rs` calls `scripts/mvp15d-source-identity.mjs`; the build also calls `scripts/mvp15d-icon-validate.mjs`. Keep these scripts and their transitive dependencies. Debug builds, production source identity, official plugin packages, and signed installers are different artifacts; one does not establish the verification or signing of another.

## Focused verification

Use the package/test filters relevant to a change. Synthetic providers and fixture projects are the default for automated verification; no existing credential or paid endpoint is required. Documentation of a command does not itself run or authorize it.

The desktop tests for conversations, provider streaming, outbound review, localization, persistence, and title-bar drag regions live beside their implementation in `apps/desktop/web/src`. Read-only diagnostics, controlled text repair, observation, and asset contracts have runtime/shared/native tests and reusable manual guides in `docs/*-manual-smoke.md`.

Preserve the negative cases: no request before exact approval; cancellation/failure excluded from successful context; project/conversation isolation; no automatic retry or locale-triggered send; no secret serialization; rejected/expired/mismatched native approvals; no side effects during replay; and no out-of-root writes.

## UE companion tooling

`integrations/unreal/UAgentAssetTools` is the project-owned companion source. [Build and manifest verification](mvp15-ue-companion-plugin-build-manifest.md) documents the required official UE package build and provenance checks. The target engine/build identity and tool contracts are specified in [the MCP baseline](mvp15-ue-mcp-plugin-baseline.md).

The `scripts/mvp15d-*` utilities implement source identity, plugin packaging, module observation, product-adapter verification, and controlled test-process lifecycle. Keep their tests, fixtures, JSON schemas, and Windows process helper. Their names do not make them disposable development records. Persisted artifact consistency does not prove owned live launch authority; fixture inputs cannot be relabeled as live results.

Live UE verification uses an explicitly approved disposable project and isolated output/cache, never an irreplaceable project or a shared process. Process ownership includes creation identity and descendants, with bounded closeout. Never change global environment variables, terminate an unowned process, or use broad cleanup to turn an unknown result into success.
