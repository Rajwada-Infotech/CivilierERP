// A PO raised for a quoted MR with a supplier other than the L1 one: the server tells each director live
// (socket "po:supplier-change", see backend/services/poSupplierDeviation.js). Shown as a toast that stays until it is
// dismissed, with a button to open the PO. Only the directors' sockets receive it.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { connectSocket } from "@/lib/socket";

interface SupplierChangeNotice {
  title: string;
  body: string;
  poId: number;
  poNo: string | null;
}

export function DirectorAlerts() {
  const navigate = useNavigate();
  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;
    const onNotice = (n: SupplierChangeNotice) => {
      toast.warning(n.title, {
        id: `po-supplier-change-${n.poId}`,
        description: n.body,
        duration: Infinity,
        closeButton: true,
        action: { label: n.poNo ? `Open ${n.poNo}` : "Open PO", onClick: () => navigate(`/material/purchase-order?view=${n.poId}`) },
      });
    };
    socket.on("po:supplier-change", onNotice);
    return () => {
      socket.off("po:supplier-change", onNotice);
    };
  }, [navigate]);
  return null;
}
