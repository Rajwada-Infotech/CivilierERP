import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import {
  Save, CheckCircle2, Circle, AlertTriangle, ChevronRight, Landmark, Users,
  IdCard, Briefcase, Phone, Building2, Search, Lock, Pencil, CreditCard,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API = "/api/crm/customer-bank-details";
const CHECKLIST_API = "/api/crm/welcome-calls";
const BKG_API = "/api/crm/bookings";

// Same "always allowed regardless of assignment" role set the backend
// enforces (backend/services/approvalService.js CRM_APPROVER_ROLES) — kept
// in sync manually since it's a small, stable list. The real gate is
// server-side (PUT rejects with 403 for anyone else); this only drives the
// UI so non-assigned staff see the lock before they try to save and get
// rejected, instead of after.
const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];

const EMPTY_FORM = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  NomineeName: "", NomineeRelation: "", NomineeDob: "", NomineeContact: "", NomineeAddress: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "", Notes: "",
  FinancingType: "",
};

// Same completeness rule the backend (crmPortal.js / crmWelcomeCalls.js
// checklist / the GET / list query below) uses to decide when agreement
// prep can auto-start — mirrored here so the dialog shows live progress
// before the record is even saved.
const REQUIRED_KEYS: (keyof typeof EMPTY_FORM)[] = [
  "BankName", "AccountNo", "IfscCode", "AccountHolderName",
  "NomineeName", "NomineeRelation", "PanNo", "AadhaarNo", "Occupation",
  "FinancingType",
];

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^\d{12}$/;
const MOBILE_RE = /^\d{10}$/;

