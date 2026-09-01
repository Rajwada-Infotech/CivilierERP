import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus, CheckSquare, Square, ClipboardCheck, ArrowRight,
  AlertCircle, CheckCircle2, Loader2,
  Lock, ShieldCheck, ShieldAlert, FileWarning, Building2,
  ChevronRight, Circle, CreditCard, Camera,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { promptNextStep } from "@/lib/workflowNav";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const API = "/api/crm/pre-possession";

const MANUAL_CHECKS = [
  { key: "DocumentationCheck",     label: "Documentation Complete",      Icon: FileWarning },
  { key: "QualityInspectionCheck", label: "Quality Inspection Passed",   Icon: ShieldCheck },
  { key: "UtilityReadinessCheck",  label: "Utility Readiness Confirmed", Icon: Building2 },
] as const;

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; strip: string }> = {
  Pending:    { label: "Pending",     bg: "bg-orange-50",  text: "text-orange-700", border: "border-orange-200", strip: "bg-orange-400" },
  InProgress: { label: "In Progress", bg: "bg-blue-50",    text: "text-blue-700",   border: "border-blue-200",   strip: "bg-blue-500"   },
  Ready:      { label: "Ready",       bg: "bg-green-50",   text: "text-green-700",  border: "border-green-200",  strip: "bg-green-500"  },
  Blocked:    { label: "Blocked",     bg: "bg-red-50",     text: "text-red-700",    border: "border-red-200",    strip: "bg-red-500"    },
};


async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
  return r.json();
}
async function fetchGatewayStatus(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/gateway-status`);
  if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error || `HTTP ${r.status}`); }
  return r.json();
}
async function fetchEligibleBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}

// ── Gate chain sub-step pill ──────────────────────────────────────────────────
function SubStepPill({ pass, label }: { pass: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium ${
      pass ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-600 border-red-200"
    }`}>
      {pass ? <CheckCircle2 size={9} /> : <Lock size={9} />}
      {label}
    </span>
  );
}

