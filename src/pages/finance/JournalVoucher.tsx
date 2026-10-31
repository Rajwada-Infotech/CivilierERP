import { useLiveData } from "@/hooks/useLiveData";
import React from "react";
import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
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
  CheckCircle2, Clock, FileText, AlertCircle, Search, X, BookOpen, Pencil,
} from "lucide-react";
import {
  getJournalVouchers,
  getJournalVoucher,
  createJournalVoucher,
  updateJournalVoucher,
  deleteJournalVoucher,
  getJournalVoucherLedgerOptions,
  type JournalVoucherSummary,
  type JournalVoucherLine,
  type JournalVoucherLedgerOption,
  type JournalVoucherDetail,
} from "@/api/journalVoucherApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { LedgerHeadPicker } from "./journalVoucher/LedgerHeadPicker";
import { partnerLineKind } from "./journalVoucher/ledgerGroups";
import { SettlementModeSection } from "./journalVoucher/SettlementModeSection";
import {
  emptySettlement,
  hasSettlement,
  settlementError,
  settlementFromVoucher,
  settlementPayload,
  type SettlementValue,
} from "./journalVoucher/settlement";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { DateInput } from "@/components/ui/date-input";

type JournalVoucherLineUI = JournalVoucherLine & { _id: string };
const emptyLine = (): JournalVoucherLineUI => ({
  _id: (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)),
  LHeadId: null,
  DebitAmount: 0,
  CreditAmount: 0,
  Narration: "",
});

function StatusBadge({ status }: { status: string }) {
  return <SheetMark text={status || "—"} tone={statusTone(status || "")} />;
}

