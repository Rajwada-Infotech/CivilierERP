import { useEffect } from "react";
import { useSidebarState } from "@/components/layout/layoutContexts";
// Compass's own shortcut logic (Enter+Space chord) lives in useCompass.ts —
// it needs the held-key tracking state, which is Compass-specific — and is
// re-exported here so every app-wide hotkey has one place to be imported
// from. Add new shortcuts to this file directly; re-export a module-owned
// one here the same way if it has to live closer to its own context.
export { isCompassShortcut, getShortcutLabels, type HeldKeys, type ShortcutLabels } from "@/components/compass/useCompass";

// ─── Global (window-level) keyboard shortcuts ──────────────────────────────────
// Single source of truth for every app-wide hotkey — matcher functions here,
// the hooks that actually wire them up to state right below. Add new ones to
// this file rather than scattering another window keydown listener elsewhere;
// each hook below mounts once (in AppLayout.tsx) so it works identically from
// every module.

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

// ── Sidebar toggle: Ctrl+B (⌘B on Mac) ──────────────────────────────────────────

/** Ctrl+B (⌘B on Mac) — no other modifiers. */
export function isSidebarToggleShortcut(e: KeyLike): boolean {
  if (e.shiftKey || e.altKey) return false;
  if (e.ctrlKey === e.metaKey) return false; // need exactly one of Ctrl/⌘, not both/neither
  return e.key.toLowerCase() === "b";
}

/**
 * Toggles the sidebar on Ctrl+B / ⌘B — mount once, high up the tree (inside
 * <SidebarContext.Provider>, e.g. AppLayout.tsx), so it works the same from
 * every module rather than needing a per-page listener. Capture phase +
 * preventDefault so it fires before any focused input's own keydown handler
 * and doesn't also trigger the browser's own Ctrl+B (bold, in some browser
 * chrome contexts).
 */
export function useSidebarToggleShortcut(): void {
  const { collapsed, setCollapsed } = useSidebarState();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSidebarToggleShortcut(e)) return;
      e.preventDefault();
      setCollapsed(!collapsed);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [collapsed, setCollapsed]);
}