// ── Inline-editable check card ────────────────────────────────────────────────
interface CheckCardProps {
  c: any;
  checkLoading: Record<string, boolean>;
  onToggle: (record: any, field: string, current: boolean) => void;
  onSaved: () => void;
  navigate: ReturnType<typeof useNavigate>;
}
function CheckCard({ c, checkLoading, onToggle, onSaved, navigate }: CheckCardProps) {
  const [sdt,    setSdt]    = useState<string>(c.ScheduledInspectionDate?.slice(0, 10) ?? "");
  const [icd,    setIcd]    = useState<string>(c.InspectionCompletedDate?.slice(0, 10) ?? "");
  const [notes,  setNotes]  = useState<string>(c.Notes ?? "");
  const [saving, setSaving] = useState(false);

  // Patch a single field on blur so the user doesn't have to click Save
  const patch = async (patch: Record<string, string | null>) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${c.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };

  const duesCleared = c.DuesClearedCheck === 1;
  const outstanding = c.OutstandingDemandCount ?? 0;
  const st = STATUS_CONFIG[c.Status] ?? STATUS_CONFIG.Pending;
  const doneCount = (duesCleared ? 1 : 0) + MANUAL_CHECKS.filter((ch) => !!c[ch.key]).length;
  const pct = Math.round((doneCount / 4) * 100);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className={`h-1 w-full ${st.strip}`} />
      <div className="p-4 space-y-3">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold truncate">{c.ApplicantName}</div>
            <div className="text-xs text-muted-foreground">{c.BookingNo} · {c.UnitNo}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saving && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${st.bg} ${st.text} ${st.border}`}>
              {st.label}
            </span>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{doneCount} of 4 checks complete</span>
            <span className={pct === 100 ? "text-green-600 font-semibold" : ""}>{pct}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Inline dates */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Inspection Scheduled</label>
            <input type="date" value={sdt}
              onChange={(e) => setSdt(e.target.value)}
              onBlur={(e) => patch({ ScheduledInspectionDate: e.target.value || null })}
              className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Inspection Completed</label>
            <input type="date" value={icd}
              onChange={(e) => setIcd(e.target.value)}
              onBlur={(e) => patch({ InspectionCompletedDate: e.target.value || null })}
              className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>

        {/* Checklist */}
        <div className="space-y-1 pt-2 border-t border-border">
          {/* Dues — auto-derived */}
          <div className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg ${duesCleared ? "bg-green-50" : "bg-red-50"}`}>
            {duesCleared
              ? <CheckCircle2 size={15} className="text-green-600 shrink-0" />
              : <AlertCircle  size={15} className="text-red-500  shrink-0" />}
            <CreditCard size={12} className={`shrink-0 ${duesCleared ? "text-green-600" : "text-red-500"}`} />
            <span className={`flex-1 text-sm font-medium ${duesCleared ? "text-green-700" : "text-red-700"}`}>Dues Cleared</span>
            <span className="text-xs text-muted-foreground italic flex items-center gap-1.5">
              {duesCleared
                ? "Auto · all clear"
                : <>
                    {outstanding} outstanding
                    <button onClick={() => navigate(`/crm/payments?bookingId=${c.BookingId}`)}
                      className="text-blue-600 hover:underline font-medium not-italic">View →</button>
                  </>}
            </span>
          </div>

          {MANUAL_CHECKS.map(({ key, label, Icon }) => {
            const loadKey = `${c.Id}:${key}`;
            const isLoadingThis = !!checkLoading[loadKey];
            const isChecked = !!c[key];
            return (
              <button key={key}
                onClick={() => onToggle(c, key, isChecked)}
                disabled={isLoadingThis}
                className={`flex items-center gap-2 text-sm w-full text-left rounded-lg px-2 py-1.5 transition-all disabled:opacity-60 disabled:cursor-wait ${
                  isChecked ? "bg-green-50 hover:bg-green-100" : "hover:bg-muted/60"
                }`}>
                {isLoadingThis
                  ? <Loader2    size={15} className="animate-spin text-muted-foreground shrink-0" />
                  : isChecked
                    ? <CheckSquare size={15} className="text-green-600 shrink-0" />
                    : <Square      size={15} className="text-muted-foreground shrink-0" />}
                <Icon size={12} className={`shrink-0 ${isChecked ? "text-green-600" : "text-muted-foreground"}`} />
                <span className={`font-medium ${isChecked ? "text-green-700" : "text-foreground"}`}>{label}</span>
                {isChecked && <CheckCircle2 size={12} className="ml-auto text-green-500" />}
              </button>
            );
          })}
        </div>

        {/* Inline notes */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Notes</label>
          <textarea value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={(e) => { if (e.target.value !== (c.Notes ?? "")) patch({ Notes: e.target.value || null }); }}
            rows={2} placeholder="Add inspection remarks…"
            className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary text-muted-foreground placeholder:text-muted-foreground/50" />
        </div>

        {/* CTA when Ready */}
        {c.Status === "Ready" && (
          <button onClick={() => navigate(`/crm/possession-notice?bookingId=${c.BookingId}&open=1`)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm shadow-green-600/20">
            <Camera size={14} /> Send Possession Notice →
          </button>
        )}
        {doneCount === 3 && c.Status !== "Ready" && (
          <div className="text-xs text-center text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 font-medium">
            1 check remaining — almost ready!
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────
interface CreateDialogProps {
  onClose: () => void;
  onCreated: () => void;
  onViewGateway: () => void;
  prefillBookingId?: string;
}
function CreateDialog({ onClose, onCreated, onViewGateway, prefillBookingId }: CreateDialogProps) {
  const [bookingId, setBookingId] = useState(prefillBookingId ?? "");
  const [scheduledDate, setScheduledDate] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: eligible = [], isFetching } = useQuery({
    queryKey: ["crm-pre-possession-eligible"],
    queryFn: fetchEligibleBookings,
    staleTime: 0,
  });

  const handleCreate = async () => {
    if (!bookingId) { toast.error("Select a booking"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId), ScheduledInspectionDate: scheduledDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Pre-possession check started");
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Start Pre-Possession Check</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
            {isFetching ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Loading eligible bookings…
              </p>
            ) : (eligible as any[]).length === 0 ? (
              <div className="text-xs bg-amber-50 border border-amber-200 rounded px-3 py-2.5 space-y-2">
                <p className="font-semibold text-amber-800 flex items-center gap-1.5">
                  <ShieldAlert size={13} /> No eligible bookings
                </p>
                <p className="text-amber-700">Both gates must pass before a check can be started:</p>
                <ul className="space-y-1 text-amber-700">
                  <li className="flex items-start gap-1.5">
                    <Circle size={5} className="mt-1.5 shrink-0 fill-amber-500 text-amber-500" />
                    <span><strong>Gate 1 — AFS Registered:</strong> AFS Query Payment confirmed → AFS Registry visit completed → Agreement marked Registered</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Circle size={5} className="mt-1.5 shrink-0 fill-amber-500 text-amber-500" />
                    <span><strong>Gate 2 — OC/CC Received:</strong> project must have a received occupancy certificate</span>
                  </li>
                </ul>
                <button onClick={() => { onClose(); onViewGateway(); }}
                  className="flex items-center gap-1 text-blue-600 hover:underline text-xs pt-0.5">
                  View Gateway Status — see which step is blocking each booking <ChevronRight size={11} />
                </button>
              </div>
            ) : (
              <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(eligible as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>
                    {b.BookingNo} — {b.ApplicantName} ({b.UnitNo})
                  </option>
                ))}
              </select>
            )}
          </div>
          {(eligible as any[]).length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Scheduled Inspection Date</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button onClick={handleCreate}
            disabled={saving || !bookingId || (eligible as any[]).length === 0}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Starting…" : "Start Check"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Gateway row ───────────────────────────────────────────────────────────────
function GatewayRow({ g, onStartCheck, navigate }: { g: any; onStartCheck: (bookingId: string) => void; navigate: any }) {
  const g0  = !!g.Gate0_AgreementExecuted;   // Agreement Executed/Registered
  const g1a = !!g.Gate1a_AfsQueryPayment;    // AFS Query Payment Confirmed
  const g1b = !!g.Gate1b_AfsRegistryCompleted; // AFS Registry Completed
  const g1  = !!g.Gate1_AfsRegistered;       // Agreement Registered
  const g2  = !!g.Gate2_OcCcReceived;
  const allPass = g1 && g2;

  // Deep-link to the first failing step
  const g1FixPath = !g0
    ? `/crm/agreements?bookingId=${g.BookingId}`
    : !g1a
      ? `/crm/afs-query-payment?bookingId=${g.BookingId}`
      : !g1b
        ? `/crm/afs-registry?bookingId=${g.BookingId}`
        : `/crm/agreements?bookingId=${g.BookingId}`;

  const agreementStatusLabel = g.AgreementStatus ? `(${g.AgreementStatus})` : "(no agreement)";
  const afsQpLabel           = g.AfsQpStatus     ? `(${g.AfsQpStatus})`     : "(none)";
  const afsRegLabel          = g.AfsRegStatus    ? `(${g.AfsRegStatus})`    : "(none)";

  return (
    <div className={`px-4 py-3 ${allPass ? "bg-green-50/40" : "bg-card"}`}>
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${allPass ? "bg-green-500" : "bg-amber-400"}`} />
        <div className="min-w-0 flex-1">
          {/* Booking identity */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{g.BookingNo}</span>
            <span className="text-xs text-muted-foreground">{g.UnitNo}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground truncate">{g.ApplicantName}</span>
          </div>

          {/* Gate 1 full chain */}
          <div className="flex items-center gap-1 flex-wrap mt-1.5">
            <span className="text-xs text-muted-foreground mr-0.5 shrink-0">Gate 1:</span>
            <SubStepPill pass={g0}  label={g0 ? "Agr. Executed" : `Agr. Executed ${agreementStatusLabel}`} />
            <ChevronRight size={9} className="text-muted-foreground shrink-0" />
            <SubStepPill pass={g1a} label={g1a ? "AFS Payment" : `AFS Payment ${afsQpLabel}`} />
            <ChevronRight size={9} className="text-muted-foreground shrink-0" />
            <SubStepPill pass={g1b} label={g1b ? "Registry Visit" : `Registry Visit ${afsRegLabel}`} />
            <ChevronRight size={9} className="text-muted-foreground shrink-0" />
            <SubStepPill pass={g1}  label="Agr. Registered" />
            {!g1 && (
              <button onClick={() => navigate(g1FixPath)}
                className="ml-1 text-xs text-blue-600 hover:underline flex items-center gap-0.5 font-medium shrink-0">
                Fix <ChevronRight size={10} />
              </button>
            )}
          </div>

          {/* Gate 2 */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-muted-foreground mr-0.5 shrink-0">Gate 2:</span>
            <SubStepPill pass={g2} label="OC/CC Received" />
            {!g2 && (
              <button onClick={() => navigate("/crm/oc-cc")}
                className="ml-1 text-xs text-blue-600 hover:underline flex items-center gap-0.5 font-medium">
                Enter OC/CC <ChevronRight size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Inline Start Check if fully eligible */}
        {allPass && (
          <button
            onClick={() => onStartCheck(String(g.BookingId))}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            <Plus size={11} /> Start
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const CrmPrePossession: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  usePageRights("crm-pre-possession");

  const [createOpen,      setCreateOpen]      = useState(false);
  const [createPrefillId, setCreatePrefillId] = useState<string | undefined>(undefined);
  const [checkLoading,    setCheckLoading]    = useState<Record<string, boolean>>({});
  const [activeTab,       setActiveTab]       = useState<"checks" | "gateway">("checks");

  const { data: records = [], isLoading, isError, error, dataUpdatedAt, isFetching, refetch } =
    useQuery({ queryKey: ["crm-pre-possession"], queryFn: fetchAll, staleTime: 30_000 });

  const { data: gateway = [], isLoading: gwLoading, isError: gwError, error: gwErrorMsg, refetch: gwRefetch } =
    useQuery({ queryKey: ["crm-pre-possession-gateway"], queryFn: fetchGatewayStatus, staleTime: 30_000 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["crm-pre-possession"] });
    qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
    qc.invalidateQueries({ queryKey: ["crm-pre-possession-eligible"] });
    qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  };

  const toggleCheck = async (record: any, field: string, current: boolean) => {
    const loadKey = `${record.Id}:${field}`;
    if (checkLoading[loadKey]) return;
    setCheckLoading((prev) => ({ ...prev, [loadKey]: true }));
    try {
      const res = await fetchWithAuth(`${API}/${record.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      invalidate();
      if (data?.status === "Ready") {
        promptNextStep(navigate, "All checks cleared — ready to send the Possession Notice.", "/crm/possession-notice", "Go to Possession Notice");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setCheckLoading((prev) => ({ ...prev, [loadKey]: false }));
    }
  };

  const openCreate = (prefillId?: string) => {
    setCreatePrefillId(prefillId);
    setCreateOpen(true);
  };

  const handleRefresh = () => { refetch(); gwRefetch(); };

  // Counts
  const total     = (records as any[]).length;
  const ready     = (records as any[]).filter((r: any) => r.Status === "Ready").length;
  const pending   = (records as any[]).filter((r: any) => r.Status === "Pending").length;
  const gwTotal   = (gateway as any[]).length;
  const gwElig    = (gateway as any[]).filter((g: any) => g.Gate1_AfsRegistered && g.Gate2_OcCcReceived).length;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Pre-Possession Check"]} />
      <CrmShell
        title="Pre-Possession Check"
        subtitle="All four checks must pass before a Possession Notice can be sent"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={handleRefresh} />
            <button onClick={() => openCreate()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              <Plus size={14} /> Start Check
            </button>
          </div>
        }
      >
        {/* Summary metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Active Checks",   value: total,   color: "text-foreground"  },
            { label: "Ready",           value: ready,   color: "text-green-600"   },
            { label: "Pending",         value: pending, color: "text-orange-500"  },
            { label: "Awaiting Gates",  value: gwTotal, color: "text-blue-600"    },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-4">
          {(["checks", "gateway"] as const).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {t === "checks"
                ? `Active Checks${total > 0 ? ` (${total})` : ""}`
                : `Gateway${gwTotal > 0 ? ` (${gwTotal})` : ""}`}
            </button>
          ))}
        </div>

        {/* ── Active Checks ── */}
        {activeTab === "checks" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            ) : isError ? (
              <div className="col-span-2 p-6 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">
                <p className="font-semibold mb-1">Failed to load active checks</p>
                <p className="text-xs font-mono">{(error as Error)?.message}</p>
              </div>
            ) : (records as any[]).length === 0 ? (
              <div className="col-span-2 flex flex-col items-center gap-3 py-14 text-center">
                <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
                  <ClipboardCheck size={22} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium text-foreground">No active checks</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                    A check can be started once the Agreement is Registered and the project's OC / CC is received.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setActiveTab("gateway")}
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                    View Gateway <ChevronRight size={14} />
                  </button>
                  <button onClick={() => openCreate()}
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                    Start Check <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            ) : (records as any[]).map((c: any) => (
              <CheckCard
                key={c.Id}
                c={c}
                checkLoading={checkLoading}
                onToggle={toggleCheck}
                onSaved={invalidate}
                navigate={navigate}
              />
            ))}
          </div>
        )}

        {/* ── Gateway tab ── */}
        {activeTab === "gateway" && (
          <div className="space-y-3">
            {gwLoading ? (
              <div className="py-10 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading gateway status…
              </div>
            ) : gwError ? (
              <div className="flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
                <span>Failed to load gateway status: {(gwErrorMsg as Error)?.message}</span>
                <button onClick={() => gwRefetch()} className="text-xs font-medium underline hover:no-underline shrink-0">Retry</button>
              </div>
            ) : (gateway as any[]).length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <div className="w-12 h-12 rounded-full bg-green-50 border border-green-200 flex items-center justify-center">
                  <ShieldCheck size={22} className="text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-foreground">All bookings processed</p>
                  <p className="text-sm text-muted-foreground mt-1">No bookings are waiting for gate clearance.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-1 mb-2">
                  <p className="text-sm text-muted-foreground">
                    {gwElig > 0
                      ? <span><span className="font-semibold text-green-700">{gwElig} eligible</span> · {gwTotal - gwElig} awaiting clearance</span>
                      : <span className="text-muted-foreground">{gwTotal} bookings awaiting gate clearance — 0 eligible</span>}
                  </p>
                </div>

                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                  {(gateway as any[]).map((g: any) => (
                    <GatewayRow
                      key={g.BookingId}
                      g={g}
                      onStartCheck={(id) => openCreate(id)}
                      navigate={navigate}
                    />
                  ))}
                </div>

                {/* Legend */}
                <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 mt-2 space-y-1.5">
                  <p className="text-xs font-medium text-foreground">Gate 1 — AFS Registration chain (all 4 sub-steps required in order):</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-muted-foreground">
                    <div className="flex items-start gap-1.5">
                      <ShieldCheck size={11} className="mt-0.5 shrink-0 text-primary" />
                      <span><strong>Agr. Executed:</strong> Agreement → both parties signed (Mark Executed)</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <CreditCard size={11} className="mt-0.5 shrink-0 text-primary" />
                      <span><strong>AFS Payment:</strong> AFS Query Payment → Confirmed (customer paid govt. fees)</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <Camera size={11} className="mt-0.5 shrink-0 text-primary" />
                      <span><strong>Registry Visit:</strong> AFS Registry → Completed (visit at Sub-Registrar)</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <ShieldCheck size={11} className="mt-0.5 shrink-0 text-primary" />
                      <span><strong>Agr. Registered:</strong> Agreement → Mark as Registered (enter AFS Reg No)</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground pt-0.5">
                    <strong>Gate 2 — OC/CC:</strong> Project must have an Occupancy/Completion Certificate in <em>Received</em> status.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </CrmShell>

      {/* Dialogs */}
      {createOpen && (
        <CreateDialog
          prefillBookingId={createPrefillId}
          onClose={() => { setCreateOpen(false); setCreatePrefillId(undefined); }}
          onCreated={invalidate}
          onViewGateway={() => setActiveTab("gateway")}
        />
      )}
    </>
  );
};

export default CrmPrePossession;
