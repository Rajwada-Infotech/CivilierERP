import React, { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Plus, FileText, CheckCircle2, X, Upload, ExternalLink,
  Eye, Download, Clock, AlertTriangle, ArrowRight, Circle, Dot,
  Search,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const API = "/api/crm/allotment-letter";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function reraDeadline(acknowledgedOn: string | null): Date | null {
  if (!acknowledgedOn) return null;
  const d = new Date(acknowledgedOn);
  d.setDate(d.getDate() + 30);
  return d;
}

function daysFrom(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

// Days since issued (only meaningful pre-acknowledgement). Shared by the
// list row badge and the Overdue stat card so the two can never drift.
function daysSinceIssued(row: any): number | null {
  if (!row.IssuedOn || row.Status === "Acknowledged") return null;
  return -daysFrom(new Date(row.IssuedOn));
}

// A letter counts as Overdue in one of two ways, matching the two warning
// signals already surfaced per-row elsewhere in this file: still Issued and
// pending signature return for too long, or Acknowledged with the RERA
// 30-day Agreement-for-Sale deadline already passed.
function isOverdue(row: any): boolean {
  if (row.Status === "Issued") {
    const d = daysSinceIssued(row);
    return d !== null && d > 7;
  }
  if (row.Status === "Acknowledged") {
    const deadline = reraDeadline(row.AcknowledgedOn);
    return !!deadline && daysFrom(deadline) < 0;
  }
  return false;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { text: string; bar: string; pill: string }> = {
  Issued:       { text: "text-amber-700",   bar: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200" },
  Acknowledged: { text: "text-emerald-700", bar: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? { text: "text-slate-700", bar: "bg-slate-500", pill: "" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider", c.text)}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", c.bar)} />
      {status}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? { pill: "bg-slate-50 text-slate-700 border-slate-200" };
  return (
    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full border", c.pill)}>
      {status}
    </span>
  );
}

// ─── File staging ─────────────────────────────────────────────────────────────

interface StagedFile { name: string; size: number; type: string; base64: string; }

function fileToStaged(file: File): Promise<StagedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUri = reader.result as string;
      resolve({ name: file.name, size: file.size, type: file.type, base64: dataUri.slice(dataUri.indexOf(",") + 1) });
    };
    reader.readAsDataURL(file);
  });
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Allotment Letters");
  return r.json();
}
async function fetchEligible(): Promise<any[]> {
  const r = await fetchWithAuth(API + "/eligible-bookings");
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}

// ─── RERA clock strip ─────────────────────────────────────────────────────────

