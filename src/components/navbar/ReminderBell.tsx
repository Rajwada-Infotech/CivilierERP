import React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ChromeIcons } from "@/components/icons/moduleIcons";
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
import { BodyPortal } from "@/components/ui/body-portal";

type ReminderMeta = {
  icon: React.ElementType;
  label: string;
};

const TYPE_META: Record<string, ReminderMeta> = {
  purchase_order: { icon: ShoppingCart, label: "PO" },
  work_order: { icon: HardHat, label: "WO" },
  tds: { icon: FileWarning, label: "TDS" },
  grn: { icon: Package, label: "GRN" },
  emi_installment: { icon: Lock, label: "EMI" },
  material_request: { icon: ClipboardList, label: "MR" },
  pdc: { icon: Landmark, label: "PDC" },
  followup: { icon: CalendarClock, label: "Follow-Up" },
  loan_emi: { icon: Banknote, label: "Loan EMI" },
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

// The reminders panel drawn on the sheet: a square card with an ink border and a hard shadow on the faint grid, a
// title block under a strip in the current module's colour, squared filter tabs with counts, reminders split into
// Overdue / Due today / Coming up, and numbered rows with a square due mark: red when overdue, solid when due today,
// hatched when still to come. Colours come from the theme, so every theme matches.
const RB_CSS = `
@keyframes fullSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.animate-spin-full { animation: fullSpin 0.6s cubic-bezier(0.15, 0, 0, 1); }
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { scrollbar-width: none; }
.rb-sheet {
  --rb-ink: hsl(var(--foreground));
  --rb-graphite: hsl(var(--muted-foreground));
  --rb-rule: hsl(var(--border));
  --rb-rule-soft: hsl(var(--border) / 0.55);
  --rb-paper: hsl(var(--card));
  --rb-wash: hsl(var(--primary) / 0.10);
  --rb-red: hsl(var(--destructive));
  background-color: var(--rb-paper);
  background-image:
    linear-gradient(hsl(var(--foreground) / 0.04) 1px, transparent 1px),
    linear-gradient(90deg, hsl(var(--foreground) / 0.04) 1px, transparent 1px);
  background-size: 24px 24px;
  color: var(--rb-ink);
  border: 1.5px solid var(--rb-ink);
  border-top: 3px solid var(--rb-accent);
  box-shadow: 6px 6px 0 hsl(var(--foreground) / 0.14);
  font-family: "DM Sans", sans-serif;
  font-variant-numeric: tabular-nums;
}
.rb-sheet .rb-label {
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--rb-graphite);
}
.rb-sheet .rb-label.ink { color: var(--rb-ink); }
.rb-sheet .rb-label.red { color: var(--rb-red); }
.rb-sheet .rb-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; border-bottom: 1.5px solid var(--rb-ink); }
.rb-sheet .rb-count { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
.rb-sheet .rb-figure { font-family: "Sora", sans-serif; font-weight: 600; font-size: 28px; line-height: 1; letter-spacing: -0.02em; color: var(--rb-ink); }
.rb-sheet .rb-key {
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  border: 1px solid var(--rb-ink); color: var(--rb-ink); background: var(--rb-paper); transition: background-color .15s, color .15s;
}
.rb-sheet .rb-key:hover:not(:disabled) { background: var(--rb-ink); color: var(--rb-paper); }
.rb-sheet .rb-key:disabled { opacity: 0.6; }
.rb-sheet .rb-key.red { border-color: var(--rb-red); color: var(--rb-red); }
.rb-sheet .rb-tabs { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rb-rule); }
.rb-sheet .rb-arrow { width: 20px; height: 24px; display: inline-flex; align-items: center; justify-content: center; color: var(--rb-ink); flex-shrink: 0; }
.rb-sheet .rb-arrow:disabled { color: var(--rb-rule); cursor: default; }
.rb-sheet .rb-seg { flex: 1; min-width: 0; display: flex; overflow-x: auto; border: 1px solid var(--rb-ink); }
.rb-sheet .rb-seg button {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; white-space: nowrap;
  font-family: "Sora", sans-serif; font-weight: 600; font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--rb-graphite); transition: background-color .15s, color .15s;
}
.rb-sheet .rb-seg button + button { border-left: 1px solid var(--rb-ink); }
.rb-sheet .rb-seg button:hover { color: var(--rb-ink); background: var(--rb-wash); }
.rb-sheet .rb-seg button.on { background: var(--rb-ink); color: var(--rb-paper); }
.rb-sheet .rb-seg .rb-n { letter-spacing: 0; opacity: 0.75; }
.rb-sheet .rb-list { overflow-y: auto; max-height: min(60vh, 440px); overscroll-behavior: contain; }
.rb-sheet .rb-sec { display: flex; align-items: center; gap: 10px; padding: 12px 16px 6px; }
.rb-sheet .rb-rule { flex: 1; height: 1px; background: var(--rb-rule); }
.rb-sheet .rb-row {
  display: grid; grid-template-columns: 20px 28px minmax(0, 1fr) auto; align-items: start; gap: 10px; width: 100%;
  padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--rb-rule-soft); transition: background-color .12s;
}
.rb-sheet .rb-row:hover, .rb-sheet .rb-row:focus-visible { background: var(--rb-wash); box-shadow: inset 3px 0 0 var(--rb-ink); outline: none; }
.rb-sheet .rb-num { font-family: "Sora", sans-serif; font-size: 10px; font-weight: 600; color: var(--rb-graphite); padding-top: 8px; }
.rb-sheet .rb-mark {
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--rb-rule); background: var(--rb-paper); color: var(--rb-ink);
}
.rb-sheet .rb-row:hover .rb-mark { border-color: var(--rb-ink); }
.rb-sheet .rb-text { display: flex; flex-direction: column; min-width: 0; }
.rb-sheet .rb-title { font-size: 13px; font-weight: 600; color: var(--rb-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rb-sheet .rb-sub { font-size: 11px; color: var(--rb-graphite); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.rb-sheet .rb-due { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; }
.rb-sheet .rb-dot { width: 8px; height: 8px; border: 1px solid var(--rb-ink); flex-shrink: 0; }
.rb-sheet .rb-dot.red { background: var(--rb-red); border-color: var(--rb-red); }
.rb-sheet .rb-dot.solid { background: var(--rb-ink); }
.rb-sheet .rb-dot.hatch { background: repeating-linear-gradient(135deg, var(--rb-ink) 0, var(--rb-ink) 1px, transparent 1px, transparent 3px); }
.rb-sheet .rb-date { font-size: 11px; color: var(--rb-graphite); }
.rb-sheet .rb-amt { font-family: "Sora", sans-serif; font-weight: 600; font-size: 13px; letter-spacing: -0.01em; color: var(--rb-ink); white-space: nowrap; padding-top: 1px; }
.rb-sheet .rb-empty { margin: 18px 16px; padding: 22px; text-align: center; border: 1px dashed var(--rb-rule); font-size: 12px; color: var(--rb-graphite); }
.rb-sheet .rb-empty p + p { margin-top: 4px; }
`;

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

  const countByType = new Map<string, number>();
  for (const r of scoped) countByType.set(r.type, (countByType.get(r.type) ?? 0) + 1);
  const overdueCount = scoped.filter((r) => r.urgency === "overdue").length;

  // Overdue first, then what is due today, then everything still to come.
  const sections = [
    { key: "overdue", title: "Overdue", items: filtered.filter((r) => r.urgency === "overdue") },
    { key: "today", title: "Due today", items: filtered.filter((r) => r.urgency === "today") },
    { key: "later", title: "Coming up", items: filtered.filter((r) => r.urgency === "soon" || r.urgency === "upcoming") },
  ];

  // The strip along the panel's top edge takes the module the user is in.
  const accentVars = { "--rb-accent": accent } as React.CSSProperties;

  let rowNo = 0;

  return (
    <div className="relative">
      <style dangerouslySetInnerHTML={{ __html: RB_CSS }} />

      <button
        ref={bellButtonRef}
        onClick={handleNotificationClick}
        className="relative w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        title="Reminders"
      >
        <ChromeIcons.bell size={18} style={{ color: scoped.length > 0 ? "hsl(var(--foreground))" : undefined }} />
        {scoped.length > 0 && (
          <span className="absolute -top-0.5 -right-1 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center bg-destructive text-destructive-foreground font-heading text-[0.5625rem] font-semibold tabular-nums leading-none">
            {scoped.length > 99 ? "99+" : scoped.length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile scrim — tapping outside the panel closes it */}
          <BodyPortal><div
            className="fixed inset-0 z-40 sm:hidden"
            onClick={() => setOpen(false)}
          /></BodyPortal>

          <div
            ref={panelRef}
            style={accentVars}
            className="rb-sheet fixed sm:absolute left-1/2 sm:left-auto sm:right-0 top-16 sm:top-auto -translate-x-1/2 sm:translate-x-0 sm:mt-3 z-50 w-[min(92vw,440px)] flex flex-col animate-in fade-in duration-200"
          >
            {/* Title block: what this is, how many are waiting, and refresh */}
            <div className="rb-head">
              <div className="min-w-0">
                <p className="rb-label">CivilierERP · Reminders</p>
                <p className="rb-count">
                  <span className="rb-figure">{scoped.length}</span>
                  <span className="rb-label">pending</span>
                  {overdueCount > 0 && <span className="rb-label red">· {overdueCount} overdue</span>}
                </p>
              </div>
              <button
                onClick={() => {
                  if (!isLocked) refresh(true);
                }}
                disabled={loading || isLocked}
                className={`rb-key ${isLocked ? "red" : ""}`}
                title={isLocked ? "Refresh is locked for a moment" : "Refresh"}
              >
                {isLocked ? <Lock size={13} /> : <RefreshCw size={13} className={loading ? "animate-spin-full" : ""} />}
              </button>
            </div>

            {/* Type filter: squared tabs, each with its own count */}
            <div className="rb-tabs">
              <button type="button" onClick={() => scrollTabs(-1)} disabled={!canScrollLeft} className="rb-arrow" aria-label="Scroll filters left">
                <ChevronLeft size={12} />
              </button>
              <div ref={tabsRef} className="rb-seg no-scrollbar">
                {availableTabs.map((t) => {
                  const meta = t !== "all" ? TYPE_META[t] : null;
                  const count = t === "all" ? scoped.length : (countByType.get(t) ?? 0);
                  return (
                    <button key={t} type="button" onClick={() => setFilter(t)} className={filter === t ? "on" : ""}>
                      {t === "all" ? "All" : meta?.label || t.toUpperCase()}
                      <span className="rb-n">{count}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => scrollTabs(1)} disabled={!canScrollRight} className="rb-arrow" aria-label="Scroll filters right">
                <ChevronRight size={12} />
              </button>
            </div>

            <div className="rb-list thin-scroll">
              {filtered.length === 0 ? (
                <div className="rb-empty">
                  <p className="rb-label ink">All caught up</p>
                  <p>No reminders to show right now.</p>
                </div>
              ) : (
                sections.map((sec) =>
                  sec.items.length === 0 ? null : (
                    <section key={sec.key}>
                      <header className="rb-sec">
                        <span className={`rb-label ${sec.key === "overdue" ? "red" : "ink"}`}>{sec.title}</span>
                        <span className="rb-rule" />
                        <span className="rb-label">{sec.items.length}</span>
                      </header>
                      {sec.items.map((r) => {
                        const meta = TYPE_META[r.type];
                        const tone = r.urgency === "overdue" ? "red" : r.urgency === "today" ? "solid" : "hatch";
                        rowNo += 1;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              navigate(r.path);
                            }}
                            className="rb-row"
                          >
                            <span className="rb-num">{String(rowNo).padStart(2, "0")}</span>
                            <span className="rb-mark" title={meta?.label}>
                              {React.createElement(meta?.icon || Package, { size: 14, strokeWidth: 1.75 })}
                            </span>
                            <span className="rb-text">
                              <span className="rb-title">{r.title}</span>
                              {r.subtitle && <span className="rb-sub">{r.subtitle}</span>}
                              <span className="rb-due">
                                <i className={`rb-dot ${tone}`} />
                                <span className={`rb-label ${tone === "red" ? "red" : "ink"}`}>{formatRelative(r.dueDate)}</span>
                                <span className="rb-date">{formatDate(r.dueDate)}</span>
                              </span>
                            </span>
                            {r.amount ? <span className="rb-amt">₹{r.amount.toLocaleString("en-IN")}</span> : <span />}
                          </button>
                        );
                      })}
                    </section>
                  ),
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
