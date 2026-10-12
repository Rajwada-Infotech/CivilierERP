import { useEffect } from "react";

const CHECK_MS = 60_000;
const SETTLE_MS = 4_000;
/** Typing in a field counts as data entry for this long after the last keystroke. */
const TYPING_GRACE_MS = 2 * 60_000;
const FORM_PATH = /\/(new|create|add|edit)(\/|$)/i;

const entryScript = (html: string) => /<script[^>]+type="module"[^>]+src="([^"]+)"/i.exec(html)?.[1] ?? null;

/**
 * After a new build goes live, an open tab keeps running the old one until it reloads. This reloads it - but only
 * when the person is not entering data: never while a dialog or a form route is open, a field has focus, or they
 * typed in the last two minutes. A list/report screen is refreshed straight away; a form waits until it is saved
 * and closed (the same check keeps running).
 */
export function NewBuildWatcher() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let current: string | null = null;
    let stale = false;
    let lastTyped = 0;
    const onInput = () => { lastTyped = Date.now(); };
    document.addEventListener("input", onInput, true);

    const busy = () => {
      if (FORM_PATH.test(window.location.pathname)) return true;
      if (Date.now() - lastTyped < TYPING_GRACE_MS) return true;
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return true;
      const a = document.activeElement as HTMLElement | null;
      return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    };

    const check = async () => {
      try {
        const res = await fetch("/index.html", { cache: "no-store" });
        if (!res.ok) return;
        const latest = entryScript(await res.text());
        if (!latest) return;
        if (current === null) current = latest;
        else if (latest !== current) stale = true;
      } catch {
        /* offline or mid-deploy: try again next time */
      }
    };

    const first = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute("src");
    current = first ?? null;
    const poll = window.setInterval(() => { if (!stale && !document.hidden) void check(); }, CHECK_MS);
    const settle = window.setInterval(() => { if (stale && !busy()) window.location.reload(); }, SETTLE_MS);
    return () => {
      document.removeEventListener("input", onInput, true);
      window.clearInterval(poll);
      window.clearInterval(settle);
    };
  }, []);

  return null;
}
