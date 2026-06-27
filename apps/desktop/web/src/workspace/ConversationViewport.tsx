import { ConversationMessage } from "./ConversationMessage";
import { workspaceMessages, type WorkspaceMessage } from "./workspace-data";
import {
  mapTaskEventToWorkspaceMessage,
  extractProviderStreamText,
} from "../runtime/event-view-models";
import { useRuntimeStore, useThreadStore } from "../stores/ui-store";
import "./ConversationViewport.css";

function mcpBadgeLabel(status: string, capabilities: unknown): string {
  if (status === "connected" && capabilities) return "MCP read-only";
  if (status === "connected") return "Discovery required";
  return "Mock only";
}

export interface ConversationViewportProps {
  messages?: WorkspaceMessage[];
}

export function ConversationViewport({ messages = workspaceMessages }: ConversationViewportProps) {
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const runtimeEvents = useRuntimeStore((state) =>
    activeThreadId ? (state.eventsByTaskId[activeThreadId] ?? null) : null,
  );
  const runtimeMessages = runtimeEvents?.map(mapTaskEventToWorkspaceMessage);
  const providerStreamText = runtimeEvents ? extractProviderStreamText(runtimeEvents) : null;
  const visibleMessages = runtimeMessages && runtimeMessages.length > 0 ? runtimeMessages : messages;
  const mcpStatus = useRuntimeStore((state) => state.mcp.status);
  const mcpCapabilities = useRuntimeStore((state) => state.mcp.capabilities);

  return (
    <section className="ua-conversation-viewport" aria-label="Conversation activity">
      <div className="ua-conversation-viewport__header">
        <div>
          <h2 className="ua-conversation-viewport__title">Conversation</h2>
          <p className="ua-conversation-viewport__subtitle">
            Requests, plans, MCP read-only events, provider streaming, evidence, and review summaries.
          </p>
        </div>
        <span className="ua-conversation-viewport__badge">
          {mcpBadgeLabel(mcpStatus, mcpCapabilities)}
        </span>
      </div>
      <div className="ua-conversation-viewport__list">
        {visibleMessages.map((message) => (
          <ConversationMessage key={message.id} message={message} />
        ))}
      </div>
      {providerStreamText && providerStreamText.length > 0 && (
        <div className="ua-conversation-viewport__provider-stream">
          <span className="ua-conversation-viewport__stream-label">Provider stream</span>
          <p className="ua-conversation-viewport__stream-text">{providerStreamText}</p>
        </div>
      )}
    </section>
  );
}
