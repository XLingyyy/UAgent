import { useEffect, type RefObject } from "react";

/** Keyboard navigation for a single portalled popup, including focus exit and restoration. */
export function useAccessiblePopup(open: boolean, trigger: RefObject<HTMLElement>, selector: string, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const popup = () => document.querySelector<HTMLElement>(selector);
    const items = () => Array.from(popup()?.querySelectorAll<HTMLElement>(
      '[role="option"]:not([aria-disabled="true"]), [role="menuitem"]:not([disabled]), button:not([disabled])',
    ) ?? []);
    const restore = () => { close(); trigger.current?.focus(); };
    const timer = window.setTimeout(() => {
      const root = popup();
      items().forEach((item) => { item.tabIndex = -1; });
      if (!root?.contains(document.activeElement)) (root?.querySelector<HTMLInputElement>('input') ?? items()[0])?.focus();
    }, 0);
    const keydown = (event: KeyboardEvent) => {
      const root = popup();
      if (!root || (!root.contains(event.target as Node) && event.target !== trigger.current)) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); restore(); return; }
      if (event.key === "Tab") { close(); trigger.current?.focus(); return; }
      const options = items();
      const current = options.indexOf(document.activeElement as HTMLElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        if ((event.key === "Home" || event.key === "End") && event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        const index = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : current < 0 ? (event.key === "ArrowDown" ? 0 : options.length - 1) : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[index]?.focus();
      } else if ((event.key === "Enter" || event.key === " ") && current >= 0) {
        event.preventDefault(); options[current].click();
        if (document.activeElement === options[current]) trigger.current?.focus();
      } else if (event.key.length === 1 && !(event.target instanceof HTMLInputElement) && !event.ctrlKey && !event.metaKey) {
        options.find((item) => item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
      }
    };
    const outside = (event: Event) => {
      if (!popup()?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("mousedown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, trigger, selector, close]);
}
