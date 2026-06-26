import {
  cloneElement,
  isValidElement,
  useId,
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
  /**
   * When true, the wrapper uses block-level display instead of inline-block.
   * Use for block children (div, textarea) to prevent shrink-wrap squeezing.
   */
  blockChild?: boolean;
}

interface ComingSoonChildProps {
  className?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  tabIndex?: number;
  title?: string;
  "aria-disabled"?: string;
  "aria-describedby"?: string;
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

export function ComingSoonGate({ phase, reason, children, blockChild }: ComingSoonGateProps) {
  const tooltipId = `ua-coming-soon-tooltip-${useId()}`;

  if (!isValidElement(children)) {
    return children;
  }

  const message = `Coming in ${phase}: ${reason}`;
  const child = children as ReactElement<ComingSoonChildProps>;
  const childProps = child.props;

  return (
    <span
      className="ua-coming-soon"
      data-coming-soon-block={blockChild ? "" : undefined}
      title={message}
      aria-label={message}
    >
      {cloneElement(child, {
        className: `${childProps.className ?? ""} ua-coming-soon__target`.trim(),
        title: message,
        "aria-disabled": "true",
        "aria-describedby": tooltipId,
        "data-coming-soon-phase": phase,
        tabIndex: childProps.tabIndex ?? 0,
        onClick: blockClick,
        onKeyDown: createBlockedKeyHandler(childProps.onKeyDown),
      })}
      <span id={tooltipId} role="tooltip" className="ua-coming-soon__tooltip">
        {message}
      </span>
    </span>
  );
}
