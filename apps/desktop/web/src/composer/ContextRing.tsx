import "./ContextRing.css";

export interface ContextRingProps {
  percent: number;
  label?: string;
}

export function ContextRing({ percent, label = "context" }: ContextRingProps) {
  const r = 10;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <span
      className="ua-context-ring"
      aria-label={`${label}: ${percent}% used`}
      title={`Context: ${percent}% used`}
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
