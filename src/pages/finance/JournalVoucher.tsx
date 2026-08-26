import React from "react";
import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { preventEnterSubmit, wasPageReloaded } from "@/hooks/useDraftForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus, Trash2, Scale, Loader2, RefreshCw,
  CheckCircle2, Clock, FileText, AlertCircle, Search, X, Check,
} from "lucide-react";
import {
  getJournalVouchers,
  getJournalVoucher,
  createJournalVoucher,
  approveJournalVoucher,
  rejectJournalVoucher,
  getJournalVoucherLedgerOptions,
  type JournalVoucherSummary,
  type JournalVoucherLine,
  type JournalVoucherLedgerOption,
  type JournalVoucherDetail,
} from "@/api/journalVoucherApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";

// Matches the real LHeadType convention used everywhere else account heads
// are created (see CustomerMaster/ContractorMaster/SupplierMaster/
// CrmBrokerMaster's own CUSTOMER_TYPE/CONTRACTOR_TYPE/SUPPLIER_TYPE
// constants) — this map previously had "C" labeled "Customer", which is
// actually Contractor; Customer is "A". Left the group header showing the
// wrong name for every Contractor head in the picker.
const LHEAD_TYPE_LABEL: Record<string, string> = {
  GL: "General Ledger",
  A: "Customer",
  C: "Contractor",
  S: "Supplier",
  BR: "Broker",
  B: "Bank",
};

type JournalVoucherLineUI = JournalVoucherLine & { _id: string };
const emptyLine = (): JournalVoucherLineUI => ({
  _id: (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)),
  LHeadId: null,
  DebitAmount: 0,
  CreditAmount: 0,
  Narration: "",
});

