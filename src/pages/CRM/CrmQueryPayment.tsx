import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Send, CheckCircle2, Paperclip, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/query-payment";
const BKG_API = "/api/crm/bookings";

const statusColor: Record<string, string> = {
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
  InfoSent:  "text-blue-600 bg-blue-50 border-blue-200",
  Confirmed: "text-green-600 bg-green-50 border-green-200",
};

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Query Payments");
  return r.json();
}
async function fetchBookings(): Promise<any[]> {
  const r = await fetchWithAuth(BKG_API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load bookings");
  return r.json();
}
async function fetchDetail(id: number | null): Promise<any> {
  if (!id) return null;
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load Query Payment");
  return r.json();
}

const CrmQueryPayment: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [confirmRemarks, setConfirmRemarks] = useState("");
  const infoInputRef = useRef<HTMLInputElement>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  const { data: rows = [], isLoading } = useQuery({ queryKey: ["crm-query-payment"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: detail, refetch: refetchDetail } = useQuery({
    queryKey: ["crm-query-payment-detail", selectedId],
    queryFn: () => fetchDetail(selectedId),
    enabled: !!selectedId,
  });

  const trackedBookingIds = new Set((rows as any[]).map((r: any) => r.BookingId));
  const startableBookings = (bookings as any[]).filter((b: any) => !trackedBookingIds.has(b.Id));

  // Deep-link from Legal Milestones: open the tracker if this booking
  // already has one, otherwise pre-fill the Start dialog with it.
  useEffect(() => {
    if (!deepLinkBookingId || !rows.length) return;
    const existing = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (existing) setSelectedId(existing.Id);
    else if (startableBookings.some((b: any) => String(b.Id) === deepLinkBookingId)) {
      setBookingId(deepLinkBookingId);
      setDialogOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, rows.length]);

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.QPNo} started`);
      setDialogOpen(false);
      setBookingId("");
      qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendInfo = async (files: FileList | null) => {
    if (!selectedId || !files?.length) return;
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetchWithAuth(`${API}/${selectedId}/info`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Sent to customer");
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    try {
      const fd = new FormData();
      if (confirmAmount) fd.append("ConfirmedAmount", confirmAmount);
      if (confirmRemarks) fd.append("Remarks", confirmRemarks);
      if (proofInputRef.current?.files?.[0]) fd.append("proof", proofInputRef.current.files[0]);
      const res = await fetchWithAuth(`${API}/${selectedId}/confirm`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Confirmed — customer has paid the government");
      setConfirmAmount("");
      setConfirmRemarks("");
      refetchDetail();
      qc.invalidateQueries({ queryKey: ["crm-query-payment"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "QPNo", header: "QP No", size: 110,
      cell: (i) => <span className="font-mono text-xs font-semibold text-primary">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 160,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "DeedNo", header: "Deed", size: 100, cell: (i) => <span className="text-xs">{i.getValue() as string || "—"}</span> },
    { id: "amount", header: "Required Amount", size: 130,
      cell: (i) => <span className="text-xs font-mono">₹{Number(i.row.original.RequiredAmount || 0).toLocaleString("en-IN")}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { id: "actions", header: "", size: 90, enableSorting: false,
      cell: (i) => (
        <button onClick={() => setSelectedId(i.row.original.Id)} className="text-xs text-primary hover:underline">Open</button>
      ) },
  ];

  return (
    <SalesAutoShell
      title="CRM — Query Payment"
      subtitle="Stamp duty & registration fee paid by the customer directly to the government"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Start Query Payment
        </button>
      }
    >
      <DataTable
        data={rows as any[]}
        columns={columns}
        loading={isLoading}
        emptyMessage="No Query Payment trackers yet"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {/* Start dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Start Query Payment</DialogTitle></DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select booking</option>
              {startableBookings.map((b: any) => (
                <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">Requires a Sales Deed to already exist for this booking.</p>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setBookingId(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleStart} disabled={saving || !bookingId}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Starting..." : "Start"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading flex items-center gap-2">
                  {detail.QPNo}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${statusColor[detail.Status] || ""}`}>{detail.Status}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <div className="font-medium">{detail.ApplicantName} — {detail.BookingNo} · {detail.UnitNo}</div>
                  <div className="text-xs text-muted-foreground mt-1">Deed {detail.DeedNo || "—"}</div>
                  <div className="text-xs mt-1">
                    Stamp Duty ₹{Number(detail.StampDuty || 0).toLocaleString("en-IN")} + Registration Fee ₹{Number(detail.RegistrationFee || 0).toLocaleString("en-IN")}
                    {" "}= <span className="font-semibold">₹{Number(detail.RequiredAmount || 0).toLocaleString("en-IN")}</span> required
                  </div>
                </div>

                {detail.Status !== "Confirmed" && (!detail.StampDuty && !detail.RegistrationFee) && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertTriangle size={12} /> Sales Deed has no Stamp Duty / Registration Fee amount on file yet.
                  </div>
                )}

                <div className="border-t border-border pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Attachments</p>
                  {detail.attachments?.length ? (
                    <ul className="space-y-1">
                      {detail.attachments.map((a: any) => (
                        <li key={a.AttachmentId} className="flex items-center gap-2 text-xs">
                          <Paperclip size={11} className="text-muted-foreground" />
                          <a href={`${API}/attachment/${a.AttachmentId}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{a.FileName}</a>
                          <span className="text-muted-foreground">· {a.DocType}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No files uploaded yet</p>
                  )}
                </div>

                {detail.Status !== "Confirmed" && (
                  <div className="border-t border-border pt-3 space-y-2">
                    <input type="file" multiple ref={infoInputRef} className="hidden" onChange={(e) => handleSendInfo(e.target.files)} />
                    <button onClick={() => infoInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted">
                      <Send size={12} /> {detail.Status === "Pending" ? "Send Info & Paperwork to Customer" : "Send Additional Documents"}
                    </button>

                    <div className="rounded-lg border border-border p-2.5 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Confirm Government Payment</p>
                      <input type="number" placeholder="Amount actually paid (optional)" value={confirmAmount}
                        onChange={(e) => setConfirmAmount(e.target.value)}
                        className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                      <textarea placeholder="Remarks (optional)" rows={1} value={confirmRemarks}
                        onChange={(e) => setConfirmRemarks(e.target.value)}
                        className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
                      <input type="file" ref={proofInputRef} className="text-xs w-full" />
                      <button onClick={handleConfirm}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg font-medium hover:bg-green-700">
                        <CheckCircle2 size={12} /> Confirm Customer Paid the Government
                      </button>
                    </div>
                  </div>
                )}

                {detail.Status === "Confirmed" && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 border-t border-border pt-3">
                    <CheckCircle2 size={13} /> Confirmed {detail.ConfirmedAt ? String(detail.ConfirmedAt).slice(0, 10) : ""}
                    {detail.ConfirmedAmount ? ` · ₹${Number(detail.ConfirmedAmount).toLocaleString("en-IN")}` : ""}
                  </div>
                )}
              </div>
              <div className="flex justify-end pt-3 border-t border-border">
                <button onClick={() => setSelectedId(null)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmQueryPayment;
