# UAgent MVP Roadmap

## MVP0 — Project Foundation

- TypeScript monorepo baseline with pnpm workspaces
- Shared type definitions (messages, plans, tools, evidence)
- Runtime state machine placeholder
- MCP client type stubs
- Basic quality tooling: ESLint, Prettier, TypeScript, Vitest

Status: complete

## MVP0.5 — UI Shell Foundation (current)

- Tauri 2 + React + Vite desktop shell
- AppShell skeleton: TitleBar, LeftSidebar, Workspace, InspectorPane, GlobalOverlays
- Dark theme token system and animation token system
- Three-column layout with inspector open/close state
- ComposerDock and ConversationViewport placeholders
- UI smoke tests with Testing Library

## MVP1 — UI Shell Expansion

- Left Sidebar: PrimaryNav, project list, conversation list
- UE project tree (static / semi-dynamic)
- Central Workspace: WelcomeHero, ConversationViewport
- ComposerDock: permissions, project, mode, model, ContextRing
- Right InspectorPane: review tab, diagnostics, animations
- SettingsShell with six settings page skeletons
- ProviderSettings and Composer model selection
- ComingSoonGate for disabled feature entries
- Zustand store layer, Runtime mock event integration
- Long-list virtualization and performance checks
- UI regression tests and visual acceptance

## MVP2 — Agent Core

- Agent loop: think → plan → act → observe → report
- Task/plan execution engine in `packages/runtime`
- Tool registry and dispatch
- Evidence recording and artifact storage (SQLite/JSONL)
- Basic system prompt and instruction following

## MVP3 — MCP Integration

- MCP client implementation with transport layer (Streamable HTTP default, legacy HTTP + SSE compat)
- Unreal MCP Server connection and profile management
- Tool discovery from connected MCP servers
- Resource and prompt listing

## MVP4 — LLM Provider

- Provider adapter interface (OpenAI, Anthropic, local)
- Streaming response handling
- Token accounting and cost estimation
- Model selection and fallback

## MVP5 — Workflow & Safety

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
