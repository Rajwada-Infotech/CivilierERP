// A PO raised for a quoted MR with a supplier other than the L1 one: each director is told (see
// backend/services/poSupplierDeviation.js). Shown as a toast that stays until it is dismissed, with a button to open
// the PO — live over the socket ("po:supplier-change"), and on the next login for any not dismissed yet
// (GET /api/sa/notifications/toasts). Closing or opening it marks it seen. Only directors ever have any.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { connectSocket } from "@/lib/socket";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface Notice {
  id: number;
  title: string;
  body: string | null;
  refId: number | null;
}

export function DirectorAlerts() {
  const navigate = useNavigate();
  useEffect(() => {
    let live = true;
    const seen = (id: number) => {
      fetchWithAuth(`/api/sa/notifications/${id}/read`, { method: "PUT" }).catch(() => {});
    };
    const show = (n: Notice) =>
      toast.warning(n.title, {
        id: `director-notice-${n.id}`,
        description: n.body ?? undefined,
        duration: Infinity,
        closeButton: true,
        onDismiss: () => seen(n.id),
        action: n.refId
          ? {
              label: "Open PO",
              onClick: () => {
                seen(n.id);
                navigate(`/material/purchase-order?view=${n.refId}`);
              },
            }
          : undefined,
      });

    // Not dismissed yet — e.g. sent while this director was logged out.
    fetchWithAuth("/api/sa/notifications/toasts")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Notice[]) => {
        if (live) rows.forEach(show);
      })
      .catch(() => {});

    const socket = connectSocket();
    socket?.on("po:supplier-change", show);
    return () => {
      live = false;
      socket?.off("po:supplier-change", show);
    };
  }, [navigate]);
  return null;
}
