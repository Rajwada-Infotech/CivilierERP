import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Construction } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getMaintenanceStatus } from "@/api/maintenanceModeApi";
import { MAINTENANCE_EVENT, MAINTENANCE_STORAGE_KEY } from "@/lib/maintenanceRedirect";
import { formatCountdown, formatIst } from "@/lib/maintenanceTime";
import Maintenance from "@/pages/Maintenance";

const POLL_MS = 15_000;
const LOGOUT_WAIT_MS = 4000;
/** Remembers, across reloads of the tab, that this person was held by maintenance - only they are signed out at the end. */
const HELD_KEY = "maintenance:held";

/**
 * Everything the app shows about maintenance, on every page - including the login page:
 *  - announced, not started yet: an amber strip with a countdown, so people can finish and save what they are doing;
 *  - started: a full-screen Maintenance page over the app (nothing is reloaded, so nothing on screen is lost) for
 *    everyone except a super admin;
 *  - a super admin, who is never held, sees a small reminder that it is on;
 *  - when maintenance ends, everyone who was held is signed out and the site is reloaded from scratch (so they get
 *    whatever was deployed meanwhile, and nobody carries on with a screen from before).
 */
export function MaintenanceWatcher() {
  const { currentUser, logout } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const navigate = useNavigate();
  const location = useLocation();

  const { data, refetch } = useQuery({
    queryKey: ["system-maintenance"],
    queryFn: getMaintenanceStatus,
    refetchInterval: POLL_MS,
    retry: false,
  });

  // A call was refused with the maintenance answer: cover the app now, without waiting for the next check.
  const [blocked, setBlocked] = useState(false);
  // "Administrator sign in" lets the overlay step aside on the login page only.
  const [loginOpen, setLoginOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const onBlocked = () => {
      setBlocked(true);
      setLoginOpen(false);
    };
    window.addEventListener(MAINTENANCE_EVENT, onBlocked);
    return () => window.removeEventListener(MAINTENANCE_EVENT, onBlocked);
  }, []);

  const announced = !!data?.active && !data.enforced;
  const startsAtMs = data?.startsAt ? new Date(data.startsAt).getTime() : null;

  useEffect(() => {
    if (!announced) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [announced]);

  // The countdown reached zero: ask the server rather than trusting this computer's clock.
  useEffect(() => {
    if (announced && startsAtMs !== null && now >= startsAtMs) void refetch();
  }, [announced, startsAtMs, now, refetch]);

  const endHeldSessionRef = useRef<() => Promise<void>>(async () => {});
  // One stable object, so the screen's own status check is not restarted every time this component renders.
  const overlayProps = useMemo(
    () => ({
      onOver: () => void endHeldSessionRef.current(),
      onAdminSignIn: () => {
        setLoginOpen(true);
        navigate("/login");
      },
    }),
    [navigate],
  );

  const held = !isSuperAdmin && (blocked || (!!data?.active && data.enforced));

  // Remember that this tab was held (a reload during maintenance must not forget it). A super admin never is.
  useEffect(() => {
    try {
      if (held) sessionStorage.setItem(HELD_KEY, "1");
      else if (isSuperAdmin) sessionStorage.removeItem(HELD_KEY);
    } catch {
      /* storage can be blocked */
    }
  }, [held, isSuperAdmin]);

  // Maintenance is over. Anyone who was held is signed out, then the whole site reloads: a signed-in person lands
  // on the login page, a signed-out visitor stays where they were. People who only saw the countdown (it was called
  // off before it started) are left alone.
  const finishing = useRef(false);
  const endHeldSession = useCallback(async () => {
    if (finishing.current) return;
    let wasHeld = false;
    try {
      wasHeld = sessionStorage.getItem(HELD_KEY) === "1";
    } catch {
      /* ignore */
    }
    setBlocked(false);
    if (!wasHeld) return;
    finishing.current = true;
    try {
      sessionStorage.removeItem(HELD_KEY);
      sessionStorage.removeItem(MAINTENANCE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const signedIn = !!currentUser;
    if (signedIn) {
      try {
        await Promise.race([Promise.resolve(logout()), new Promise((resolve) => setTimeout(resolve, LOGOUT_WAIT_MS))]);
      } catch {
        /* the token is cleared below anyway */
      }
    }
    window.location.replace(signedIn ? "/login" : window.location.pathname + window.location.search);
  }, [currentUser, logout]);

  useEffect(() => {
    if (data && !data.active) void endHeldSession();
  }, [data, endHeldSession]);

  endHeldSessionRef.current = endHeldSession;
  const overlayVisible = held && !(loginOpen && location.pathname === "/login");

  if (overlayVisible) return <Maintenance overlay={overlayProps} />;

  if (!data?.active) return null;

  if (isSuperAdmin) {
    return (
      <Link
        to="/admin/system-maintenance"
        role="status"
        className="fixed bottom-4 left-4 z-[1900] flex items-center gap-2 rounded-full bg-amber-500 px-3.5 py-2 text-xs font-medium text-amber-950 shadow-lg transition-opacity hover:opacity-90"
      >
        <Construction size={14} />
        {data.enforced ? "Maintenance is ON" : "Maintenance starting"} - everyone else is{data.enforced ? "" : " about to be"} held
        {data.endsAt ? ` until ${formatIst(data.endsAt)}` : ""}
      </Link>
    );
  }

  if (announced && startsAtMs !== null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-0 top-0 z-[2000] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-md"
      >
        <Construction size={14} />
        Maintenance starts in <span className="tabular-nums">{formatCountdown(startsAtMs - now)}</span>. Please finish and save
        what you are doing.
        {data.endsAt ? ` Expected back ${formatIst(data.endsAt)}.` : ""}
      </div>
    );
  }
  return null;
}
