import React, { useRef, useState } from "react";
import { ChromeIcons } from "@/components/icons/moduleIcons";
import { CheckCheck } from "lucide-react";
import { useSaNotifications } from "@/hooks/useSaNotifications";
import { useNavigate } from "react-router-dom";
import { BodyPortal } from "@/components/ui/body-portal";
import { NAV_PANEL_CSS } from "./navPanelStyles";

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
      {/* Same button chrome as ReminderBell, right next to it; the count tag is ink here (red on Reminders) so the two
          stay tellable apart at a glance. */}
      <button
        onClick={() => setOpen((p) => !p)}
        className="relative w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        title="Sales notifications"
      >
        <ChromeIcons.announce size={18} style={{ color: unreadCount > 0 ? "hsl(var(--foreground))" : undefined }} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-1 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center bg-foreground text-card font-heading text-[0.5625rem] font-semibold tabular-nums leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <style dangerouslySetInnerHTML={{ __html: NAV_PANEL_CSS }} />
          {/* backdrop */}
          <BodyPortal><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /></BodyPortal>
          {/* Phones: a panel fixed under the top bar, centred on the screen (pinned to the bell it ran off the
              right edge, and the phone rule capping w-[…] boxes to their parent squeezed it to the bell's width).
              Wider screens: dropped from the bell as before. Width set inline so that rule can't touch it. */}
          <div
            className="np-sheet fixed sm:absolute left-1/2 sm:left-auto sm:right-0 top-16 sm:top-full -translate-x-1/2 sm:translate-x-0 sm:mt-3 z-50 flex flex-col animate-in fade-in duration-200"
            style={{ width: "min(calc(100vw - 1.5rem), 360px)" }}
          >
            {/* Title block: what this is, how many are unread, and mark-all-read */}
            <div className="np-head">
              <div className="min-w-0">
                <p className="np-label">CivilierERP · Notifications</p>
                <p className="np-count">
                  <span className="np-figure">{unreadCount}</span>
                  <span className="np-label">unread</span>
                </p>
              </div>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="np-key" title="Mark all read">
                  <CheckCheck size={12} /> All read
                </button>
              )}
            </div>

            <div className="np-list thin-scroll" style={{ maxHeight: "min(60vh, 380px)" }}>
              {recent.length === 0 ? (
                <div className="np-empty">
                  <p className="np-label ink">Nothing yet</p>
                  <p>New notifications will show here.</p>
                </div>
              ) : (
                recent.map((n, i) => (
                  <button key={n.id} type="button" onClick={() => handleClick(n)} className={`np-row ${n.isRead ? "read" : ""}`}>
                    <span className="np-num">{String(i + 1).padStart(2, "0")}</span>
                    <i className={`np-dot ${n.isRead ? "" : "solid"}`} title={n.isRead ? "Read" : "Unread"} />
                    <span className="np-text">
                      <span className="np-name">{n.title}</span>
                      {n.body && <span className="np-sub">{n.body}</span>}
                    </span>
                    <span className="np-label" style={{ whiteSpace: "nowrap", paddingTop: 2 }}>{timeAgo(n.createdAt)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
