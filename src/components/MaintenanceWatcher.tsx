import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Construction } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getMaintenanceStatus } from "@/api/maintenanceModeApi";
import { MAINTENANCE_EVENT } from "@/lib/maintenanceRedirect";
import { formatCountdown, formatIst } from "@/lib/maintenanceTime";
import Maintenance from "@/pages/Maintenance";

const POLL_MS = 15_000;

/**
 * Everything the app shows about maintenance, on every page - including the login page:
 *  - announced, not started yet: an amber strip with a countdown, so people can finish and save what they are doing;
 *  - started: a full-screen Maintenance page over the app (nothing is reloaded, so nothing on screen is lost) for
 *    everyone except a super admin;
 *  - a super admin, who is never held, sees a small reminder that it is on.
 */
export function MaintenanceWatcher() {
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

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

  // Maintenance ended: forget the block.
  useEffect(() => {
    if (data && !data.active) setBlocked(false);
  }, [data]);

  const handleOver = useCallback(() => {
    setBlocked(false);
    void queryClient.invalidateQueries(); // screens that failed while it was on load again
  }, [queryClient]);

  const held = !isSuperAdmin && (blocked || (!!data?.active && data.enforced));
  const overlayVisible = held && !(loginOpen && location.pathname === "/login");

  if (overlayVisible) {
    return (
      <Maintenance
        overlay={{
          onOver: handleOver,
          onAdminSignIn: () => {
            setLoginOpen(true);
            navigate("/login");
          },
        }}
      />
    );
  }

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
