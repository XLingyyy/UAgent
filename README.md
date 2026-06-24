# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows — starting with Unreal Engine game development tooling.

## Current Stage: MVP0 — Project Foundation

Establishing the TypeScript monorepo baseline with Electron + React desktop shell, shared type definitions, runtime state machine, and MCP client abstractions. No real UE connection or LLM calls yet.

## Technology Stack

- **Desktop Shell**: Electron 31 + React 18 + Vite
- **Build**: electron-vite
- **Language**: TypeScript 5.5+ (strict mode)
- **Package Manager**: pnpm 9+ monorepo
- **Linting**: ESLint 9 (flat config) + Prettier
- **Testing**: Vitest

## Quick Start

```bash
pnpm install
pnpm dev          # Launch Electron desktop workspace
pnpm typecheck    # TypeScript checking
pnpm lint         # Static analysis
pnpm test         # Run test suite
```

## Project Structure

```
apps/desktop/         Electron + React desktop app
packages/shared/      Shared types (messages, plans, tools, evidence)
packages/runtime/     Agent state machine and task execution
packages/mcp-client/  MCP server profile and connection types
docs/                 Architecture, roadmap, development guide
```

## Non-Goals (MVP0)

- Real Unreal Engine connection or Editor launch
- Real LLM API calls or provider integration
- Cloud deployment, auth, or remote services
- Forking or embedding Codex/Claude Code/Cursor/Aider
- Production-level sandboxing, approval workflow, or promote/rollback

## Documentation

- [Architecture](docs/architecture.md)
- [MVP Roadmap](docs/mvp-roadmap.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
