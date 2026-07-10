import React, { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as spApi from "@/api/supplierPortalApi";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import {
  FileText, Bell, CheckCircle, Clock, ChevronRight,
  IndianRupee, Building2, AlertCircle,
  Package, Search, Save, Edit3, X,
} from "lucide-react";

// ── Utilities ─────────────────────────────────────────────────────────────────
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const isOverdue = (d?: string | null) => !!d && new Date(d) < new Date();
const isDueSoon = (d?: string | null) =>
  !!d && !isOverdue(d) && new Date(d) <= new Date(Date.now() + 3 * 86_400_000);

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
});

// ── Welcome hero ──────────────────────────────────────────────────────────────
function WelcomeHero({ name, total, pending, submitted, loading }: {
  name: string; total: number; pending: number; submitted: number; loading: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <section className="px-6 sm:px-10 py-8 sm:py-10 font-body border-b border-border"
      style={{
        background: isDark
          ? "linear-gradient(160deg, rgba(6,78,59,0.18) 0%, rgba(5,46,22,0.10) 50%, transparent 100%)"
          : "linear-gradient(160deg, #ecfdf5 0%, #f0fdf4 50%, #ffffff 100%)",
      }}>
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
        <div>
          <motion.p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-1" {...fade(0)}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
            {greeting}
          </motion.p>
          <motion.h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground leading-tight" {...fade(0.08)}>
            {name}
          </motion.h1>
          <motion.p className="text-sm text-muted-foreground mt-1.5" {...fade(0.14)}>
            Respond to open RFQs, manage your price catalog and track submissions.
          </motion.p>
        </div>

        <motion.div className="flex items-center gap-5 sm:gap-7 shrink-0" {...fade(0.18)}>
          {[
            { icon: FileText, label: "Total RFQs", val: loading ? "…" : String(total), col: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10" },
            { icon: Clock, label: "Pending", val: loading ? "…" : String(pending), col: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" },
            { icon: CheckCircle, label: "Submitted", val: loading ? "…" : String(submitted), col: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center text-center min-w-[56px]">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-1.5 ${s.bg}`}>
                <s.icon size={17} className={s.col} />
              </div>
              <span className="text-xl font-heading font-bold text-foreground">{s.val}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{s.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, due }: { status: string; due?: string | null }) {
  const overdue = isOverdue(due);
  const soon = isDueSoon(due);
  if (status === "Submitted") return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-fit">Submitted</span>
  );
  if (overdue) return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-1 w-fit">
      <AlertCircle size={10} /> Overdue
    </span>
  );
  if (soon) return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 w-fit">Due Soon</span>
  );
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 w-fit">Open</span>
  );
}

// ── Quotations section ────────────────────────────────────────────────────────
function QuotationsSection({ quotations, loading }: {
  quotations: spApi.SupplierQuotationSummary[]; loading: boolean;
}) {
  const navigate = useNavigate();

  const pending = quotations.filter((q) => q.MySubmissionStatus === "Pending");
  const submitted = quotations.filter((q) => q.MySubmissionStatus === "Submitted");

  return (
    <section id="quotations-section" className="px-6 sm:px-10 py-8 font-body">
      <div className="max-w-6xl mx-auto">
        <motion.div className="flex items-center justify-between mb-5" {...fade(0)}>
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">Active Quotations</h2>
            <p className="text-xs text-muted-foreground mt-0.5">RFQs you have been tagged on</p>
          </div>
          <button onClick={() => navigate("/supplier")}
            className="flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
            View all <ChevronRight size={14} />
          </button>
        </motion.div>

        {loading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : quotations.length === 0 ? (
          <motion.div className="text-center py-12 rounded-2xl border border-dashed border-border" {...fade(0.1)}>
            <Package size={28} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No quotations yet. You'll be notified when an RFQ arrives.</p>
          </motion.div>
        ) : (
          <motion.div className="rounded-2xl border border-border overflow-hidden shadow-sm bg-card" {...fade(0.1)}>
            {/* Tabs */}
            <div className="flex border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
              <div className="px-5 py-2.5 border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400">
                Pending ({pending.length})
              </div>
              <div className="px-5 py-2.5">Submitted ({submitted.length})</div>
            </div>

            {/* Header */}
            <div className="grid grid-cols-[2fr_2fr_1.2fr_1fr_1fr] gap-4 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
              <span>RFQ No.</span>
              <span className="hidden sm:block">Description / Project</span>
              <span>Company</span>
              <span>Due Date</span>
              <span>Status</span>
            </div>

            {quotations.slice(0, 8).map((q, i) => (
              <motion.div key={q.QuotationId}
                className="grid grid-cols-[2fr_2fr_1.2fr_1fr_1fr] gap-4 px-5 py-3.5 items-center hover:bg-emerald-500/5 transition-colors cursor-pointer border-b border-border/60 last:border-0"
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
                onClick={() => navigate(`/supplier/quotation/${q.QuotationId}`)}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${q.MySubmissionStatus === "Submitted" ? "bg-emerald-400" : isOverdue(q.DueDate) ? "bg-red-400" : "bg-amber-400"}`} />
                  <span className="text-xs font-mono font-semibold text-foreground truncate">{q.DocNo}</span>
                </div>
                <div className="hidden sm:block min-w-0">
                  <p className="text-xs text-foreground font-medium truncate">{q.ProjectName ?? q.Remarks ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{q.ItemCount} item{q.ItemCount !== 1 ? "s" : ""}</p>
                </div>
                <span className="text-xs text-muted-foreground truncate">{q.CompanyName ?? "—"}</span>
                <span className={`text-xs ${isOverdue(q.DueDate) ? "text-red-500 font-semibold" : isDueSoon(q.DueDate) ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
                  {fmtDate(q.DueDate)}
                </span>
                <StatusBadge status={q.MySubmissionStatus} due={q.DueDate} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </section>
  );
}

// ── Price catalog section (inline editable) ───────────────────────────────────
function PriceCatalogSection({ catalog, loading }: {
  catalog: spApi.SupplierCatalogItem[]; loading: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  // Lock the initial display order (unpriced first) so saving a rate doesn't
  // cause the row to jump to the bottom on re-render.
  const initialOrderRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (catalog.length && !initialOrderRef.current) {
      initialOrderRef.current = [...catalog]
        .sort((a, b) => (a.Rate === null ? -1 : b.Rate === null ? 1 : 0))
        .map((c) => c.ItemId);
    }
  }, [catalog]);

  const mutation = useMutation({
    mutationFn: spApi.updateSupplierCatalog,
    onSuccess: () => {
      toast.success("Rate saved");
      qc.invalidateQueries({ queryKey: ["supplier-catalog"] });
      setEditingId(null);
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to save"),
  });

  const priced = catalog.filter((c) => c.Rate !== null).length;
  const pct = catalog.length ? Math.round((priced / catalog.length) * 100) : 0;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const items = catalog.filter((c) => !q || c.ItemName.toLowerCase().includes(q));
    if (initialOrderRef.current) {
      const orderMap = new Map(initialOrderRef.current.map((id, i) => [id, i]));
      return [...items].sort((a, b) => (orderMap.get(a.ItemId) ?? 999) - (orderMap.get(b.ItemId) ?? 999));
    }
    return items;
  }, [catalog, search]);

  const saveRate = (item: spApi.SupplierCatalogItem) => {
    const raw = edits[item.ItemId];
    const rate = parseFloat(raw ?? "");
    if (isNaN(rate) || rate < 0) { toast.error("Enter a valid rate"); return; }
    mutation.mutate([{ ItemId: item.ItemId, ItemName: item.ItemName, UOMCode: item.UOMCode ?? "", Rate: rate }]);
  };

  return (
    <section className="px-6 sm:px-10 py-8 font-body bg-background border-t border-border">
      <div className="max-w-6xl mx-auto">
        <motion.div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5" {...fade(0)}>
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">Price Catalog</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Set your rates for each item — shown to procurement during L1 comparison</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Coverage */}
            <div className="flex items-center gap-2">
              <div className="w-28 h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div className="h-full rounded-full bg-emerald-500"
                  initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: 0.2 }} />
              </div>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{pct}% covered</span>
            </div>
            <button onClick={() => navigate("/supplier/catalog")}
              className="flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
              Full view <ChevronRight size={14} />
            </button>
          </div>
        </motion.div>

        {/* Search */}
        <motion.div className="relative mb-4" {...fade(0.06)}>
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full sm:w-72 pl-8 pr-3 py-2 text-xs rounded-xl border border-border bg-muted/40 text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:bg-background transition-all" />
        </motion.div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : (
          <motion.div className="rounded-2xl border border-border overflow-hidden shadow-sm bg-card" {...fade(0.1)}>
            {/* Header */}
            <div className="grid grid-cols-[3fr_1fr_2fr_1.2fr] gap-4 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
              <span>Item Name</span>
              <span>UOM</span>
              <span>Your Rate (₹)</span>
              <span>Last Updated</span>
            </div>

            <div className="max-h-[340px] overflow-y-auto">
              {filtered.slice(0, 30).map((item, i) => {
                const isEditing = editingId === item.ItemId;
                const hasRate = item.Rate !== null;
                return (
                  <div key={item.ItemId}
                    className={`grid grid-cols-[3fr_1fr_2fr_1.2fr] gap-4 px-4 py-2.5 items-center border-b border-border/60 last:border-0 transition-colors ${isEditing ? "bg-emerald-500/5" : "hover:bg-muted/30"}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      {!hasRate && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                      <span className="text-xs text-foreground truncate font-medium">{item.ItemName}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{item.UOMCode ?? "—"}</span>
                    <div className="flex items-center gap-1.5">
                      {isEditing ? (
                        <>
                          <div className="relative flex items-center">
                            <span className="absolute left-2.5 text-xs text-muted-foreground">₹</span>
                            <input
                              autoFocus
                              type="number"
                              min="0"
                              step="0.01"
                              value={edits[item.ItemId] ?? ""}
                              onChange={(e) => setEdits((p) => ({ ...p, [item.ItemId]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveRate(item); if (e.key === "Escape") setEditingId(null); }}
                              className="w-28 pl-6 pr-2 py-1 text-xs border border-emerald-500/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-background text-foreground"
                              placeholder="0.00"
                            />
                          </div>
                          <button onClick={() => saveRate(item)} disabled={mutation.isPending}
                            className="p-1 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                            <Save size={11} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
                            <X size={11} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { setEditingId(item.ItemId); setEdits((p) => ({ ...p, [item.ItemId]: item.Rate !== null ? String(item.Rate) : "" })); }}
                          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors ${hasRate ? "text-foreground hover:bg-muted" : "text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/15 font-semibold"}`}>
                          {hasRate ? (
                            <><IndianRupee size={10} className="text-muted-foreground" />{Number(item.Rate).toLocaleString("en-IN", { minimumFractionDigits: 2 })}<Edit3 size={10} className="text-muted-foreground/50 ml-1" /></>
                          ) : (
                            <><Edit3 size={10} />Set rate</>
                          )}
                        </button>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {item.UpdatedAt ? fmtDate(item.UpdatedAt) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            {filtered.length > 30 && (
              <div className="px-4 py-2.5 text-center border-t border-border/60">
                <button onClick={() => navigate("/supplier/catalog")}
                  className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
                  View all {catalog.length} items in full catalog →
                </button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </section>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────
function QuickActions() {
  const navigate = useNavigate();

  const actions: {
    icon: React.ElementType; label: string; desc: string;
    col: string; bg: string; badge?: string;
    onClick: () => void;
  }[] = [
    {
      icon: FileText, label: "My Quotations", desc: "View & respond to RFQs",
      col: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10",
      onClick: () => {
        const el = document.getElementById("quotations-section");
        el ? el.scrollIntoView({ behavior: "smooth", block: "start" }) : navigate("/supplier");
      },
    },
    {
      icon: IndianRupee, label: "Price Catalog", desc: "Update your rates",
      col: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10",
      onClick: () => navigate("/supplier/catalog"),
    },
    {
      icon: Building2, label: "Company Profile", desc: "Contact & address details",
      col: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10",
      onClick: () => navigate("/supplier/profile"),
    },
    {
      icon: Bell, label: "Notifications", desc: "Alerts & reminders",
      col: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10",
      onClick: () => navigate("/supplier/notifications"),
    },
  ];

  return (
    <section className="px-6 sm:px-10 py-8 font-body border-t border-border">
      <div className="max-w-6xl mx-auto">
        <motion.h2 className="font-heading text-lg font-bold text-foreground mb-4" {...fade(0)}>Quick Actions</motion.h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {actions.map((a, i) => (
            <motion.button key={a.label} onClick={a.onClick}
              className="relative flex flex-col items-start p-4 rounded-2xl border border-border bg-card hover:shadow-md hover:-translate-y-0.5 transition-all text-left"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.06, duration: 0.4 }}>
              {a.badge && (
                <span className="absolute top-3 right-3 text-[9px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {a.badge}
                </span>
              )}
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${a.bg}`}>
                <a.icon size={16} className={a.col} />
              </div>
              <p className="text-sm font-heading font-semibold text-foreground">{a.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{a.desc}</p>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SupplierLanding() {
  const { data: profile } = useQuery({
    queryKey: ["supplier-profile"],
    queryFn: spApi.getSupplierProfile,
    staleTime: 5 * 60_000,
  });

  const { data: quotations = [], isLoading: loadingQ } = useQuery({
    queryKey: ["supplier-quotations"],
    queryFn: spApi.getSupplierQuotations,
    refetchInterval: 60_000,
  });

  const { data: catalog = [], isLoading: loadingC } = useQuery({
    queryKey: ["supplier-catalog"],
    queryFn: spApi.getSupplierCatalog,
    staleTime: 2 * 60_000,
  });

  const pending = quotations.filter((q) => q.MySubmissionStatus === "Pending").length;
  const submitted = quotations.filter((q) => q.MySubmissionStatus === "Submitted").length;

  return (
    <div className="min-h-screen font-body bg-background">
      <WelcomeHero
        name={profile?.Name ?? "Supplier"}
        total={quotations.length}
        pending={pending}
        submitted={submitted}
        loading={loadingQ}
      />
      <div className="bg-background">
        <QuotationsSection quotations={quotations} loading={loadingQ} />
        <PriceCatalogSection catalog={catalog} loading={loadingC} />
        <QuickActions />
      </div>
    </div>
  );
}
