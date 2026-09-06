import React, { useRef, useState } from "react";
import { Notification } from "iconsax-react";
import { CheckCheck, Megaphone } from "lucide-react";
import { useSaNotifications } from "@/hooks/useSaNotifications";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const SaNotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } = useSaNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const recent = notifications.slice(0, 10);

  const handleClick = (n: (typeof notifications)[number]) => {
    if (!n.isRead) markRead(n.id);
    if (n.refId) {
      if (n.refType === "lead") navigate("/sales-automation/leads");
      else if (n.refType === "crm_cancellation") navigate("/crm/cancellations");
      else if (n.refType === "crm_booking_amendment") navigate("/crm/booking-amendments");
      else if (n.refType === "crm_service_ticket") navigate("/crm/service-tickets");
      else if (n.refType === "crm_handover") navigate("/crm/handover");
      else if (n.refType?.startsWith("crm_")) navigate("/crm/dashboard");
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="relative w-8 h-8 rounded-full flex items-center justify-center border border-border bg-muted hover:bg-muted/80 text-foreground transition-all"
        title="Notifications"
      >
        <Notification size={14} variant={unreadCount > 0 ? "Bold" : "Outline"} color="hsl(var(--foreground))" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-80 rounded-2xl border border-border bg-popover shadow-xl overflow-hidden">
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Megaphone size={14} className="text-orange-500" />
                <span className="text-sm font-heading font-semibold text-foreground">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-500">
                    {unreadCount} new
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  title="Mark all read"
                >
                  <CheckCheck size={13} /> All read
                </button>
              )}
            </div>

            {/* list */}
            <div className="max-h-72 overflow-y-auto">
              {recent.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet</div>
              ) : recent.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${!n.isRead ? "bg-orange-500/5" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                    )}
                    <div className={!n.isRead ? "" : "pl-4"}>
                      <p className="text-xs font-medium text-foreground leading-snug">{n.title}</p>
                      {n.body && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{n.body}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
