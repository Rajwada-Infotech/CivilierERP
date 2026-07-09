import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Phone, Mail, MessageSquare, MapPin, FileText, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/communication";
const BKG_API = "/api/crm/bookings";
const APP_API = "/api/crm/applications";

const CHANNELS = ["Call", "Email", "SMS", "WhatsApp", "InPerson", "Letter"];
const DIRECTIONS = ["Inbound", "Outbound"];
const channelIcon: Record<string, any> = { Call: Phone, Email: Mail, SMS: MessageSquare, WhatsApp: MessageSquare, InPerson: MapPin, Letter: FileText };

const EMPTY_FORM = { ApplicationId: "", BookingId: "", Channel: "Call", Direction: "Outbound", Subject: "", Summary: "" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchApps(): Promise<any[]> {
  try { const r = await fetchWithAuth(APP_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmCommunication: React.FC = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, BookingId: bkgFilter });
  const [saving, setSaving] = useState(false);

  const { data: logs = [], isLoading } = useQuery({ queryKey: ["crm-communication"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: apps = [] } = useQuery({ queryKey: ["crm-applications"], queryFn: fetchApps, staleTime: 5 * 60_000 });

  const filteredLogs = useMemo(() =>
    bkgFilter ? (logs as any[]).filter((c: any) => String(c.BookingId) === bkgFilter) : logs,
    [logs, bkgFilter]
  );
  const filterBooking = useMemo(() =>
    bkgFilter ? (bookings as any[]).find((b: any) => String(b.Id) === bkgFilter) : null,
    [bookings, bkgFilter]
  );

  const handleCreate = async () => {
    if (!form.ApplicationId && !form.BookingId) { toast.error("Application or Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ApplicationId: form.ApplicationId ? parseInt(form.ApplicationId) : null,
          BookingId: form.BookingId ? parseInt(form.BookingId) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Communication logged");
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM, BookingId: bkgFilter });
      qc.invalidateQueries({ queryKey: ["crm-communication"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Communication Log"
      subtitle={filterBooking ? `Showing only ${filterBooking.BookingNo} — ${filterBooking.ApplicantName}` : "Every touchpoint with a buyer, in one timeline"}
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Log Communication
        </button>
      }
    >
      {bkgFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary flex items-center gap-1.5">
            Filtered to {filterBooking?.BookingNo || `booking #${bkgFilter}`}
            <button onClick={() => { sp.delete("bookingId"); setSp(sp); }} className="hover:text-red-600">
              <X size={11} />
            </button>
          </span>
        </div>
      )}

      <div className="space-y-2">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">No communications logged</div>
        ) : (filteredLogs as any[]).map((c: any) => {
          const Icon = channelIcon[c.Channel] || MessageSquare;
          return (
            <div key={c.Id} className="rounded-lg border border-border p-3 flex items-start gap-3">
              <div className="p-2 rounded-full bg-muted"><Icon size={14} /></div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.ApplicantName || c.BookingNo || "—"}</span>
                  <span className="text-xs text-muted-foreground">{String(c.ContactedAt).slice(0,16).replace("T"," ")}</span>
                </div>
                <div className="text-xs text-muted-foreground">{c.Channel} · {c.Direction || "—"}{c.Subject ? ` · ${c.Subject}` : ""}</div>
                {c.Summary && <p className="text-sm mt-1">{c.Summary}</p>}
                <div className="text-xs text-muted-foreground mt-1">By {c.CreatedByName || "—"}</div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM, BookingId: bkgFilter }); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Log Communication</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Application</label>
                <select value={form.ApplicationId} onChange={(e) => setForm((f) => ({ ...f, ApplicationId: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">—</option>
                  {(apps as any[]).map((a: any) => <option key={a.Id} value={String(a.Id)}>{a.ApplicationNo} — {a.ApplicantName}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Booking</label>
                <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">—</option>
                  {(bookings as any[]).map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Channel</label>
                <select value={form.Channel} onChange={(e) => setForm((f) => ({ ...f, Channel: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {CHANNELS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Direction</label>
                <select value={form.Direction} onChange={(e) => setForm((f) => ({ ...f, Direction: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  {DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Subject</label>
              <input type="text" value={form.Subject} onChange={(e) => setForm((f) => ({ ...f, Subject: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Summary</label>
              <textarea value={form.Summary} onChange={(e) => setForm((f) => ({ ...f, Summary: e.target.value }))}
                rows={3} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM, BookingId: bkgFilter }); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Logging..." : "Log"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmCommunication;
