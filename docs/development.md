# UAgent Development Guide

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Git

## Getting Started

```bash
# Clone and install
git clone <repo-url> uagent
cd uagent
pnpm install

# Start desktop app in development mode
pnpm dev

# Run all checks
pnpm typecheck
pnpm lint
pnpm test
```

## Development Commands

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `pnpm dev`          | Start Electron desktop app in dev mode       |
| `pnpm build`        | Build all packages and apps                  |
| `pnpm typecheck`    | TypeScript type checking across all packages |
| `pnpm lint`         | ESLint static analysis                       |
| `pnpm lint:fix`     | Auto-fix lint issues                         |
| `pnpm format`       | Format code with Prettier                    |
| `pnpm format:check` | Check code formatting                        |
| `pnpm test`         | Run all tests with Vitest                    |

## Project Structure

```text
uagent/
├── apps/
│   └── desktop/          # Electron + React desktop app
│       ├── src/
│       │   ├── main/     # Electron main process
│       │   ├── preload/  # Preload bridge
│       │   └── renderer/ # React SPA (workspace UI)
│       └── electron.vite.config.ts
├── packages/
│   ├── shared/           # Shared types and utilities
│   ├── runtime/          # Agent runtime engine
│   └── mcp-client/       # MCP client abstraction
├── docs/
│   ├── architecture.md
│   ├── mvp-roadmap.md
│   └── development.md
├── package.json          # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.json         # Base TypeScript config
└── eslint.config.mjs     # Flat ESLint config
```

## Technology Stack

- **Runtime**: Node.js >= 20
- **Language**: TypeScript 5.5+
- **Desktop**: Electron 31 + React 18
- **Build**: electron-vite + Vite 5
- **Package Manager**: pnpm 9+
- **Linting**: ESLint 9 (flat config) + Prettier
- **Testing**: Vitest

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
pnpm --filter @uagent/runtime test

# Watch mode
pnpm --filter @uagent/shared test:watch
```