function GLBadge({ status, postedToGL }: { status: string; postedToGL?: boolean }) {
  return <SheetMark text={postedToGL ? "Posted" : "Not posted"} tone={status !== "Approved" ? "none" : postedToGL ? "done" : "stopped"} />;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// What saving an edit does to the voucher, by its current status.
const editTitle = (status: string) =>
  status === "Approved"
    ? "Edit (reverses its posting and reopens for approval)"
    : status === "Pending"
      ? "Edit (stays pending; approval restarts)"
      : "Edit";

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
  // Payment mode (Cash / Cheque / PDC / NEFT / …) and its bank / cheque-lot detail.
  const [settlement, setSettlement] = useState<SettlementValue>(emptySettlement());
  const [banks, setBanks] = useState<BankRecord[]>([]);

  // Edit — reuses the same dialog as New; editingId set means submit() calls
  // updateJournalVoucher instead of createJournalVoucher. Loading a voucher
  // for edit fetches its full detail (list rows don't carry LHeadId per
  // line) rather than trusting whatever's already in the summary row.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Delete — small confirm dialog, same pattern as VehicleInOut.tsx's own
  // delete confirmation.
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // A JV must belong to a real Company (and optionally a Project within it)
  // just like every other document in the system — otherwise it floats
  // free of the entity structure everything else is scoped by.
  const [companies, setCompanies] = useState<{ id: number; label: string }[]>([]);
  const [allProjects, setAllProjects] = useState<{ id: number; label: string; company_id: number | null; tagged_company_ids?: string | null }[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");

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
    // Always clear the param first so it can't reopen on a back/refresh.
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
    // Number("0") === 0 — a non-positive id is invalid; skip the API call
    // rather than sending a request for JV id=0 which will 400/404.
    const id = Number(viewId);
    if (id > 0) openJVDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("view")]);

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

  // A ledger or vendor added anywhere shows up in the line pickers straight away. On a failed live reload the list on
  // screen is kept (the first load below still clears it on failure, as before).
  useLiveData("ledgers", () => {
    getJournalVoucherLedgerOptions().then(setLedgerOptions).catch(() => {});
  });

  useEffect(() => {
    load();
    getJournalVoucherLedgerOptions().then(setLedgerOptions).catch(() => setLedgerOptions([]));
    getBanks().then(setBanks).catch(() => setBanks([]));
    getEnterpriseOptions(undefined, "C")
      .then((rows) => setCompanies(rows.map((r) => ({ id: r.id, label: r.label }))))
      .catch(() => setCompanies([]));
    getEnterpriseOptions(undefined, "P")
      .then((rows) =>
        setAllProjects(
          rows.map((r) => ({ id: r.id, label: r.label, company_id: r.company_id, tagged_company_ids: r.tagged_company_ids })),
        ),
      )
      .catch(() => setAllProjects([]));
  }, []);

  // A project shows up for a company if it's either the project's primary
  // (owning) company, or the company has been tagged onto the project via
  // Project Master's multi-company tagging — see dbo.ProjectCompanies.
  const projectsForCompany = useMemo(
    () =>
      companyId
        ? allProjects.filter(
            (p) =>
              String(p.company_id) === companyId ||
              (p.tagged_company_ids?.split(",") ?? []).includes(companyId),
          )
        : [],
    [allProjects, companyId],
  );

  // Banks are tagged to a company by name (BankRecord.BCompanyName), same as Fund Transfer.
  const banksForCompany = useMemo(() => {
    const label = companies.find((c) => String(c.id) === companyId)?.label;
    return label ? banks.filter((b) => b.BCompanyName === label) : [];
  }, [banks, companies, companyId]);

  // Changing the company invalidates a bank that belongs to the old one.
  useEffect(() => {
    if (settlement.bankId && !banksForCompany.some((b) => String(b.BId) === settlement.bankId)) {
      setSettlement((prev) => (prev.bankId ? { ...prev, bankId: "", chequeLotId: null, chequeNo: "" } : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banksForCompany]);

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
    setSettlement(emptySettlement());
    setEditingId(null);
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
        if (draft.settlement?.mode) setSettlement({ ...emptySettlement(), ...draft.settlement });
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
      hasSettlement(settlement) ||
      lines.some(
        (l) => l.LHeadId != null || (l.DebitAmount || 0) > 0 || (l.CreditAmount || 0) > 0 || !!l.Narration?.trim(),
      );
    try {
      if (isDirty) {
        localStorage.setItem(draftKey, JSON.stringify({ jvDate, narration, lines, companyId, projectId, settlement }));
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {
      // localStorage unavailable — the draft simply won't persist.
    }
  }, [draftHydrated, jvDate, narration, lines, companyId, projectId, settlement]);

  const startEdit = async (v: JournalVoucherSummary) => {
    setEditLoading(true);
    try {
      const full = await getJournalVoucher(v.JVID);
      setJvDate((full.JVDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10));
      setNarration(full.Narration || "");
      setCompanyId(full.CompanyId ? String(full.CompanyId) : "");
      setProjectId(full.ProjectId ? String(full.ProjectId) : "");
      setSettlement(settlementFromVoucher(full));
      setLines(
        (full.lines || []).map((l) => ({
          _id: (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
          LineID: l.LineID,
          LHeadId: l.LHeadId,
          DebitAmount: l.DebitAmount,
          CreditAmount: l.CreditAmount,
          Narration: l.Narration || "",
        })),
      );
      setEditingId(v.JVID);
      setDialogOpen(true);
    } catch (err: any) {
      toast.error(err?.message || `Failed to load Journal Voucher #${v.JVID}`);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(true);
    try {
      await deleteJournalVoucher(id);
      toast.success("Journal Voucher deleted");
      setDeleteId(null);
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete Journal Voucher");
    } finally {
      setDeleting(false);
    }
  };

  const submit = async () => {
    if (!companyId) { toast.error("Select the Company this voucher belongs to."); return; }
    if (!totals.balanced) { toast.error("Debit and Credit totals must match before saving."); return; }
    if (lines.some((l) => !l.LHeadId)) { toast.error("Every line requires an account head."); return; }
    const modeProblem = settlementError(settlement);
    if (modeProblem) { toast.error(modeProblem); return; }
    setSaving(true);
    try {
      const payload = {
        JVDate: jvDate,
        Narration: narration,
        CompanyId: parseInt(companyId, 10),
        ProjectId: projectId ? parseInt(projectId, 10) : null,
        lines,
        ...settlementPayload(settlement),
      };
      if (editingId) {
        const result: any = await updateJournalVoucher(editingId, payload);
        toast.success(
          result?.message ||
            (result?.reopenedForApproval
              ? "Journal Voucher updated — previous GL posting reversed, sent back for approval"
              : "Journal Voucher updated"),
        );
      } else {
        await createJournalVoucher(payload);
        toast.success("Journal Voucher created and submitted for approval");
      }
      setDialogOpen(false);
      resetForm();
      load();
    } catch (err: any) {
      toast.error(err?.message || `Failed to ${editingId ? "update" : "create"} Journal Voucher`);
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

  const exportColumns: ExportColumn[] = useMemo(() => [
    { header: "JV No", accessor: (r) => (r as unknown as JournalVoucherSummary).JVNo || `JV-${(r as unknown as JournalVoucherSummary).JVID}` },
    { header: "Date", accessor: (r) => fmtDate((r as unknown as JournalVoucherSummary).JVDate) },
    { header: "Company", accessor: (r) => (r as unknown as JournalVoucherSummary).CompanyName || "" },
    { header: "Project", accessor: (r) => (r as unknown as JournalVoucherSummary).ProjectName || "" },
    { header: "Narration", accessor: (r) => (r as unknown as JournalVoucherSummary).Narration || "" },
    { header: "Amount", accessor: (r) => (r as unknown as JournalVoucherSummary).TotalAmount || 0 },
    { header: "Status", accessor: (r) => (r as unknown as JournalVoucherSummary).Status || "" },
    { header: "GL", accessor: (r) => {
        const v = r as unknown as JournalVoucherSummary;
        return v.Status !== "Approved" ? "--" : v.PostedToGL ? "Posted" : "Not posted";
      } },
  ], []);

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
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Journal vouchers"
        subtitle="Correct account-head mismatches with balanced multi-line entries"
        action={
          <div className="flex items-center gap-2">
            {rights.canCreate && (
              <Button
                onClick={() => setDialogOpen(true)}
                className="gap-1.5 shrink-0 bg-foreground text-card hover:bg-foreground/85 font-heading font-semibold uppercase tracking-[0.1em] text-[0.625rem] px-3 sm:px-4 py-2 h-auto"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">New voucher</span>
              </Button>
            )}
            <ExportMenu
              data={filtered as unknown as Record<string, unknown>[]}
              columns={exportColumns}
              title="Journal Voucher"
              filename="journal-voucher"
              disabled={loading}
            />
            <button
              onClick={load}
              disabled={loading}
              title="Refresh"
              className="w-8 h-8 flex items-center justify-center border border-foreground text-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        }
      >

        {/* ── Counts ── */}
        {!loading && (
          <div className="statrow four">
            {[
              { label: "Vouchers", value: stats.total, note: "in all" },
              { label: "Approved", value: stats.approved, note: "settled" },
              { label: "Pending", value: stats.pending, note: "awaiting approval" },
              { label: "Draft", value: stats.draft, note: "not yet submitted" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(22px, 2.4vw, 32px)", marginTop: 9 }}>{Number(x.value || 0).toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Search ── */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by JV number, narration, or status…"
            className="w-full pl-8 pr-8 py-2.5 border border-foreground/40 bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        {/* ── Table ── */}
        <div className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>

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
                      className="flex items-center gap-1.5 mt-1 px-4 py-2 bg-foreground text-card font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]"
                    >
                      <Plus size={12} /> Create First Voucher
                    </button>
                  )}
                </div>
              </div>
            ) : (
              filtered.map((v) => (
                <div key={v.JVID} className="px-4 py-3.5 hover:bg-primary/[0.06] transition-colors">
                  {/* Row 1: JV No + date + amount */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">{v.JVNo || `JV-${v.JVID}`}</span>
                      <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{fmtDate(v.JVDate)}</span>
                    </div>
                    <span className="font-heading tabular-nums text-sm font-semibold text-foreground tabular-nums shrink-0">
                      {formatINR(v.TotalAmount || 0, { decimals: 2 })}
                    </span>
                  </div>
                  {/* Row 2: company / project */}
                  {v.CompanyName && (
                    <div className="mb-1.5">
                      <p className="text-xs font-medium text-foreground">{v.CompanyName}</p>
                      {v.ProjectName && <p className="text-[0.6875rem] text-muted-foreground">{v.ProjectName}</p>}
                    </div>
                  )}
                  {/* Row 3: narration */}
                  {v.Narration && (
                    <p className="text-[0.6875rem] text-muted-foreground mb-2 line-clamp-2">{v.Narration}</p>
                  )}
                  {/* Row 4: badges + actions */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={v.Status} />
                      <GLBadge status={v.Status} postedToGL={v.PostedToGL} />
                    </div>
                    <div className="flex gap-1">
                      {rights.canEdit && (
                        <button
                          disabled={editLoading}
                          onClick={() => startEdit(v)}
                          title={editTitle(v.Status)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {rights.canDelete && (
                        <button
                          onClick={() => setDeleteId(v.JVID)}
                          title="Delete"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Desktop table (md+) ─────────────────────────────────────────── */}
          <table className="w-full text-sm hidden md:table" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
                {[
                  { h: "No.", right: false },
                  { h: "Voucher", right: false },
                  { h: "Date", right: false },
                  { h: "Company / project", right: false },
                  { h: "Narration", right: false },
                  { h: "Amount", right: true },
                  { h: "Status", right: false },
                  { h: "Ledger", right: false },
                  { h: "", right: true },
                ].map((c, i) => (
                  <th key={i} className={`px-3 py-3 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground ${c.right ? "text-right" : "text-left"}`}>
                    {c.h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-2">Loading vouchers…</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Scale size={36} className="opacity-20" />
                      <p className="text-sm font-medium">{search ? "No vouchers match your search" : "No journal vouchers yet"}</p>
                      {search && (
                        <button onClick={() => setSearch("")} className="text-xs text-foreground underline">Clear search</button>
                      )}
                      {!search && rights.canCreate && (
                        <button
                          onClick={() => setDialogOpen(true)}
                          className="flex items-center gap-1.5 mt-1 px-4 py-2 bg-foreground text-card font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]"
                        >
                          <Plus size={12} /> Create first voucher
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((v, i) => (
                  <tr
                    key={v.JVID}
                    onClick={() => openJVDetail(v.JVID)}
                    className="hover:bg-primary/[0.06] transition-colors cursor-pointer align-top"
                    style={{ borderBottom: "1px solid hsl(var(--border) / 0.6)" }}
                  >
                    <td className="px-3 py-3 font-heading text-[0.625rem] font-semibold tabular-nums text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-3 py-3 font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground whitespace-nowrap">{v.JVNo || `JV-${v.JVID}`}</td>
                    <td className="px-3 py-3 text-[0.75rem] text-foreground tabular-nums whitespace-nowrap">{fmtDate(v.JVDate)}</td>
                    <td className="px-3 py-3">
                      {v.CompanyName ? (
                        <>
                          <p className="text-[0.8125rem] font-semibold text-foreground truncate max-w-[180px]">{v.CompanyName}</p>
                          {v.ProjectName && <p className="text-[0.6875rem] text-muted-foreground mt-1 truncate max-w-[180px]">{v.ProjectName}</p>}
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[0.8125rem] text-foreground/85 max-w-xs">
                      <p className="line-clamp-2">{v.Narration || <span className="text-muted-foreground">—</span>}</p>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap font-heading text-[0.8125rem] font-semibold tabular-nums text-foreground">{formatINR(v.TotalAmount || 0, { decimals: 2 })}</td>
                    <td className="px-3 py-3"><SheetMark text={v.Status || "—"} tone={statusTone(v.Status || "")} /></td>
                    <td className="px-3 py-3">
                      <SheetMark
                        text={v.PostedToGL ? "Posted" : "Not posted"}
                        tone={v.Status !== "Approved" ? "none" : v.PostedToGL ? "done" : "stopped"}
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {rights.canEdit && (
                          <button
                            disabled={editLoading}
                            onClick={(e) => { e.stopPropagation(); startEdit(v); }}
                            title={editTitle(v.Status)}
                            className="p-1.5 border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-40"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        {rights.canDelete && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteId(v.JVID); }}
                            title="Delete"
                            className="p-1.5 border border-destructive/30 text-destructive/70 hover:text-destructive hover:border-destructive transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {!loading && filtered.length > 0 && search && (
            <div className="px-3 py-2.5" style={{ borderTop: "1px solid hsl(var(--foreground))" }}>
              <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Showing {filtered.length} of {vouchers.length} vouchers
              </p>
            </div>
          )}
        </div>
      </SheetShell>

      {/* ── New JV Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="sheet-frame max-w-2xl p-0 gap-0 flex flex-col max-h-[85dvh] overflow-hidden" style={{ margin: 0 }} onKeyDown={preventEnterSubmit}>
          <DialogHeader className="shrink-0 px-4 sm:px-5 py-4 border-b border-foreground">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 ring-1 ring-primary/20">
                <Scale size={15} className="text-primary" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="font-heading text-base font-bold tracking-tight">
                  {editingId ? "Edit Journal Voucher" : "New Journal Voucher"}
                </DialogTitle>
                <DialogDescription className="text-[0.6875rem] mt-0.5">
                  {editingId
                    ? "Every field can be changed. An approved voucher has its GL posting reversed and goes back for approval; a pending one stays pending and its approval restarts."
                    : "Debit total must equal credit total before saving."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-4 sm:px-5 py-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
            {/* Header fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Company *</label>
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
                <label className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Project</label>
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
                <label className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Date</label>
                <DateInput value={jvDate} onChange={(e) => setJvDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Narration</label>
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Reason for this Journal Voucher" />
              </div>
            </div>

            {/* Lines — horizontally scrollable on narrow screens rather than
                squeezing the Account Head column unreadably thin. */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
                    <tr>
                      <th className="px-3 py-2 text-left text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">Account Head</th>
                      <th className="px-3 py-2 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground w-28 sm:w-32">Debit</th>
                      <th className="px-3 py-2 text-right text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground w-28 sm:w-32">Credit</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map((line, idx) => (
                      <tr key={line._id} className="group hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <LedgerHeadPicker
                            value={line.LHeadId}
                            options={ledgerOptions}
                            onChange={(id) => updateLine(idx, { LHeadId: id })}
                          />
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
                  <tfoot className="border-t border-foreground">
                    <tr>
                      <td className="px-3 py-2">
                        <button onClick={addLine} className="flex items-center gap-1 text-xs text-primary hover:underline">
                          <Plus size={11} /> Add line
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">{formatINR(totals.debit, { decimals: 2 })}</td>
                      <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">{formatINR(totals.credit, { decimals: 2 })}</td>
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
                ? "border-foreground/40 bg-primary/10 text-foreground"
                : totals.debit > 0 || totals.credit > 0
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-muted/20 text-muted-foreground"
            )}>
              {totals.balanced
                ? <CheckCircle2 size={13} className="shrink-0" />
                : totals.debit > 0 || totals.credit > 0
                ? <AlertCircle size={13} className="shrink-0" />
                : <Scale size={13} className="shrink-0" />}
              {totals.balanced
                ? `Balanced — ${formatINR(totals.debit, { decimals: 2 })} each side`
                : totals.debit > 0 || totals.credit > 0
                ? `Difference: ${formatINR(Math.abs(totals.debit - totals.credit), { decimals: 2 })}`
                : "Enter amounts on each line"}
            </div>

            <SettlementModeSection
              value={settlement}
              onChange={setSettlement}
              banks={banksForCompany}
              companySelected={!!companyId}
            />
          </div>

          <DialogFooter className="shrink-0 px-4 sm:px-5 py-3.5 border-t border-foreground">
            <button
              onClick={() => { setDialogOpen(false); resetForm(); }}
              disabled={saving}
              className="w-full sm:w-auto px-4 py-2.5 border border-foreground/40 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || !totals.balanced}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-foreground text-card font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] hover:bg-foreground/85 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {saving ? "Saving…" : editingId ? "Save Changes" : "Save & Submit"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Voucher detail ── */}
      <Dialog open={viewingJVLoading || !!viewingJV} onOpenChange={(o) => { if (!o) setViewingJV(null); }}>
        <DialogContent className="sheet-frame max-w-lg p-0 gap-0 flex flex-col max-h-[85dvh] overflow-hidden" style={{ margin: 0 }}>
          {viewingJVLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading voucher…
            </div>
          ) : viewingJV ? (
            <>
              <DialogHeader className="shrink-0 px-4 sm:px-5 py-4 border-b border-foreground">
                <div className="flex items-center gap-2">
                  <span className="font-heading tabular-nums text-xs bg-muted px-2 py-1 rounded text-foreground">
                    {viewingJV.JVNo || `JV-${viewingJV.JVID}`}
                  </span>
                  <StatusBadge status={viewingJV.Status} />
                </div>
                <DialogTitle className="text-sm font-semibold mt-1.5">Journal Voucher</DialogTitle>
                <DialogDescription className="text-[0.6875rem] mt-0.5">
                  {fmtDate(viewingJV.JVDate)}
                  {viewingJV.CompanyName ? ` · ${viewingJV.CompanyName}` : ""}
                  {viewingJV.ProjectName ? ` · ${viewingJV.ProjectName}` : ""}
                  {viewingJV.CreatedByName || viewingJV.CreatedBy ? ` · Created by ${viewingJV.CreatedByName || viewingJV.CreatedBy}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
                {/* Header row — same visual language as the GRN/Invoice
                    Posting tabs (BookOpen label + posted/not-posted pill) */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={14} className="text-primary" />
                    <span className="text-[0.625rem] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                      Journal Entry — JV Posting
                    </span>
                  </div>
                  <GLBadge status={viewingJV.Status} postedToGL={viewingJV.PostedToGL} />
                </div>

                {viewingJV.Narration && (
                  <p className="text-sm text-foreground">{viewingJV.Narration}</p>
                )}

                {viewingJV.Mode && (
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs space-y-1">
                    <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">Payment Mode</p>
                    <p className="text-sm font-medium text-foreground">{viewingJV.Mode}</p>
                    {viewingJV.BankName && <p className="text-muted-foreground">Bank: {viewingJV.BankName}</p>}
                    {viewingJV.ChequeNo && (
                      <p className="text-muted-foreground font-heading tabular-nums">
                        {viewingJV.ChequeLotNumber ? `${viewingJV.ChequeLotNumber} · ` : ""}Cheque #{viewingJV.ChequeNo}
                        {viewingJV.ChequeDate ? ` · ${fmtDate(viewingJV.ChequeDate)}` : ""}
                      </p>
                    )}
                    {viewingJV.DigitalRefNumber && (
                      <p className="text-muted-foreground font-heading tabular-nums">Ref: {viewingJV.DigitalRefNumber}</p>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] bg-muted/40 border-b border-border px-2 sm:px-4 py-2.5 text-[0.5625rem] sm:text-[0.625rem] uppercase tracking-widest text-muted-foreground font-semibold gap-1 sm:gap-2">
                    <span>Ledger</span>
                    <span className="text-right">Debit (₹)</span>
                    <span className="text-right">Credit (₹)</span>
                  </div>
                  {viewingJV.lines.map((l) => {
                    const isDebit = Number(l.DebitAmount) > 0;
                    const kind = partnerLineKind(l);
                    return (
                      <div
                        key={l.LineID}
                        className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-2 sm:px-4 py-3 border-b border-border/50 last:border-0 items-center gap-1 sm:gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0 pl-1">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${isDebit ? "bg-foreground" : "bg-destructive"}`} />
                          <div className="min-w-0">
                            <p className="text-[0.6875rem] sm:text-xs text-foreground truncate flex items-center gap-1.5">
                              <span className="truncate">{l.LHeadName || "—"}</span>
                              {kind && (
                                <span className={`shrink-0 text-[0.5625rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-none ${
                                  kind === "Investment"
                                    ? "bg-primary/10 text-foreground"
                                    : "bg-[#ffe2021a] text-amber-600 dark:text-amber-400"
                                }`}>
                                  {kind}
                                </span>
                              )}
                            </p>
                            {l.Narration && (
                              <p className="text-[0.625rem] text-muted-foreground mt-0.5 truncate">{l.Narration}</p>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-right font-heading tabular-nums text-foreground">
                          {l.DebitAmount ? formatINR(l.DebitAmount, { decimals: 2 }) : ""}
                        </span>
                        <span className="text-xs text-right font-heading tabular-nums text-destructive">
                          {l.CreditAmount ? formatINR(l.CreditAmount, { decimals: 2 }) : ""}
                        </span>
                      </div>
                    );
                  })}
                  <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-2 sm:px-4 py-3 bg-muted/30 border-t-2 border-border text-xs font-bold gap-1 sm:gap-2">
                    <span className="uppercase tracking-widest text-muted-foreground text-[0.625rem]">Total</span>
                    <span className="text-right text-foreground font-heading tabular-nums">
                      {formatINR(viewingJV.lines.reduce((s, l) => s + (Number(l.DebitAmount) || 0), 0), { decimals: 2 })}
                    </span>
                    <span className="text-right text-destructive font-heading tabular-nums">
                      {formatINR(viewingJV.lines.reduce((s, l) => s + (Number(l.CreditAmount) || 0), 0), { decimals: 2 })}
                    </span>
                  </div>
                </div>

                {viewingJV.Status === "Approved" && (
                  viewingJV.PostedToGL ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-foreground/40 bg-primary/10 px-4 py-3">
                      <CheckCircle2 size={13} className="text-foreground flex-shrink-0" />
                      <p className="text-xs text-foreground">
                        Posted to General Ledger. Entries are visible in the Trial Balance.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
                      <AlertCircle size={13} className="text-destructive flex-shrink-0" />
                      <p className="text-xs text-destructive">
                        Not yet posted to General Ledger.
                      </p>
                    </div>
                  )
                )}
              </div>

              <DialogFooter className="shrink-0 px-4 sm:px-5 py-3.5 border-t border-foreground">
                <button
                  onClick={() => setViewingJV(null)}
                  className="w-full sm:w-auto px-4 py-2.5 border border-foreground/40 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  Close
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Journal Voucher?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone. If this voucher was already posted to the General Ledger, that posting will be reversed.
          </p>
          <DialogFooter>
            <button
              onClick={() => setDeleteId(null)}
              disabled={deleting}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => deleteId && handleDelete(deleteId)}
              disabled={deleting}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
