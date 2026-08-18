import React, { useEffect, useState } from "react";

/**
 * Persists a form's in-progress values to localStorage so a page refresh
 * doesn't wipe out what's been typed — same fix already applied to the
 * shared MasterPage component (src/components/MasterPage.tsx), reused here
 * for pages with their own hand-rolled forms. The draft clears itself once
 * the form returns to its empty/default shape (a successful save or an
 * explicit Reset both do this by resetting state back to `emptyValue`), so
 * callers don't need a separate "clear on save" call.
 *
 * Pass `skip: true` while editing an existing record (not adding a new
 * one) — persisting an in-progress edit as a generic "draft" risks it
 * silently reappearing over a different row after a refresh, since which
 * record was being edited isn't itself persisted.
 */
export function useDraftForm<T extends object>(
  storageKey: string,
  emptyValue: T,
  options?: { skip?: boolean },
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const key = `draft-form:${storageKey}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) return { ...emptyValue, ...JSON.parse(saved) };
    } catch {
      // Corrupt/unparseable draft — fall back to a clean form rather than
      // crash the page over a stale localStorage value.
    }
    return emptyValue;
  });

  useEffect(() => {
    if (options?.skip) return;
    const isDirty = Object.keys(emptyValue).some(
      (k) => String((value as any)[k] ?? "") !== String((emptyValue as any)[k] ?? ""),
    );
    try {
      if (isDirty) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch {
      // localStorage unavailable (private browsing quota, etc.) — the
      // draft simply won't persist; nothing else depends on it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, key, options?.skip]);

  return [value, setValue];
}

/**
 * Same draft-persistence behavior as useDraftForm, for pages whose form
 * state is owned externally (e.g. react-hook-form's watch()/reset()
 * instead of a plain useState) — sync a snapshot of the live values in,
 * and get a one-time rehydration callback out, rather than owning the
 * state itself.
 *
 * `applyDraft` is called once, on mount, only when a draft was actually
 * found — wire it to the form library's own reset/setValues.
 */
export function useDraftFormSync<T extends object>(
  storageKey: string,
  values: T,
  applyDraft: (draft: T) => void,
  emptyValue: T,
  options?: { skip?: boolean },
): void {
  const key = `draft-form:${storageKey}`;
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) applyDraft({ ...emptyValue, ...JSON.parse(saved) });
    } catch {
      // Corrupt/unparseable draft — proceed with whatever the form
      // already has rather than crash the page over a stale value.
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skip until the mount-time rehydration above has actually landed —
    // otherwise this fires on the same render with the pre-reset (empty)
    // values and immediately deletes the very draft just read.
    if (!hydrated || options?.skip) return;
    const isDirty = Object.keys(emptyValue).some(
      (k) => String((values as any)[k] ?? "") !== String((emptyValue as any)[k] ?? ""),
    );
    try {
      if (isDirty) localStorage.setItem(key, JSON.stringify(values));
      else localStorage.removeItem(key);
    } catch {
      // localStorage unavailable — the draft simply won't persist.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, key, hydrated, options?.skip]);
}

/**
 * Enter inside a text/number/date/select field must not act like a form
 * submit. Attach to the form's outer wrapper (onKeyDown bubbles up from
 * every descendant field) rather than every individual input. Textareas
 * keep Enter = newline; buttons (Save/Reset/etc.) keep Enter = activate,
 * since suppressing that would break keyboard-only use of the form's own
 * actions.
 */
export function preventEnterSubmit(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter") return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "TEXTAREA" || tag === "BUTTON") return;
  e.preventDefault();
}

/**
 * True only for the page load that was an actual browser reload (F5,
 * ctrl+R, refresh button) — false for a fresh navigation, a back/forward,
 * and critically, every ordinary React Router route change (a route click
 * unmounts/remounts the page component but never triggers a new top-level
 * navigation entry, so this stays false throughout an SPA session).
 *
 * A page's "reopen the form if a draft was restored" mount effect must gate
 * on this — without it, that effect fires on every single mount, so simply
 * clicking the page's own sidebar link while an old, possibly days-stale
 * draft still sits in localStorage silently hijacks the link into always
 * opening the form instead of the list.
 */
export function wasPageReloaded(): boolean {
  try {
    const [entry] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    return entry?.type === "reload";
  } catch {
    return false;
  }
}
