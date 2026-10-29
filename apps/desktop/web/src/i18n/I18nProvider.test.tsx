import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./I18nProvider";
import { createLocaleStore } from "./locale-store";

afterEach(cleanup);

function Switcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <button onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}>
      {t("settings.language")}
    </button>
  );
}
function Copy() {
  const { t, text } = useI18n();
  return (
    <p>
      {t("common.cancel")} / {text("Confirm this exact outbound request")}
    </p>
  );
}

describe("React language switching", () => {
  it("updates every subscriber and the document language immediately", () => {
    const store = createLocaleStore({ storage: null, eventTarget: null });
    render(
      <I18nProvider store={store}>
        <Switcher />
        <Copy />
      </I18nProvider>,
    );
    expect(screen.getByRole("button").textContent).toBe("界面语言");
    expect(screen.getByText("取消 / 确认本次出站请求")).toBeTruthy();
    expect(document.documentElement.lang).toBe("zh-CN");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("Language");
    expect(screen.getByText("Cancel / Confirm this exact outbound request")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("取消 / 确认本次出站请求")).toBeTruthy();
  });

  it("allows an isolated English surface without changing another provider", () => {
    const zh = createLocaleStore({ storage: null, eventTarget: null });
    const en = createLocaleStore({ initialLocale: "en", storage: null, eventTarget: null });
    render(
      <>
        <I18nProvider store={zh}>
          <Copy />
        </I18nProvider>
        <I18nProvider store={en}>
          <Copy />
        </I18nProvider>
      </>,
    );
    expect(screen.getByText("取消 / 确认本次出站请求")).toBeTruthy();
    expect(screen.getByText("Cancel / Confirm this exact outbound request")).toBeTruthy();
  });
});
