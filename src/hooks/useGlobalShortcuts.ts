import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSidebarState } from "@/components/layout/layoutContexts";
import { useModule } from "@/contexts/ModuleContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  MODULE_DASHBOARD_ROUTES,
  isAdminTierRole,
  userHasModuleAccess,
  type Module,
} from "@/contexts/module.utils";
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

// True while focus is somewhere a keypress should type a character instead
// of triggering a shortcut — an <input>/<textarea>/<select> or a
// contentEditable region. Shift+digit in particular types "!"/"@"/etc. in a
// normal text field, so any shortcut built on it must back off there.
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// ── Sidebar toggle: Ctrl+B (⌘B on Mac) ──────────────────────────────────────────

/** Ctrl+B (⌘B on Mac) — no other modifiers. */
export function isSidebarToggleShortcut(e: KeyLike): boolean {
  if (e.shiftKey || e.altKey) return false;
  if (e.ctrlKey === e.metaKey) return false; // need exactly one of Ctrl/⌘, not both/neither
  return e.key.toLowerCase() === "b";
}

/**
 * Options for the Home page, which renders with no module strip/nav panel
 * at all by default (a full-width dashboard) — there's nothing for the
 * normal collapse/expand toggle to act on there. Home instead has its own
 * temporary "reveal the strip" state (AppLayout.tsx's homeNavOpen), so on
 * Home the same Ctrl+B toggles that instead.
 */
export interface HomeShortcutOptions {
  isHome: boolean;
  homeNavOpen: boolean;
  setHomeNavOpen: (v: boolean) => void;
}

/**
 * Toggles the sidebar on Ctrl+B / ⌘B — mount once, high up the tree (inside
 * <SidebarContext.Provider>, e.g. AppLayout.tsx), so it works the same from
 * every module rather than needing a per-page listener. Capture phase +
 * preventDefault so it fires before any focused input's own keydown handler
 * and doesn't also trigger the browser's own Ctrl+B (bold, in some browser
 * chrome contexts). On Home (see HomeShortcutOptions), it opens/closes the
 * module strip instead of the normal nav-panel collapse, since Home has
 * neither by default.
 */
export function useSidebarToggleShortcut(home?: HomeShortcutOptions): void {
  const { collapsed, setCollapsed } = useSidebarState();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (!isSidebarToggleShortcut(e)) return;
      e.preventDefault();
      if (home?.isHome) {
        home.setHomeNavOpen(!home.homeNavOpen);
      } else {
        setCollapsed(!collapsed);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [collapsed, setCollapsed, home?.isHome, home?.homeNavOpen, home?.setHomeNavOpen]);
}

// ── Module switch: Shift+1..9/0, Shift+letter for the rest ─────────────────────
// 15 modules, 10 number keys — the first 10 (ModuleStrip's own display
// order) get Shift+1..9 and Shift+0; the remaining 5 get a mnemonic Shift+
// letter (C-R-M-H-A spells nothing, but each letter is the module's own
// initial and none collide with each other or the digits).
//
// Matched on KeyboardEvent.code (the physical key, e.g. "Digit1"/"KeyC"),
// not .key — .key reflects the character Shift actually produces ("!" for
// Shift+1 on a US layout), which varies by keyboard layout; .code doesn't.
export interface ModuleShortcut {
  code: string;
  /** Human label for the physical key, for a hint UI to show later (e.g. "1", "C"). */
  keyLabel: string;
  module: NonNullable<Module>;
  label: string;
}

export const MODULE_SHORTCUTS: ModuleShortcut[] = [
  { code: "Digit1", keyLabel: "1", module: "finance", label: "Finance" },
  { code: "Digit2", keyLabel: "2", module: "material", label: "Material" },
  { code: "Digit3", keyLabel: "3", module: "fixed-asset", label: "Fixed Asset" },
  { code: "Digit4", keyLabel: "4", module: "loan", label: "Loan" },
  { code: "Digit5", keyLabel: "5", module: "engineering", label: "Engineering" },
  { code: "Digit6", keyLabel: "6", module: "civilworkdpr", label: "Civil Work DPR" },
  { code: "Digit7", keyLabel: "7", module: "followup", label: "Follow-Up" },
  { code: "Digit8", keyLabel: "8", module: "ticket", label: "Ticket" },
  { code: "Digit9", keyLabel: "9", module: "sales", label: "Sales" },
  { code: "Digit0", keyLabel: "0", module: "sales-automation", label: "Sales Automation" },
  { code: "KeyC", keyLabel: "C", module: "crm", label: "CRM" },
  { code: "KeyR", keyLabel: "R", module: "records", label: "Records" },
  { code: "KeyM", keyLabel: "M", module: "maintenance", label: "Maintenance" },
  { code: "KeyH", keyLabel: "H", module: "hr-payroll", label: "HR & Payroll" },
  { code: "KeyA", keyLabel: "A", module: "admin", label: "Admin" },
];

const MODULE_SHORTCUT_BY_CODE: Record<string, ModuleShortcut> = Object.fromEntries(
  MODULE_SHORTCUTS.map((s) => [s.code, s]),
);

/**
 * Switches the active module on Shift+<key> — mount once, high up the tree
 * (same place as useSidebarToggleShortcut), so it works identically from
 * every page. Mirrors ModuleStrip.tsx's own handleSwitch exactly: skips a
 * module the viewer has no page rights in (same userHasModuleAccess check
 * that decides whether ModuleStrip even shows its icon), sends a non-admin-
 * tier user with only approval-inbox rights straight to the inbox instead
 * of Admin's real dashboard, and reveals the nav panel the same way a click
 * would. Ignored entirely while focus is in a text field — Shift+digit
 * normally types "!"/"@"/etc., and this would otherwise hijack that.
 */
export function useModuleSwitchShortcut(): void {
  const { setActiveModule, setModuleSwitching } = useModule();
  const { setCollapsed } = useSidebarState();
  const { currentUser, canAccessPage } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const role = currentUser?.role ?? "";
    const isAdminTier = isAdminTierRole(role);

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const shortcut = MODULE_SHORTCUT_BY_CODE[e.code];
      if (!shortcut) return;
      if (!userHasModuleAccess(shortcut.module, isAdminTier, (pk) => canAccessPage(pk as never))) return;

      e.preventDefault();
      setCollapsed(false);
      setModuleSwitching(true);
      setActiveModule(shortcut.module);
      const dest =
        shortcut.module === "admin" && !isAdminTier
          ? "/admin/approval/inbox"
          : MODULE_DASHBOARD_ROUTES[shortcut.module];
      navigate(dest);
      setTimeout(() => setModuleSwitching(false), 60);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [currentUser, canAccessPage, setActiveModule, setModuleSwitching, setCollapsed, navigate]);
}
