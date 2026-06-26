import type { MockThread } from "../types/ui";
import "./ThreadSection.css";

const THREAD_TYPE_VARIANT: Record<MockThread["type"], string> = {
  Plan: "ua-thread-badge--plan",
  Build: "ua-thread-badge--build",
  Review: "ua-thread-badge--review",
  Runtime: "ua-thread-badge--plan",
};

export interface ThreadSectionProps {
  threads: MockThread[];
  activeThreadId: string | null;
  onThreadSelect: (threadId: string) => void;
}

export function ThreadSection({ threads, activeThreadId, onThreadSelect }: ThreadSectionProps) {
  return (
    <section className="ua-thread-section" aria-label="Threads">
      <div className="ua-thread-section__header">
        <span className="ua-thread-section__label">Threads</span>
      </div>
      <div className="ua-thread-section__list" role="listbox" aria-label="Thread list">
        {threads.map((thread) => (
          <button
            key={thread.id}
            className={`ua-thread-item${activeThreadId === thread.id ? " ua-thread-item--active" : ""}`}
            onClick={() => onThreadSelect(thread.id)}
            role="option"
            aria-selected={activeThreadId === thread.id}
            type="button"
          >
            <div className="ua-thread-item__main">
              <span className="ua-thread-item__title">{thread.title}</span>
              <span className="ua-thread-item__time">{thread.updatedAt}</span>
            </div>
            <span className={`ua-thread-badge ${THREAD_TYPE_VARIANT[thread.type]}`}>
              {thread.type}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
