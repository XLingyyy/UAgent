import type { WorkspaceMessage } from "./workspace-data";
import "./ConversationMessage.css";

export interface ConversationMessageProps {
  message: WorkspaceMessage;
}

export function ConversationMessage({ message }: ConversationMessageProps) {
  return (
    <article
      className={`ua-conversation-message ua-conversation-message--${message.kind}`}
      aria-label={`${message.label}: ${message.title}`}
    >
      <header className="ua-conversation-message__header">
        <span className="ua-conversation-message__label">{message.label}</span>
        <time className="ua-conversation-message__time">{message.timestamp}</time>
      </header>
      <div className="ua-conversation-message__body">
        <h3 className="ua-conversation-message__title">{message.title}</h3>
        <p className="ua-conversation-message__text">{message.body}</p>
      </div>
      <footer className="ua-conversation-message__meta">{message.meta}</footer>
    </article>
  );
}
