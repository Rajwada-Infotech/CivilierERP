import React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Notification } from "iconsax-react";
import {
  RefreshCw,
  ShoppingCart,
  HardHat,
  FileWarning,
  Package,
  Lock,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Landmark,
  CalendarClock,
  Banknote,
} from "lucide-react";
import { useReminders, formatRelative, formatDate, REMINDER_TYPE_MODULE } from "@/hooks/useReminders";
import { useModule } from "@/contexts/ModuleContext";
import { getModuleAccent } from "@/lib/moduleColors";

type ReminderMeta = {
  icon: React.ElementType;
  label: string;
  color: string;
};

const TYPE_META: Record<string, ReminderMeta> = {
  purchase_order: { icon: ShoppingCart, label: "PO", color: "text-violet-500" },
  work_order: { icon: HardHat, label: "WO", color: "text-orange-500" },
  tds: { icon: FileWarning, label: "TDS", color: "text-rose-500" },
  grn: { icon: Package, label: "GRN", color: "text-emerald-500" },
  emi_installment: { icon: Lock, label: "EMI", color: "text-purple-500" },
  material_request: { icon: ClipboardList, label: "MR", color: "text-blue-500" },
  pdc: { icon: Landmark, label: "PDC", color: "text-sky-500" },
  followup: { icon: CalendarClock, label: "Follow-Up", color: "text-teal-500" },
  loan_emi: { icon: Banknote, label: "Loan EMI", color: "text-green-500" },
};

const ALL_TABS = [
  "all",
  "material_request",
  "purchase_order",
  "grn",
  "work_order",
  "pdc",
  "emi_installment",
  "tds",
  "followup",
  "loan_emi",
];

