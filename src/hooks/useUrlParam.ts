// A piece of page state kept in the address (?name=value), so a refresh, a
// shared link or Back lands on the same tab / project / block. Other params are
// left as they are; the empty / fallback value is dropped from the address.
// Changes replace the current history entry (switching a tab is not a "page"
// to go Back through).
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export function useUrlParam<T extends string = string>(name: string, fallback = "" as T) {
  const [sp, setSp] = useSearchParams();
  const value = (sp.get(name) ?? fallback) as T;
  const setValue = useCallback((v: T | "") => {
    // From the live address, not the render's copy: two calls in one handler
    // (pick a company, clear the project) would otherwise undo each other.
    setSp(() => {
      const next = new URLSearchParams(window.location.search);
      if (!v || v === fallback) next.delete(name); else next.set(name, v);
      return next;
    }, { replace: true });
  }, [name, fallback, setSp]);
  return [value, setValue] as const;
}
