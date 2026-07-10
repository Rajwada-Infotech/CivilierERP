import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus, Phone, Mail, MessageSquare, MapPin, FileText, X, Search, ChevronRight,
  Trash2, Cog, MessageCircle, Copy, PhoneCall, ArrowDownLeft, ArrowUpRight,
  Clock, History, Building2, User, Target, IndianRupee, UserCheck, CalendarClock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/communication";
const BKG_API = "/api/crm/bookings";
const APP_API = "/api/crm/applications";

const CHANNELS = ["Call", "Email", "SMS", "WhatsApp", "InPerson", "Letter"];
const DIRECTIONS = ["Inbound", "Outbound"];
const channelIcon: Record<string, any> = { Call: Phone, Email: Mail, SMS: MessageSquare, WhatsApp: MessageCircle, InPerson: MapPin, Letter: FileText, System: Cog };
const channelStyle: Record<string, string> = {
  Call: "bg-emerald-500/10 text-emerald-600", Email: "bg-violet-500/10 text-violet-600",
  SMS: "bg-blue-500/10 text-blue-600", WhatsApp: "bg-green-500/10 text-green-600",
  InPerson: "bg-amber-500/10 text-amber-600", Letter: "bg-slate-500/10 text-slate-600",
  System: "bg-muted text-muted-foreground",
};

const EMPTY_FORM = { ApplicationId: "", BookingId: "", Channel: "Call", Direction: "Outbound", Subject: "", Summary: "", ContactedAt: "" };

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function fmtDateTime(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchApps(): Promise<any[]> {
  try { const r = await fetchWithAuth(APP_API); return r.ok ? r.json() : []; } catch { return []; }
}

// Indian mobile numbers stored as plain 10-digit strings (occasionally with a
// leading 0 or +91) — wa.me needs the bare country-code-prefixed digits.
function toWhatsAppNumber(mobile: string): string {
  const digits = mobile.replace(/\D/g, "").replace(/^0+/, "");
  return digits.startsWith("91") ? digits : `91${digits}`;
}

// "Call" has no reliable direct-dial affordance on desktop, so instead of a
// bare tel: link that silently does nothing there, this pops up the number
// with a tel: link (works when there IS a dialer, e.g. mobile/Teams/Skype-
// enabled desktops) plus a copy-to-clipboard fallback for manual dialing.
function CallDialog({ applicantName, mobile, onClose }: { applicantName: string; mobile: string; onClose: () => void }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(mobile);
    toast.success("Number copied");
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xs text-center">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center justify-center gap-1.5"><PhoneCall size={16} className="text-primary" /> Call {applicantName}</DialogTitle>
        </DialogHeader>
        <div className="py-3">
          <div className="text-2xl font-bold tracking-wide text-foreground">{mobile}</div>
          <p className="text-xs text-muted-foreground mt-1">On mobile, "Call Now" opens your dialer. On desktop, copy the number to dial manually.</p>
        </div>
        <div className="flex flex-col gap-2">
          <a href={`tel:${mobile}`}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 flex items-center justify-center gap-1.5">
            <PhoneCall size={14} /> Call Now
          </a>
          <button onClick={handleCopy}
            className="px-4 py-2 text-sm border border-border rounded-lg font-medium hover:bg-muted flex items-center justify-center gap-1.5">
            <Copy size={14} /> Copy Number
          </button>
          <a href={`sms:${mobile}`}
            className="px-4 py-2 text-sm border border-border rounded-lg font-medium hover:bg-muted flex items-center justify-center gap-1.5">
            <MessageSquare size={14} /> Send SMS Instead
          </a>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground pt-1">Close</button>
      </DialogContent>
    </Dialog>
  );
}

// Direct-contact buttons: Call / SMS / WhatsApp / Email, straight to the
// customer's real number/address — no separate lookup, no leaving the page.
// Optionally reports which channel was used back to the caller so the log
// form can reflect it automatically.
function ContactActionBar({
  applicantName, mobile, email, onUsed,
}: { applicantName: string; mobile: string | null; email: string | null; onUsed?: (channel: string) => void }) {
  const [calling, setCalling] = useState(false);
  if (!mobile && !email) return null;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {mobile && (
          <button onClick={() => { setCalling(true); onUsed?.("Call"); }}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium hover:bg-emerald-100">
            <Phone size={13} /> Call
          </button>
        )}
        {mobile && (
          <a href={`sms:${mobile}`} onClick={() => onUsed?.("SMS")}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-medium hover:bg-blue-100">
            <MessageSquare size={13} /> SMS
          </a>
        )}
        {mobile && (
          <a href={`https://wa.me/${toWhatsAppNumber(mobile)}`} target="_blank" rel="noreferrer" onClick={() => onUsed?.("WhatsApp")}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-700 font-medium hover:bg-green-100">
            <MessageCircle size={13} /> WhatsApp
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} onClick={() => onUsed?.("Email")}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 font-medium hover:bg-violet-100">
            <Mail size={13} /> Email
          </a>
        )}
      </div>
      {calling && mobile && <CallDialog applicantName={applicantName} mobile={mobile} onClose={() => setCalling(false)} />}
    </>
  );
}

