import {responsesFailureHint,OPENAI_MODEL_DOCS} from "../runtime/responses-failure-hints";
import {useI18n} from "../i18n";
import type { WorkspaceMessage } from "./workspace-data";
import "./ConversationMessage.css";

export interface ConversationMessageProps {
  message: WorkspaceMessage;
}

export function ConversationMessage({ message }: ConversationMessageProps) {
  const {text: uiText,t,locale} = useI18n();
  const hint=message.eventType==="provider_request_failed"?responsesFailureHint(message.body,locale):null;
  const runtimeEvent=Boolean(message.eventType);
  const issue=runtimeEvent&&/(failed|cancelled|blocked|denied|timed_out)$/.test(message.eventType!);
  const rawHeading=!runtimeEvent||message.eventType==="task_submitted";
  const heading=rawHeading?(runtimeEvent?uiText(message.title):message.title):uiText(message.label);
  return <article className={`ua-conversation-message ua-conversation-message--${message.kind}`} aria-label={t("workspace.messageLabel",{label:uiText(message.label),title:heading})}>
    <header className="ua-conversation-message__header"><span className="ua-conversation-message__label">{uiText(message.label)}</span><time className="ua-conversation-message__time">{message.timestamp}</time></header>
    <div className="ua-conversation-message__body">
      <h3 className="ua-conversation-message__title">{heading}</h3>
      {issue?<p>{hint?.summary??uiText("The request did not complete. Review the details before retrying.")}{hint?.modelDocs&&<> <a href={OPENAI_MODEL_DOCS} target="_blank" rel="noreferrer">{t("responses.modelDocs")}</a></>}</p>:<p className="ua-conversation-message__text">{message.body}</p>}
    </div>
    {runtimeEvent?<details className="ua-disclosure ua-event-details"><summary>{uiText("Technical details")}</summary><p>{message.title}</p>{issue&&<pre>{message.body}</pre>}<p>{uiText("Runtime event")}: <code>{message.eventType}</code></p></details>:<footer className="ua-conversation-message__meta">{message.meta}</footer>}
  </article>;
}
