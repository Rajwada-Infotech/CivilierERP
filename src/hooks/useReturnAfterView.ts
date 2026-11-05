import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * A page opened on one record from somewhere else (the Material dashboard's lists pass `state: { returnTo }`)
 * goes back there once that record is closed, instead of leaving the user on the page's own list.
 *
 * `busy` is true while the record (or its edit form) is open. The return address is read once, on arrival — the
 * page's own `?view=` handling replaces the URL right after, which drops the navigation state.
 */
export function useReturnAfterView(busy: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const [returnTo] = useState<string | null>(() => (location.state as { returnTo?: string } | null)?.returnTo ?? null);
  const opened = useRef(false);

  useEffect(() => {
    if (!returnTo) return;
    if (busy) {
      opened.current = true;
      return;
    }
    if (opened.current) navigate(returnTo, { replace: true });
  }, [busy, returnTo, navigate]);
}
