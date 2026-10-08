import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Construction } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getMaintenanceStatus } from "@/api/maintenanceModeApi";
import { formatIst } from "@/lib/maintenanceTime";

/**
 * Shown to a super admin only, on every page, while maintenance is on - they are the one person who can still use
 * the system, so it is easy to forget everyone else is locked out.
 */
export function MaintenanceActiveBanner() {
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const { data } = useQuery({
    queryKey: ["system-maintenance"],
    queryFn: getMaintenanceStatus,
    enabled: isSuperAdmin,
    refetchInterval: 30_000,
  });

  if (!isSuperAdmin || !data?.active) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[1900] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-amber-500 px-4 py-1.5 text-sm font-medium text-amber-950 shadow-md"
    >
      <Construction size={14} />
      Maintenance mode is ON - only super admins can use the system
      {data.endsAt ? ` (expected back ${formatIst(data.endsAt)})` : ""}.
      <Link to="/admin/system-maintenance" className="underline underline-offset-2">
        Manage
      </Link>
    </div>
  );
}
