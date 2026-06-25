import "./ContextRing.css";

export interface ContextRingProps {
  used: number;
  total: number;
  percent: number;
  label?: string;
}

function formatTooltip(used: number, total: number, percent: number): string {
  const usedStr = used.toLocaleString("en-US");
  const totalStr = total.toLocaleString("en-US");
  const remaining = 100 - percent;
  return `Context: ${usedStr} / ${totalStr} used (${percent}%, ${remaining}% remaining)`;
}

function getStatusClass(percent: number): string {
  if (percent <= 60) return "ua-context-ring--normal";
  if (percent <= 85) return "ua-context-ring--attention";
  return "ua-context-ring--warning";
}

export function ContextRing({ used, total, percent }: ContextRingProps) {
  const r = 10;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (percent / 100) * circumference;
  const tooltip = formatTooltip(used, total, percent);
  const statusClass = getStatusClass(percent);

  return (
    <span
      className={`ua-context-ring ${statusClass}`}
      aria-label={tooltip}
      title={tooltip}
      data-context-status={percent <= 60 ? "normal" : percent <= 85 ? "attention" : "warning"}
    >
      <svg
        className="ua-context-ring__svg"
        viewBox="0 0 24 24"
        width={20}
        height={20}
        aria-hidden="true"
      >
        <circle
          className="ua-context-ring__track"
          cx={12}
          cy={12}
          r={r}
          fill="none"
          strokeWidth={2}
        />
        <circle
          className="ua-context-ring__progress"
          cx={12}
          cy={12}
          r={r}
          fill="none"
          strokeWidth={2}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="ua-context-ring__value">{percent}%</span>
    </span>
  );
}
