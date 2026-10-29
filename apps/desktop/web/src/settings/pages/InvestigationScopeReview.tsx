import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./InvestigationScopeReview.css";
import { useI18n } from "../../i18n";
import {
  investigationScopeGate,
  type createInvestigationScopeGate,
} from "../../runtime/investigation-scope-gate";
import { useComposerStore, useProjectStore } from "../../stores/ui-store";
export function InvestigationScopeReview({
  gate = investigationScopeGate,
}: {
  gate?: ReturnType<typeof createInvestigationScopeGate>;
}) {
  const { t } = useI18n(),
    pending = useSyncExternalStore(gate.subscribe, gate.getPending, gate.getPending);
  const project = useProjectStore((s) => s.activeProjectId),
    input = useComposerStore((s) => s.input),
    model = useComposerStore((s) => s.selectedModelId);
  const [prefixes, setPrefixes] = useState("Source, Config"),
    [whole, setWhole] = useState(false),
    [share, setShare] = useState(false),
    [limit, setLimit] = useState(3),
    [error, setError] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    gate.invalidate();
    return () => gate.invalidate();
  }, [gate, project, input, model]);
  useEffect(() => {
    if (!pending) return;
    setPrefixes("Source, Config");
    setWhole(false);
    setShare(false);
    setLimit(3);
    setError(false);
    const previous = document.activeElement as HTMLElement | null,
      node = panel.current,
      app = document.querySelector<HTMLElement>(".ua-app"),
      wasInert = app?.hasAttribute("inert");
    app?.setAttribute("inert", "");
    node?.querySelector<HTMLElement>("input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        gate.invalidate();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          node?.querySelectorAll<HTMLElement>("input,button") ?? [],
        ).filter((control) => !control.hasAttribute("disabled"));
        const first = controls[0],
          last = controls.at(-1);
        if (
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    node?.addEventListener("keydown", key);
    return () => {
      node?.removeEventListener("keydown", key);
      if (!wasInert) app?.removeAttribute("inert");
      if (previous?.isConnected) previous.focus();
    };
  }, [pending?.id, gate]);
  if (!pending) return null;
  const p = pending.proposal;
  return (
    <section
      ref={panel}
      className="ua-outbound-review ua-investigation-review"
      role="dialog"
      aria-modal="true"
      aria-label={t("run.scopeTitle")}
    >
      <h2>{t("run.scopeTitle")}</h2>
      <p>{t("run.scopeHint")}</p>
      <dl className="ua-outbound-identifiers">
        <div>
          <dt>{p.projectName}</dt>
          <dd>{p.modelId}</dd>
        </div>
        <div>
          <dt>{t("run.goal")}</dt>
          <dd>{p.goal}</dd>
        </div>
      </dl>
      <p>
        <code>{p.endpoint}</code>
      </p>
      <label className="ua-scope-field">
        {t("run.prefixes")}
        <input
          type="text"
          value={prefixes}
          disabled={whole}
          onChange={(event) => setPrefixes(event.target.value)}
          aria-describedby="run-prefix-hint"
        />
      </label>
      <p id="run-prefix-hint">{t("run.prefixHint")}</p>
      <label className="ua-scope-option">
        <input
          type="checkbox"
          checked={whole}
          onChange={(event) => setWhole(event.target.checked)}
        />
        {t("run.wholeProject")}
      </label>
      <label className="ua-scope-option">
        <input
          type="checkbox"
          checked={share}
          onChange={(event) => setShare(event.target.checked)}
        />
        {t("run.shareResults")}
      </label>
      <p>{t("run.noShare")}</p>
      <label className="ua-scope-field">
        {t("run.callLimit")}
        <input
          type="number"
          min={1}
          max={30}
          value={limit}
          onChange={(event) => setLimit(Number(event.target.value))}
        />
      </label>
      <p>{t("run.stopLimits")}</p>
      {error && <p role="alert">{t("run.invalidScope")}</p>}
      <button
        className="ua-btn ua-btn--primary"
        type="button"
        onClick={() =>
          setError(
            !gate.approve(pending.id, {
              prefixes: whole
                ? [""]
                : prefixes
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
              shareResults: share,
              maxToolCalls: limit,
            }),
          )
        }
      >
        {t("run.approveScope")}
      </button>
      <button className="ua-btn" type="button" onClick={() => gate.invalidate()}>
        {t("common.cancel")}
      </button>
    </section>
  );
}
