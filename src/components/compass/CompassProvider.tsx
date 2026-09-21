import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { rememberModuleForRoute } from "@/contexts/moduleFromPath";
import { CompassDialog } from "./CompassDialog";
import { useCompassRegistry, type CompassEntry } from "./compassRegistry";
import {
  CompassContext,
  type CompassContextValue,
  type HeldKeys,
  getShortcutLabels,
  isCompassShortcut,
} from "./useCompass";

const MAX_RECENT = 8;
// Per-user key: a shared workstation must not leak one person's history to the next login.
const recentKey = (userId: string) => `compass:recent:v1:${userId}`;

function loadRecent(userId: string): string[] {
  try {
    const raw = localStorage.getItem(recentKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(userId: string, routes: string[]) {
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify(routes));
  } catch {
    /* storage full/blocked — recents are a nicety, never fail navigation over them */
  }
}

/**
 * Mounted once in AppLayout so Compass is available from every module shell.
 * Recent-page tracking lives here (not in the dialog) so it records every
 * navigation, not just the ones made through Compass.
 */
export function CompassProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const entries = useCompassRegistry();
  const userId = currentUser?.id ?? "";

  const [open, setOpen] = useState(false);
  const [recentRoutes, setRecentRoutes] = useState<string[]>([]);
  const recentRef = useRef<string[]>([]);

  // Load this user's history whenever the signed-in user changes.
  useEffect(() => {
    recentRef.current = userId ? loadRecent(userId) : [];
    setRecentRoutes(recentRef.current);
  }, [userId]);

  const byRoute = useMemo(() => new Map(entries.map((e) => [e.route, e])), [entries]);

  // Record every navigation to a page Compass knows about (move-to-front, capped).
  useEffect(() => {
    if (!userId || !byRoute.has(pathname)) return;
    if (recentRef.current[0] === pathname) return;
    const next = [pathname, ...recentRef.current.filter((r) => r !== pathname)].slice(0, MAX_RECENT);
    recentRef.current = next;
    saveRecent(userId, next);
    setRecentRoutes(next);
  }, [pathname, userId, byRoute]);

  // Re-resolved against the permission-filtered registry, so a page the user
  // has since lost access to drops out; the page you're on is just noise.
  const recent = useMemo(
    () =>
      recentRoutes
        .filter((r) => r !== pathname)
        .map((r) => byRoute.get(r))
        .filter((e): e is CompassEntry => !!e),
    [recentRoutes, pathname, byRoute],
  );

  // Global hotkey: Enter+Space chord. Capture phase so a focused input can't
  // swallow it. Neither key is a modifier, so we track which one is
  // currently held ourselves — a keydown of the other while it's held opens
  // Compass. held.current only reflects a raw key being down, not whether
  // it's "part of" a chord attempt, so a Space keydown while Enter happens to
  // be held (e.g. from an unrelated rapid Enter-then-Space typed elsewhere)
  // will still trigger — an accepted false-positive for a rarely-typed pair.
  useEffect(() => {
    const held: HeldKeys = { enter: false, space: false };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (!e.repeat && isCompassShortcut(e, held)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") held.enter = true;
      if (e.code === "Space") held.space = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "NumpadEnter") held.enter = false;
      if (e.code === "Space") held.space = false;
    };
    // A held key's keyup can land outside the window (blur, devtools, etc.)
    // and never fire — reset both on blur so a stuck "held" flag can't
    // silently arm the chord later.
    const onBlur = () => {
      held.enter = false;
      held.space = false;
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Browser back/forward (or any navigation) while open shouldn't leave it hanging.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const openCompass = useCallback(() => setOpen(true), []);
  const closeCompass = useCallback(() => setOpen(false), []);
  const toggleCompass = useCallback(() => setOpen((o) => !o), []);

  const select = useCallback(
    (entry: CompassEntry) => {
      setOpen(false);
      // /masters/* URLs don't say which module they belong to; without this the
      // sidebar would stay on whichever module the user happened to be in.
      rememberModuleForRoute(entry.route, entry.moduleId);
      navigate(entry.route, entry.state ? { state: entry.state } : undefined);
    },
    [navigate],
  );

  const shortcut = useMemo(() => getShortcutLabels(), []);

  const value = useMemo<CompassContextValue>(
    () => ({ open, openCompass, closeCompass, toggleCompass, entries, recent, select, shortcut }),
    [open, openCompass, closeCompass, toggleCompass, entries, recent, select, shortcut],
  );

  return (
    <CompassContext.Provider value={value}>
      {children}
      <CompassDialog />
    </CompassContext.Provider>
  );
}
