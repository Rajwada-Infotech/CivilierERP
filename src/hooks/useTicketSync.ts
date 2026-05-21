import { useEffect } from "react";
import { connectSocket } from "@/lib/socket";

type RefetchFn = () => unknown;

export function useTicketSync(refetch: RefetchFn, ticketId?: number | null) {
  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    const refetchTicket = (payload?: { ticketId?: number; ticketIds?: number[] }) => {
      if (!ticketId) {
        refetch();
        return;
      }
      if (
        payload?.ticketId === ticketId ||
        payload?.ticketIds?.includes(ticketId)
      ) {
        refetch();
      }
    };

    if (ticketId) {
      socket.emit("ticket:join", ticketId);
    }

    socket.on("ticket:updated", refetchTicket);
    socket.on("ticket:escalated", refetchTicket);
    socket.on("ticket:message", refetchTicket);

    return () => {
      if (ticketId) {
        socket.emit("ticket:leave", ticketId);
      }
      socket.off("ticket:updated", refetchTicket);
      socket.off("ticket:escalated", refetchTicket);
      socket.off("ticket:message", refetchTicket);
    };
  }, [refetch, ticketId]);
}
