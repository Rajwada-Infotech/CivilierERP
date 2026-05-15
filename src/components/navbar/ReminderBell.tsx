import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom"; // React Router
import {
  Bell,
  RefreshCw,
  ShoppingCart,
  HardHat,
  BookOpen,
  FileWarning,
  Package,
  Lock,
  ClipboardList,
} from "lucide-react";
import { useReminders, formatRelative, formatDate } from "@/hooks/useReminders";

const TYPE_META: Record<string, any> = {
  purchase_order: { icon: ShoppingCart, label: "PO", color: "text-violet-500" },
  work_order: { icon: HardHat, label: "WO", color: "text-orange-500" },
  cheque: { icon: BookOpen, label: "CHQ", color: "text-cyan-500" },
  tds: { icon: FileWarning, label: "TDS", color: "text-rose-500" },
  grn: { icon: Package, label: "GRN", color: "text-emerald-500" },
  emi_installment: { icon: Lock, label: "EMI", color: "text-purple-500" },
  material_request: { icon: ClipboardList, label: "MR", color: "text-blue-500" },
};

export const ReminderBell = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const { reminders, loading, badgeCount, refresh, isLocked } = useReminders({
    pollingInterval: 0,
  });
  const panelRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const clickOut = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        setOpen(false);
    };
    if (open) document.addEventListener("mousedown", clickOut);
    return () => document.removeEventListener("mousedown", clickOut);
  }, [open]);

  const filtered =
    filter === "all" ? reminders : reminders.filter((r) => r.type === filter);

  return (
    <div className="relative" ref={panelRef}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes periodicJingle {
          0% { transform: rotate(0deg); }
          2% { transform: rotate(15deg); }
          4% { transform: rotate(-15deg); }
          6% { transform: rotate(15deg); }
          8% { transform: rotate(-15deg); }
          10% { transform: rotate(10deg); }
          12% { transform: rotate(-10deg); }
          14% { transform: rotate(0deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes fullSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-jingle-periodic { animation: periodicJingle 4s ease-in-out infinite; }
        .animate-spin-full { animation: fullSpin 0.6s cubic-bezier(0.15, 0, 0, 1); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `,
        }}
      />

      <button
        onClick={() => setOpen(!open)}
        className="relative p-2.5 hover:bg-muted rounded-full transition-all active:scale-95"
      >
        <Bell
          size={20}
          className={
            badgeCount > 0
              ? "text-amber-500 animate-jingle-periodic"
              : "text-muted-foreground"
          }
        />
        {badgeCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-600 text-[10px] font-bold text-white items-center justify-center border-2 border-background">
              {badgeCount}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-80 bg-card border rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-right">
          <div className="p-4 border-b flex justify-between items-center bg-muted/20">
            <span className="text-xs font-bold uppercase tracking-widest text-foreground/70">
              Reminders
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isLocked) refresh(true);
              }}
              disabled={loading || isLocked}
              className={`p-1.5 rounded-md transition-all ${isLocked ? "bg-red-50 text-red-400" : "hover:bg-background"}`}
            >
              {isLocked ? (
                <Lock size={14} />
              ) : (
                <RefreshCw
                  size={14}
                  className={
                    loading
                      ? "animate-spin-full text-primary"
                      : "text-muted-foreground"
                  }
                />
              )}
            </button>
          </div>

          <div className="p-2 flex gap-1 overflow-x-auto border-b bg-muted/5 no-scrollbar">
            {[
              "all",
              "purchase_order",
              "grn",
              "cheque",
              "tds",
              "emi_installment",
              "material_request",
            ].map((t) => (
              <button
                key={t}
                onClick={(e) => {
                  e.stopPropagation();
                  setFilter(t);
                }}
                className={`px-3 py-1 text-[10px] font-bold rounded-full border transition-all ${filter === t ? "bg-primary text-white border-primary shadow-sm" : "bg-background text-muted-foreground hover:border-muted"}`}
              >
                {t === "all" ? "All" : TYPE_META[t]?.label || t.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto max-h-[400px] divide-y divide-border/40">
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-xs font-medium">
                No alerts today.
              </div>
            ) : (
              filtered.map((r) => (
                <div
                  key={r.id}
                  onClick={() => {
                    setOpen(false);
                    navigate(r.path);
                  }}
                  className="p-4 hover:bg-muted/50 transition-colors cursor-pointer group"
                >
                  <div className="flex gap-3">
                    <div
                      className={`mt-1 transition-transform group-hover:scale-110 ${TYPE_META[r.type]?.color}`}
                    >
                      {React.createElement(TYPE_META[r.type]?.icon || Package, {
                        size: 16,
                      })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between font-bold text-[11px] items-center">
                        <span className="truncate pr-2 group-hover:text-primary transition-colors">
                          {r.title}
                        </span>
                        {r.amount && (
                          <span className="text-emerald-600 shrink-0">
                            ₹{r.amount.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {r.subtitle}
                      </p>
                      <div className="mt-2.5 flex gap-2 items-center">
                        <span
                          className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${r.urgency === "overdue" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}
                        >
                          {formatRelative(r.dueDate)}
                        </span>
                        <span className="text-[9px] text-muted-foreground/50 font-medium">
                          {formatDate(r.dueDate)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
