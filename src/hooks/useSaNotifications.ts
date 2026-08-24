import { useState, useEffect, useCallback } from "react";
import { connectSocket } from "@/lib/socket";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface SaNotification {
  id: number;
  userId: number;
  type: string;
  title: string;
  body: string | null;
  refId: number | null;
  refType: string | null;
  isRead: boolean;
  createdAt: string;
}

export function useSaNotifications() {
  const [notifications, setNotifications] = useState<SaNotification[]>([]);
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/sa/notifications");
      if (res.ok) setNotifications(await res.json());
    } catch {}
  }, []);

  // Initial fetch + 30-second polling
  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  // Real-time socket updates
  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    function onSaNotification(notif: SaNotification) {
      toast.info(notif.title, { description: notif.body ?? undefined });
      setNotifications((prev) => [notif, ...prev]);
    }

    socket.on("sa:notification", onSaNotification);
    return () => { socket.off("sa:notification", onSaNotification); };
  }, []);

  const markRead = useCallback(async (id: number) => {
    try {
      await fetchWithAuth(`/api/sa/notifications/${id}/read`, { method: "PUT" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
    } catch {}
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await fetchWithAuth("/api/sa/notifications/read-all", { method: "PUT" });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {}
  }, []);

  return { notifications, unreadCount, markRead, markAllRead, refresh: fetchNotifications };
}