function validate(form: typeof EMPTY_FORM) {
  const errors: Partial<Record<keyof typeof EMPTY_FORM, string>> = {};
  if (form.IfscCode && !IFSC_RE.test(form.IfscCode.toUpperCase())) errors.IfscCode = "Invalid IFSC format (e.g. HDFC0001234)";
  if (form.PanNo && !PAN_RE.test(form.PanNo.toUpperCase())) errors.PanNo = "Invalid PAN format (e.g. ABCDE1234F)";
  if (form.AadhaarNo && !AADHAAR_RE.test(form.AadhaarNo)) errors.AadhaarNo = "Aadhaar must be exactly 12 digits";
  if (form.NomineeContact && !MOBILE_RE.test(form.NomineeContact)) errors.NomineeContact = "Must be a 10-digit mobile number";
  if (form.AccountNo && !/^\d{6,20}$/.test(form.AccountNo)) errors.AccountNo = "Account number should be 6-20 digits";
  return errors;
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

async function fetchList(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBankDetail(bookingId: number): Promise<any> {
  try { const r = await fetchWithAuth(`${API}/booking/${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
}
async function fetchChecklist(bookingId: number): Promise<any> {
  try { const r = await fetchWithAuth(`${CHECKLIST_API}/${bookingId}/checklist`); return r.ok ? r.json() : null; } catch { return null; }
}
async function fetchLoan(bookingId: number): Promise<any> {
  try { const r = await fetchWithAuth(`${BKG_API}/${bookingId}/loan`); return r.ok ? r.json() : null; } catch { return null; }
}

function SectionCard({ icon: Icon, iconClass, title, children }: { icon: any; iconClass: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}><Icon size={14} /></span>
        {title}
      </h3>
      {children}
    </div>
  );
}

// Opened when a booking row is clicked — the entire capture/edit form lives
// here, never inline on the list page.
function BankDetailDialog({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // Once KYC data is on file it's sensitive — only the salesperson this
  // booking is assigned to, or an admin-tier role, can edit it. Everyone
  // else sees the whole form read-only. Backend enforces the real gate on
  // save; this just reflects it in the UI ahead of time.
  const isApprover = CRM_APPROVER_ROLES.includes(String(currentUser?.role || "").toLowerCase());
  const isAssigned = row.AssignedTo != null && currentUser?.id != null && Number(currentUser.id) === Number(row.AssignedTo);
  const canEdit = isApprover || isAssigned;
  // Even for someone who CAN edit, the form still opens read-only by
  // default — an explicit "Edit" click is required, and a successful save
  // re-locks it. Layered on top of (not a replacement for) the permission
  // gate above: someone without canEdit never sees an Edit button at all.
  const [uiLocked, setUiLocked] = useState(true);
  const locked = !canEdit || uiLocked;
  // Booking Amount (Milestone 1) must actually be paid before this form —
  // and the Financing Type declaration on it — can be completed. Mirrors the
  // same hard gate the backend now enforces in
  // validateAgreementPreparationPrerequisites (crmWorkflowGuards.js), so
  // staff see the reason up front instead of a save that silently never
  // unlocks Agreement prep.
  const [milestone1Status, setMilestone1Status] = useState<string | null>(null);
  const bookingAmountPaid = milestone1Status === "Paid";

  useQuery({
    queryKey: ["crm-bank-detail", row.BookingId],
    queryFn: async () => {
      const d = await fetchBankDetail(row.BookingId);
      setMilestone1Status(d?.Milestone1Status ?? null);
      setForm(d ? {
        BankName: d.BankName || "", BranchName: d.BranchName || "", AccountNo: d.AccountNo || "",
        IfscCode: d.IfscCode || "", AccountHolderName: d.AccountHolderName || "",
        NomineeName: d.NomineeName || "", NomineeRelation: d.NomineeRelation || "",
        NomineeDob: d.NomineeDob ? String(d.NomineeDob).slice(0,10) : "", NomineeContact: d.NomineeContact || "",
        NomineeAddress: d.NomineeAddress || "", PanNo: d.PanNo || "", AadhaarNo: d.AadhaarNo || "",
        Occupation: d.Occupation || "", AnnualIncome: d.AnnualIncome != null ? String(d.AnnualIncome) : "",
        Notes: d.Notes || "", FinancingType: d.FinancingType || "",
      } : { ...EMPTY_FORM });
      return d;
    },
  });
  const { data: checklist } = useQuery({
    queryKey: ["crm-welcome-checklist", row.BookingId],
    queryFn: () => fetchChecklist(row.BookingId),
  });
  // Soft check only — never blocks saving/completing this form. Just tells
  // staff, right where they're declaring Financing Type, whether the loan
  // side actually has anything on file yet.
  const { data: loanDetail } = useQuery({
    queryKey: ["crm-loan-detail", row.BookingId],
    queryFn: () => fetchLoan(row.BookingId),
    enabled: form.FinancingType === "LoanFinanced",
  });

  const errors = useMemo(() => validate(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const missingRequired = REQUIRED_KEYS.filter((k) => !String(form[k]).trim());
  const filledCount = REQUIRED_KEYS.length - missingRequired.length;
  const progressPct = Math.round((filledCount / REQUIRED_KEYS.length) * 100);
  const isComplete = missingRequired.length === 0 && !hasErrors;

  const handleSave = async () => {
    if (locked) { toast.error("This record is locked — only the assigned salesperson or an admin can edit it"); return; }
    if (!bookingAmountPaid) { toast.error("Booking Amount (Milestone 1) must be paid before this form can be completed"); return; }
    setTouched(true);
    if (hasErrors) { toast.error("Fix the highlighted fields before saving"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/booking/${row.BookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(isComplete
        ? (checklist?.welcomeCall?.done ? "KYC complete — agreement prep will proceed automatically" : "KYC complete — waiting on the welcome call to proceed")
        : "Bank & nominee details saved");
      setUiLocked(true);
      qc.invalidateQueries({ queryKey: ["crm-bank-detail", row.BookingId] });
      qc.invalidateQueries({ queryKey: ["crm-welcome-checklist", row.BookingId] });
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = "text", required = false) => (
    <div>
      <label className="text-xs text-muted-foreground block mb-1">{label}{required && " *"}</label>
      <input type={type} value={form[key]} readOnly={locked}
        onChange={(e) => !locked && setForm((f) => ({ ...f, [key]: e.target.value }))}
        onBlur={() => setTouched(true)}
        className={`w-full text-sm border rounded-lg px-2.5 py-2 ${locked ? "bg-muted/30 text-muted-foreground cursor-not-allowed" : "bg-background"} ${touched && errors[key] ? "border-rose-400" : "border-border"}`} />
      {touched && errors[key] && <p className="text-[11px] text-rose-500 mt-0.5">{errors[key]}</p>}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
            <span className="flex items-center gap-2">
              <Landmark size={16} className="text-primary" /> Bank & Nominee Details
            </span>
            {canEdit && uiLocked && bookingAmountPaid && (
              <button onClick={() => setUiLocked(false)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                <Pencil size={12} /> Edit
              </button>
            )}
          </DialogTitle>
        </DialogHeader>

        {!bookingAmountPaid ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle size={13} /> Booking Amount (Milestone 1) must be paid before Bank & Nominee / Financing details can be completed.
          </div>
        ) : !canEdit ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Lock size={13} /> This record is locked — only the assigned salesperson or an admin can edit it.
          </div>
        ) : uiLocked ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-1.5">
            <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
          </div>
        ) : null}

        {/* ── Customer context + progress + workflow status ── */}
        <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/15 text-primary font-bold text-sm flex items-center justify-center shrink-0">
                {initials(row.ApplicantName)}
              </div>
              <div>
                <span className="font-semibold text-foreground">{row.ApplicantName}</span>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                  <span className="font-mono">{row.BookingNo}</span>
                  <span>·</span>
                  <Phone size={11} /> {row.Mobile}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                  <Building2 size={11} /> {row.ProjectName || "—"}{row.UnitNo ? ` · Unit ${row.UnitNo}` : ""}
                </div>
              </div>
            </div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${isComplete ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-amber-600 bg-amber-50 border-amber-200"}`}>
              {isComplete ? "KYC Complete" : `${progressPct}% Complete`}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{filledCount} of {REQUIRED_KEYS.length} required fields captured</span>
              <span className="font-medium text-foreground">{progressPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full transition-all ${isComplete ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${checklist?.welcomeCall?.done ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-muted-foreground bg-muted/50 border-border"}`}>
              {checklist?.welcomeCall?.done ? <CheckCircle2 size={12} /> : <Circle size={12} />} Welcome Call
            </span>
            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${isComplete ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-muted-foreground bg-muted/50 border-border"}`}>
              {isComplete ? <CheckCircle2 size={12} /> : <Circle size={12} />} Bank & KYC
            </span>
            {checklist?.agreement ? (
              <button onClick={() => navigate(`/crm/agreements?bookingId=${row.BookingId}`)}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 ml-auto">
                Agreement: {checklist.agreement.Status} <ChevronRight size={11} />
              </button>
            ) : isComplete && !checklist?.welcomeCall?.done ? (
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border border-amber-200 text-amber-600 bg-amber-50 ml-auto">
                <AlertTriangle size={12} /> Welcome call needed to trigger agreement prep
              </span>
            ) : null}
          </div>
        </div>

        {/* ── Form sections ── */}
        <SectionCard icon={Landmark} iconClass="bg-sky-500/10 text-sky-600" title="Bank Details">
          <div className="grid grid-cols-2 gap-3">
            {field("BankName", "Bank Name", "text", true)}
            {field("BranchName", "Branch Name")}
            {field("AccountNo", "Account Number", "text", true)}
            {field("IfscCode", "IFSC Code", "text", true)}
            <div className="col-span-2">{field("AccountHolderName", "Account Holder Name", "text", true)}</div>
          </div>
        </SectionCard>

        <SectionCard icon={Users} iconClass="bg-violet-500/10 text-violet-600" title="Nominee Details">
          <div className="grid grid-cols-2 gap-3">
            {field("NomineeName", "Nominee Name", "text", true)}
            {field("NomineeRelation", "Relation", "text", true)}
            {field("NomineeDob", "Date of Birth", "date")}
            {field("NomineeContact", "Contact Number")}
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nominee Address</label>
            <textarea value={form.NomineeAddress} readOnly={locked}
              onChange={(e) => !locked && setForm((f) => ({ ...f, NomineeAddress: e.target.value }))}
              rows={2} className={`w-full text-sm border border-border rounded-lg px-2.5 py-2 resize-none ${locked ? "bg-muted/30 text-muted-foreground cursor-not-allowed" : "bg-background"}`} />
          </div>
        </SectionCard>

        <div className="grid grid-cols-2 gap-4">
          <SectionCard icon={IdCard} iconClass="bg-amber-500/10 text-amber-600" title="Identity">
            {field("PanNo", "PAN Number", "text", true)}
            {field("AadhaarNo", "Aadhaar Number", "text", true)}
          </SectionCard>
          <SectionCard icon={Briefcase} iconClass="bg-emerald-500/10 text-emerald-600" title="Occupation & Income">
            {field("Occupation", "Occupation", "text", true)}
            {field("AnnualIncome", "Annual Income (₹)", "number")}
          </SectionCard>
        </div>

        <SectionCard icon={CreditCard} iconClass="bg-cyan-500/10 text-cyan-600" title="Financing">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">How is this purchase being financed? *</label>
            <div className="grid grid-cols-2 gap-2">
              {(["SelfFunded", "LoanFinanced"] as const).map((opt) => (
                <button key={opt} type="button" disabled={locked}
                  onClick={() => !locked && setForm((f) => ({ ...f, FinancingType: opt }))}
                  className={`text-sm rounded-lg border px-3 py-2 text-left transition-colors ${
                    form.FinancingType === opt ? "border-primary bg-primary/10 text-primary font-medium" : "border-border bg-background"
                  } ${locked ? "cursor-not-allowed opacity-70" : "hover:bg-muted/40"}`}>
                  {opt === "SelfFunded" ? "Self-funded" : "Loan-financed"}
                </button>
              ))}
            </div>
            {touched && !form.FinancingType && (
              <p className="text-[11px] text-rose-500 mt-1">Financing type must be declared</p>
            )}
          </div>
          {form.FinancingType === "LoanFinanced" && !loanDetail?.HasLoanRecord && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={13} /> No loan record on file yet — capture it on Home Loan Tracking once the customer's bank/sanction details are known.
            </div>
          )}
        </SectionCard>

        <div className="flex justify-between items-center pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {!canEdit ? "Locked — assigned salesperson or admin only" : uiLocked ? "Locked for viewing" : hasErrors ? "Fix highlighted errors before saving" : missingRequired.length > 0 ? `${missingRequired.length} required field(s) remaining` : "All required fields captured"}
          </span>
          <div className="flex gap-2">
            {locked ? (
              <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Close</button>
            ) : (
              <>
                <button onClick={() => { setUiLocked(true); onClose(); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-40">
                  <Save size={14} /> {saving ? "Saving..." : "Save Details"}
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type StatusFilter = "All" | "Pending" | "Complete";

const CrmCustomerBankDetails: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");
  const [activeRow, setActiveRow] = useState<any | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);

  const { data: list = [], isLoading } = useQuery({ queryKey: ["crm-bank-details-list"], queryFn: fetchList, staleTime: 30_000 });

  // Deep-link support: /crm/customer-bank-details?bookingId=X opens the
  // dialog for that booking directly (e.g. from the Bookings list action).
  // deepLinkOpened is a one-shot guard — without it, closing the dialog
  // (setActiveRow(null)) re-ran this effect, saw bookingId was still in the
  // URL, and immediately reopened it, making Close look completely broken.
  React.useEffect(() => {
    if (!bkgFilter || deepLinkOpened) return;
    const row = (list as any[]).find((r) => String(r.BookingId) === bkgFilter);
    if (row) { setActiveRow(row); setDeepLinkOpened(true); }
  }, [bkgFilter, list, deepLinkOpened]);

  const counts = useMemo(() => {
    const rows = list as any[];
    return { all: rows.length, complete: rows.filter((r) => r.IsComplete).length, pending: rows.filter((r) => !r.IsComplete).length };
  }, [list]);

  const filtered = useMemo(() => {
    let rows = list as any[];
    if (statusFilter === "Pending") rows = rows.filter((r) => !r.IsComplete);
    if (statusFilter === "Complete") rows = rows.filter((r) => r.IsComplete);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.ApplicantName?.toLowerCase().includes(q) ||
        r.BookingNo?.toLowerCase().includes(q) ||
        r.ProjectName?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [list, statusFilter, search]);

  return (
    <SalesAutoShell title="CRM — Customer Bank & Nominee Details" subtitle="KYC captured before agreement preparation">
      <div className="space-y-4">
        <div className="flex gap-3 items-center flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer, booking, project..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {([
              ["All", counts.all],
              ["Pending", counts.pending],
              ["Complete", counts.complete],
            ] as [StatusFilter, number][]).map(([key, count]) => (
              <button key={key} onClick={() => setStatusFilter(key)}
                className={`px-3 py-2 text-xs font-medium ${statusFilter === key ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
                {key} ({count})
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">No bookings found</div>
          ) : filtered.map((r: any) => (
            <button
              key={r.BookingId}
              onClick={() => setActiveRow(r)}
              className="w-full text-left rounded-lg border border-border p-3 flex items-center gap-3 hover:bg-muted/10 hover:border-primary/40 transition-colors cursor-pointer"
            >
              <div className="w-9 h-9 rounded-full bg-primary/15 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                {initials(r.ApplicantName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{r.ApplicantName}</span>
                  <span className="text-xs font-mono text-muted-foreground shrink-0">{r.BookingNo}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.Mobile} · {r.ProjectName || "—"}{r.UnitNo ? ` · Unit ${r.UnitNo}` : ""}
                </div>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${r.LastCallOutcome === "Welcomed" ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-muted-foreground bg-muted/50 border-border"}`}>
                {r.LastCallOutcome === "Welcomed" ? "Called" : "Not Called"}
              </span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${r.IsComplete ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-amber-600 bg-amber-50 border-amber-200"}`}>
                {r.IsComplete ? "KYC Complete" : "KYC Pending"}
              </span>
              <ChevronRight size={14} className="text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {activeRow && (
        <BankDetailDialog
          row={activeRow}
          onClose={() => setActiveRow(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["crm-bank-details-list"] })}
        />
      )}
    </SalesAutoShell>
  );
};

export default CrmCustomerBankDetails;