function ReraClockStrip({ acknowledgedOn }: { acknowledgedOn: string | null }) {
  const deadline = reraDeadline(acknowledgedOn);
  if (!deadline) return null;
  const days = daysFrom(deadline);
  const urgent = days <= 5;
  const overdue = days < 0;

  return (
    <div className={cn(
      "rounded-lg border px-3 py-2.5 flex items-start gap-2.5",
      overdue
        ? "bg-rose-50 border-rose-200 text-rose-800"
        : urgent
          ? "bg-amber-50 border-amber-200 text-amber-800"
          : "bg-sky-50 border-sky-200 text-sky-800"
    )}>
      <Clock size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-semibold">
          {overdue
            ? `RERA 30-day clock expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} ago`
            : days === 0
              ? "RERA Agreement deadline is today"
              : `RERA Agreement deadline in ${days} day${days !== 1 ? "s" : ""}`}
        </div>
        <div className="text-[11px] mt-0.5 opacity-80">
          Acknowledged {fmtDate(acknowledgedOn)} → Agreement for Sale due by{" "}
          {deadline.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </div>
      </div>
    </div>
  );
}

// ─── Workflow steps ───────────────────────────────────────────────────────────

function WorkflowSteps({ status, issuedOn, acknowledgedOn }: {
  status: string; issuedOn: string | null; acknowledgedOn: string | null;
}) {
  const steps = [
    { label: "Generated", hint: "Letter created & issued", done: true, date: fmtDate(issuedOn) },
    { label: "Shared with Customer", hint: "Print or email the PDF", done: status === "Acknowledged", date: null },
    { label: "Acknowledged", hint: "Customer returns signed copy", done: status === "Acknowledged", date: fmtDate(acknowledgedOn) },
  ];

  return (
    <div className="space-y-0">
      {steps.map((s, i) => {
        const isActive = !s.done && (i === 0 || steps[i - 1].done);
        return (
          <div key={s.label} className="relative flex gap-3">
            {i < steps.length - 1 && (
              <div className={cn("absolute left-[9px] top-5 bottom-0 w-px", s.done ? "bg-emerald-300" : "bg-border")} />
            )}
            <div className="shrink-0 mt-0.5 z-10">
              {s.done
                ? <CheckCircle2 size={19} className="text-emerald-600 bg-card" />
                : isActive
                  ? <div className="w-[19px] h-[19px] rounded-full border-2 border-primary bg-card flex items-center justify-center"><Dot size={10} className="text-primary" /></div>
                  : <Circle size={19} className="text-border bg-card" />
              }
            </div>
            <div className="pb-4 min-w-0">
              <div className={cn("text-sm font-medium leading-tight", s.done ? "text-foreground" : isActive ? "text-primary" : "text-muted-foreground")}>
                {s.label}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</div>
              {s.done && s.date && s.date !== "—" && (
                <div className="text-[11px] text-emerald-700 mt-0.5">{s.date}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, count, active, onClick, tone }: {
  label: string; count: number; active: boolean; onClick: () => void;
  tone: "slate" | "amber" | "emerald" | "rose";
}) {
  const toneCls: Record<string, string> = {
    slate:   "text-foreground",
    amber:   "text-amber-600",
    emerald: "text-emerald-600",
    rose:    "text-rose-600",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 min-w-[120px] text-left rounded-xl border px-4 py-3 transition-colors",
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/20"
      )}
    >
      <div className={cn("text-2xl font-heading font-semibold", toneCls[tone])}>{count}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type StatusFilter = "All" | "Issued" | "Acknowledged" | "Overdue";

const CrmAllotmentLetter: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const { canCreate, canEdit } = usePageRights("crm-allotment-letter");

  // Create
  const [createOpen, setCreateOpen] = useState(false);
  const [newBookingId, setNewBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  // List panel — search / filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");

  // Detail / Acknowledge
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ackDate, setAckDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ackRemarks, setAckRemarks] = useState("");
  const [stagedFile, setStagedFile] = useState<StagedFile | null>(null);
  const [issuing, setIssuing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PDF preview
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({
    queryKey: ["crm-allotment-letter"], queryFn: fetchAll, staleTime: 30_000,
  });
  const { data: eligibleBookings = [] } = useQuery({
    queryKey: ["crm-allotment-letter-eligible"], queryFn: fetchEligible, staleTime: 30_000,
  });

  const selectedRow = selectedId != null ? (rows as any[]).find((r: any) => r.Id === selectedId) : null;

  // Stat counts — always computed off the full unfiltered list, so the
  // cards reflect the whole book even while a filter/search narrows the
  // list below them.
  const stats = useMemo(() => {
    const all = rows as any[];
    return {
      total: all.length,
      issued: all.filter((r) => r.Status === "Issued").length,
      acknowledged: all.filter((r) => r.Status === "Acknowledged").length,
      overdue: all.filter(isOverdue).length,
    };
  }, [rows]);

  // Search + status filter — client-side, matching the same convention
  // CrmAgreement.tsx's own list panel already uses (a single fetched list,
  // filtered in the browser). The backend's GET / ?status= filter still
  // exists and works if this list ever grows large enough to warrant a
  // server round-trip instead.
  const filtered = useMemo(() => {
    let list = rows as any[];
    if (statusFilter === "Overdue") {
      list = list.filter(isOverdue);
    } else if (statusFilter !== "All") {
      list = list.filter((r) => r.Status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) =>
        String(r.ApplicantName || "").toLowerCase().includes(q) ||
        String(r.AlNo || "").toLowerCase().includes(q) ||
        String(r.BookingNo || "").toLowerCase().includes(q) ||
        String(r.UnitNo || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, statusFilter, search]);

  // Deep-link
  React.useEffect(() => {
    if (!deepLinkBookingId || !rows.length) return;
    const existing = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (existing) { openDetail(existing.Id); return; }
    if (eligibleBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setNewBookingId(deepLinkBookingId);
      setCreateOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, rows.length, eligibleBookings]);

  // PDF fetch when detail opens
  React.useEffect(() => {
    if (!selectedId) { setBlobUrl(null); return; }
    let objectUrl: string | null = null;
    setPdfLoading(true);
    setPdfError(null);
    fetchWithAuth(`${API}/${selectedId}/pdf`)
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch((e: any) => setPdfError(e.message || "Failed to load PDF"))
      .finally(() => setPdfLoading(false));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedId]);

  function openDetail(id: number) {
    setSelectedId(id);
    setAckDate(new Date().toISOString().slice(0, 10));
    setAckRemarks("");
    setStagedFile(null);
  }

  const stageFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5 MB"); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    try { setStagedFile(await fileToStaged(file)); } catch { toast.error("Failed to read file"); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCreate = async () => {
    if (!newBookingId) { toast.error("Select a booking"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(newBookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.AlNo} generated — share the PDF with the customer`);
      setCreateOpen(false);
      setNewBookingId("");
      qc.invalidateQueries({ queryKey: ["crm-allotment-letter"] });
      qc.invalidateQueries({ queryKey: ["crm-allotment-letter-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      if (data.id) openDetail(data.id);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!selectedId) return;
    if (!ackDate) { toast.error("Acknowledgement date is required"); return; }
    setIssuing(true);
    try {
      const body: any = {
        AcknowledgedOn: ackDate,
        Remarks: ackRemarks || undefined,
      };
      if (stagedFile) {
        body.file = { fileName: stagedFile.name, mimeType: stagedFile.type, base64: stagedFile.base64 };
      }
      const res = await fetchWithAuth(`${API}/${selectedId}/acknowledge`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Allotment Letter acknowledged — RERA 30-day Agreement clock has started");
      setStagedFile(null);
      setAckRemarks("");
      qc.invalidateQueries({ queryKey: ["crm-allotment-letter"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setIssuing(false);
    }
  };

  const retryPdf = () => {
    if (!selectedRow) return;
    setPdfError(null);
    setPdfLoading(true);
    let objectUrl: string | null = null;
    fetchWithAuth(`${API}/${selectedRow.Id}/pdf`)
      .then((r) => r.blob())
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch((e: any) => setPdfError(e.message || "Failed to load PDF"))
      .finally(() => setPdfLoading(false));
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Documents", "Allotment Letter"]} />
      <CrmShell
        title="Allotment Letter"
        subtitle="Issued once the Booking Amount milestone is paid. Acknowledgement triggers the 30-day RERA clock for the Agreement for Sale."
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            {canCreate && (
              <button
                onClick={() => { qc.invalidateQueries({ queryKey: ["crm-allotment-letter-eligible"] }); setCreateOpen(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90"
              >
                <Plus size={14} /> Generate Letter
              </button>
            )}
          </div>
        }
      >
        {/* ── Stat cards ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 mb-4">
          <StatCard label="All Letters" count={stats.total} tone="slate"
            active={statusFilter === "All"} onClick={() => setStatusFilter("All")} />
          <StatCard label="Issued — Awaiting Signature" count={stats.issued} tone="amber"
            active={statusFilter === "Issued"} onClick={() => setStatusFilter("Issued")} />
          <StatCard label="Acknowledged" count={stats.acknowledged} tone="emerald"
            active={statusFilter === "Acknowledged"} onClick={() => setStatusFilter("Acknowledged")} />
          <StatCard label="Overdue" count={stats.overdue} tone="rose"
            active={statusFilter === "Overdue"} onClick={() => setStatusFilter("Overdue")} />
        </div>

        <div className="flex gap-4 h-[calc(100vh-280px)]">
          {/* ── LEFT — searchable, filterable list ──────────────────────── */}
          <div className="w-80 shrink-0 flex flex-col gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search letters..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  {rows.length === 0 ? "No allotment letters yet" : "No letters match"}
                </div>
              ) : (filtered as any[]).map((r: any) => {
                const overdue = isOverdue(r);
                const barColor = (STATUS_CFG[r.Status] ?? { bar: "bg-slate-400" }).bar;
                return (
                  <button key={r.Id} onClick={() => openDetail(r.Id)}
                    className={cn(
                      "w-full text-left rounded-lg border transition-colors flex overflow-hidden",
                      selectedId === r.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                    )}
                  >
                    <span className={cn("w-[3px] shrink-0 self-stretch", barColor)} />
                    <div className="min-w-0 flex-1 px-3.5 py-3 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground truncate leading-tight">{r.ApplicantName}</span>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0 pt-0.5">{r.AlNo}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{r.BookingNo} · {r.UnitNo}</div>
                      {overdue ? (
                        <div className="text-[11px] font-medium text-rose-600 flex items-center gap-1">
                          <AlertTriangle size={11} /> Overdue
                        </div>
                      ) : (
                        <StatusPill status={r.Status} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── RIGHT — inline detail (no dialog) ───────────────────────── */}
          <div className="flex-1 overflow-hidden rounded-xl border border-border bg-card">
            {!selectedRow ? (
              selectedId != null ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  Select a letter to view details
                </div>
              )
            ) : (
              <div className="h-full flex flex-col md:flex-row">
                {/* Left column — workflow + actions */}
                <div className="w-full md:w-[380px] flex flex-col border-r border-border shrink-0 h-full overflow-y-auto">
                  <div className="px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-primary">{selectedRow.AlNo}</span>
                      <StatusBadge status={selectedRow.Status} />
                    </div>
                    <div className="text-sm font-medium mt-1">{selectedRow.ApplicantName}</div>
                    <div className="text-xs text-muted-foreground">{selectedRow.BookingNo} · {selectedRow.UnitNo}</div>
                  </div>

                  <div className="px-5 py-4 space-y-4">
                    {selectedRow.Status === "Acknowledged" && (
                      <ReraClockStrip acknowledgedOn={selectedRow.AcknowledgedOn} />
                    )}

                    <WorkflowSteps status={selectedRow.Status} issuedOn={selectedRow.IssuedOn} acknowledgedOn={selectedRow.AcknowledgedOn} />

                    {selectedRow.FileName && (
                      <a
                        href={`${API}/${selectedRow.Id}/download`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-primary hover:underline border border-border rounded-lg px-3 py-2 bg-muted/30 transition-colors hover:bg-muted/50"
                      >
                        <ExternalLink size={12} />
                        <span className="truncate">{selectedRow.FileName}</span>
                        <span className="text-muted-foreground shrink-0 ml-auto">signed copy</span>
                      </a>
                    )}

                    {selectedRow.Remarks && (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Remarks</div>
                        <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3 border border-border">{selectedRow.Remarks}</p>
                      </div>
                    )}

                    {selectedRow.Status === "Acknowledged" ? (
                      <div className="border-t border-border pt-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Next Step</div>
                        <button
                          onClick={() => navigate(`/crm/agreements?bookingId=${selectedRow.BookingId}`)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary text-sm font-medium transition-colors"
                        >
                          <span>Agreement for Sale</span>
                          <ArrowRight size={14} className="shrink-0" />
                        </button>
                        <p className="text-[11px] text-muted-foreground mt-1.5">Must be executed within 30 days of acknowledgement per RERA.</p>
                      </div>
                    ) : canEdit ? (
                      <div className="space-y-4 border-t border-border pt-5">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Record Acknowledgement</div>
                          <p className="text-[11px] text-muted-foreground">
                            When the customer signs and returns this letter, record the date below. Attaching the scanned signed copy is optional — you can upload it later.
                          </p>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-foreground block mb-1">Acknowledgement Date *</label>
                          <Input type="date" className="h-9 text-sm" value={ackDate} onChange={(e) => setAckDate(e.target.value)} />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-foreground block mb-1">
                            Signed Copy <span className="text-muted-foreground font-normal">(optional)</span>
                          </label>
                          {stagedFile ? (
                            <div className="flex items-center gap-2 text-xs bg-muted/30 border border-border rounded-lg px-3 py-2">
                              <FileText size={13} className="shrink-0 text-muted-foreground" />
                              <span className="truncate flex-1 font-medium">{stagedFile.name}</span>
                              <span className="text-muted-foreground shrink-0">{(stagedFile.size / 1024).toFixed(0)} KB</span>
                              <button
                                onClick={() => { setStagedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                                className="text-muted-foreground hover:text-rose-600 shrink-0 p-0.5"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <input type="file" accept=".pdf,.jpg,.jpeg,.png" ref={fileInputRef} className="hidden" onChange={(e) => stageFile(e.target.files)} />
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium border border-dashed border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                              >
                                <Upload size={13} /> Attach Signed Letter
                              </button>
                            </>
                          )}
                        </div>

                        <div>
                          <label className="text-xs font-medium text-foreground block mb-1">
                            Remarks <span className="text-muted-foreground font-normal">(optional)</span>
                          </label>
                          <Textarea rows={2} className="resize-none text-sm" value={ackRemarks} onChange={(e) => setAckRemarks(e.target.value)} placeholder="Any notes…" />
                        </div>

                        <button
                          onClick={handleAcknowledge}
                          disabled={issuing || !ackDate}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                        >
                          <CheckCircle2 size={14} />
                          {issuing ? "Saving…" : "Mark as Acknowledged"}
                        </button>

                        <p className="text-[10px] text-muted-foreground text-center">
                          This starts the 30-day RERA Agreement for Sale deadline.
                        </p>
                      </div>
                    ) : (
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
                        <Clock size={13} className="shrink-0" />
                        Issued — waiting for the customer to return the signed copy.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right column — PDF preview */}
                <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900/50 h-full overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 bg-white dark:bg-slate-950 border-b border-border shrink-0">
                    <div className="flex items-center gap-2">
                      <Eye size={14} className="text-muted-foreground" />
                      <span className="text-sm font-semibold">Document Preview</span>
                    </div>
                    {blobUrl && (
                      <a
                        href={blobUrl}
                        download={`allotment-letter-${selectedRow.AlNo}.pdf`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        <Download size={12} /> Download PDF
                      </a>
                    )}
                  </div>
                  <div className="flex-1 relative flex items-center justify-center p-3">
                    {pdfLoading && (
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        <span className="text-sm">Generating preview…</span>
                      </div>
                    )}
                    {pdfError && !pdfLoading && (
                      <div className="flex flex-col items-center gap-2 text-rose-600 bg-rose-50 border border-rose-200 px-4 py-3 rounded-lg">
                        <span className="text-sm font-medium">{pdfError}</span>
                        <button onClick={retryPdf} className="text-xs underline hover:text-rose-700">Retry</button>
                      </div>
                    )}
                    {blobUrl && !pdfLoading && (
                      <iframe
                        src={blobUrl}
                        className="w-full h-full rounded-lg border border-border bg-white shadow-sm"
                        title="Allotment Letter Preview"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Generate dialog ─────────────────────────────────────────────── */}
        <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setNewBookingId(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading">Generate Allotment Letter</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Eligible Booking *</label>
                <select
                  value={newBookingId}
                  onChange={(e) => setNewBookingId(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                >
                  <option value="">Select booking…</option>
                  {(eligibleBookings as any[]).map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>
                      {b.BookingNo} · {b.ApplicantName}
                    </option>
                  ))}
                </select>
              </div>
              {eligibleBookings.length === 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-2.5 rounded-lg">
                  No bookings are eligible yet. A booking must be Approved and the Booking Amount milestone (Milestone 1) must be fully paid.
                </p>
              )}
              <div className="bg-muted/40 rounded-lg px-3 py-2.5 space-y-1 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5 font-medium text-foreground text-xs"><Clock size={12} /> What happens next</div>
                <div>1. Letter is instantly generated and marked <strong>Issued</strong>.</div>
                <div>2. Download the PDF and share it with the customer.</div>
                <div>3. When the customer returns the signed copy, record <strong>Acknowledgement</strong> — this starts the 30-day RERA clock.</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button onClick={() => { setCreateOpen(false); setNewBookingId(""); }}
                className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={saving || !newBookingId}
                className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
                {saving ? "Generating…" : "Generate"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmAllotmentLetter;