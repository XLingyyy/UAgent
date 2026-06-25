import {
  cloneElement,
  isValidElement,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import "./ComingSoonGate.css";

export type ComingSoonPhase = "MVP1" | "MVP2" | "MVP3" | "MVP4";

export interface ComingSoonGateProps {
  phase: ComingSoonPhase;
  reason: string;
  children: ReactElement;
}

interface ComingSoonChildProps {
  className?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  tabIndex?: number;
  title?: string;
  "aria-disabled"?: string;
  "data-coming-soon-phase"?: string;
}

export function getComingSoonPhase(disabledReason?: string): ComingSoonPhase | null {
  if (!disabledReason) {
    return null;
  }

  const match = disabledReason.match(/MVP[1-4]/)?.[0] as ComingSoonPhase | undefined;
  return match ?? null;
}

function blockClick(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function createBlockedKeyHandler(originalHandler?: (event: KeyboardEvent<HTMLElement>) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    originalHandler?.(event);
  };
}

export function ComingSoonGate({ phase, reason, children }: ComingSoonGateProps) {
  if (!isValidElement(children)) {
    return children;
  }

  const message = `Coming in ${phase}: ${reason}`;
  const child = children as ReactElement<ComingSoonChildProps>;
  const childProps = child.props;

  return (
    <span className="ua-coming-soon" title={message} aria-label={message}>
      {cloneElement(child, {
        className: `${childProps.className ?? ""} ua-coming-soon__target`.trim(),
        title: message,
        "aria-disabled": "true",
        "data-coming-soon-phase": phase,
        tabIndex: childProps.tabIndex ?? 0,
        onClick: blockClick,
        onKeyDown: createBlockedKeyHandler(childProps.onKeyDown),
      })}
    </span>
  );
}
