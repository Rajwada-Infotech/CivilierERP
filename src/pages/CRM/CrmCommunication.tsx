import React, { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { useSearchParams } from "react-router-dom";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus, Phone, Mail, MessageSquare, MapPin, FileText, X, Search,
  Trash2, Cog, MessageCircle, ArrowDownLeft, ArrowUpRight,
  Clock, Building2, User, Target, IndianRupee, UserCheck, CalendarClock,
  Send, Pencil, Lock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContactActionBar } from "@/components/crm/ContactActionBar";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

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
function fmtTime(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
function fmtRelative(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return fmtTime(v);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
function dayLabel(v: string) {
  const d = new Date(v), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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

// Shared form body used by both the "Log Communication" create dialog and
// the edit dialog opened when a message bubble is clicked.
function LogForm({
  form, setForm, apps, bookings, lockLinkage, locked,
}: {
  form: typeof EMPTY_FORM; setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  apps: any[]; bookings: any[]; lockLinkage?: boolean; locked?: boolean;
}) {
  const inputCls = `w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40 disabled:opacity-60 ${locked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;
  const labelCls = "text-xs text-muted-foreground block mb-1.5";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Application</label>
          <select value={form.ApplicationId} disabled={lockLinkage || locked}
            onChange={(e) => setForm((f) => ({ ...f, ApplicationId: e.target.value }))}
            className={inputCls}>
            <option value="">—</option>
            {apps.map((a: any) => <option key={a.Id} value={String(a.Id)}>{a.ApplicationNo} — {a.ApplicantName}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Booking</label>
          <select value={form.BookingId} disabled={lockLinkage || locked}
            onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
            className={inputCls}>
            <option value="">—</option>
            {bookings.map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Channel</label>
          <select value={form.Channel} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, Channel: e.target.value }))}
            className={inputCls}>
            {CHANNELS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Direction</label>
          <select value={form.Direction} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, Direction: e.target.value }))}
            className={inputCls}>
            {DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Contacted At</label>
          <input type="datetime-local" value={form.ContactedAt} readOnly={locked} onChange={(e) => setForm((f) => ({ ...f, ContactedAt: e.target.value }))}
            className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Subject</label>
        <input type="text" value={form.Subject} readOnly={locked} onChange={(e) => setForm((f) => ({ ...f, Subject: e.target.value }))}
          className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Summary</label>
        <textarea value={form.Summary} readOnly={locked} onChange={(e) => setForm((f) => ({ ...f, Summary: e.target.value }))}
          rows={3} className={`${inputCls} resize-none`} />
      </div>
    </div>
  );
}

// Click any message bubble -> reach out directly (call/SMS/WhatsApp/email),
// edit its details in place, or remove it entirely. Also surfaces the
// related application/booking and engagement stats for real context.
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
  // Always opens on an existing log entry, so always opens locked.
  const [locked, setLocked] = useState(true);

  const relatedBooking = useMemo(() =>
    log.BookingId ? bookings.find((b) => b.Id === log.BookingId) : null,
    [bookings, log.BookingId]
  );
  const relatedApplication = useMemo(() =>
    log.ApplicationId ? apps.find((a) => a.Id === log.ApplicationId) : null,
    [apps, log.ApplicationId]
  );

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
      setLocked(true);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
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
      toast.error(translateError(e.message));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
            <span className="flex items-center gap-2">
              <MessageSquare size={16} className="text-amber-600 dark:text-amber-400" /> Communication Detail
            </span>
            {locked && (
              <button onClick={() => setLocked(false)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                <Pencil size={12} /> Edit
              </button>
            )}
          </DialogTitle>
        </DialogHeader>
        {locked && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5 -mt-1">
            <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-sm flex items-center justify-center shrink-0">
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

            {relatedBooking && (
              <div className="rounded-xl border border-border p-3.5">
                <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2"><Building2 size={13} /> Related Booking</h3>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div><span className="text-muted-foreground block">Booking No</span><span className="font-medium font-mono">{relatedBooking.BookingNo}</span></div>
                  <div><span className="text-muted-foreground block">Status</span><span className="font-medium">{relatedBooking.Status || "—"}</span></div>
                  <div><span className="text-muted-foreground block">Project</span><span className="font-medium">{relatedBooking.ProjectName || "—"}</span></div>
                  <div><span className="text-muted-foreground block">Unit</span><span className="font-medium">{relatedBooking.UnitNo || "—"}{relatedBooking.BlockName ? ` · ${relatedBooking.BlockName}` : ""}</span></div>
                  <div><span className="text-muted-foreground block">Total Value</span><span className="font-medium">{relatedBooking.GrandTotal ?? relatedBooking.TotalValue ? `₹${Number(relatedBooking.GrandTotal ?? relatedBooking.TotalValue).toLocaleString("en-IN")}` : "—"}</span></div>
                  <div><span className="text-muted-foreground block">Booking Date</span><span className="font-medium">{relatedBooking.BookingDate ? String(relatedBooking.BookingDate).slice(0, 10) : "—"}</span></div>
                </div>
              </div>
            )}

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

          <div className="space-y-4">
            <div className="rounded-xl border border-border p-3.5">
              <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground mb-2">
                <Clock size={13} /> Interaction Timeline {customerHistory.length > 0 && `(${customerHistory.length} other${customerHistory.length === 1 ? "" : "s"})`}
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                <div className="flex items-start gap-2 text-xs bg-amber-500/5 border border-amber-500/20 rounded-lg p-2">
                  {(() => { const CIcon = channelIcon[log.Channel] || MessageSquare; return <span className={`p-1 rounded-full shrink-0 ${channelStyle[log.Channel] || "bg-muted"}`}><CIcon size={11} /></span>; })()}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-amber-600 dark:text-amber-400">Currently editing</span>
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
              <LogForm form={form} setForm={setForm} apps={apps} bookings={bookings} lockLinkage locked={locked} />
            </div>

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
            {locked ? (
              <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
            ) : (
              <>
                <button onClick={() => { setLocked(true); onClose(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-1.5 text-sm text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-lg font-medium hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40">
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// One chat bubble in the thread. System entries (auto-logged workflow
// events like "agreement sent", "date proposed") render as centered pills,
// matching how messaging apps show system notices — everything else is a
// real bubble, right-aligned for Outbound (us -> customer), left-aligned
// for Inbound (customer -> us).
function MessageBubble({ log, onClick }: { log: any; onClick: () => void }) {
  const Icon = channelIcon[log.Channel] || MessageSquare;
  if (log.Channel === "System") {
    return (
      <button onClick={onClick} className="w-full flex justify-center py-1">
        <span className="flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-muted text-muted-foreground hover:bg-muted/70 max-w-[85%] truncate">
          <Cog size={10} className="shrink-0" /> {log.Summary || log.Subject || "System event"} · {fmtTime(log.ContactedAt)}
        </span>
      </button>
    );
  }
  const isOutbound = log.Direction !== "Inbound";
  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"} px-1`}>
      <button onClick={onClick}
        className={`group max-w-[70%] text-left rounded-xl px-2.5 py-1.5 shadow-sm transition-colors ${
          isOutbound
            ? "text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 rounded-br-sm hover:shadow-lg hover:shadow-amber-500/20"
            : "bg-muted text-foreground rounded-bl-sm hover:bg-muted/70"
        }`}>
        <div className={`flex items-center gap-1 text-[9px] mb-0.5 ${isOutbound ? "text-white/70" : "text-muted-foreground"}`}>
          <Icon size={9} /> {log.Channel}
        </div>
        {log.Subject && <div className="text-xs font-medium leading-snug">{log.Subject}</div>}
        {log.Summary && <div className="text-xs leading-snug whitespace-pre-wrap">{log.Summary}</div>}
        <div className={`flex items-center justify-end gap-1 text-[9px] mt-0.5 ${isOutbound ? "text-white/70" : "text-muted-foreground"}`}>
          {fmtTime(log.ContactedAt)}
          <Pencil size={8} className="opacity-0 group-hover:opacity-70 transition-opacity" />
        </div>
      </button>
    </div>
  );
}

const CrmCommunication: React.FC = () => {
  const qc = useQueryClient();
  usePageRights("crm-communication");
  const [sp, setSp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM, BookingId: bkgFilter });
  const [saving, setSaving] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [composer, setComposer] = useState({ Channel: "Call", Direction: "Outbound", Text: "" });
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: logs = [], isLoading } = useQuery({ queryKey: ["crm-communication"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: apps = [] } = useQuery({ queryKey: ["crm-applications"], queryFn: fetchApps, staleTime: 5 * 60_000 });

  const filterBooking = useMemo(() =>
    bkgFilter ? (bookings as any[]).find((b: any) => String(b.Id) === bkgFilter) : null,
    [bookings, bkgFilter]
  );

  // A booking's own ApplicationId (from the bookings list) is used to fold
  // a log entry that only carries BookingId into the same customer thread
  // as one carrying ApplicationId directly — otherwise the same person's
  // conversation could fork into two separate threads.
  const bookingAppId = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of bookings as any[]) if (b.ApplicationId) map.set(b.Id, b.ApplicationId);
    return map;
  }, [bookings]);

  // Group every log entry into one conversation per real-world customer —
  // the messaging-app "contact list" this page was missing.
  const conversations = useMemo(() => {
    const map = new Map<string, any>();
    for (const log of logs as any[]) {
      const resolvedAppId = log.ApplicationId || (log.BookingId ? bookingAppId.get(log.BookingId) : null) || null;
      const key = resolvedAppId ? `app-${resolvedAppId}` : log.BookingId ? `bkg-${log.BookingId}` : `log-${log.Id}`;
      if (!map.has(key)) {
        map.set(key, {
          key, ApplicationId: resolvedAppId, BookingId: log.BookingId,
          ApplicantName: log.ApplicantName, Mobile: log.Mobile, Email: log.Email,
          BookingNo: log.BookingNo, logs: [],
        });
      }
      const convo = map.get(key);
      convo.logs.push(log);
      // Prefer the richest identity info seen across all logs in the thread.
      if (!convo.Mobile && log.Mobile) convo.Mobile = log.Mobile;
      if (!convo.Email && log.Email) convo.Email = log.Email;
      if (!convo.BookingId && log.BookingId) convo.BookingId = log.BookingId;
      if (!convo.BookingNo && log.BookingNo) convo.BookingNo = log.BookingNo;
    }
    return Array.from(map.values())
      .map((c) => ({
        ...c,
        logs: c.logs.slice().sort((a: any, b: any) => new Date(a.ContactedAt).getTime() - new Date(b.ContactedAt).getTime()),
      }))
      .sort((a, b) => {
        const la = a.logs[a.logs.length - 1]?.ContactedAt, lb = b.logs[b.logs.length - 1]?.ContactedAt;
        return new Date(lb || 0).getTime() - new Date(la || 0).getTime();
      });
  }, [logs, bookingAppId]);

  const filteredConversations = useMemo(() => {
    let rows = conversations;
    if (bkgFilter) rows = rows.filter((c) => String(c.BookingId) === bkgFilter);
    if (threadSearch.trim()) {
      const q = threadSearch.trim().toLowerCase();
      rows = rows.filter((c) =>
        c.ApplicantName?.toLowerCase().includes(q) ||
        c.BookingNo?.toLowerCase().includes(q) ||
        c.Mobile?.includes(q)
      );
    }
    return rows;
  }, [conversations, bkgFilter, threadSearch]);

  // Auto-select the most recent conversation (or the booking-filtered one)
  // so the page never opens on an empty "pick something" state.
  useEffect(() => {
    if (activeKey && filteredConversations.some((c) => c.key === activeKey)) return;
    setActiveKey(filteredConversations[0]?.key || null);
  }, [filteredConversations, activeKey]);

  const activeConvo = useMemo(() =>
    filteredConversations.find((c) => c.key === activeKey) || null,
    [filteredConversations, activeKey]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [activeConvo?.logs?.length, activeKey]);

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
      const newKey = form.ApplicationId ? `app-${form.ApplicationId}` : form.BookingId ? `bkg-${form.BookingId}` : null;
      setForm({ ...EMPTY_FORM, BookingId: bkgFilter });
      await qc.invalidateQueries({ queryKey: ["crm-communication"] });
      if (newKey) setActiveKey(newKey);
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // Quick-send composer at the bottom of the active thread — the fast path
  // for logging a touchpoint without opening the full dialog, like typing a
  // message in a chat app instead of filling out a form every time.
  const handleQuickSend = async () => {
    if (!activeConvo || !composer.Text.trim()) return;
    setSending(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ApplicationId: activeConvo.ApplicationId || null,
          BookingId: activeConvo.BookingId || null,
          Channel: composer.Channel,
          Direction: composer.Direction,
          Summary: composer.Text.trim(),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setComposer((c) => ({ ...c, Text: "" }));
      qc.invalidateQueries({ queryKey: ["crm-communication"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSending(false);
    }
  };

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

  const relatedApp = useMemo(() =>
    activeConvo?.ApplicationId ? (apps as any[]).find((a) => a.Id === activeConvo.ApplicationId) : null,
    [apps, activeConvo]
  );

  // Group the active thread's messages into day buckets, like a real chat
  // app's date dividers.
  const dayGroups = useMemo(() => {
    if (!activeConvo) return [];
    const groups: { label: string; items: any[] }[] = [];
    for (const log of activeConvo.logs) {
      const label = dayLabel(log.ContactedAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(log);
      else groups.push({ label, items: [log] });
    }
    return groups;
  }, [activeConvo]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Communication"]} />
      <CrmShell
        title="CRM — Communication Log"
      subtitle={filterBooking ? `Showing only ${filterBooking.BookingNo} — ${filterBooking.ApplicantName}` : "Every touchpoint with a buyer, in one place"}
      action={
        <button onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 transition-all">
          <Plus size={14} /> New Conversation
        </button>
      }
    >
      {bkgFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
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

      {/* ── Messaging-app two-pane layout ── */}
      <div className="rounded-xl border border-amber-500/15 overflow-hidden bg-card" style={{ height: "min(680px, 75vh)" }}>
        <div className="flex h-full">
          {/* ══ LEFT: conversation list ══ */}
          <div className="w-[300px] shrink-0 border-r border-amber-500/15 flex flex-col">
            <div className="p-2.5 border-b border-amber-500/15">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={threadSearch} onChange={(e) => setThreadSearch(e.target.value)}
                  placeholder="Search conversations..."
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground text-xs">Loading...</div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-xs">No conversations yet</div>
              ) : filteredConversations.map((c) => {
                const last = c.logs[c.logs.length - 1];
                const LastIcon = channelIcon[last?.Channel] || MessageSquare;
                const isActive = c.key === activeKey;
                return (
                  <button key={c.key} onClick={() => setActiveKey(c.key)}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 border-b border-border/60 transition-colors ${isActive ? "bg-amber-500/10" : "hover:bg-muted/30"}`}>
                    <div className="w-9 h-9 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">
                      {initials(c.ApplicantName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-sm truncate ${isActive ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>{c.ApplicantName || c.BookingNo || "Unknown"}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{fmtRelative(last?.ContactedAt)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground truncate mt-0.5">
                        <LastIcon size={10} className="shrink-0" />
                        <span className="truncate">{last?.Summary || last?.Subject || last?.Channel}</span>
                      </div>
                    </div>
                    {c.logs.length > 1 && (
                      <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground mt-0.5">{c.logs.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ══ RIGHT: active thread ══ */}
          <div className="flex-1 flex flex-col min-w-0">
            {!activeConvo ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Select a conversation, or start a new one
              </div>
            ) : (
              <>
                {/* thread header */}
                <div className="px-4 py-2.5 border-b border-amber-500/15 flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">
                      {initials(activeConvo.ApplicantName)}
                    </div>
                    <div className="min-w-0">
                      <button onClick={() => setEditingLog(activeConvo.logs[activeConvo.logs.length - 1])}
                        className="text-sm font-semibold text-foreground truncate hover:underline block">
                        {activeConvo.ApplicantName || "Unknown"}
                      </button>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {activeConvo.Mobile || "No mobile"}{activeConvo.BookingNo ? ` · ${activeConvo.BookingNo}` : ""}{relatedApp?.Status ? ` · ${relatedApp.Status}` : ""}
                      </div>
                    </div>
                  </div>
                  <ContactActionBar
                    applicantName={activeConvo.ApplicantName || "Customer"}
                    mobile={activeConvo.Mobile || null}
                    email={activeConvo.Email || null}
                    onUsed={(channel) => setComposer((c) => ({ ...c, Channel: channel }))}
                    compact
                  />
                </div>

                {/* messages */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-muted/5">
                  {dayGroups.map((g) => (
                    <div key={g.label} className="space-y-2">
                      <div className="flex justify-center">
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground">{g.label}</span>
                      </div>
                      {g.items.map((log) => (
                        <MessageBubble key={log.Id} log={log} onClick={() => setEditingLog(log)} />
                      ))}
                    </div>
                  ))}
                </div>

                {/* quick-send composer — Channel + Direction grouped into one
                    labeled control (the old Direction toggle was two bare
                    arrow icons with no text, easy to misread/misclick) */}
                <div className="border-t border-amber-500/15 p-2.5 shrink-0 space-y-2 bg-muted/5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background pl-2 pr-1 py-1">
                      {(() => { const CIcon = channelIcon[composer.Channel] || MessageSquare; return <CIcon size={12} className="text-muted-foreground shrink-0" />; })()}
                      <select value={composer.Channel} onChange={(e) => setComposer((c) => ({ ...c, Channel: e.target.value }))}
                        className="text-xs bg-transparent focus:outline-none pr-1">
                        {CHANNELS.map((ch) => <option key={ch}>{ch}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-0.5 text-xs">
                      {DIRECTIONS.map((d) => (
                        <button key={d} onClick={() => setComposer((c) => ({ ...c, Direction: d }))}
                          title={d}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-all ${
                            composer.Direction === d ? "text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}>
                          {d === "Inbound" ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
                          {d === "Inbound" ? "In" : "Out"}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setDialogOpen(true)}
                      className="ml-auto text-[11px] text-muted-foreground hover:text-amber-600 flex items-center gap-1 shrink-0">
                      <FileText size={11} /> Full form
                    </button>
                  </div>
                  <div className="flex items-end gap-2">
                    <textarea value={composer.Text} onChange={(e) => setComposer((c) => ({ ...c, Text: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleQuickSend(); } }}
                      placeholder={`Log a ${composer.Channel.toLowerCase()} touchpoint...`}
                      rows={1} className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none max-h-24" />
                    <button onClick={handleQuickSend} disabled={sending || !composer.Text.trim()}
                      className="w-9 h-9 rounded-lg text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 flex items-center justify-center hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40 shrink-0 transition-all">
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM, BookingId: bkgFilter }); } }}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto p-4 sm:p-5 gap-3">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="flex items-center gap-2 text-base font-heading font-bold">
              <MessageSquare size={16} className="text-amber-500" /> Log Communication
            </DialogTitle>
          </DialogHeader>
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
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM, BookingId: bkgFilter }); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-heading font-semibold text-white shadow-sm bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
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
      </CrmShell>
    </>
  );
};

export default CrmCommunication;
