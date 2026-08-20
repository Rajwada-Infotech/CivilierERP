import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Search, Building2, Package, Calendar, FileText, Hash,
  ArrowRight, Check, X, Boxes, User, Circle, CheckCircle2,
} from "lucide-react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import {
  getTransferUsers, getEligibleTransferAssets, getAssetTransfers, createAssetTransfer,
  type TransferUser, type EligibleTransferAsset, type TransferListItem,
} from "@/api/assetTransferApi";

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN");
}

const inputCls   = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow";
const labelCls   = "flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1";
const sectionCls = "bg-card border border-border rounded-xl p-5 space-y-4";

function SectionHeader({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 shrink-0">
        <Icon size={14} />
      </span>
      <p className="text-sm font-semibold text-foreground">{children}</p>
    </div>
  );
}

function SummaryCard({ label, value, color = "", icon: Icon }: { label: string; value: string; color?: string; icon?: React.ElementType }) {
  return (
    <div className="bg-muted/40 rounded-lg p-3 text-center">
      {Icon && <Icon size={13} className={`mx-auto mb-1 ${color || "text-muted-foreground"}`} />}
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function TransferPreviewCard({
  form, fromUserName, toUserName, assetName, saving,
}: {
  form: FormState;
  fromUserName: string;
  toUserName: string;
  assetName: string;
  saving: boolean;
}) {
  const fields = [
    { label: "Document Date",  value: form.docDate ? fmtDate(form.docDate) : "—", done: !!form.docDate },
    { label: "Transfer Date",  value: form.transferDate ? fmtDate(form.transferDate) : "—", done: !!form.transferDate },
    { label: "From User",      value: fromUserName || "—", done: !!fromUserName },
    { label: "Item / Asset",   value: assetName || "—", done: !!assetName },
    { label: "To User",        value: toUserName || "—", done: !!toUserName },
    { label: "Remarks",        value: form.remarks || "—", done: !!form.remarks },
  ];
  const doneCount = fields.filter((f) => f.done).length;
  const pct = Math.round((doneCount / fields.length) * 100);

  return (
    <div className="relative bg-card border border-border rounded-xl overflow-hidden h-fit shadow-lg shadow-black/5 dark:shadow-black/20">
      <div className="bg-gradient-to-br from-yellow-500 via-amber-500 to-yellow-700 p-4 text-white">
        <p className="text-[10px] uppercase tracking-wide text-white/70 mb-1.5">Draft Transfer</p>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 shrink-0">
            <ArrowRight size={16} />
          </span>
          <p className="text-sm font-bold truncate">{assetName || "New Asset Transfer"}</p>
        </div>
      </div>

      {fromUserName && toUserName && (
        <div className="flex items-center justify-center gap-2 px-4 pt-4 text-xs">
          <span className="font-medium truncate max-w-[100px]">{fromUserName}</span>
          <ArrowRight size={13} className="text-yellow-600 dark:text-yellow-400 shrink-0" />
          <span className="font-medium truncate max-w-[100px]">{toUserName}</span>
        </div>
      )}

      <div className="p-4 space-y-2.5">
        {fields.map((f) => (
          <div key={f.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground shrink-0">
              {f.done ? <CheckCircle2 size={12} className="text-yellow-500 transition-colors" /> : <Circle size={12} className="text-muted-foreground/30" />}
              {f.label}
            </span>
            <span className={`font-medium text-right truncate transition-colors ${f.done ? "text-foreground" : "text-muted-foreground/50"}`}>
              {f.value}
            </span>
          </div>
        ))}
      </div>

      <div className="px-4 pb-4">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-amber-500 transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">{pct}% filled</p>
      </div>

      {saving && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card/95 backdrop-blur-sm">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 animate-pulse">
            <ArrowRight size={20} />
          </span>
          <p className="text-xs font-medium text-muted-foreground">Transferring…</p>
        </div>
      )}
    </div>
  );
}

interface FormState {
  docDate: string;
  transferDate: string;
  companyId: string;
  projectId: string;
  finYear: string;
  fromUserId: string;
  assetId: string;
  toUserId: string;
  remarks: string;
}

const emptyForm = (finYear = ""): FormState => ({
  docDate:      new Date().toISOString().slice(0, 10),
  transferDate: new Date().toISOString().slice(0, 10),
  companyId:    "",
  projectId:    "",
  finYear,
  fromUserId:   "",
  assetId:      "",
  toUserId:     "",
  remarks:      "",
});

type ViewMode = "list" | "form";

export default function AssetTransfer() {
  const rights = usePageRights("asset-transfer");
  const qc     = useQueryClient();
  const { finYears } = useFinYear();
  const activeFinYear = finYears.find((f) => f.status === "Active")?.year || "";

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [form, setForm] = useState<FormState>(emptyForm(activeFinYear));

  const [filterCompany, setFilterCompany] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterFinYear, setFilterFinYear] = useState("");
  const [search, setSearch] = useState("");

  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
  }, []);

  // ── data queries ──────────────────────────────────────────────────────────
  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ["asset-transfers"],
    queryFn:  () => getAssetTransfers(),
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options-C"],
    queryFn:  () => getEnterpriseOptions(undefined, "C"),
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ["enterprise-options-P"],
    queryFn:  () => getEnterpriseOptions(undefined, "P"),
  });
  const { data: users = [] } = useQuery({
    queryKey: ["asset-transfer-users"],
    queryFn:  getTransferUsers,
  });

  const { data: eligibleAssets = [], isLoading: loadingEligible } = useQuery({
    queryKey: ["asset-transfer-eligible-assets", form.companyId, form.projectId, form.finYear, form.fromUserId],
    queryFn: () => getEligibleTransferAssets({
      fromUserId: form.fromUserId ? Number(form.fromUserId) : undefined,
      projectId:  form.projectId  ? Number(form.projectId)  : undefined,
      companyId:  form.companyId  ? Number(form.companyId)  : undefined,
      finYear:    form.finYear || undefined,
    }),
    enabled: viewMode === "form" && !!form.projectId && !!form.fromUserId,
  });

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(form.companyId));
  }, [allProjects, form.companyId]);

  const filterProjects = useMemo(() => {
    if (!filterCompany) return [];
    return ensureArray<{ id: number; label: string; company_id: number | null }>(allProjects)
      .filter((p) => p.company_id === Number(filterCompany));
  }, [allProjects, filterCompany]);

  const toUserOptions = useMemo(
    () => ensureArray<TransferUser>(users).filter((u) => String(u.id) !== form.fromUserId),
    [users, form.fromUserId],
  );

  const selectedAsset = useMemo(
    () => ensureArray<EligibleTransferAsset>(eligibleAssets).find((a) => String(a.AssetId) === form.assetId) || null,
    [eligibleAssets, form.assetId],
  );

  // ── filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = ensureArray<TransferListItem>(transfers);
    if (filterCompany) r = r.filter((t) => String(t.CompanyId) === filterCompany);
    if (filterProject) r = r.filter((t) => String(t.ProjectId) === filterProject);
    if (filterFinYear) r = r.filter((t) => t.FinYear === filterFinYear);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((t) =>
        (t.DocNo || "").toLowerCase().includes(s) ||
        (t.AssetName || "").toLowerCase().includes(s) ||
        (t.AssetCode || "").toLowerCase().includes(s) ||
        (t.FromUserName || "").toLowerCase().includes(s) ||
        (t.ToUserName || "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [transfers, filterCompany, filterProject, filterFinYear, search]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createAssetTransfer,
    onSuccess: (r) => {
      toast.success(`Transferred — ${r.docNo}`);
      qc.invalidateQueries({ queryKey: ["asset-transfers"] });
      qc.invalidateQueries({ queryKey: ["asset-transfer-eligible-assets"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
      resetForm();
      setViewMode("list");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => setForm(emptyForm(activeFinYear));
  const goToCreate = () => { resetForm(); setViewMode("form"); };

  const handleSave = () => {
    if (!form.companyId)    return toast.error("Company is required");
    if (!form.finYear)      return toast.error("Financial year is required");
    if (!form.projectId)    return toast.error("Project is required");
    if (!form.docDate)      return toast.error("Document date is required");
    if (!form.transferDate) return toast.error("Transfer date is required");
    if (!form.fromUserId)   return toast.error("From User is required");
    if (!form.assetId)      return toast.error("Item / Asset is required");
    if (!form.toUserId)     return toast.error("To User is required");
    if (form.fromUserId === form.toUserId) return toast.error("From User and To User must be different");
    if (!selectedAsset) return toast.error("Selected asset is no longer available for transfer");

    createMut.mutate({
      docDate:      form.docDate,
      transferDate: form.transferDate,
      companyId:    Number(form.companyId),
      projectId:    Number(form.projectId),
      finYear:      form.finYear,
      assetId:      Number(form.assetId),
      fromUserId:   Number(form.fromUserId),
      toUserId:     Number(form.toUserId),
      remarks:      form.remarks || undefined,
    });
  };

  const saving = createMut.isPending;

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (viewMode === "form") {
    return (
      <GlassShell
        title="New Asset Transfer"
        subtitle="Move a fixed asset's assignment from one user to another"
        icon={ArrowRight}
        accentColor="#eab308"
        action={
          <div className="flex gap-2">
            <button onClick={() => { resetForm(); setViewMode("list"); }}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border hover:bg-muted transition-all">
              <ArrowLeft size={13} /> Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all disabled:opacity-50">
              <Check size={13} /> {saving ? "Saving…" : "Save Transfer"}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 xl:gap-8 items-start w-full max-w-[1600px]">
        <div className="space-y-5 min-w-0">
          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Header Information</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><Building2 size={11} /> Company *</label>
                <select value={form.companyId}
                  onChange={(e) => { setField("companyId", e.target.value); setField("projectId", ""); setField("assetId", ""); }}
                  className={inputCls}>
                  <option value="">Select company…</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Project *</label>
                <select value={form.projectId}
                  onChange={(e) => { setField("projectId", e.target.value); setField("assetId", ""); }}
                  className={inputCls} disabled={!form.companyId}>
                  <option value="">Select project…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Financial Year *</label>
                <select value={form.finYear}
                  onChange={(e) => { setField("finYear", e.target.value); setField("assetId", ""); }}
                  className={inputCls}>
                  <option value="">Select year…</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Hash size={11} /> Document Number</label>
                <input type="text" value="Auto-generated on save" readOnly
                  className={`${inputCls} bg-muted/30 text-muted-foreground`} />
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Document Date *</label>
                <input type="date" value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> Transfer Date *</label>
                <input type="date" value={form.transferDate} onChange={(e) => setField("transferDate", e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={User}>Transfer Details</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:gap-5">
              <div>
                <label className={labelCls}><User size={11} /> From User *</label>
                <select value={form.fromUserId}
                  onChange={(e) => { setField("fromUserId", e.target.value); setField("assetId", ""); }}
                  className={inputCls} disabled={!form.companyId || !form.projectId}>
                  <option value="">Select user…</option>
                  {ensureArray<TransferUser>(users).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><User size={11} /> To User *</label>
                <select value={form.toUserId} onChange={(e) => setField("toUserId", e.target.value)} className={inputCls}
                  disabled={!form.fromUserId}>
                  <option value="">Select user…</option>
                  {toUserOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className={labelCls}><Package size={11} /> Item / Asset *</label>
                <select value={form.assetId} onChange={(e) => setField("assetId", e.target.value)} className={inputCls}
                  disabled={!form.fromUserId || !form.projectId}>
                  <option value="">
                    {loadingEligible ? "Loading assets…" : "Select item…"}
                  </option>
                  {ensureArray<EligibleTransferAsset>(eligibleAssets).map((a) => (
                    <option key={a.AssetId} value={a.AssetId}>
                      {a.AssetName}{a.AssetCode ? ` · ${a.AssetCode}` : ""} ({a.AssetCategory})
                    </option>
                  ))}
                </select>
                {!loadingEligible && form.fromUserId && form.projectId && eligibleAssets.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1.5">
                    No assets currently assigned to this user in the selected project.
                  </p>
                )}
              </div>

            </div>
          </div>

          <div className={sectionCls}>
            <SectionHeader icon={FileText}>Remarks</SectionHeader>
            <input type="text" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)}
              placeholder="Optional remarks…" className={inputCls} />
          </div>
        </div>

        <TransferPreviewCard
          form={form}
          saving={saving}
          fromUserName={ensureArray<TransferUser>(users).find((u) => String(u.id) === form.fromUserId)?.name || ""}
          toUserName={ensureArray<TransferUser>(users).find((u) => String(u.id) === form.toUserId)?.name || ""}
          assetName={selectedAsset?.AssetName || ""}
        />
        </div>
      </GlassShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
    <Breadcrumbs items={["Dashboard", "Fixed Asset", "Asset Transfer"]} />
    <GlassShell
      title="Asset Transfer"
      subtitle="Transfer fixed assets between users, tracked project-wise"
      icon={ArrowRight}
      accentColor="#eab308"
      action={
        rights.canCreate && (
          <button onClick={goToCreate}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
            <Plus size={13} /> New Transfer
          </button>
        )
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Total Transfers" value={fmt(filtered.length)} icon={Boxes} />
      </div>

      <Card className="border-border shadow-sm mb-5">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label className={labelCls}>Search</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search doc no, asset, user…"
                  className={`${inputCls} pl-8`} />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>Company</label>
              <select value={filterCompany} onChange={(e) => { setFilterCompany(e.target.value); setFilterProject(""); }} className={inputCls}>
                <option value="">All Companies</option>
                {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Project</label>
              <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className={inputCls} disabled={!filterCompany}>
                <option value="">All Projects</option>
                {filterProjects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Financial Year</label>
              <select value={filterFinYear} onChange={(e) => setFilterFinYear(e.target.value)} className={inputCls}>
                <option value="">All Years</option>
                {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {(filterCompany || filterProject || filterFinYear || search) && (
              <button
                onClick={() => { setFilterCompany(""); setFilterProject(""); setFilterFinYear(""); setSearch(""); }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
              >
                Clear filters
              </button>
            )}
            <span className="text-xs text-muted-foreground shrink-0">
              {filtered.length} of {transfers.length} transfers
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base font-semibold">Transfer History</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Full audit trail of asset transfers</p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60">
                <ArrowRight size={26} className="opacity-40" />
              </span>
              <p className="text-sm">No asset transfers found</p>
              {rights.canCreate && (
                <button onClick={goToCreate}
                  className="mt-2 inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
                  <Plus size={13} /> Add First Transfer
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Doc No</th>
                    <th className="px-4 py-3 text-left">Transfer Date</th>
                    <th className="px-4 py-3 text-left">Asset</th>
                    <th className="px-4 py-3 text-left">From → To</th>
                    <th className="px-4 py-3 text-left">Company / Project</th>
                    <th className="px-4 py-3 text-left">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((t) => (
                    <tr key={t.Id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{t.DocNo || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(t.TransferDate)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium truncate">{t.AssetName || "—"}</p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">{t.AssetCode || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span>{t.FromUserName || "—"}</span>
                          <ArrowRight size={11} className="text-muted-foreground shrink-0" />
                          <span className="font-medium">{t.ToUserName || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t.CompanyName || "—"}{t.ProjectName ? ` / ${t.ProjectName}` : ""}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{t.Remarks || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </GlassShell>
    </>
  );
}
