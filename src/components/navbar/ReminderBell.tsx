import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  RefreshCw,
  CheckCircle2,
  CreditCard,
  CalendarClock,
  ShoppingCart,
  Package,
  BookOpen,
  FileWarning,
  CheckSquare,
  Wallet,
} from "lucide-react";
import {
  useReminders,
  type ReminderItem,
  formatRelative,
} from "@/hooks/useReminders";

const BELL_JINGLE_STYLE = `
@keyframes bellJingle {
  0%   { transform: rotate(0deg); }
  10%  { transform: rotate(18deg); }
  20%  { transform: rotate(-16deg); }
  30%  { transform: rotate(14deg); }
  40%  { transform: rotate(-10deg); }
  50%  { transform: rotate(7deg); }
  60%  { transform: rotate(-4deg); }
  70%  { transform: rotate(2deg); }
  80%  { transform: rotate(-1deg); }
  90%  { transform: rotate(0.5deg); }
  100% { transform: rotate(0deg); }
}
.bell-jingle {
  animation: bellJingle 1s ease-in-out;
  transform-origin: top center;
}
`;

if (
  typeof document !== "undefined" &&
  !document.getElementById("bell-jingle-style")
) {
  const style = document.createElement("style");
  style.id = "bell-jingle-style";
  style.textContent = BELL_JINGLE_STYLE;
  document.head.appendChild(style);
}

const URGENCY_CONFIG = {
  overdue: {
    label: "Overdue",
    className: "bg-red-500/15 text-red-600 border-red-400/30",
    dot: "bg-red-500",
  },
  today: {
    label: "Today",
    className: "bg-amber-500/15 text-amber-600 border-amber-400/30",
    dot: "bg-amber-500",
  },
  soon: {
    label: "Soon",
    className: "bg-blue-500/15 text-blue-600 border-blue-400/30",
    dot: "bg-blue-500",
  },
  upcoming: {
    label: "Upcoming",
    className: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

const TYPE_ICON: Record<ReminderItem["type"], React.ElementType> = {
  payment: CreditCard,
  deadline: CalendarClock,
  purchase_order: ShoppingCart,
  grn: Package,
  cheque: BookOpen,
  card: Wallet,
  tds: FileWarning,
  task: CheckSquare,
  general: Bell,
};

// Mapped to actual routes defined in App.tsx
const TYPE_ROUTE: Partial<Record<ReminderItem["type"], string>> = {
  task: "/tasks",
  card: "/masters/card",
  purchase_order: "/material/purchase-order",
  grn: "/material/grn",
  cheque: "/masters/cheque",
  tds: "/masters/tds",
};

interface ReminderBellProps {
  open?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}

export const ReminderBell: React.FC<ReminderBellProps> = ({
  open: openProp,
  onToggle: onToggleProp,
  onClose: onCloseProp,
}) => {
  const navigate = useNavigate();

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp! : internalOpen;
  const onClose = onCloseProp ?? (() => setInternalOpen(false));
  const onToggle = onToggleProp ?? (() => setInternalOpen((p) => !p));

  const [jingle, setJingle] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const { reminders, loading, badgeCount, refresh } = useReminders({
    fetchOnMount: true,
  });

  // On open: refresh data and compute panel position from button rect
  useEffect(() => {
    if (!open) return;
    refresh();
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jingle on badge changes
  useEffect(() => {
    if (badgeCount <= 0) return;
    const fire = () => {
      setJingle(false);
      requestAnimationFrame(() => setJingle(true));
    };
    fire();
    const id = setInterval(fire, 4500);
    return () => clearInterval(id);
  }, [badgeCount]);

  // Click-outside closes panel — checks both panel and button refs
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  const handleRefresh = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      refresh();
    },
    [refresh],
  );

  const handleItemClick = useCallback(
    (r: ReminderItem) => {
      let dest = TYPE_ROUTE[r.type] ?? null;
      if (r.type === "task") dest = r.taskId ? `/tasks/${r.taskId}` : "/tasks";
      if (dest) {
        navigate(dest);
        onClose();
      }
    },
    [navigate, onClose],
  );

  const isClickable = (r: ReminderItem) => r.type in TYPE_ROUTE;

  const urgencyCounts = reminders.reduce(
    (acc, r) => {
      acc[r.urgency] = (acc[r.urgency] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const criticalCount =
    (urgencyCounts.overdue || 0) + (urgencyCounts.today || 0);

  const panel = (
    <div
      ref={panelRef}
      className={[
        "fixed z-[999] rounded-xl border border-border bg-card shadow-2xl",
        "transition-all duration-200 origin-top-right",
        open
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-95 pointer-events-none",
      ].join(" ")}
      style={{
        top: pos.top,
        right: pos.right,
        width: "min(22rem, calc(100vw - 1rem))",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-amber-500" />
          <span className="text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
            Reminders
          </span>
          {criticalCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">
              {criticalCount}
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh reminders"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!loading && reminders.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/60 flex-wrap">
          {(["overdue", "today", "soon"] as const).map((u) =>
            urgencyCounts[u] ? (
              <span
                key={u}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${URGENCY_CONFIG[u].className}`}
              >
                {urgencyCounts[u]} {URGENCY_CONFIG[u].label}
              </span>
            ) : null,
          )}
        </div>
      )}

      <div className="overflow-y-auto" style={{ maxHeight: "22rem" }}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <RefreshCw
              size={18}
              className="text-muted-foreground animate-spin"
            />
            <p className="text-xs text-muted-foreground">
              Loading reminders...
            </p>
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <p className="text-sm font-heading font-semibold text-foreground">
              All clear!
            </p>
            <p className="text-xs text-muted-foreground">
              No overdue or upcoming items in the next 7 days.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {reminders.map((r) => {
              const Icon = TYPE_ICON[r.type];
              const cfg = URGENCY_CONFIG[r.urgency];
              const clickable = isClickable(r);
              return (
                <div
                  key={r.id}
                  onClick={() => handleItemClick(r)}
                  className={[
                    "flex items-start gap-3 px-4 py-3 transition-colors",
                    clickable ? "cursor-pointer" : "cursor-default",
                    r.urgency === "overdue"
                      ? "bg-red-500/5 hover:bg-red-500/10"
                      : r.urgency === "today"
                        ? "bg-amber-500/5 hover:bg-amber-500/10"
                        : clickable
                          ? "hover:bg-muted/40"
                          : "",
                  ].join(" ")}
                >
                  <div
                    className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${cfg.className}`}
                  >
                    <Icon size={13} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {r.title}
                        {clickable && (
                          <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                            {"→"}
                          </span>
                        )}
                      </p>
                      {r.amount !== undefined && (
                        <span className="text-[10px] font-bold text-emerald-600 shrink-0">
                          Rs.{r.amount.toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {r.subtitle}
                    </p>
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cfg.className}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}
                        />
                        {formatRelative(r.dueDate, r.timeSlot)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border px-4 py-2.5 flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Overdue {"·"} Today {"·"} Next 7 days
        </p>
        <button
          onClick={() => {
            navigate("/tasks");
            onClose();
          }}
          className="text-[10px] text-primary hover:underline font-heading"
        >
          View all tasks {"→"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={onToggle}
        title="Reminders"
        className={`relative p-2 rounded-md transition-all text-foreground ${open ? "bg-muted" : "hover:bg-muted"}`}
      >
        <Bell
          size={17}
          className={jingle ? "bell-jingle" : ""}
          onAnimationEnd={() => setJingle(false)}
        />
        {badgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>
      {createPortal(panel, document.body)}
    </div>
  );
};

export default ReminderBell;
