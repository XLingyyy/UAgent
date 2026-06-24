import type { WorkspaceState, ChatMessage, PlanItem, ToolCall, Evidence } from "@uagent/shared";
import { useState } from "react";

const INITIAL_STATE: WorkspaceState = {
  messages: [
    {
      id: "welcome",
      role: "assistant",
      content: "Welcome to UAgent Workspace.",
      timestamp: Date.now(),
    },
  ],
  plan: [
    {
      id: "1",
      status: "pending",
      title: "Project foundation",
      description: "Set up monorepo baseline.",
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: "2",
      status: "pending",
      title: "MCP integration",
      description: "Connect to Unreal MCP Server.",
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: "3",
      status: "pending",
      title: "Agent runtime",
      description: "Implement agent state machine.",
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
  timeline: [
    {
      id: "t1",
      toolName: "workspace.init",
      args: {},
      status: "completed",
      startedAt: Date.now() - 60000,
      finishedAt: Date.now(),
      result: "ok",
      error: null,
    },
  ],
  evidence: [
    {
      id: "e1",
      type: "log",
      source: "UAgent",
      data: { level: "info", message: "Workspace initialized." },
      capturedAt: Date.now(),
    },
  ],
};

export default function App() {
  const [state] = useState<WorkspaceState>(INITIAL_STATE);

  return (
    <div className="workspace">
      <header className="workspace-header">
        <h1>UAgent Workspace</h1>
        <span className="version-badge">MVP0</span>
      </header>
      <main className="workspace-main">
        <Panel title="Chat / Command" area="chat">
          <MessageList messages={state.messages} />
        </Panel>
        <Panel title="Plan" area="plan">
          <PlanList items={state.plan} />
        </Panel>
        <Panel title="Tool Timeline" area="timeline">
          <TimelineList tools={state.timeline} />
        </Panel>
        <Panel title="Evidence" area="evidence">
          <EvidenceList evidence={state.evidence} />
        </Panel>
      </main>
    </div>
  );
}

function Panel({
  title,
  area,
  children,
}: {
  title: string;
  area: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel panel-${area}`}>
      <h2 className="panel-title">{title}</h2>
      <div className="panel-content">{children}</div>
    </section>
  );
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="message-list">
      {messages.map((m) => (
        <div key={m.id} className={`message message-${m.role}`}>
          <span className="message-role">{m.role}</span>
          <span className="message-text">{m.content}</span>
        </div>
      ))}
    </div>
  );
}

function PlanList({ items }: { items: PlanItem[] }) {
  return (
    <ul className="plan-list">
      {items.map((item) => (
        <li key={item.id} className={`plan-item plan-${item.status}`}>
          <span className="plan-status">{item.status}</span>
          <span className="plan-title">{item.title}</span>
        </li>
      ))}
    </ul>
  );
}

function TimelineList({ tools }: { tools: ToolCall[] }) {
  return (
    <ul className="timeline-list">
      {tools.map((t) => (
        <li key={t.id} className={`timeline-item timeline-${t.status}`}>
          <span className="timeline-tool">{t.toolName}</span>
          <span className="timeline-status">{t.status}</span>
          {t.result != null && <span className="timeline-result">{JSON.stringify(t.result)}</span>}
        </li>
      ))}
    </ul>
  );
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return (
    <ul className="evidence-list">
      {evidence.map((e) => (
        <li key={e.id} className={`evidence-item evidence-${e.type}`}>
          <span className="evidence-type">{e.type}</span>
          <span className="evidence-source">{e.source}</span>
          <span className="evidence-time">{new Date(e.capturedAt).toLocaleTimeString()}</span>
        </li>
      ))}
    </ul>
  );
}
