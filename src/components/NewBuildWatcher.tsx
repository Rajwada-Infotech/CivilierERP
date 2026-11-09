import { useEffect } from "react";

const CHECK_MS = 60_000;
const SETTLE_MS = 4_000;
/** Typing in a field counts as data entry for this long after the last keystroke. */
const TYPING_GRACE_MS = 2 * 60_000;
/** Any tap, click or key counts as working for this long — dragging a progress bar to 100% on Reporting is work too. */
const ACTIVE_GRACE_MS = 30_000;
const FORM_PATH = /\/(new|create|add|edit)(\/|$)/i;

const entryScript = (html: string) => /<script[^>]+type="module"[^>]+src="([^"]+)"/i.exec(html)?.[1] ?? null;

/**
 * After a new build goes live, an open tab keeps running the old one until it reloads. This reloads it - but only
 * when the person is not working: never while a dialog, pop-up or form route is open, a field has focus, they typed
 * in the last two minutes, or tapped / clicked / pressed a key in the last 30 seconds. A form waits until it is saved
 * and closed (the same check keeps running).
 *
 * Pop-ups count even when they are not marked role="dialog": Reporting's activity pop-up (ActivityDetailModal) is
 * a plain portal, so the tab used to reload under it the moment a save finished — the "whole page refreshes after
 * marking an activity 100%" report. Such pop-ups are caught by the history entry useOverlayBackClose pushes while
 * they are open, or by the page scroll they lock.
 */
export function NewBuildWatcher() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let current: string | null = null;
    let stale = false;
    let lastTyped = 0;
    let lastActive = 0;
    const onInput = () => { lastTyped = Date.now(); };
    const onActive = () => { lastActive = Date.now(); };
    document.addEventListener("input", onInput, true);
    document.addEventListener("pointerdown", onActive, true);
    document.addEventListener("keydown", onActive, true);

    const busy = () => {
      if (FORM_PATH.test(window.location.pathname)) return true;
      if (Date.now() - lastTyped < TYPING_GRACE_MS) return true;
      if (Date.now() - lastActive < ACTIVE_GRACE_MS) return true;
      if (document.querySelector('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')) return true;
      // A pop-up opened through useOverlayBackClose (its history entry is the current one), or one that locked the page.
      if ((window.history.state as { __overlay?: number } | null)?.__overlay) return true;
      if (document.body.style.overflow === "hidden") return true;
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
      document.removeEventListener("pointerdown", onActive, true);
      document.removeEventListener("keydown", onActive, true);
      window.clearInterval(poll);
      window.clearInterval(settle);
    };
  }, []);

  return null;
}
