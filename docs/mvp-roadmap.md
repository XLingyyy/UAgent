# UAgent MVP Roadmap

## MVP0 — Project Foundation (current)

- TypeScript monorepo baseline with pnpm workspaces
- Electron + React desktop shell with workspace layout
- Shared type definitions (messages, plans, tools, evidence)
- Runtime state machine placeholder
- MCP client type stubs
- Basic quality tooling: ESLint, Prettier, TypeScript, Vitest

Status: in progress

## MVP1 — Agent Core

- Agent loop: think → plan → act → observe → report
- Task/plan execution engine in `packages/runtime`
- Tool registry and dispatch
- Evidence recording and artifact storage (SQLite/JSONL)
- Basic system prompt and instruction following

## MVP2 — MCP Integration

- MCP client implementation with transport layer (Streamable HTTP default, legacy HTTP + SSE compat)
- Unreal MCP Server connection and profile management
- Tool discovery from connected MCP servers
- Resource and prompt listing

## MVP3 — LLM Provider

- Provider adapter interface (OpenAI, Anthropic, local)
- Streaming response handling
- Token accounting and cost estimation
- Model selection and fallback

## MVP4 — Workflow & Safety

- Approval workflow for tool execution
- Sandbox execution mode
- Rollback / promote for workspace state
- Audit log and session history

## Non-Goals (explicitly out of scope)

- Cloud deployment or SaaS platform
- Real-time collaboration
- Plugin marketplace
- Mobile or web-only client
- Direct fork or embedding of Codex/Claude Code/Cursor/Aider