const STATUS_CFG: Record<string, { cls: string; dot: string; icon: React.ElementType }> = {
  Draft:    { cls: "bg-slate-500/10 text-slate-500 border-slate-400/20",   dot: "bg-slate-400",   icon: FileText },
  Pending:  { cls: "bg-amber-500/10 text-amber-600 border-amber-400/20",   dot: "bg-amber-400",   icon: Clock },
  Approved: { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20", dot: "bg-emerald-500", icon: CheckCircle2 },
  Rejected: { cls: "bg-rose-500/10 text-rose-600 border-rose-400/20",     dot: "bg-rose-500",    icon: AlertCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.Draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border", cfg.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {status}
    </span>
  );
}

function GLBadge({ status, postedToGL }: { status: string; postedToGL?: boolean }) {
  if (status !== "Approved") {
    return <span className="text-muted-foreground text-xs">--</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
        postedToGL
          ? "bg-emerald-500/10 text-emerald-600 border-emerald-400/20"
          : "bg-rose-500/10 text-rose-600 border-rose-400/20",
      )}
    >
      {postedToGL ? "Posted" : "Not posted"}
    </span>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function JournalVoucher() {
  const rights = usePageRights("journal-voucher");
  const [vouchers, setVouchers] = useState<JournalVoucherSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ledgerOptions, setLedgerOptions] = useState<JournalVoucherLedgerOption[]>([]);
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jvDate, setJvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<JournalVoucherLineUI[]>([emptyLine(), emptyLine()]);

  // A JV must belong to a real Company (and optionally a Project within it)
  // just like every other document in the system — otherwise it floats
  // free of the entity structure everything else is scoped by.
  const [companies, setCompanies] = useState<{ id: number; label: string }[]>([]);
  const [allProjects, setAllProjects] = useState<{ id: number; label: string; company_id: number | null }[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");

  const [acting, setActing] = useState<{ id: number; action: "approve" | "reject" } | null>(null);

  // Detail view — clicking a row, or a deep link from elsewhere (Trial
  // Balance's ledger drill-down navigates here as /journal-voucher?view=<JVID>)
  // opens this exact voucher's real detail, not just the plain list.
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewingJV, setViewingJV] = useState<JournalVoucherDetail | null>(null);
  const [viewingJVLoading, setViewingJVLoading] = useState(false);

  const openJVDetail = async (id: number) => {
    setViewingJVLoading(true);
    try {
      setViewingJV(await getJournalVoucher(id));
    } catch (err: any) {
      toast.error(err?.message || `Journal Voucher #${id} not found`);
    } finally {
      setViewingJVLoading(false);
    }
  };

  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    openJVDetail(Number(viewId));
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getJournalVouchers();
      setVouchers(data);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load journal vouchers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    getJournalVoucherLedgerOptions().then(setLedgerOptions).catch(() => setLedgerOptions([]));
    getEnterpriseOptions(undefined, "C")
      .then((rows) => setCompanies(rows.map((r) => ({ id: r.id, label: r.label }))))
      .catch(() => setCompanies([]));
    getEnterpriseOptions(undefined, "P")
      .then((rows) => setAllProjects(rows.map((r) => ({ id: r.id, label: r.label, company_id: r.company_id }))))
      .catch(() => setAllProjects([]));
  }, []);

  const projectsForCompany = useMemo(
    () => (companyId ? allProjects.filter((p) => String(p.company_id) === companyId) : []),
    [allProjects, companyId],
  );

  const groupedLedgerOptions = useMemo(() => {
    const groups: Record<string, JournalVoucherLedgerOption[]> = {};
    ledgerOptions.forEach((opt) => {
      const key = opt.type || "GL";
      (groups[key] ||= []).push(opt);
    });
    return groups;
  }, [ledgerOptions]);

  const totals = useMemo(() => {
    const debit  = lines.reduce((s, l) => s + (Number(l.DebitAmount)  || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.CreditAmount) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  const updateLine = (idx: number, patch: Partial<JournalVoucherLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const addLine    = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const resetForm = () => {
    setJvDate(new Date().toISOString().slice(0, 10));
    setNarration("");
    setLines([emptyLine(), emptyLine()]);
    setCompanyId("");
    setProjectId("");
  };

  // A refresh used to silently drop an in-progress JV — this form's state
  // is spread across several individual useStates (not one form object,
  // and emptyLine() mints a fresh random _id every call, which rules out
  // a generic "diff against empty" check), so it gets its own hand-rolled
  // persistence rather than the shared useDraftForm hook. Only counts as
  // "dirty" when something was actually typed/picked — jvDate always has
  // today's date and lines' _id always differs, so neither is a useful
  // empty-state signal on its own.
  const draftKey = "draft-form:journal-voucher";
  const [draftHydrated, setDraftHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.jvDate) setJvDate(draft.jvDate);
        if (draft.narration) setNarration(draft.narration);
        if (Array.isArray(draft.lines) && draft.lines.length > 0) setLines(draft.lines);
        if (draft.companyId) setCompanyId(draft.companyId);
        if (draft.projectId) setProjectId(draft.projectId);
        const hasContent =
          !!draft.narration?.trim() ||
          !!draft.companyId ||
          (draft.lines || []).some(
            (l: JournalVoucherLineUI) =>
              l.LHeadId != null || (l.DebitAmount || 0) > 0 || (l.CreditAmount || 0) > 0 || !!l.Narration?.trim(),
          );
        // Only reopen the dialog on an actual browser reload — not a plain
        // in-app navigation, which would otherwise let an old leftover
        // draft hijack the sidebar link into always opening the dialog.
        if (hasContent && wasPageReloaded()) setDialogOpen(true);
      }
    } catch {
      // Corrupt/unparseable draft — proceed with a clean form.
    }
    setDraftHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    const isDirty =
      !!narration.trim() ||
      !!companyId ||
      !!projectId ||
      lines.some(
        (l) => l.LHeadId != null || (l.DebitAmount || 0) > 0 || (l.CreditAmount || 0) > 0 || !!l.Narration?.trim(),
      );
    try {
      if (isDirty) {
        localStorage.setItem(draftKey, JSON.stringify({ jvDate, narration, lines, companyId, projectId }));
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {
      // localStorage unavailable — the draft simply won't persist.
    }
  }, [draftHydrated, jvDate, narration, lines, companyId, projectId]);

  const handleApprove = async (id: number) => {
    setActing({ id, action: "approve" });
    try {
      await approveJournalVoucher(id);
      toast.success("Journal Voucher approved and posted to GL");
      load();
    } catch (err: any) {
      toast.error(err?.message || "Approval failed");
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (id: number) => {
    setActing({ id, action: "reject" });
    try {
      await rejectJournalVoucher(id);
      toast.success("Journal Voucher rejected");
      load();
    } catch (err: any) {
      toast.error(err?.message || "Rejection failed");
    } finally {
      setActing(null);
    }
  };

  const submit = async () => {
    if (!companyId) { toast.error("Select the Company this voucher belongs to."); return; }
    if (!totals.balanced) { toast.error("Debit and Credit totals must match before saving."); return; }
    if (lines.some((l) => !l.LHeadId)) { toast.error("Every line requires an account head."); return; }
    setSaving(true);
    try {
      await createJournalVoucher({
        JVDate: jvDate,
        Narration: narration,
        CompanyId: parseInt(companyId, 10),
        ProjectId: projectId ? parseInt(projectId, 10) : null,
        lines,
      });
      toast.success("Journal Voucher created and submitted for approval");
      setDialogOpen(false);
      resetForm();
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create Journal Voucher");
    } finally {
      setSaving(false);
    }
  };

  // Stats
  const stats = useMemo(() => ({
    total:    vouchers.length,
    approved: vouchers.filter((v) => v.Status === "Approved").length,
    pending:  vouchers.filter((v) => v.Status === "Pending").length,
    draft:    vouchers.filter((v) => v.Status === "Draft").length,
  }), [vouchers]);

  // Filtered list
  const filtered = useMemo(() => {
    if (!search.trim()) return vouchers;
    const q = search.toLowerCase();
    return vouchers.filter(
      (v) =>
        (v.JVNo || "").toLowerCase().includes(q) ||
        (v.Narration || "").toLowerCase().includes(q) ||
        (v.Status || "").toLowerCase().includes(q),
    );
  }, [vouchers, search]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Journal Voucher"]} />
      <FinanceShell
        title="Journal Voucher"
        subtitle="Correct account-head mismatches with balanced multi-line entries"
        icon={Scale}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            {rights.canCreate && (
              <Button
                onClick={() => setDialogOpen(true)}
                className="gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg gradient-accent transition-all"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">New Journal Voucher</span>
              </Button>
            )}
          </div>
        }
      >

        {/* ── Stat pills ── */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Total",    value: stats.total,    color: "text-foreground",     bg: "bg-muted/30",          icon: FileText },
              { label: "Approved", value: stats.approved, color: "text-emerald-600",    bg: "bg-emerald-500/5",     icon: CheckCircle2 },
              { label: "Pending",  value: stats.pending,  color: "text-amber-600",      bg: "bg-amber-500/5",       icon: Clock },
              { label: "Draft",    value: stats.draft,    color: "text-slate-500",      bg: "bg-slate-500/5",       icon: FileText },
            ].map(({ label, value, color, bg, icon: Icon }) => (
              <div key={label} className={cn("flex items-center gap-3 px-4 py-3 rounded-xl border border-border", bg)}>
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bg)}>
                  <Icon size={14} className={color} />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground leading-none">{value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Search ── */}
        <div className="relative mb-4">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by JV number, narration, or status…"
            className="w-full pl-8 pr-8 py-2 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        {/* ── Table ── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">

          {/* ── Mobile cards (< md) ─────────────────────────────────────────── */}
          <div className="md:hidden divide-y divide-border">
            {loading ? (
              <div className="py-16 text-center">
                <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2">Loading vouchers…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Scale size={36} className="opacity-20" />
                  <p className="text-sm font-medium">
                    {search ? "No vouchers match your search" : "No journal vouchers yet"}
                  </p>
                  {search && (
                    <button onClick={() => setSearch("")} className="text-xs text-primary hover:underline">Clear search</button>
                  )}
                  {!search && rights.canCreate && (
                    <button
                      onClick={() => setDialogOpen(true)}
                      className="flex items-center gap-1.5 mt-1 px-4 py-2 rounded-lg gradient-accent text-white text-xs font-semibold"
                    >
                      <Plus size={12} /> Create First Voucher
                    </button>
                  )}
                </div>
              </div>
            ) : (
              filtered.map((v) => (
                <div key={v.JVID} className="px-4 py-3.5 hover:bg-muted/20 transition-colors">
                  {/* Row 1: JV No + date + amount */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                        {v.JVNo || `JV-${v.JVID}`}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(v.JVDate)}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-foreground tabular-nums shrink-0">
                      {formatINR(v.TotalAmount || 0)}
                    </span>
                  </div>
                  {/* Row 2: company / project */}
                  {v.CompanyName && (
                    <div className="mb-1.5">
                      <p className="text-xs font-medium text-foreground">{v.CompanyName}</p>
                      {v.ProjectName && <p className="text-[11px] text-muted-foreground">{v.ProjectName}</p>}
                    </div>
                  )}
                  {/* Row 3: narration */}
                  {v.Narration && (
                    <p className="text-[11px] text-muted-foreground mb-2 line-clamp-2">{v.Narration}</p>
                  )}
                  {/* Row 4: badges + actions */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={v.Status} />
                      <GLBadge status={v.Status} postedToGL={v.PostedToGL} />
                    </div>
                    {v.Status === "Pending" && rights.canEdit && (
                      <div className="flex gap-1">
                        <button
                          disabled={acting?.id === v.JVID}
                          onClick={() => handleApprove(v.JVID)}
                          title="Approve"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                        >
                          {acting?.id === v.JVID && acting.action === "approve" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        </button>
                        <button
                          disabled={acting?.id === v.JVID}
                          onClick={() => handleReject(v.JVID)}
                          title="Reject"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                        >
                          {acting?.id === v.JVID && acting.action === "reject" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Desktop table (md+) ─────────────────────────────────────────── */}
          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">JV No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">Company / Project</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">Narration</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">GL</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-2">Loading vouchers…</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Scale size={36} className="opacity-20" />
                      <p className="text-sm font-medium">
                        {search ? "No vouchers match your search" : "No journal vouchers yet"}
                      </p>
                      {search && (
                        <button onClick={() => setSearch("")} className="text-xs text-primary hover:underline">
                          Clear search
                        </button>
                      )}
                      {!search && rights.canCreate && (
                        <button
                          onClick={() => setDialogOpen(true)}
                          className="flex items-center gap-1.5 mt-1 px-4 py-2 rounded-lg gradient-accent text-white text-xs font-semibold"
                        >
                          <Plus size={12} /> Create First Voucher
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((v) => (
                  <tr
                    key={v.JVID}
                    onClick={() => openJVDetail(v.JVID)}
                    className="hover:bg-muted/30 transition-colors group cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                        {v.JVNo || `JV-${v.JVID}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(v.JVDate)}</td>
                    <td className="px-4 py-3 text-sm">
                      {v.CompanyName ? (
                        <>
                          <p className="text-foreground truncate max-w-[160px]">{v.CompanyName}</p>
                          {v.ProjectName && (
                            <p className="text-[11px] text-muted-foreground truncate max-w-[160px]">{v.ProjectName}</p>
                          )}
                        </>
                      ) : (
                        <span className="italic text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground max-w-xs">
                      <p className="truncate">{v.Narration || <span className="italic text-muted-foreground/50">—</span>}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums">
                      {formatINR(v.TotalAmount || 0)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={v.Status} />
                    </td>
                    <td className="px-4 py-3">
                      <GLBadge status={v.Status} postedToGL={v.PostedToGL} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {v.Status === "Pending" && rights.canEdit && (
                        <div className="flex justify-end gap-1">
                          <button
                            disabled={acting?.id === v.JVID}
                            onClick={(e) => { e.stopPropagation(); handleApprove(v.JVID); }}
                            title="Approve"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                          >
                            {acting?.id === v.JVID && acting.action === "approve" ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Check size={13} />
                            )}
                          </button>
                          <button
                            disabled={acting?.id === v.JVID}
                            onClick={(e) => { e.stopPropagation(); handleReject(v.JVID); }}
                            title="Reject"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                          >
                            {acting?.id === v.JVID && acting.action === "reject" ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <X size={13} />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {!loading && filtered.length > 0 && search && (
            <div className="px-4 py-2.5 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length} of {vouchers.length} vouchers
              </p>
            </div>
          )}
        </div>
      </FinanceShell>

      {/* ── New JV Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col max-h-[85dvh] overflow-hidden" onKeyDown={preventEnterSubmit}>
          <DialogHeader className="shrink-0 px-4 sm:px-5 py-4 border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
                <Scale size={15} className="text-primary" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold">New Journal Voucher</DialogTitle>
                <DialogDescription className="text-[11px] mt-0.5">
                  Debit total must equal credit total before saving.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-4 sm:px-5 py-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
            {/* Header fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Company *</label>
                <Select
                  value={companyId}
                  onValueChange={(v) => { setCompanyId(v); setProjectId(""); }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select company…" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} className="text-sm">{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Project</label>
                <Select
                  value={projectId}
                  onValueChange={setProjectId}
                  disabled={!companyId}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder={companyId ? "Select project (optional)…" : "Select a company first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {projectsForCompany.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)} className="text-sm">{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Date</label>
                <Input type="date" value={jvDate} onChange={(e) => setJvDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Narration</label>
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Reason for this correction" />
              </div>
            </div>

            {/* Lines — horizontally scrollable on narrow screens rather than
                squeezing the Account Head column unreadably thin. */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead className="bg-muted/40 border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Account Head</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-28 sm:w-32">Debit</th>
                      <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-28 sm:w-32">Credit</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map((line, idx) => (
                      <tr key={line._id} className="group hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <Select
                            value={line.LHeadId ? String(line.LHeadId) : ""}
                            onValueChange={(v) => updateLine(idx, { LHeadId: parseInt(v, 10) })}
                          >
                            <SelectTrigger className="h-8 text-xs border-0 bg-transparent focus:ring-0 focus:ring-offset-0 px-0">
                              <SelectValue placeholder="Select account…" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(groupedLedgerOptions).map(([type, opts]) => (
                                <SelectGroup key={type}>
                                  <SelectLabel className="text-[10px] uppercase tracking-widest">
                                    {LHEAD_TYPE_LABEL[type] || type}
                                  </SelectLabel>
                                  {opts.map((opt) => (
                                    <SelectItem key={opt.id} value={String(opt.id)} className="text-xs">{opt.label}</SelectItem>
                                  ))}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={line.DebitAmount || ""}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value) || 0;
                              updateLine(idx, v !== 0 ? { DebitAmount: v, CreditAmount: 0 } : { DebitAmount: v });
                            }}
                            className="h-8 text-xs text-right border-0 bg-transparent focus-visible:ring-0 px-0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            placeholder="0.00"
                            value={line.CreditAmount || ""}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value) || 0;
                              updateLine(idx, v !== 0 ? { CreditAmount: v, DebitAmount: 0 } : { CreditAmount: v });
                            }}
                            className="h-8 text-xs text-right border-0 bg-transparent focus-visible:ring-0 px-0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            disabled={lines.length <= 2}
                            onClick={() => removeLine(idx)}
                            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border bg-muted/20">
                    <tr>
                      <td className="px-3 py-2">
                        <button onClick={addLine} className="flex items-center gap-1 text-xs text-primary hover:underline">
                          <Plus size={11} /> Add line
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">{formatINR(totals.debit)}</td>
                      <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">{formatINR(totals.credit)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Balance indicator */}
            <div className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-medium",
              totals.balanced
                ? "border-emerald-400/30 bg-emerald-500/5 text-emerald-600"
                : totals.debit > 0 || totals.credit > 0
                ? "border-rose-400/30 bg-rose-500/5 text-rose-600"
                : "border-border bg-muted/20 text-muted-foreground"
            )}>
              {totals.balanced
                ? <CheckCircle2 size={13} className="shrink-0" />
                : totals.debit > 0 || totals.credit > 0
                ? <AlertCircle size={13} className="shrink-0" />
                : <Scale size={13} className="shrink-0" />}
              {totals.balanced
                ? `Balanced — ${formatINR(totals.debit)} each side`
                : totals.debit > 0 || totals.credit > 0
                ? `Difference: ${formatINR(Math.abs(totals.debit - totals.credit))}`
                : "Enter amounts on each line"}
            </div>
          </div>

          <DialogFooter className="shrink-0 px-4 sm:px-5 py-3.5 border-t border-border bg-muted/20">
            <button
              onClick={() => { setDialogOpen(false); resetForm(); }}
              disabled={saving}
              className="w-full sm:w-auto px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || !totals.balanced}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2 rounded-lg gradient-accent text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {saving ? "Saving…" : "Save & Submit"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Voucher detail ── */}
      <Dialog open={viewingJVLoading || !!viewingJV} onOpenChange={(o) => { if (!o) setViewingJV(null); }}>
        <DialogContent className="max-w-lg p-0 gap-0 flex flex-col max-h-[85dvh] overflow-hidden">
          {viewingJVLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading voucher…
            </div>
          ) : viewingJV ? (
            <>
              <DialogHeader className="shrink-0 px-4 sm:px-5 py-4 border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                    {viewingJV.JVNo || `JV-${viewingJV.JVID}`}
                  </span>
                  <StatusBadge status={viewingJV.Status} />
                  <GLBadge status={viewingJV.Status} postedToGL={viewingJV.PostedToGL} />
                </div>
                <DialogTitle className="text-sm font-semibold mt-1.5">Journal Voucher</DialogTitle>
                <DialogDescription className="text-[11px] mt-0.5">
                  {fmtDate(viewingJV.JVDate)}
                  {viewingJV.CompanyName ? ` · ${viewingJV.CompanyName}` : ""}
                  {viewingJV.ProjectName ? ` · ${viewingJV.ProjectName}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
                {viewingJV.Narration && (
                  <p className="text-sm text-foreground">{viewingJV.Narration}</p>
                )}
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-left text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Ledger</th>
                        <th className="px-3 py-2 font-medium text-right">Debit</th>
                        <th className="px-3 py-2 font-medium text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewingJV.lines.map((l) => (
                        <tr key={l.LineID} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-2">
                            <p className="text-foreground">{l.LHeadName || "—"}</p>
                            {l.Narration && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">{l.Narration}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-foreground">
                            {l.DebitAmount ? formatINR(l.DebitAmount) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-foreground">
                            {l.CreditAmount ? formatINR(l.CreditAmount) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-3 py-2 text-foreground">Total</td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">
                          {formatINR(viewingJV.lines.reduce((s, l) => s + (Number(l.DebitAmount) || 0), 0))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">
                          {formatINR(viewingJV.lines.reduce((s, l) => s + (Number(l.CreditAmount) || 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <DialogFooter className="shrink-0 px-4 sm:px-5 py-3.5 border-t border-border bg-muted/20">
                <button
                  onClick={() => setViewingJV(null)}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Close
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
