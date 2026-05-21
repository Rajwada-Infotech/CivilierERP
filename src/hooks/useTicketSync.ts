import { useEffect } from "react";
import { connectSocket } from "@/lib/socket";

type RefetchFn = () => unknown;

export function useTicketSync(refetch: RefetchFn) {
  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    socket.on("ticket:updated", refetch);
    socket.on("ticket:escalated", refetch);

    return () => {
      socket.off("ticket:updated", refetch);
      socket.off("ticket:escalated", refetch);
    };
  }, [refetch]);
}
