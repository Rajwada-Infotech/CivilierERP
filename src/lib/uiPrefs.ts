import { useSyncExternalStore } from "react";

// What a person has switched off on this device, from Settings on any profile page: the bubble the menus open with, the rise and fade
// of pages and dialogs, and numbers counting up. Kept in this browser (an animation setting follows the device, not the account) and
// applied as data attributes on <html>, which CSS in index.css reads; the animations that run from script ask menuAnimationsOn() /
// countAnimationsOn(). The system's "reduce motion" setting turns them off as well.
export interface UiPrefs {
  /** the bubble the top-bar panels and the mobile menus open and close with */
  menus: boolean;
  /** the rise and fade of pages, cards, charts and dialogs */
  pages: boolean;
  /** figures on dashboards counting up to their value */
  counts: boolean;
}

const KEY = "civilier-ui-prefs";
const DEFAULTS: UiPrefs = { menus: true, pages: true, counts: true };
const ATTRIBUTE: Record<keyof UiPrefs, string> = { menus: "animMenus", pages: "animPages", counts: "animCounts" };

let cache: UiPrefs | null = null;
const listeners = new Set<() => void>();

function read(): UiPrefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as Partial<UiPrefs>) : {};
    return {
      menus: parsed.menus !== false,
      pages: parsed.pages !== false,
      counts: parsed.counts !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getUiPrefs(): UiPrefs {
  if (!cache) cache = read();
  return cache;
}

/** Puts the saved choices on <html> (data-anim-menus="off" ...) for the CSS to read. */
export function applyUiPrefs(): void {
  if (typeof document === "undefined") return;
  const prefs = getUiPrefs();
  for (const k of Object.keys(ATTRIBUTE) as (keyof UiPrefs)[]) {
    if (prefs[k]) delete document.documentElement.dataset[ATTRIBUTE[k]];
    else document.documentElement.dataset[ATTRIBUTE[k]] = "off";
  }
}

export function setUiPrefs(patch: Partial<UiPrefs>): void {
  cache = { ...getUiPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked (a private window): the choice still holds until the page is reloaded.
  }
  applyUiPrefs();
  listeners.forEach((l) => l());
}

const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** True when the menus should open and close with the bubble (the person left it on, and the system does not ask for less motion). */
export const menuAnimationsOn = () => getUiPrefs().menus && !prefersReducedMotion();
/** True when figures should count up. */
export const countAnimationsOn = () => getUiPrefs().counts && !prefersReducedMotion();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed it: read it again.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      cache = null;
      applyUiPrefs();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, getUiPrefs, getUiPrefs);
}
