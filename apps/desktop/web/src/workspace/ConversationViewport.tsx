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
          <h2 className="ua-conversation-viewport__title">Activity timeline</h2>
          <p className="ua-conversation-viewport__subtitle">
            Static mock lane for requests, plans, tool events, and review summaries.
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
