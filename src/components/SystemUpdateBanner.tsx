import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getSystemStatus, subscribeSystemStatus } from "@/lib/systemStatus";

/**
 * Shown while a new version is going live (the gateway answers 502 for a few seconds). One banner instead of a
 * message per failed request; it goes away by itself when the system answers again, and the data on screen is
 * refreshed at that moment.
 */
export function SystemUpdateBanner() {
  const status = useSyncExternalStore(subscribeSystemStatus, getSystemStatus, getSystemStatus);
  const queryClient = useQueryClient();
  const wasUpdating = useRef(false);

  useEffect(() => {
    if (status === "updating") {
      wasUpdating.current = true;
    } else if (wasUpdating.current) {
      wasUpdating.current = false;
      void queryClient.invalidateQueries(); // pages that failed while it was down load again
    }
  }, [status, queryClient]);

  if (status !== "updating") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[2000] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-md"
    >
      <Loader2 size={14} className="animate-spin" />
      The system is updating to a new version. Please wait a few seconds for the system to stabilise. Anything on your screen stays as it is.
    </div>
  );
}
