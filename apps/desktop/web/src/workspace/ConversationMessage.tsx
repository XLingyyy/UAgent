import {useI18n} from "../i18n";
import type { WorkspaceMessage } from "./workspace-data";
import "./ConversationMessage.css";

export interface ConversationMessageProps {
  message: WorkspaceMessage;
}

export function ConversationMessage({ message }: ConversationMessageProps) {
  const {text: uiText,t} = useI18n();
  const runtimeEvent=Boolean(message.eventType);
  const issue=runtimeEvent&&/(failed|cancelled|blocked|denied|timed_out)$/.test(message.eventType!);
  const rawHeading=!runtimeEvent||message.eventType==="task_submitted";
  return <article className={`ua-conversation-message ua-conversation-message--${message.kind}`} aria-label={t("workspace.messageLabel",{label:uiText(message.label),title:rawHeading?message.title:uiText(message.label)})}>
    <header className="ua-conversation-message__header"><span className="ua-conversation-message__label">{uiText(message.label)}</span><time className="ua-conversation-message__time">{message.timestamp}</time></header>
    <div className="ua-conversation-message__body">
      <h3 className="ua-conversation-message__title">{rawHeading?message.title:uiText(message.label)}</h3>
      {issue?<p>{uiText("The request did not complete. Review the details before retrying.")}</p>:<p className="ua-conversation-message__text">{message.body}</p>}
    </div>
    {runtimeEvent?<details className="ua-disclosure ua-event-details"><summary>{uiText("Technical details")}</summary><p>{message.title}</p>{issue&&<pre>{message.body}</pre>}<p>{uiText("Runtime event")}: <code>{message.eventType}</code></p></details>:<footer className="ua-conversation-message__meta">{message.meta}</footer>}
  </article>;
}
