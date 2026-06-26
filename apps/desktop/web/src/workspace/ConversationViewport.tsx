import { ConversationMessage } from "./ConversationMessage";
import { workspaceMessages, type WorkspaceMessage } from "./workspace-data";
import "./ConversationViewport.css";

export interface ConversationViewportProps {
  messages?: WorkspaceMessage[];
}

export function ConversationViewport({ messages = workspaceMessages }: ConversationViewportProps) {
  return (
    <section className="ua-conversation-viewport" aria-label="Conversation activity">
      <div className="ua-conversation-viewport__header">
        <div>
          <h2 className="ua-conversation-viewport__title">Conversation</h2>
          <p className="ua-conversation-viewport__subtitle">
            Requests, plans, tool notes, and review summaries for this mock thread.
          </p>
        </div>
        <span className="ua-conversation-viewport__badge">Mock only</span>
      </div>
      <div className="ua-conversation-viewport__list">
        {messages.map((message) => (
          <ConversationMessage key={message.id} message={message} />
        ))}
      </div>
    </section>
  );
}