export const ReminderBell = () => {
  const navigate = useNavigate();
  const { activeModule } = useModule();
  const accent = getModuleAccent(activeModule);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const { reminders, loading, refresh, isLocked } = useReminders({
    pollingInterval: 0,
  });

  const bellButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Measure after the open animation mounts the panel.
    const id = requestAnimationFrame(updateScrollState);
    const el = tabsRef.current;
    el?.addEventListener("scroll", updateScrollState);
    window.addEventListener("resize", updateScrollState);
    return () => {
      cancelAnimationFrame(id);
      el?.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [open, updateScrollState]);

  const scrollTabs = (dir: 1 | -1) => {
    tabsRef.current?.scrollBy({ left: dir * 120, behavior: "smooth" });
  };

  // Click-outside: close only when clicking outside BOTH the button and the panel
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        bellButtonRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const handleNotificationClick = useCallback(() => {
    setOpen((prev) => {
      if (!prev) refresh(true);
      return !prev;
    });
  }, [refresh]);

  // Home (activeModule === null) is the one consolidated view — everywhere
  // else the bell only ever shows the current module's own reminders, per
  // REMINDER_TYPE_MODULE, so e.g. the Material bell doesn't get cluttered
  // with Follow-Up or Finance items and vice versa.
  const scoped = activeModule
    ? reminders.filter((r) => REMINDER_TYPE_MODULE[r.type] === activeModule)
    : reminders;

  const availableTabs = activeModule
    ? ["all", ...ALL_TABS.filter((t) => t !== "all" && REMINDER_TYPE_MODULE[t as keyof typeof REMINDER_TYPE_MODULE] === activeModule)]
    : ALL_TABS;

  // Reset back to "all" if the active filter tab no longer applies (e.g. the
  // user switched modules while a type-specific tab was selected).
  useEffect(() => {
    if (!availableTabs.includes(filter)) setFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModule]);

  const filtered =
    filter === "all" ? scoped : scoped.filter((r) => r.type === filter);

  // CSS custom properties drive every accent-tinted style below, so the
  // whole panel re-themes to whichever module the user is currently in
  // without a single hardcoded color or any mouseenter/leave JS.
  const accentVars = {
    "--rb-accent": accent,
    "--rb-accent-10": `${accent}1A`,
    "--rb-accent-20": `${accent}33`,
    "--rb-accent-30": `${accent}4D`,
  } as React.CSSProperties;

  return (
    <div className="relative">
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
        ref={bellButtonRef}
        onClick={handleNotificationClick}
        className="relative p-2.5 hover:bg-muted rounded-full transition-all active:scale-95"
      >
        <Notification
          size={20}
          variant={scoped.length > 0 ? "Bold" : "Outline"}
          className={scoped.length > 0 ? "animate-jingle-periodic" : ""}
          color={scoped.length > 0 ? "#f59e0b" : "hsl(var(--muted-foreground))"}
        />
        {scoped.length > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-600 text-[10px] font-bold text-white items-center justify-center border-2 border-background">
              {scoped.length}
            </span>
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile scrim — tapping outside the panel closes it */}
          <div
            className="fixed inset-0 z-40 sm:hidden"
            onClick={() => setOpen(false)}
          />

          <div
            ref={panelRef}
            style={accentVars}
            className="fixed sm:absolute left-1/2 sm:left-auto sm:right-0 top-16 sm:top-auto -translate-x-1/2 sm:translate-x-0 sm:mt-3 z-50 w-[min(92vw,420px)] bg-card border border-[var(--rb-accent-20)] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top sm:origin-top-right"
          >
            {/* Header — gradient wash + live count, tinted to the active module */}
            <div className="relative px-4 py-3.5 border-b border-[var(--rb-accent-20)] bg-gradient-to-br from-[var(--rb-accent-10)] via-card to-card overflow-hidden">
              <div
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none"
                style={{
                  background: `radial-gradient(circle, ${accent}28 0%, transparent 70%)`,
                }}
              />
              <div className="relative z-10 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg border border-[var(--rb-accent-30)] bg-[var(--rb-accent-10)] flex items-center justify-center shrink-0">
                    <Notification size={13} variant="Bold" color="var(--rb-accent)" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold tracking-wide text-foreground truncate">
                      Reminders
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {scoped.length} pending alert
                      {scoped.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!isLocked) refresh(true);
                  }}
                  disabled={loading || isLocked}
                  className={`p-1.5 rounded-lg transition-all active:scale-90 shrink-0 ${
                    isLocked
                      ? "bg-red-500/10 text-red-400"
                      : "text-muted-foreground hover:bg-[var(--rb-accent-10)] hover:text-[var(--rb-accent)]"
                  }`}
                >
                  {isLocked ? (
                    <Lock size={14} />
                  ) : (
                    <RefreshCw
                      size={14}
                      className={loading ? "animate-spin-full text-[var(--rb-accent)]" : ""}
                    />
                  )}
                </button>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="border-b border-[var(--rb-accent-20)] bg-muted/30 px-3 py-2.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollTabs(-1)}
                disabled={!canScrollLeft}
                className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                  canScrollLeft
                    ? "text-[var(--rb-accent)] hover:bg-[var(--rb-accent-10)] active:scale-90"
                    : "text-muted-foreground/25 cursor-default"
                }`}
              >
                <ChevronLeft size={12} />
              </button>

              <div
                ref={tabsRef}
                className="flex-1 flex gap-1 overflow-x-auto no-scrollbar"
              >
                {availableTabs.map((t) => {
                  const active = filter === t;
                  const meta = t !== "all" ? TYPE_META[t] : null;
                  const Icon = meta?.icon;
                  return (
                    <button
                      key={t}
                      onClick={() => setFilter(t)}
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-lg transition-all duration-150 ${
                        active
                          ? "bg-[var(--rb-accent)] text-white shadow-sm"
                          : "bg-card/60 text-muted-foreground hover:bg-card hover:text-foreground border border-border/60"
                      }`}
                    >
                      {Icon && <Icon size={10} className={active ? "text-white/80" : meta?.color} />}
                      {t === "all" ? "All" : meta?.label || t.toUpperCase()}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => scrollTabs(1)}
                disabled={!canScrollRight}
                className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                  canScrollRight
                    ? "text-[var(--rb-accent)] hover:bg-[var(--rb-accent-10)] active:scale-90"
                    : "text-muted-foreground/25 cursor-default"
                }`}
              >
                <ChevronRight size={12} />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[60vh] sm:max-h-[400px] scrollbar-none">
              {filtered.length === 0 ? (
                <div className="py-12 px-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
                    <Notification size={18} variant="Outline" color="rgb(52 211 153 / 0.6)" />
                  </div>
                  <p className="text-xs font-semibold text-foreground">
                    All caught up
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    No alerts to show right now.
                  </p>
                </div>
              ) : (
                <div className="p-2 space-y-1.5">
                  {filtered.map((r) => {
                    const meta = TYPE_META[r.type];
                    const overdue = r.urgency === "overdue";
                    return (
                      <div
                        key={r.id}
                        onClick={() => {
                          setOpen(false);
                          navigate(r.path);
                        }}
                        className="group relative flex gap-3 p-3 rounded-xl border border-transparent hover:border-[var(--rb-accent-30)] hover:bg-muted/40 hover:shadow-sm transition-all cursor-pointer"
                      >
                        <div
                          className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-current/10 ${meta?.color ?? "text-muted-foreground"} transition-transform group-hover:scale-110`}
                        >
                          {React.createElement(meta?.icon || Package, {
                            size: 15,
                          })}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between gap-2 items-baseline">
                            <span className="truncate font-bold text-[11px] text-foreground group-hover:text-[var(--rb-accent)] transition-colors">
                              {r.title}
                            </span>
                            {r.amount && (
                              <span className="text-emerald-600 text-[11px] font-bold shrink-0">
                                ₹{r.amount.toLocaleString()}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {r.subtitle}
                          </p>
                          <div className="mt-2 flex gap-1.5 items-center flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                overdue
                                  ? "bg-red-500/10 text-red-600"
                                  : "bg-amber-500/10 text-amber-600"
                              }`}
                            >
                              <span
                                className={`w-1 h-1 rounded-full ${overdue ? "bg-red-500" : "bg-amber-500"}`}
                              />
                              {formatRelative(r.dueDate)}
                            </span>
                            <span className="text-[9px] text-muted-foreground/60 font-medium">
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
          </div>
        </>
      )}
    </div>
  );
};
