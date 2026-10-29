import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { reviewMessages, reviewText, type ReviewMessageKey } from "./messages";
import type {
  OperationReviewDocument,
  ReviewAction,
  ReviewDecision,
  ReviewItem,
  ReviewState,
} from "./types";
import "./OperationReview.css";

export interface OperationReviewProps {
  document: OperationReviewDocument;
  /** Default is an unmistakably labelled UI demonstration. */
  environment?: "development-preview" | "host";
  approval?: ReviewAction;
  inspection?: ReviewAction;
  onDismiss?: () => void;
}
const states: ReviewState[] = ["planned", "completed", "failed", "unknown", "not-started"];
function TargetIcon({ kind }: { kind: ReviewItem["kind"] }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {kind === "file" ? (
        <>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v5h5M10 12h5M10 16h5" />
        </>
      ) : kind === "object" ? (
        <>
          <path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6m0 3v1" />
        </>
      )}
    </svg>
  );
}
function ChangeDiff({ value, label }: { value: string; label: string }) {
  const [full, setFull] = useState(false),
    { locale } = useI18n();
  const lines = value.split(/\r?\n/),
    shown = lines.slice(0, 160),
    clippedLines = lines.length > shown.length,
    clippedCharacters = shown.some((line) => line.length > 1000),
    isLong = clippedLines || clippedCharacters;
  const hint = [
    ...(clippedLines ? [reviewText(locale, "truncated", { count: shown.length })] : []),
    ...(clippedCharacters ? [reviewText(locale, "truncatedCharacters", { count: 1000 })] : []),
  ].join(" · ");
  return (
    <div className="ua-operation-review__diff">
      <pre tabIndex={0} aria-label={label}>
        <code>
          {full
            ? value
            : shown.map((line, index) => (
                <span
                  key={index}
                  className={
                    line.startsWith("+") && !line.startsWith("+++")
                      ? "is-added"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "is-removed"
                        : "is-context"
                  }
                >
                  {line.slice(0, 1000) || " "}
                </span>
              ))}
        </code>
      </pre>
      {isLong && (
        <div className="ua-operation-review__diff-more">
          <p className="ua-operation-review__muted">{!full ? hint : null}</p>
          <button type="button" onClick={() => setFull((value) => !value)}>
            {reviewText(locale, full ? "lessDiff" : "fullDiff")}
          </button>
        </div>
      )}
    </div>
  );
}
export function OperationReview(props: OperationReviewProps) {
  // A new bound document gets independent disclosure/action state. This never restores approval.
  return (
    <ReviewBody
      key={JSON.stringify([
        props.document.id,
        props.document.revision,
        props.document.mode,
        props.document.source,
      ])}
      {...props}
    />
  );
}
function ReviewBody({
  document,
  environment = "development-preview",
  approval,
  inspection,
  onDismiss,
}: OperationReviewProps) {
  const { locale } = useI18n(),
    headingId = useId(),
    active = useRef(true),
    action = useRef<"idle" | "pending" | "sent">("idle");
  const [expanded, setExpanded] = useState(false),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState<"sent" | "checked" | "actionFailed" | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const text = (key: ReviewMessageKey, params?: Readonly<Record<string, string | number>>) =>
    reviewText(locale, key, params);
  const duplicateIds =
    new Set(document.items.map((item) => item.id)).size !== document.items.length;
  const items = document.items.map((item) => {
    const known = states.includes(item.state),
      state: ReviewState =
        !known || duplicateIds || (document.integrity !== "complete" && item.state === "completed")
          ? "unknown"
          : document.mode === "preview"
            ? item.state === "planned"
              ? "planned"
              : "unknown"
            : item.state === "planned"
              ? "unknown"
              : item.state;
    return {
      ...item,
      state,
      changes: item.changes?.map((change) => ({ ...change })),
      notes: item.notes ? [...item.notes] : undefined,
    };
  });
  const incomplete =
    document.integrity !== "complete" ||
    duplicateIds ||
    (document.mode === "preview" && items.some((item) => item.state !== "planned"));
  const counts = Object.fromEntries(
    states.map((state) => [state, items.filter((item) => item.state === state).length]),
  ) as Record<ReviewState, number>;
  const decision: ReviewDecision = Object.freeze({
    reviewId: document.id,
    revision: document.revision,
  });
  const matches = (action: ReviewAction | undefined) =>
    action?.enabled === true &&
    action.reviewId === decision.reviewId &&
    action.revision === decision.revision &&
    typeof action.onRequest === "function";
  const approvable =
    document.mode === "preview" &&
    document.source !== "effects" &&
    items.length > 0 &&
    !incomplete &&
    matches(approval);
  const inspectable = document.mode === "result" && counts.unknown > 0 && matches(inspection);
  const callback = document.mode === "preview" ? approval?.onRequest : inspection?.onRequest;
  const canRequest = document.mode === "preview" ? approvable : inspectable;
  const requested = notice === "sent" || notice === "checked";
  const request = async () => {
    if (!canRequest || action.current !== "idle" || !callback) return;
    action.current = "pending";
    setPending(true);
    setNotice(null);
    try {
      await callback(decision);
      if (active.current) {
        action.current = "sent";
        setNotice(document.mode === "preview" ? "sent" : "checked");
      }
    } catch {
      if (active.current) {
        action.current = "idle";
        setNotice("actionFailed");
      }
    } finally {
      if (active.current) setPending(false);
    }
  };
  const notices = [
    ...new Set([...(document.notices ?? []), ...(incomplete ? ["incomplete" as const] : [])]),
  ];
  const visible = expanded ? items : items.slice(0, 6);
  const propertyLabel = (label: string) =>
    Object.hasOwn(reviewMessages, label) ? text(label as ReviewMessageKey) : label;
  return (
    <section className="ua-operation-review" aria-labelledby={headingId}>
      <header className="ua-operation-review__header">
        <div className="ua-operation-review__heading">
          <p className="ua-operation-review__eyebrow">
            {text(("source_" + document.source) as ReviewMessageKey)}
          </p>
          <h2 id={headingId}>{document.title}</h2>
        </div>
        <span className={"ua-operation-review__phase is-" + document.mode}>
          {text(document.mode === "preview" ? "preview" : "result")}
        </span>
      </header>
      {environment === "development-preview" && (
        <p className="ua-operation-review__development">
          <span>{text("development")}</span>
          <span>{text("developmentHint")}</span>
        </p>
      )}
      <div
        className="ua-operation-review__summary"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <strong>{text("total", { count: items.length })}</strong>
        <div className="ua-operation-review__counts">
          {(document.mode === "preview"
            ? (["planned", "unknown"] as const)
            : (["completed", "failed", "unknown", "not-started"] as const)
          )
            .filter((state) => document.mode === "result" || counts[state] > 0)
            .map((state) => (
              <span
                key={state}
                className={
                  "ua-operation-review__count is-" + state + (counts[state] === 0 ? " is-zero" : "")
                }
              >
                <i aria-hidden="true" />
                <b>{counts[state]}</b> {text(state)}
              </span>
            ))}
        </div>
      </div>
      {notices.length > 0 && (
        <div className="ua-operation-review__notices">
          {notices.map((key) => (
            <p key={key}>{text(key)}</p>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <p className="ua-operation-review__empty">{text("empty")}</p>
      ) : (
        <ul className="ua-operation-review__list">
          {visible.map((item, index) => (
            <li key={item.id + ":" + index} className="ua-operation-review__item">
              <details>
                <summary>
                  <span className="ua-operation-review__target-icon">
                    <TargetIcon kind={item.kind} />
                  </span>
                  <span className="ua-operation-review__target">
                    <span>{item.target}</span>
                    <small>{text(item.operation)}</small>
                  </span>
                  <span className={"ua-operation-review__item-state is-" + item.state}>
                    <i aria-hidden="true" />
                    {text(item.state)}
                  </span>
                  <svg
                    className="ua-operation-review__chevron"
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </summary>
                <div className="ua-operation-review__details" aria-label={text("details")}>
                  {item.changes?.length ? (
                    <dl className="ua-operation-review__properties">
                      {item.changes.map((change, i) => (
                        <div key={change.label + ":" + i}>
                          <dt>{propertyLabel(change.label)}</dt>
                          <dd>
                            <span>
                              <small>{text("before")}</small>
                              <code>{change.before ?? text("notPresent")}</code>
                            </span>
                            <span>
                              <small>{text("after")}</small>
                              <code>{change.after ?? text("notPresent")}</code>
                            </span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {item.diff !== undefined &&
                    (item.diff.length === 0 ? (
                      <p className="ua-operation-review__muted">{text("noDisplayableDiff")}</p>
                    ) : (
                      <ChangeDiff value={item.diff} label={text("diff") + ": " + item.target} />
                    ))}
                  {item.notes?.length ? (
                    <ul className="ua-operation-review__notes">
                      {item.notes.map((note, i) => (
                        <li key={i}>{propertyLabel(note)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {item.diff === undefined && !item.changes?.length && !item.notes?.length && (
                    <p className="ua-operation-review__muted">{text("notRecorded")}</p>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {items.length > 6 && (
        <button
          className="ua-operation-review__show-more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? text("less") : text("more", { count: items.length - 6 })}
        </button>
      )}
      <footer className="ua-operation-review__footer">
        <p
          role={notice === "actionFailed" ? "alert" : "status"}
          className="ua-operation-review__action-status"
        >
          {notice
            ? text(notice)
            : document.mode === "preview" && !approvable
              ? text("noApproval")
              : ""}
        </p>
        <div className="ua-operation-review__actions">
          {onDismiss && (
            <button type="button" className="ua-operation-review__secondary" onClick={onDismiss}>
              {text("dismiss")}
            </button>
          )}
          {(document.mode === "preview" || counts.unknown > 0) && (
            <button
              type="button"
              className="ua-operation-review__primary"
              disabled={!canRequest || pending || requested}
              aria-busy={pending}
              onClick={() => void request()}
            >
              {pending
                ? text("pending")
                : document.mode === "preview"
                  ? text(environment === "development-preview" ? "simulateApprove" : "approve")
                  : text(
                      environment === "development-preview" ? "simulateInspect" : "inspectState",
                    )}
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