// Shared form body used by both the "Log Communication" create dialog and
// the edit dialog opened when a log entry is clicked.
function LogForm({
  form, setForm, apps, bookings, lockLinkage,
}: {
  form: typeof EMPTY_FORM; setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  apps: any[]; bookings: any[]; lockLinkage?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Application</label>
          <select value={form.ApplicationId} disabled={lockLinkage}
            onChange={(e) => setForm((f) => ({ ...f, ApplicationId: e.target.value }))}
            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background disabled:opacity-60">
            <option value="">—</option>
            {apps.map((a: any) => <option key={a.Id} value={String(a.Id)}>{a.ApplicationNo} — {a.ApplicantName}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Booking</label>
          <select value={form.BookingId} disabled={lockLinkage}
            onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background disabled:opacity-60">
            <option value="">—</option>
            {bookings.map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Channel</label>
          <select value={form.Channel} onChange={(e) => setForm((f) => ({ ...f, Channel: e.target.value }))}
            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
            {CHANNELS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Direction</label>
          <select value={form.Direction} onChange={(e) => setForm((f) => ({ ...f, Direction: e.target.value }))}
            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
            {DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Contacted At</label>
        <input type="datetime-local" value={form.ContactedAt} onChange={(e) => setForm((f) => ({ ...f, ContactedAt: e.target.value }))}
          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Subject</label>
        <input type="text" value={form.Subject} onChange={(e) => setForm((f) => ({ ...f, Subject: e.target.value }))}
          className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Summary</label>
        <textarea value={form.Summary} onChange={(e) => setForm((f) => ({ ...f, Summary: e.target.value }))}
          rows={3} className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background resize-none" />
      </div>
    </div>
  );
}

// Click any logged touchpoint -> reach out directly (call/SMS/WhatsApp/
// email), edit its details in place, or remove it entirely. Also surfaces
// the related booking and the customer's most recent other interactions so
// staff have real context instead of an isolated, disconnected form.
function EditLogDialog({
  log, apps, bookings, allLogs, onClose, onSaved,
}: { log: any; apps: any[]; bookings: any[]; allLogs: any[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    ApplicationId: log.ApplicationId ? String(log.ApplicationId) : "",
    BookingId: log.BookingId ? String(log.BookingId) : "",
    Channel: log.Channel || "Call",
    Direction: log.Direction || "Outbound",
    Subject: log.Subject || "",
    Summary: log.Summary || "",
    ContactedAt: log.ContactedAt ? String(log.ContactedAt).slice(0, 16) : "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const relatedBooking = useMemo(() =>
    log.BookingId ? bookings.find((b) => b.Id === log.BookingId) : null,
    [bookings, log.BookingId]
  );
  const relatedApplication = useMemo(() =>
    log.ApplicationId ? apps.find((a) => a.Id === log.ApplicationId) : null,
    [apps, log.ApplicationId]
  );

  // Every other touchpoint with this same customer — a real running timeline,
  // not just a "recent few" teaser, so the full contact history is visible
  // without leaving this dialog.
  const customerHistory = useMemo(() => {
    const key = log.ApplicationId || null;
    if (!key) return [];
    return allLogs
      .filter((l) => l.ApplicationId === key && l.Id !== log.Id)
      .sort((a, b) => new Date(b.ContactedAt).getTime() - new Date(a.ContactedAt).getTime());
  }, [allLogs, log.ApplicationId, log.Id]);

  const historyStats = useMemo(() => {
    if (!customerHistory.length) return null;
    const dates = customerHistory.map((l) => new Date(l.ContactedAt).getTime());
    return {
      total: customerHistory.length + 1,
      first: new Date(Math.min(...dates, new Date(log.ContactedAt).getTime())),
      last: new Date(Math.max(...dates, new Date(log.ContactedAt).getTime())),
    };
  }, [customerHistory, log.ContactedAt]);

  const budgetRange = relatedApplication && (relatedApplication.BudgetMin || relatedApplication.BudgetMax)
    ? `₹${Number(relatedApplication.BudgetMin || 0).toLocaleString("en-IN")} – ₹${Number(relatedApplication.BudgetMax || 0).toLocaleString("en-IN")}`
    : null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${log.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Channel: form.Channel, Direction: form.Direction, Subject: form.Subject,
          Summary: form.Summary, ContactedAt: form.ContactedAt || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Communication log updated");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`${API}/${log.Id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Log entry removed");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <MessageSquare size={16} className="text-primary" /> Communication Detail
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ══════════════ LEFT: Customer, Application, Booking, Stats ══════════════ */}
          <div className="space-y-4">
            {/* ── Customer identity + direct contact actions ── */}
            <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-primary/15 text-primary font-bold text-sm flex items-center justify-center shrink-0">
                    {initials(log.ApplicantName)}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground block">{log.ApplicantName || "Unknown"}</span>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {log.Mobile || "No mobile"}{relatedApplication?.AltMobile ? ` / ${relatedApplication.AltMobile}` : ""}
                    </div>
                    {log.Email && <div className="text-xs text-muted-foreground">{log.Email}</div>}
                  </div>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 shrink-0 ${form.Direction === "Inbound" ? "bg-sky-500/10 text-sky-600" : "bg-orange-500/10 text-orange-600"}`}>
                  {form.Direction === "Inbound" ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />} {form.Direction}
                </span>
              </div>
              <ContactActionBar
                applicantName={log.ApplicantName || "Customer"}
                mobile={log.Mobile || null}
                email={log.Email || null}
                onUsed={(channel) => setForm((f) => ({ ...f, Channel: channel, Direction: "Outbound" }))}
              />
            </div>

            {/* ── Full applicant profile ── */}
            {relatedApplication && (
              <div className="rounded-xl border border-border p-3.5">
                <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><User size={13} /> Applicant Profile</h3>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div><span className="text-muted-foreground block">Application No</span><span className="font-medium font-mono">{relatedApplication.ApplicationNo || "—"}</span></div>
                  <div><span className="text-muted-foreground block">Status</span><span className="font-medium">{relatedApplication.Status || "—"}</span></div>
                  <div><span className="text-muted-foreground block flex items-center gap-1"><Target size={10} /> Source</span><span className="font-medium">{relatedApplication.Source || "—"}</span></div>
                  <div><span className="text-muted-foreground block flex items-center gap-1"><UserCheck size={10} /> Assigned To</span><span className="font-medium">{relatedApplication.AssigneeName || "—"}</span></div>
                  <div><span className="text-muted-foreground block">Interested In</span><span className="font-medium">{relatedApplication.InterestedProject || relatedApplication.ProjectMasterName || "—"}{relatedApplication.InterestedUnit ? ` (${relatedApplication.InterestedUnit})` : ""}</span></div>
                  {budgetRange && (
                    <div><span className="text-muted-foreground block flex items-center gap-1"><IndianRupee size={10} /> Budget</span><span className="font-medium">{budgetRange}</span></div>
                  )}
                </div>
              </div>
            )}

            {/* ── Related booking ── */}
            {relatedBooking && (
              <div className="rounded-xl border border-border p-3.5">
                <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><Building2 size={13} /> Related Booking</h3>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div><span className="text-muted-foreground block">Booking No</span><span className="font-medium font-mono">{relatedBooking.BookingNo}</span></div>
                  <div><span className="text-muted-foreground block">Status</span><span className="font-medium">{relatedBooking.Status || "—"}</span></div>
                  <div><span className="text-muted-foreground block">Project</span><span className="font-medium">{relatedBooking.ProjectName || "—"}</span></div>
                  <div><span className="text-muted-foreground block">Unit</span><span className="font-medium">{relatedBooking.UnitNo || "—"}{relatedBooking.BlockName ? ` · ${relatedBooking.BlockName}` : ""}</span></div>
                  <div><span className="text-muted-foreground block">Total Value</span><span className="font-medium">{relatedBooking.TotalValue ? `₹${Number(relatedBooking.TotalValue).toLocaleString("en-IN")}` : "—"}</span></div>
                  <div><span className="text-muted-foreground block">Booking Date</span><span className="font-medium">{relatedBooking.BookingDate ? String(relatedBooking.BookingDate).slice(0, 10) : "—"}</span></div>
                </div>
              </div>
            )}

            {/* ── Engagement stats ── */}
            {historyStats && (
              <div className="rounded-xl border border-border p-3.5">
                <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><CalendarClock size={13} /> Engagement Summary</h3>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted-foreground block">Total Touchpoints</span><span className="font-medium">{historyStats.total}</span></div>
                  <div><span className="text-muted-foreground block">First Contacted</span><span className="font-medium">{historyStats.first.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
                  <div><span className="text-muted-foreground block">Last Contacted</span><span className="font-medium">{historyStats.last.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* ══════════════ RIGHT: Full interaction timeline + edit form ══════════════ */}
          <div className="space-y-4">
            {/* ── Full interaction timeline ── */}
            <div className="rounded-xl border border-border p-3.5">
              <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2">
                <History size={13} /> Interaction Timeline {customerHistory.length > 0 && `(${customerHistory.length} other${customerHistory.length === 1 ? "" : "s"})`}
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {/* current entry, pinned at top */}
                <div className="flex items-start gap-2 text-xs bg-primary/5 border border-primary/20 rounded-lg p-2">
                  {(() => { const CIcon = channelIcon[log.Channel] || MessageSquare; return <span className={`p-1 rounded-full shrink-0 ${channelStyle[log.Channel] || "bg-muted"}`}><CIcon size={11} /></span>; })()}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-primary">Currently editing</span>
                      <span className="text-muted-foreground shrink-0">{fmtDateTime(log.ContactedAt)}</span>
                    </div>
                    <div className="truncate">{log.Subject || log.Channel}</div>
                    {log.Summary && <div className="text-muted-foreground truncate">{log.Summary}</div>}
                  </div>
                </div>
                {customerHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No other interactions recorded with this customer yet.</p>
                ) : customerHistory.map((r) => {
                  const RIcon = channelIcon[r.Channel] || MessageSquare;
                  return (
                    <div key={r.Id} className="flex items-start gap-2 text-xs border-b border-border last:border-0 pb-2">
                      <span className={`p-1 rounded-full shrink-0 ${channelStyle[r.Channel] || "bg-muted text-muted-foreground"}`}><RIcon size={11} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium flex items-center gap-1">
                            {r.Channel}
                            {r.Direction === "Inbound" ? <ArrowDownLeft size={10} className="text-sky-600" /> : <ArrowUpRight size={10} className="text-orange-600" />}
                          </span>
                          <span className="text-muted-foreground shrink-0">{fmtDateTime(r.ContactedAt)}</span>
                        </div>
                        {r.Subject && <div className="truncate">{r.Subject}</div>}
                        {r.Summary && <div className="text-muted-foreground truncate">{r.Summary}</div>}
                        <div className="text-muted-foreground">By {r.CreatedByName || (r.Channel === "System" ? "System" : "—")}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground mb-3"><FileText size={14} /> Log Details</h3>
              <LogForm form={form} setForm={setForm} apps={apps} bookings={bookings} lockLinkage />
            </div>

            {/* ── Metadata ── */}
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 px-1">
              <Clock size={11} /> Logged by <span className="font-medium">{log.CreatedByName || (log.Channel === "System" ? "System" : "—")}</span> on {fmtDateTime(log.CreatedAt)}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-border">
          <button onClick={handleDelete} disabled={deleting}
            className="text-xs px-3 py-1.5 border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-40 flex items-center gap-1">
            <Trash2 size={13} /> {deleting ? "Removing..." : "Delete"}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CrmCommunication: React.FC = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM, BookingId: bkgFilter });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");

  const { data: logs = [], isLoading } = useQuery({ queryKey: ["crm-communication"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: apps = [] } = useQuery({ queryKey: ["crm-applications"], queryFn: fetchApps, staleTime: 5 * 60_000 });

  const filterBooking = useMemo(() =>
    bkgFilter ? (bookings as any[]).find((b: any) => String(b.Id) === bkgFilter) : null,
    [bookings, bkgFilter]
  );

  // Resolve the customer behind whatever the create-dialog form currently
  // has selected, so the quick-contact bar works there too, before anything
  // has even been logged yet.
  const selectedContact = useMemo(() => {
    if (form.BookingId) {
      const b = (bookings as any[]).find((x) => String(x.Id) === form.BookingId);
      if (b) return { name: b.ApplicantName, mobile: b.Mobile || null, email: b.Email || null };
    }
    if (form.ApplicationId) {
      const a = (apps as any[]).find((x) => String(x.Id) === form.ApplicationId);
      if (a) return { name: a.ApplicantName, mobile: a.Mobile || null, email: a.Email || null };
    }
    return null;
  }, [form.ApplicationId, form.BookingId, apps, bookings]);

  const filteredLogs = useMemo(() => {
    let rows = logs as any[];
    if (bkgFilter) rows = rows.filter((c) => String(c.BookingId) === bkgFilter);
    if (channelFilter) rows = rows.filter((c) => c.Channel === channelFilter);
    if (directionFilter) rows = rows.filter((c) => c.Direction === directionFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) =>
        c.ApplicantName?.toLowerCase().includes(q) ||
        c.BookingNo?.toLowerCase().includes(q) ||
        c.Subject?.toLowerCase().includes(q) ||
        c.Summary?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [logs, bkgFilter, channelFilter, directionFilter, search]);

  const stats = useMemo(() => {
    const rows = logs as any[];
    const weekAgo = Date.now() - 7 * 86400000;
    return {
      total: rows.length,
      calls: rows.filter((c) => c.Channel === "Call").length,
      emails: rows.filter((c) => c.Channel === "Email").length,
      messages: rows.filter((c) => c.Channel === "SMS" || c.Channel === "WhatsApp").length,
      thisWeek: rows.filter((c) => new Date(c.ContactedAt).getTime() >= weekAgo).length,
    };
  }, [logs]);

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

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total Logged", value: stats.total, dot: "bg-blue-400" },
          { label: "Calls", value: stats.calls, dot: "bg-emerald-500" },
          { label: "Emails", value: stats.emails, dot: "bg-violet-500" },
          { label: "SMS / WhatsApp", value: stats.messages, dot: "bg-green-500" },
          { label: "This Week", value: stats.thisWeek, dot: "bg-amber-500" },
        ].map(({ label, value, dot }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className={`w-2 h-2 rounded-full ${dot} mb-3`} />
            <p className="text-2xl font-bold font-heading text-foreground leading-none">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer, booking, subject..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="">All Channels</option>
          {CHANNELS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="">All Directions</option>
          {DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">No communications logged</div>
        ) : (filteredLogs as any[]).map((c: any) => {
          const Icon = channelIcon[c.Channel] || MessageSquare;
          const booking = c.BookingId ? (bookings as any[]).find((b) => b.Id === c.BookingId) : null;
          return (
            <button
              key={c.Id}
              onClick={() => setEditingLog(c)}
              className="w-full text-left rounded-lg border border-border p-3 flex items-start gap-3 hover:bg-muted/10 hover:border-primary/40 transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-full bg-primary/15 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                {initials(c.ApplicantName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{c.ApplicantName || c.BookingNo || "—"}</span>
                    <span className={`shrink-0 p-1 rounded-full ${channelStyle[c.Channel] || "bg-muted text-muted-foreground"}`}><Icon size={11} /></span>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${c.Direction === "Inbound" ? "bg-sky-500/10 text-sky-600" : "bg-orange-500/10 text-orange-600"}`}>
                      {c.Direction === "Inbound" ? <ArrowDownLeft size={9} /> : <ArrowUpRight size={9} />} {c.Direction || "—"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{fmtDateTime(c.ContactedAt)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {c.Channel}{c.Subject ? ` · ${c.Subject}` : ""}
                  {booking && ` · ${booking.ProjectName || ""}${booking.UnitNo ? ` (${booking.UnitNo})` : ""}`}
                </div>
                {c.Summary && <p className="text-sm mt-1 truncate">{c.Summary}</p>}
                <div className="text-xs text-muted-foreground mt-1">By {c.CreatedByName || (c.Channel === "System" ? "System" : "—")}</div>
              </div>
              <ChevronRight size={14} className="text-muted-foreground shrink-0 mt-2" />
            </button>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM, BookingId: bkgFilter }); } }}>
        <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">Log Communication</DialogTitle></DialogHeader>
          <LogForm form={form} setForm={setForm} apps={apps as any[]} bookings={bookings as any[]} />
          {selectedContact && (
            <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Reach {selectedContact.name} directly:</p>
              <ContactActionBar
                applicantName={selectedContact.name}
                mobile={selectedContact.mobile}
                email={selectedContact.email}
                onUsed={(channel) => setForm((f) => ({ ...f, Channel: channel }))}
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM, BookingId: bkgFilter }); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Logging..." : "Log"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {editingLog && (
        <EditLogDialog
          log={editingLog}
          apps={apps as any[]}
          bookings={bookings as any[]}
          allLogs={logs as any[]}
          onClose={() => setEditingLog(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["crm-communication"] })}
        />
      )}
    </SalesAutoShell>
  );
};

export default CrmCommunication;
