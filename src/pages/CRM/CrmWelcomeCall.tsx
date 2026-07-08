import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, Phone } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams } from "react-router-dom";

const API = "/api/crm/welcome-calls";
const BKG_API = "/api/crm/bookings";
const SA_LEADS_API = "/api/sa/leads";

const OUTCOMES = ["Welcomed", "NotReachable", "RequestedCallback", "VoiceMail", "Busy", "SwitchedOff"];
const outcomeColor: Record<string, string> = {
  Welcomed:          "text-green-600 bg-green-50 border-green-200",
  NotReachable:      "text-red-500 bg-red-50 border-red-200",
  RequestedCallback: "text-orange-600 bg-orange-50 border-orange-200",
  VoiceMail:         "text-blue-500 bg-blue-50 border-blue-200",
  Busy:              "text-yellow-600 bg-yellow-50 border-yellow-200",
  SwitchedOff:       "text-muted-foreground bg-muted/50 border-border",
};

const EMPTY_FORM = {
  BookingId: "", CalledBy: "", CallDate: "", DurationSeconds: "",
  Outcome: "", NextCallDate: "", Notes: "",
};

async function fetchCalls(bookingId?: string): Promise<any[]> {
  try {
    const url = bookingId ? `${API}?bookingId=${bookingId}` : API;
    const res = await fetchWithAuth(url);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(BKG_API);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!res.ok) return [];
    const d: any[] = await res.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

const CrmWelcomeCall: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, BookingId: bkgFilter });
  const [saving, setSaving] = useState(false);

  const { data: calls = [], isLoading } = useQuery({
    queryKey: ["crm-welcome-calls", bkgFilter],
    queryFn: () => fetchCalls(bkgFilter || undefined),
    staleTime: 60_000,
  });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });

  const filtered = useMemo(() =>
    (calls as any[]).filter((c: any) =>
      !search || c.ApplicantName?.toLowerCase().includes(search.toLowerCase()) || c.BookingNo?.includes(search)
    ), [calls, search]);

  const handleSave = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId:       parseInt(form.BookingId),
          CalledBy:        form.CalledBy       || null,
          CallDate:        form.CallDate        || null,
          DurationSeconds: form.DurationSeconds ? parseInt(form.DurationSeconds) : null,
          Outcome:         form.Outcome         || null,
          NextCallDate:    form.NextCallDate     || null,
          Notes:           form.Notes           || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log call");
      toast.success("Welcome call logged");
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM, BookingId: bkgFilter });
      qc.invalidateQueries({ queryKey: ["crm-welcome-calls"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const pendingCallbacks = useMemo(() =>
    (calls as any[]).filter((c: any) => c.NextCallDate && c.Outcome !== "Welcomed"),
    [calls]
  );

  return (
    <SalesAutoShell
      title="CRM — Welcome Calls"
      subtitle="Post-booking welcome calls and callback tracking"
      action={
        <button onClick={() => setDialogOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
          <Phone size={14} /> Log Welcome Call
        </button>
      }
    >
      {pendingCallbacks.length > 0 && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 px-4 py-2.5 text-sm text-orange-700 flex items-center gap-2">
          <Phone size={14} />
          <span><strong>{pendingCallbacks.length}</strong> pending callback{pendingCallbacks.length > 1 ? "s" : ""} scheduled</span>
        </div>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer or booking no..."
          className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No welcome calls logged yet</div>
        ) : (filtered as any[]).map((c: any) => (
          <div key={c.Id} className="rounded-xl border border-border p-4 hover:bg-muted/10 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{c.ApplicantName}</span>
                  <span className="text-xs text-muted-foreground font-mono">{c.BookingNo}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{c.Mobile} · {c.ProjectName || c.UnitNo}</div>
              </div>
              <div className="flex items-center gap-2">
                {c.Outcome && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${outcomeColor[c.Outcome] || ""}`}>
                    {c.Outcome}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {c.CallDate ? String(c.CallDate).slice(0, 16).replace("T", " ") : "—"}
                </span>
              </div>
            </div>
            {(c.Notes || c.DurationSeconds || c.NextCallDate) && (
              <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                {c.DurationSeconds && <span>{Math.floor(c.DurationSeconds / 60)}m {c.DurationSeconds % 60}s</span>}
                {c.CalledByName && <span>by {c.CalledByName}</span>}
                {c.NextCallDate && <span className="text-orange-600">Callback: {String(c.NextCallDate).slice(0, 10)}</span>}
                {c.Notes && <span className="truncate max-w-xs">{c.Notes}</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM, BookingId: bkgFilter }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">Log Welcome Call</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>
                    {b.BookingNo} — {b.ApplicantName} ({b.UnitNo})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Called By</label>
                <select value={form.CalledBy} onChange={(e) => setForm((f) => ({ ...f, CalledBy: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">— Self —</option>
                  {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Outcome</label>
                <select value={form.Outcome} onChange={(e) => setForm((f) => ({ ...f, Outcome: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="">Select outcome</option>
                  {OUTCOMES.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Call Date & Time</label>
                <input type="datetime-local" value={form.CallDate}
                  onChange={(e) => setForm((f) => ({ ...f, CallDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Duration (seconds)</label>
                <input type="number" value={form.DurationSeconds}
                  onChange={(e) => setForm((f) => ({ ...f, DurationSeconds: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="e.g. 180" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Schedule Next Call</label>
                <input type="date" value={form.NextCallDate}
                  onChange={(e) => setForm((f) => ({ ...f, NextCallDate: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Notes</label>
                <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                  rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM, BookingId: bkgFilter }); }}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Logging..." : "Log Call"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmWelcomeCall;
