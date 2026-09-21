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

/** Which of the chord's two keys is currently held down (tracked by the caller via keydown/keyup). */
export interface HeldKeys {
  enter: boolean;
  space: boolean;
}

function isSpaceKey(e: KeyLike): boolean {
  // `code` checked before `key` because macOS reports Option+Space's key as
  // a non-breaking space rather than " ".
  return e.code === "Space" || e.key === " " || e.key === " ";
}

function isEnterKey(e: KeyLike): boolean {
  return e.code === "Enter" || e.code === "NumpadEnter" || e.key === "Enter";
}

/**
 * Compass opens on the Enter+Space chord: hold one, press the other. Neither
 * key is a modifier, so this can't be read off a single event's own flags
 * (unlike Ctrl/Alt/Meta) — the caller must track which of the two is
 * currently held (via keydown/keyup) and pass that in.
 */
export function isCompassShortcut(e: KeyLike, held: HeldKeys): boolean {
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (isSpaceKey(e)) return held.enter;
  if (isEnterKey(e)) return held.space;
  return false;
}

export interface ShortcutLabels {
  primary: string;
}

export function getShortcutLabels(): ShortcutLabels {
  return { primary: "Enter + Space" };
}
