import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Bell,
  RefreshCw,
  CheckCircle2,
  CreditCard,
  ShoppingCart,
  Package,
  FileWarning,
  HardHat,
  BookOpen,
  AlertCircle,
  Clock,
  CalendarClock,
} from "lucide-react";
import {
  useReminders,
  type ReminderItem,
  formatRelative,
  formatDate,
} from "@/hooks/useReminders";

const BELL_CSS = `
@keyframes bellJingle {
  0%,100% { transform: rotate(0deg); }
  10%  { transform: rotate(18deg); }
  20%  { transform: rotate(-16deg); }
  30%  { transform: rotate(13deg); }
  40%  { transform: rotate(-9deg); }
  50%  { transform: rotate(6deg); }
  70%  { transform: rotate(-3deg); }
  90%  { transform: rotate(1deg); }
}
.bell-jingle { animation: bellJingle 0.9s ease-in-out; transform-origin: top center; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
.hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;

if (typeof document !== "undefined" && !document.getElementById("bell-css")) {
  const s = document.createElement("style");
  s.id = "bell-css";
  s.textContent = BELL_CSS;
  document.head.appendChild(s);
}

const URGENCY: Record<
  ReminderItem["urgency"],
  { bar: string; badge: string; dot: string; row: string; label: string }
> = {
  overdue: {
    bar: "bg-red-500",
    badge: "bg-red-500/15 text-red-600 border-red-400/30",
    dot: "bg-red-500",
    row: "bg-red-500/5 hover:bg-red-500/10",
    label: "Overdue",
  },
  today: {
    bar: "bg-amber-500",
    badge: "bg-amber-500/15 text-amber-600 border-amber-400/30",
    dot: "bg-amber-500",
    row: "bg-amber-500/5 hover:bg-amber-500/10",
    label: "Today",
  },
  soon: {
    bar: "bg-blue-500",
    badge: "bg-blue-500/15 text-blue-600 border-blue-400/30",
    dot: "bg-blue-500",
    row: "hover:bg-muted/40",
    label: "Soon",
  },
  upcoming: {
    bar: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
    row: "hover:bg-muted/30",
    label: "Upcoming",
  },
};

const TYPE_META: Record<
  ReminderItem["type"],
  { icon: React.ElementType; label: string; color: string }
> = {
  purchase_order: {
    icon: ShoppingCart,
    label: "Purchase Order",
    color: "text-violet-500",
  },
  work_order: { icon: HardHat, label: "Work Order", color: "text-orange-500" },
  cheque: { icon: BookOpen, label: "Cheque", color: "text-cyan-500" },
  tds: { icon: FileWarning, label: "TDS", color: "text-rose-500" },
  grn: { icon: Package, label: "GRN", color: "text-emerald-500" },
  payment: { icon: CreditCard, label: "Payment", color: "text-blue-500" },
};

const TYPE_ORDER: ReminderItem["type"][] = [
  "purchase_order",
  "work_order",
  "cheque",
  "tds",
  "grn",
  "payment",
];

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
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp! : internalOpen;
  const onClose = onCloseProp ?? (() => setInternalOpen(false));
  const onToggle = onToggleProp ?? (() => setInternalOpen((p) => !p));

  const [jingle, setJingle] = useState(false);
  const [activeFilter, setActiveFilter] = useState<
    ReminderItem["type"] | "all"
  >("all");

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { reminders, loading, badgeCount, refresh } = useReminders({
    fetchOnMount: true,
  });

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  useEffect(() => {
    if (badgeCount <= 0) return;
    const fire = () => {
      setJingle(false);
      requestAnimationFrame(() => setJingle(true));
    };
    fire();
    const id = setInterval(fire, 5000);
    return () => clearInterval(id);
  }, [badgeCount]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
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

  const typesPresent = Array.from(new Set(reminders.map((r) => r.type)));
  const filteredReminders =
    activeFilter === "all"
      ? reminders
      : reminders.filter((r) => r.type === activeFilter);
  const overdueCount = reminders.filter((r) => r.urgency === "overdue").length;
  const todayCount = reminders.filter((r) => r.urgency === "today").length;
  const soonCount = reminders.filter((r) => r.urgency === "soon").length;

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={onToggle}
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

      <div
        ref={panelRef}
        className={`absolute top-full mt-2 z-50 rounded-xl border border-border bg-card shadow-2xl transition-all duration-200 origin-top-right right-0 flex flex-col
          ${open ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"}`}
        style={{
          width: "min(24rem, calc(100vw - 1rem))",
          maxHeight: "calc(100vh - 80px)",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Bell size={13} className="text-amber-500" />
            <span className="text-xs font-heading font-bold text-foreground uppercase tracking-wider">
              Reminders
            </span>
            {(overdueCount > 0 || todayCount > 0) && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">
                {overdueCount + todayCount}
              </span>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {!loading && reminders.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/30 shrink-0 flex-wrap">
            {overdueCount > 0 && (
              <div className="flex items-center gap-1.5">
                <AlertCircle size={11} className="text-red-500" />
                <span className="text-[11px] font-semibold text-red-600">
                  {overdueCount} overdue
                </span>
              </div>
            )}
            {overdueCount > 0 && todayCount > 0 && (
              <span className="text-border text-xs">·</span>
            )}
            {todayCount > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock size={11} className="text-amber-500" />
                <span className="text-[11px] font-semibold text-amber-600">
                  {todayCount} today
                </span>
              </div>
            )}
            {(overdueCount > 0 || todayCount > 0) && soonCount > 0 && (
              <span className="text-border text-xs">·</span>
            )}
            {soonCount > 0 && (
              <div className="flex items-center gap-1.5">
                <CalendarClock size={11} className="text-blue-500" />
                <span className="text-[11px] text-blue-600">
                  {soonCount} soon
                </span>
              </div>
            )}
          </div>
        )}

        {!loading && typesPresent.length > 1 && (
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border/60 overflow-x-auto shrink-0 hide-scrollbar">
            <button
              onClick={() => setActiveFilter("all")}
              className={`shrink-0 text-[10px] font-heading font-semibold px-2.5 py-1 rounded-full border transition-all ${
                activeFilter === "all"
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              All ({reminders.length})
            </button>
            {TYPE_ORDER.filter((t) => typesPresent.includes(t)).map((t) => {
              const cfg = TYPE_META[t];
              const count = reminders.filter((r) => r.type === t).length;
              const Icon = cfg.icon;
              return (
                <button
                  key={t}
                  onClick={() => setActiveFilter(t)}
                  className={`shrink-0 flex items-center gap-1 text-[10px] font-heading font-semibold px-2.5 py-1 rounded-full border transition-all ${
                    activeFilter === t
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  }`}
                >
                  <Icon size={9} />
                  {cfg.label} ({count})
                </button>
              );
            })}
          </div>
        )}

        <div className="overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <RefreshCw
                size={18}
                className="text-muted-foreground animate-spin"
              />
              <p className="text-xs text-muted-foreground">
                Checking deadlines…
              </p>
            </div>
          ) : filteredReminders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center px-4">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <p className="text-sm font-heading font-semibold text-foreground">
                {activeFilter === "all"
                  ? "All clear!"
                  : `No ${TYPE_META[activeFilter as ReminderItem["type"]]?.label ?? ""} reminders`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filteredReminders.map((r) => {
                const urg = URGENCY[r.urgency];
                const tm = TYPE_META[r.type];
                const Icon = tm.icon;
                return (
                  <div
                    key={r.id}
                    onClick={onClose}
                    className={`relative flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer ${urg.row}`}
                  >
                    <div
                      className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${urg.bar}`}
                    />
                    <div className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-card border border-border">
                      <Icon size={13} className={tm.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-foreground truncate leading-snug">
                            {r.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate leading-snug mt-0.5">
                            {r.subtitle}
                          </p>
                        </div>
                        {r.amount !== undefined && (
                          <span className="text-[10px] font-bold text-emerald-600 shrink-0 tabular-nums">
                            ₹{r.amount.toLocaleString("en-IN")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${urg.badge}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${urg.dot}`}
                          />
                          {formatRelative(r.dueDate)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 font-mono">
                          {formatDate(r.dueDate)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!loading && reminders.length > 0 && (
          <div className="border-t border-border px-4 py-2.5 flex items-center justify-between shrink-0">
            <p className="text-[10px] text-muted-foreground">
              {reminders.length} item{reminders.length !== 1 ? "s" : ""} · Next
              7d
            </p>
            <button
              onClick={handleRefresh}
              className="text-[10px] text-primary hover:underline font-heading"
            >
              Refresh ↻
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReminderBell;
