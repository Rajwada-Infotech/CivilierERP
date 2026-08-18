import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, CheckSquare, Square, ClipboardCheck, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";

const API = "/api/crm/pre-possession";
const BKG_API = "/api/crm/bookings";

const CHECKS = [
  { key: "DuesClearedCheck",       label: "Dues Cleared" },
  { key: "DocumentationCheck",     label: "Documentation Complete" },
  { key: "QualityInspectionCheck", label: "Quality Inspection Passed" },
  { key: "UtilityReadinessCheck",  label: "Utility Readiness" },
];

const statusColor: Record<string, string> = {
  Pending:    "text-orange-600 bg-orange-50 border-orange-200",
  InProgress: "text-blue-600 bg-blue-50 border-blue-200",
  Ready:      "text-green-600 bg-green-50 border-green-200",
  Blocked:    "text-red-600 bg-red-50 border-red-200",
};

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmPrePossession: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: checks = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-pre-possession"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });

  const handleCreate = async () => {
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
      toast.success("Pre-possession check started");
      setDialogOpen(false);
      setBookingId("");
      qc.invalidateQueries({ queryKey: ["crm-pre-possession"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const toggleCheck = async (id: number, field: string, current: boolean) => {
    try {
      const res = await fetchWithAuth(`${API}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !current }),
      });
      const data = await res.json();
      if (data?.status === "Ready") {
        promptNextStep(navigate, "Pre-possession check is Ready — the Possession Notice can now be sent.", "/crm/possession-notice", "Go to Possession Notice");
      }
      qc.invalidateQueries({ queryKey: ["crm-pre-possession"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  return (
    <CrmShell
      title="CRM — Pre-Possession Check"
      subtitle="Dues, documentation, quality, and utility readiness before handover"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Start Check
        </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : checks.length === 0 ? (
          <div className="col-span-2 flex flex-col items-center gap-3 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
              <ClipboardCheck size={22} className="text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No pre-possession checks yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                Start a check once the Sales Deed has been approved by the customer.
                Four items must all be ticked before a Possession Notice can be sent.
              </p>
            </div>
            <button onClick={() => navigate("/crm/sales-deed")}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline">
              Go to Sales Deed <ArrowRight size={14} />
            </button>
          </div>
        ) : (checks as any[]).map((c: any) => (
          <div key={c.Id} className="rounded-xl border border-border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{c.ApplicantName}</div>
                <div className="text-xs text-muted-foreground">{c.BookingNo} · {c.UnitNo}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[c.Status] || ""}`}>{c.Status}</span>
            </div>
            <div className="space-y-1 pt-2 border-t border-border">
              {CHECKS.map((ch) => (
                <button key={ch.key} onClick={() => toggleCheck(c.Id, ch.key, c[ch.key])}
                  className="flex items-center gap-2 text-sm w-full text-left hover:bg-muted/30 rounded px-1 py-1">
                  {c[ch.key] ? <CheckSquare size={16} className="text-green-600" /> : <Square size={16} className="text-muted-foreground" />}
                  {ch.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">Start Pre-Possession Check</DialogTitle></DialogHeader>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
              <option value="">Select booking</option>
              {(bookings as any[]).map((b: any) => (
                <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setDialogOpen(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Starting..." : "Start"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmPrePossession;
