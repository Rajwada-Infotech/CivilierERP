import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import {
  Plus, Pencil, CheckCircle2, Clock, AlertTriangle,
  Building2, Hash, Calendar, Users, ShieldCheck,
  FileText, CircleDot, Circle, Lock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API      = "/api/crm/oc-cc";
const PROJ_API = "/api/unit-master/projects";

const CERT_TYPES = ["OC", "CC", "OC+CC"] as const;
const STATUSES   = ["Applied", "Received"] as const;

const CERT_COLOR: Record<string, string> = {
  OC:     "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-800",
  CC:     "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-800",
  "OC+CC":"text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-800",
};

const EMPTY_FORM = {
  ProjectId: "", CertType: "OC" as string, Status: "Applied" as string,
  ApplicationDate: "", ReceivedDate: "", CertificateNo: "", IssuedBy: "", Remarks: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: any) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function daysSince(d: any) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load OC/CC records");
  return r.json();
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(PROJ_API); return r.ok ? r.json() : []; } catch { return []; }
}

// ── Status stepper ────────────────────────────────────────────────────────────
function OcccStepper({ status }: { status: string }) {
  const steps = ["Applied", "Received"];
  const idx   = steps.indexOf(status);
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        // "Applied" = in-progress; "Received" = terminal (all steps done)
        const done = idx > i || (status === "Received");
        const curr = idx === i && status !== "Received";
        const Icon = done ? CheckCircle2 : curr ? CircleDot : Circle;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full border-2 ${
                done ? "border-emerald-500 bg-emerald-500 text-white" :
                curr ? "border-amber-400 bg-amber-50 text-amber-600 dark:bg-amber-950/30" :
                "border-border bg-muted/30 text-muted-foreground"
              }`}>
                <Icon size={12} />
              </div>
              <span className={`text-[10px] mt-0.5 font-medium ${
                done ? "text-emerald-600 dark:text-emerald-400" :
                curr ? "text-amber-600 dark:text-amber-400" :
                "text-muted-foreground"
              }`}>{step}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-8 mx-1 rounded ${idx > i ? "bg-emerald-400" : "bg-border"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Project card ──────────────────────────────────────────────────────────────
function OcccCard({ row, canEdit, onClick }: { row: any; canEdit: boolean; onClick: () => void }) {
  const isReceived = row.Status === "Received";
  const appDays    = daysSince(row.ApplicationDate);
  const overdue    = !isReceived && appDays != null && appDays > 45;
  const warning    = !isReceived && appDays != null && appDays > 20 && !overdue;

  return (
    <div
      onClick={onClick}
      className={`group relative rounded-2xl border bg-card cursor-pointer transition-all hover:shadow-md hover:border-primary/30 ${
        isReceived ? "border-emerald-200 dark:border-emerald-800/50" :
        overdue    ? "border-red-200 dark:border-red-800/50" :
        warning    ? "border-amber-200 dark:border-amber-800/50" :
        "border-border"
      }`}
    >
      {/* Top color strip */}
      <div className={`h-1 rounded-t-2xl ${
        isReceived ? "bg-emerald-400" : overdue ? "bg-red-400" : warning ? "bg-amber-400" : "bg-border"
      }`} />

      <div className="p-5 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-base text-foreground leading-tight truncate">{row.ProjectName}</h3>
            {row.IssuedBy && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Building2 size={10} /> {row.IssuedBy}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${CERT_COLOR[row.CertType] ?? CERT_COLOR["OC+CC"]}`}>
              {row.CertType}
            </span>
          </div>
        </div>

        {/* Stepper */}
        <OcccStepper status={row.Status} />

        {/* Key info grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Applied On</p>
            <p className="font-medium">{fmtDate(row.ApplicationDate) || "—"}</p>
          </div>
          {isReceived ? (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Received On</p>
              <p className="font-medium text-emerald-600 dark:text-emerald-400">{fmtDate(row.ReceivedDate) || "—"}</p>
            </div>
          ) : (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Days Pending</p>
              <p className={`font-semibold ${overdue ? "text-red-600" : warning ? "text-amber-600" : ""}`}>
                {appDays != null ? `${appDays} days` : "—"}
              </p>
            </div>
          )}
          {row.CertificateNo && (
            <div className="col-span-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Certificate No</p>
              <p className="font-mono font-medium text-emerald-700 dark:text-emerald-400">{row.CertificateNo}</p>
            </div>
          )}
        </div>

        {/* Footer: booking counts + gate status */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users size={11} /> {row.BookingCount ?? 0} bookings
            </span>
            {(row.BookingsAwaitingPossession ?? 0) > 0 && (
              <span className={`flex items-center gap-1 font-medium ${
                isReceived ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
              }`}>
                {isReceived
                  ? <><CheckCircle2 size={11} /> {row.BookingsAwaitingPossession} possession-ready</>
                  : <><AlertTriangle size={11} /> {row.BookingsAwaitingPossession} awaiting OC/CC</>
                }
              </span>
            )}
          </div>
          <div className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            isReceived
              ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800"
              : "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-800"
          }`}>
            {isReceived ? <><ShieldCheck size={10} /> Gate Cleared</> : <><Lock size={10} /> Gate Pending</>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Form fields shared by Create/Edit dialogs ─────────────────────────────────
function OcccForm({
  form, setForm, projects, showProject,
}: {
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  projects: any[];
  showProject: boolean;
}) {
  const sel = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40";
  const inp = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40";

  return (
    <div className="space-y-4">
      {showProject && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Project *</label>
          <select value={form.ProjectId} onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value }))} className={sel}>
            <option value="">Select project</option>
            {projects.map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Certificate Type *</label>
          <select value={form.CertType} onChange={(e) => setForm((f) => ({ ...f, CertType: e.target.value }))} className={sel}>
            {CERT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
          <select value={form.Status} onChange={(e) => setForm((f) => ({ ...f, Status: e.target.value }))} className={sel}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
            <Calendar size={10} /> Application Date
          </label>
          <input type="date" value={form.ApplicationDate}
            onChange={(e) => setForm((f) => ({ ...f, ApplicationDate: e.target.value }))}
            className={inp} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
            <CheckCircle2 size={10} /> Received Date
          </label>
          <input type="date" value={form.ReceivedDate}
            onChange={(e) => setForm((f) => ({ ...f, ReceivedDate: e.target.value }))}
            className={inp} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
          <Hash size={10} /> Certificate Number
        </label>
        <input type="text" value={form.CertificateNo} placeholder="e.g. OC/2024/01234"
          onChange={(e) => setForm((f) => ({ ...f, CertificateNo: e.target.value }))}
          className={`${inp} font-mono`} />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
          <Building2 size={10} /> Issuing Authority
        </label>
        <input type="text" value={form.IssuedBy} placeholder="e.g. GHMC, MCGM, BDA"
          onChange={(e) => setForm((f) => ({ ...f, IssuedBy: e.target.value }))}
          className={inp} />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
          <FileText size={10} /> Remarks
        </label>
        <textarea value={form.Remarks} rows={2}
          onChange={(e) => setForm((f) => ({ ...f, Remarks: e.target.value }))}
          className={`${inp} resize-none`} />
      </div>

      {form.Status === "Received" && form.CertificateNo && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
          <CheckCircle2 size={13} /> Certificate recorded — possession gate will clear for all bookings in this project.
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const CrmOcCc: React.FC = () => {
  const qc = useQueryClient();
  const { canCreate, canEdit } = usePageRights("crm-oc-cc");

  const [activeTab,  setActiveTab]  = useState("All");
  const [detailRow,  setDetailRow]  = useState<any | null>(null);
  const [editLocked, setEditLocked] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);

  const [editForm,   setEditForm]   = useState({ ...EMPTY_FORM });
  const [updating,   setUpdating]   = useState(false);

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } =
    useQuery({ queryKey: ["crm-oc-cc"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: projects = [] } =
    useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const r = rows as any[];
    return {
      total:    r.length,
      applied:  r.filter((x) => x.Status === "Applied").length,
      received: r.filter((x) => x.Status === "Received").length,
      blocked:  r.reduce((s, x) => s + (x.BookingsAwaitingPossession ?? 0), 0),
    };
  }, [rows]);

  const TABS = [
    { key: "All",      label: "All",      count: stats.total    },
    { key: "Applied",  label: "Applied",  count: stats.applied  },
    { key: "Received", label: "Received", count: stats.received },
  ];

  const filtered = useMemo(() =>
    (rows as any[]).filter((r: any) => activeTab === "All" || r.Status === activeTab),
    [rows, activeTab]
  );

  // ── Open detail ───────────────────────────────────────────────────────────
  const openDetail = (row: any) => {
    setDetailRow(row);
    setEditLocked(true);
    setEditForm({
      ProjectId:       String(row.ProjectId),
      CertType:        row.CertType,
      Status:          row.Status,
      ApplicationDate: row.ApplicationDate ? String(row.ApplicationDate).slice(0, 10) : "",
      ReceivedDate:    row.ReceivedDate    ? String(row.ReceivedDate).slice(0, 10)    : "",
      CertificateNo:   row.CertificateNo  || "",
      IssuedBy:        row.IssuedBy       || "",
      Remarks:         row.Remarks        || "",
    });
  };

  const closeDetail = () => { setDetailRow(null); setEditLocked(true); };

  // ── Create ────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!createForm.ProjectId) { toast.error("Project is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId:       parseInt(createForm.ProjectId),
          CertType:        createForm.CertType,
          Status:          createForm.Status,
          ApplicationDate: createForm.ApplicationDate || undefined,
          ReceivedDate:    createForm.ReceivedDate    || undefined,
          CertificateNo:   createForm.CertificateNo   || undefined,
          IssuedBy:        createForm.IssuedBy        || undefined,
          Remarks:         createForm.Remarks         || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("OC/CC application recorded");
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-oc-cc"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-possession-notice-eligible"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // ── Update ────────────────────────────────────────────────────────────────
  const handleUpdate = async () => {
    if (!detailRow) return;
    setUpdating(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailRow.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CertType:        editForm.CertType        || undefined,
          Status:          editForm.Status          || undefined,
          ApplicationDate: editForm.ApplicationDate || undefined,
          ReceivedDate:    editForm.ReceivedDate    || undefined,
          CertificateNo:   editForm.CertificateNo,
          IssuedBy:        editForm.IssuedBy,
          Remarks:         editForm.Remarks,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("OC/CC record updated");
      closeDetail();
      qc.invalidateQueries({ queryKey: ["crm-oc-cc"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-possession-notice-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUpdating(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <CrmShell
      title="Occupancy & Completion Certificate (OC / CC)"
      subtitle="Track OC/CC applications per project — possession handover is gated on Received status"
      action={
        <div className="flex items-center gap-2">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          {canCreate && (
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
              <Plus size={14} /> Add OC/CC
            </button>
          )}
        </div>
      }
    >
      {/* ── Summary metric cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Projects",     value: stats.total,    color: "text-foreground",      bg: "bg-muted/40"                                      },
          { label: "Applied (Pending)",  value: stats.applied,  color: "text-amber-600 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-950/20"  },
          { label: "Received (Cleared)", value: stats.received, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/20" },
          { label: "Bookings Awaiting",  value: stats.blocked,  color: "text-red-600 dark:text-red-400",      bg: "bg-red-50 dark:bg-red-950/20"         },
        ].map((m) => (
          <div key={m.label} className={`rounded-xl border border-border px-4 py-3 ${m.bg}`}>
            <div className={`text-2xl font-bold font-heading ${m.color}`}>{m.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-1.5">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              activeTab === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}>
            {tab.label}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? "bg-primary-foreground/20" : "bg-muted"}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Cards grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 space-y-3 animate-pulse">
              <div className="h-5 w-2/3 bg-muted rounded" />
              <div className="h-4 w-1/2 bg-muted rounded" />
              <div className="h-8 bg-muted rounded" />
              <div className="h-4 w-full bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground space-y-2">
          <ShieldCheck size={36} className="opacity-30" />
          <p className="text-sm">No OC/CC applications recorded yet</p>
          {canCreate && (
            <button onClick={() => setCreateOpen(true)}
              className="mt-2 text-xs text-primary hover:underline flex items-center gap-1">
              <Plus size={12} /> Add the first one
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(filtered as any[]).map((row: any) => (
            <OcccCard key={row.Id} row={row} canEdit={canEdit} onClick={() => openDetail(row)} />
          ))}
        </div>
      )}

      {/* ── Detail / Edit Dialog ── */}
      <Dialog open={!!detailRow} onOpenChange={(o) => { if (!o) closeDetail(); }}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto thin-scroll">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
              <span className="flex items-center gap-2">
                <ShieldCheck size={16} />
                {detailRow?.ProjectName}
              </span>
              {canEdit && editLocked && (
                <button onClick={() => setEditLocked(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                  <Pencil size={11} /> Edit
                </button>
              )}
            </DialogTitle>
          </DialogHeader>

          {detailRow && (
            <div className="space-y-4">
              {/* Status stepper */}
              <div className="px-4 py-3 rounded-xl border border-border bg-card flex items-center justify-between gap-4">
                <OcccStepper status={detailRow.Status} />
                <div className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border ${
                  detailRow.Status === "Received"
                    ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800"
                    : "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-800"
                }`}>
                  {detailRow.Status === "Received" ? <><ShieldCheck size={10} /> Gate Cleared</> : <><Lock size={10} /> Possession Blocked</>}
                </div>
              </div>

              {/* Booking impact */}
              {((detailRow.BookingsAwaitingPossession ?? 0) > 0 || (detailRow.BookingCount ?? 0) > 0) && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${
                  detailRow.Status === "Received"
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
                    : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20"
                }`}>
                  <div className="flex items-start gap-2">
                    <Users size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">
                        {detailRow.BookingCount ?? 0} active bookings in this project
                      </p>
                      {(detailRow.BookingsAwaitingPossession ?? 0) > 0 && (
                        <p className={`text-xs mt-0.5 ${
                          detailRow.Status === "Received" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
                        }`}>
                          {detailRow.Status === "Received"
                            ? `${detailRow.BookingsAwaitingPossession} bookings can now proceed to Pre-Possession check`
                            : `${detailRow.BookingsAwaitingPossession} bookings are blocked at Pre-Possession — waiting for this certificate`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {editLocked ? (
                /* View mode */
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {[
                    { label: "Certificate Type", value: detailRow.CertType },
                    { label: "Status",           value: detailRow.Status   },
                    { label: "Application Date", value: fmtDate(detailRow.ApplicationDate) },
                    { label: "Received Date",    value: fmtDate(detailRow.ReceivedDate)    },
                    { label: "Certificate No",   value: detailRow.CertificateNo, mono: true, span: 2 },
                    { label: "Issuing Authority",value: detailRow.IssuedBy, span: 2 },
                    { label: "Remarks",          value: detailRow.Remarks,  span: 2 },
                  ].map((f) => (
                    <div key={f.label} className={f.span === 2 ? "col-span-2" : ""}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium mb-0.5">{f.label}</p>
                      <p className={`text-sm ${f.mono ? "font-mono text-emerald-700 dark:text-emerald-400" : ""}`}>
                        {f.value || <span className="text-muted-foreground">—</span>}
                      </p>
                    </div>
                  ))}
                  {detailRow.CreatedByName && (
                    <div className="col-span-2 pt-2 border-t border-border">
                      <p className="text-[10px] text-muted-foreground">
                        Created by {detailRow.CreatedByName}
                        {detailRow.UpdatedByName ? ` · Updated by ${detailRow.UpdatedByName}` : ""}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Edit mode */
                <OcccForm form={editForm} setForm={setEditForm} projects={[]} showProject={false} />
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                {editLocked ? (
                  <button onClick={closeDetail}
                    className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                    Close
                  </button>
                ) : (
                  <>
                    <button onClick={() => setEditLocked(true)}
                      className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleUpdate} disabled={updating}
                      className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
                      {updating ? "Saving..." : "Save Changes"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto thin-scroll">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Plus size={16} /> New OC / CC Application
            </DialogTitle>
          </DialogHeader>
          <OcccForm form={createForm} setForm={setCreateForm} projects={projects as any[]} showProject={true} />
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setCreateOpen(false); setCreateForm({ ...EMPTY_FORM }); }}
              className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={saving || !createForm.ProjectId}
              className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {saving ? "Saving..." : "Record Application"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmOcCc;
