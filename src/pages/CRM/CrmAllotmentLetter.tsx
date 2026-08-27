import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Plus, RotateCcw, FileText, CheckCircle2, Send, X, Upload, ExternalLink,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/allotment-letter";
const BKG_API = "/api/crm/bookings";

const STATUS_CFG: Record<string, { text: string; bar: string }> = {
  Draft:  { text: "text-amber-700",   bar: "bg-amber-500"   },
  Issued: { text: "text-emerald-700", bar: "bg-emerald-500" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.Draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider", c.text)}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", c.bar)} />
      {status}
    </span>
  );
}

interface StagedFile { name: string; size: number; type: string; base64: string; dataUri: string; }

function fileToStaged(file: File): Promise<StagedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUri = reader.result as string;
      resolve({ name: file.name, size: file.size, type: file.type, base64: dataUri.slice(dataUri.indexOf(",") + 1), dataUri });
    };
    reader.readAsDataURL(file);
  });
}

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Allotment Letters");
  return r.json();
}
async function fetchBookings(): Promise<any[]> {
  const r = await fetchWithAuth(BKG_API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load bookings");
  return r.json();
}

const CrmAllotmentLetter: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const { canCreate, canEdit } = usePageRights("crm-allotment-letter");

  const [createOpen, setCreateOpen] = useState(false);
  const [newForm, setNewForm] = useState({ BookingId: "", DraftedOn: "", Remarks: "" });
  const [saving, setSaving] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [issueRemarks, setIssueRemarks] = useState("");
  const [stagedFile, setStagedFile] = useState<StagedFile | null>(null);
  const [issuing, setIssuing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-allotment-letter"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const trackedBookingIds = new Set((rows as any[]).map((r: any) => r.BookingId));
  const startableBookings = (bookings as any[]).filter((b: any) => !trackedBookingIds.has(b.Id));

  const selectedRow = selectedId != null ? (rows as any[]).find((r: any) => r.Id === selectedId) : null;

  // Deep-link support
  React.useEffect(() => {
    if (!deepLinkBookingId || !rows.length) return;
    const existing = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (existing) { setSelectedId(existing.Id); return; }
    if (startableBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setNewForm((f) => ({ ...f, BookingId: deepLinkBookingId }));
      setCreateOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, rows.length]);

  const handleCreate = async () => {
    if (!newForm.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: parseInt(newForm.BookingId),
          DraftedOn: newForm.DraftedOn || undefined,
          Remarks: newForm.Remarks || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.AlNo} created`);
      setCreateOpen(false);
      setNewForm({ BookingId: "", DraftedOn: "", Remarks: "" });
      qc.invalidateQueries({ queryKey: ["crm-allotment-letter"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const stageFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    try { setStagedFile(await fileToStaged(file)); } catch { toast.error("Failed to read file"); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleIssue = async () => {
    if (!selectedId) return;
    setIssuing(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/issue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          IssuedOn: issueDate || undefined,
          Remarks: issueRemarks || undefined,
          file: stagedFile ? { fileName: stagedFile.name, mimeType: stagedFile.type, base64: stagedFile.base64 } : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Allotment Letter issued");
      setSelectedId(null);
      setStagedFile(null);
      setIssueRemarks("");
      qc.invalidateQueries({ queryKey: ["crm-allotment-letter"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setIssuing(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "AlNo", header: "AL No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 180,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "Status", header: "Status", size: 90,
      cell: (i) => <StatusBadge status={i.row.original.Status} /> },
    { accessorKey: "DraftedOn", header: "Drafted", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.DraftedOn ? String(i.row.original.DraftedOn).slice(0, 10) : "—"}</span> },
    { accessorKey: "IssuedOn", header: "Issued", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.IssuedOn ? String(i.row.original.IssuedOn).slice(0, 10) : "—"}</span> },
    { id: "file", header: "Letter", size: 70, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        if (r.FileName) {
          return (
            <a href={`${API}/${r.Id}/download`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline">
              <FileText size={11} /> View
            </a>
          );
        }
        return <span className="text-xs text-muted-foreground">—</span>;
      } },
    { id: "actions", header: "", size: 80, enableSorting: false,
      cell: (i) => (
        <button onClick={() => { setSelectedId(i.row.original.Id); setIssueDate(new Date().toISOString().slice(0, 10)); setIssueRemarks(""); setStagedFile(null); }}
          className="text-xs text-primary hover:underline">Open</button>
      ) },
  ];

  return (
    <CrmShell
      title="CRM — Allotment Letter"
      subtitle="RERA-mandated allotment letter issued to buyers confirming unit, booking amount, and payment schedule"
      action={
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <button onClick={() => refetch()} disabled={isFetching}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
              <RotateCcw size={12} className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {canCreate && (
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> New Allotment Letter
            </button>
          )}
        </div>
      }
    >
      <Breadcrumbs items={[{ label: "CRM" }, { label: "Documents" }, { label: "Allotment Letter" }]} />

      <DataTable
        data={rows as any[]}
        columns={columns}
        loading={isLoading}
        emptyMessage="No allotment letters yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setNewForm({ BookingId: "", DraftedOn: "", Remarks: "" }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">New Allotment Letter</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={newForm.BookingId} onChange={(e) => setNewForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {startableBookings.map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ApplicantName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Draft Date</label>
              <Input type="date" className="h-9 text-sm" value={newForm.DraftedOn} onChange={(e) => setNewForm((f) => ({ ...f, DraftedOn: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
              <Textarea rows={2} className="resize-none text-sm" value={newForm.Remarks} onChange={(e) => setNewForm((f) => ({ ...f, Remarks: e.target.value }))} />
            </div>
            <p className="text-[11px] text-muted-foreground">The letter starts in Draft. Attach and issue the PDF from the record after drafting.</p>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setCreateOpen(false); setNewForm({ BookingId: "", DraftedOn: "", Remarks: "" }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving || !newForm.BookingId}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Creating..." : "Create Draft"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail / Issue dialog */}
      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          {selectedRow && (
            <>
              <DialogHeader className="px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText size={15} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-sm font-semibold font-heading font-mono">{selectedRow.AlNo}</DialogTitle>
                    <DialogDescription className="text-[11px] mt-0.5">Allotment Letter</DialogDescription>
                  </div>
                  <div className="ml-auto">
                    <StatusBadge status={selectedRow.Status} />
                  </div>
                </div>
              </DialogHeader>

              <div className="px-6 py-4 space-y-4">
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{selectedRow.ApplicantName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedRow.BookingNo} · {selectedRow.UnitNo} · {selectedRow.Mobile}</p>
                  {selectedRow.DraftedOn && (
                    <p className="text-[11px] mt-1 text-muted-foreground">Drafted {String(selectedRow.DraftedOn).slice(0, 10)}</p>
                  )}
                </div>

                {selectedRow.Status === "Issued" ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                      <CheckCircle2 size={15} />
                      <div>
                        <div className="font-medium">Issued to customer</div>
                        {selectedRow.IssuedOn && <div className="text-xs mt-0.5">{String(selectedRow.IssuedOn).slice(0, 10)}</div>}
                      </div>
                    </div>
                    {selectedRow.FileName && (
                      <a href={`${API}/${selectedRow.Id}/download`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline font-medium">
                        <ExternalLink size={13} /> {selectedRow.FileName}
                      </a>
                    )}
                    {selectedRow.Remarks && (
                      <p className="text-xs text-muted-foreground">{selectedRow.Remarks}</p>
                    )}
                  </div>
                ) : canEdit ? (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">Attach the signed letter PDF and mark it as issued to the customer.</p>
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading block mb-1">Issue Date</label>
                      <Input type="date" className="h-9 text-sm" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading block mb-1">Attach Letter (optional)</label>
                      {stagedFile ? (
                        <div className="flex items-center gap-2 text-xs bg-muted/30 border border-border rounded-lg px-2.5 py-1.5">
                          <FileText size={12} className="shrink-0 text-muted-foreground" />
                          <span className="truncate flex-1">{stagedFile.name}</span>
                          <span className="text-muted-foreground shrink-0">{(stagedFile.size / 1024).toFixed(0)} KB</span>
                          <button onClick={() => { setStagedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-muted-foreground hover:text-rose-600 shrink-0">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" ref={fileInputRef} className="hidden" onChange={(e) => stageFile(e.target.files)} />
                          <button onClick={() => fileInputRef.current?.click()}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-dashed border-border rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                            <Upload size={12} /> Choose PDF / Image…
                          </button>
                        </>
                      )}
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading block mb-1">Remarks</label>
                      <Textarea rows={2} className="resize-none text-sm" value={issueRemarks} onChange={(e) => setIssueRemarks(e.target.value)} />
                    </div>
                    <button onClick={handleIssue} disabled={issuing}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                      <Send size={13} /> {issuing ? "Issuing..." : "Mark as Issued"}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Draft — not yet issued.</p>
                )}
              </div>

              <DialogFooter className="px-6 py-3.5 border-t border-border bg-muted/20">
                <button onClick={() => setSelectedId(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Close</button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmAllotmentLetter;
