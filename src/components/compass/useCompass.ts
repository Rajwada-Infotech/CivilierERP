import { createContext, useContext } from "react";
import type { CompassEntry } from "./compassRegistry";

export interface CompassContextValue {
  open: boolean;
  openCompass: () => void;
  closeCompass: () => void;
  toggleCompass: () => void;
  /** Permission-filtered registry for the signed-in user. */
  entries: CompassEntry[];
  /** Most-recently visited registry pages, newest first (current page excluded). */
  recent: CompassEntry[];
  /** Go to an entry: navigates, then closes. */
  select: (entry: CompassEntry) => void;
  /** Human-readable hotkey labels for tooltips/hints. */
  shortcut: ShortcutLabels;
}

// The context lives here (not in CompassProvider) so anything that only
// needs to *open* Compass — e.g. the navbar trigger — can import this file
// without pulling in the provider, the registry, or the whole sidebar tree.
export const CompassContext = createContext<CompassContextValue | null>(null);

export function useCompass(): CompassContextValue {
  const ctx = useContext(CompassContext);
  if (!ctx) throw new Error("useCompass must be used inside <CompassProvider>");
  return ctx;
}

// ── Hotkeys ──────────────────────────────────────────────────────────────────

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/**
 * Primary: Super+Space (Win key on Windows/Linux, ⌘ on Mac).
 * Also:    Alt+Space (⌥ Space on Mac).
 * Fallback: Ctrl+K (⌘K on Mac).
 *
 * Caveat the Super chord can't get around: Windows reserves Win+Space
 * (keyboard layout switch) and macOS reserves ⌘Space (Spotlight) at the OS
 * level, so on those platforms the browser usually never receives it at all —
 * the listener is correct, the event just doesn't arrive. Alt+Space and
 * Ctrl+K are the chords that normally reach the page there. `code` is
 * checked before `key` because macOS reports Option+Space's key as a
 * non-breaking space rather than " ".
 */
export function isCompassShortcut(e: KeyLike): boolean {
  if (e.shiftKey) return false;
  const isSpace = e.code === "Space" || e.key === " ";
  if (isSpace && e.metaKey && !e.ctrlKey && !e.altKey) return true; // Super+Space
  if (isSpace && e.altKey && !e.metaKey && !e.ctrlKey) return true; // Alt+Space
  if (!e.altKey && e.ctrlKey !== e.metaKey && e.key.toLowerCase() === "k") return true; // Ctrl/⌘+K
  return false;
}

export interface ShortcutLabels {
  primary: string;
  alt: string;
  fallback: string;
}

export function getShortcutLabels(platform: string): ShortcutLabels {
  if (/mac|iphone|ipad/i.test(platform)) return { primary: "⌘ Space", alt: "⌥ Space", fallback: "⌘ K" };
  if (/win/i.test(platform)) return { primary: "Win+Space", alt: "Alt+Space", fallback: "Ctrl+K" };
  return { primary: "Super+Space", alt: "Alt+Space", fallback: "Ctrl+K" };
}
