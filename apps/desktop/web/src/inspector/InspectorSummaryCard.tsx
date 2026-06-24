import "./InspectorSummaryCard.css";

export interface InspectorSummaryCardProps {
  label: string;
  value: string;
  tone?: "default" | "warning" | "accent" | "success";
}

const TONE_CLASS: Record<string, string> = {
  default: "ua-summary-card--default",
  warning: "ua-summary-card--warning",
  accent: "ua-summary-card--accent",
  success: "ua-summary-card--success",
};

export function InspectorSummaryCard({
  label,
  value,
  tone = "default",
}: InspectorSummaryCardProps) {
  return (
    <div className={`ua-summary-card ${TONE_CLASS[tone] ?? TONE_CLASS.default}`}>
      <span className="ua-summary-card__label">{label}</span>
      <span className="ua-summary-card__value">{value}</span>
    </div>
  );
}
