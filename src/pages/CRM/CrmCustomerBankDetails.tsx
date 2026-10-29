// CRM Customer Bank Details: the bank, identity, income and financing details (KYC) of each approved booking. Once
// on file they are sensitive: only the booking's assigned salesperson or an admin-tier role may change them.
import { useCanApprove } from "@/hooks/useCanApprove";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronRight, Landmark, Lock, PenSquare, Save } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { AutoInput } from "@/components/ui/date-input";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { Block, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/customer-bank-details";
const CHECKLIST_API = "/api/crm/welcome-calls";
const BKG_API = "/api/crm/bookings";


const EMPTY_FORM = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "", Notes: "",
  FinancingType: "",
};
type BankForm = typeof EMPTY_FORM;

// The server's completeness rule (the list's IsComplete), shown live while typing. None of it is mandatory to save.
const REQUIRED_KEYS: (keyof BankForm)[] = ["BankName", "AccountNo", "IfscCode", "AccountHolderName", "PanNo", "AadhaarNo", "Occupation", "FinancingType"];
const UPPERCASE_FIELDS: (keyof BankForm)[] = ["PanNo", "IfscCode"];

function validate(form: BankForm) {
  const errors: Partial<Record<keyof BankForm, string>> = {};
  if (form.IfscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.IfscCode.toUpperCase())) errors.IfscCode = "IFSC looks like HDFC0001234.";
  if (form.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.PanNo.toUpperCase())) errors.PanNo = "PAN looks like ABCDE1234F.";
  if (form.AadhaarNo && !/^\d{12}$/.test(form.AadhaarNo.replace(/\s+/g, ""))) errors.AadhaarNo = "Aadhaar is exactly 12 digits.";
  if (form.AccountNo && !/^\d{6,20}$/.test(form.AccountNo)) errors.AccountNo = "Account number is 6 to 20 digits.";
  return errors;
}

const toForm = (d: any): BankForm => (d ? {
  BankName: d.BankName || "", BranchName: d.BranchName || "", AccountNo: d.AccountNo || "",
  IfscCode: d.IfscCode || "", AccountHolderName: d.AccountHolderName || "",
  PanNo: d.PanNo || "", AadhaarNo: d.AadhaarNo || "",
  Occupation: d.Occupation || "", AnnualIncome: d.AnnualIncome != null ? String(d.AnnualIncome) : "",
  Notes: d.Notes || "", FinancingType: d.FinancingType || "",
} : { ...EMPTY_FORM });

interface Cpb { companyId: string; projectId: string; blockId: string }
// Every approved booking under the filters (counts are worked out here). Throws, so a failed load shows as one.
async function fetchList(cpb: Cpb): Promise<any[]> {
  const params = new URLSearchParams();
  if (cpb.companyId) params.set("companyId", cpb.companyId);
  if (cpb.projectId) params.set("projectId", cpb.projectId);
  if (cpb.blockId) params.set("blockId", cpb.blockId);
  const r = await fetchWithAuth(`${API}${params.toString() ? `?${params}` : ""}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the bookings (${r.status}).`);
  return Array.isArray(data) ? data : [];
}
async function getOrNull(url: string): Promise<any> {
  try { const r = await fetchWithAuth(url); return r.ok ? r.json() : null; } catch { return null; }
}

const INP = "w-full h-9 border bg-card px-2.5 text-sm text-foreground outline-none transition-colors read-only:bg-muted/30 read-only:border-foreground/20 read-only:cursor-default";

function BankDetailDialog({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentUser, canDoAction } = useAuth();
  const [form, setForm] = useState<BankForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // Editing needs the page's edit right as well as being an approver or the assigned salesperson (the server refuses
  // either way; the page used to offer Edit without the right).
  // Besides the assigned salesperson, who may edit a locked record is set in
  // Approval Setup (crm-bank-details-edit); the server is the real gate.
  const isApprover = useCanApprove("crm-bank-details-edit");
  const isAssigned = row.AssignedTo != null && currentUser?.id != null && Number(currentUser.id) === Number(row.AssignedTo);
  const hasRight = canDoAction("crm-customer-bank-details", "edit");
  const canEdit = hasRight && (isApprover || isAssigned);
  // Opens read-only even for those who may edit; Edit unlocks it, saving locks it again.
  const [uiLocked, setUiLocked] = useState(true);
  const locked = !canEdit || uiLocked;

  const { data: saved, isLoading } = useQuery({
    queryKey: ["crm-bank-detail", row.BookingId],
    queryFn: () => getOrNull(`${API}/booking/${row.BookingId}`),
  });
  // The form follows what is on file until it is unlocked (it used to be set from inside the fetch, so a cached copy
  // opened with an empty form).
  useEffect(() => { if (uiLocked) setForm(toForm(saved)); }, [saved, uiLocked]);
  const { data: checklist } = useQuery({
    queryKey: ["crm-welcome-checklist", row.BookingId],
    queryFn: () => getOrNull(`${CHECKLIST_API}/${row.BookingId}/checklist`),
  });
  // Soft check only: says whether the loan side has anything on file yet.
  const { data: loanDetail } = useQuery({
    queryKey: ["crm-loan-detail", row.BookingId],
    queryFn: () => getOrNull(`${BKG_API}/${row.BookingId}/loan`),
    enabled: form.FinancingType === "LoanFinanced",
  });

  const errors = useMemo(() => validate(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const filledCount = REQUIRED_KEYS.filter((k) => String(form[k]).trim()).length;
  const progressPct = Math.round((filledCount / REQUIRED_KEYS.length) * 100);
  const isComplete = filledCount === REQUIRED_KEYS.length && !hasErrors;
  const welcomed = !!checklist?.welcomeCall?.done;

  const handleSave = async () => {
    if (locked) return;
    setTouched(true);
    if (hasErrors) return void toast.error("Fix the marked fields first.");
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/booking/${row.BookingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, AadhaarNo: form.AadhaarNo.replace(/\s+/g, "") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the bank details.");
      toast.success(isComplete ? (welcomed ? "KYC complete; agreement prep will go ahead" : "KYC complete; waiting on the welcome call") : "Bank details saved");
      ["crm-bank-detail", "crm-welcome-checklist"].forEach((k) => qc.invalidateQueries({ queryKey: [k, row.BookingId] }));
      setUiLocked(true);
      onSaved();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof BankForm, label: string, type = "text", className?: string) => (
    <label className={`block space-y-1 min-w-0 ${className ?? ""}`}>
      <span className={`block ${LBL}`}>{label}</span>
      <AutoInput type={type} value={form[key]} readOnly={locked}
        onChange={(e) => setForm((f) => ({ ...f, [key]: UPPERCASE_FIELDS.includes(key) ? e.target.value.toUpperCase() : e.target.value }))}
        onBlur={() => setTouched(true)}
        className={`${INP} ${touched && errors[key] ? "border-destructive" : "border-foreground/40 focus:border-foreground"}`} />
      {touched && errors[key] && <span className="block text-[0.6875rem] text-destructive">{errors[key]}</span>}
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center justify-between gap-3 pr-6">
            <span className="min-w-0">
              <span className={`block ${LBL}`}>{locked ? "Bank and KYC" : "Editing bank and KYC"}</span>
              <span className="font-heading text-lg font-bold text-foreground flex items-center gap-2">
                <Landmark size={16} /> <ApplicantNames name={row.ApplicantName} bookingId={row.BookingId} applicationId={row.ApplicationId} />
              </span>
              <span className="block text-xs text-muted-foreground font-normal mt-0.5 tabular-nums">
                {[row.BookingNo, row.Mobile, row.ProjectName, row.UnitNo && `Unit ${row.UnitNo}`].filter(Boolean).join(" · ")}
              </span>
            </span>
            {canEdit && uiLocked && <button onClick={() => setUiLocked(false)} className={`${KEY_INK} h-9 px-4`}><PenSquare size={13} /> Edit</button>}
          </DialogTitle>
        </DialogHeader>

        {locked && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-2" style={{ border: RULE_SOFT }}>
            <Lock size={11} />
            {canEdit ? "Read-only. Edit unlocks it; saving locks it again."
              : !hasRight ? "Read-only: you don't have the edit right on this page."
              : "Read-only: only the booking's assigned salesperson or an admin can change these details."}
          </p>
        )}

        <div className="bg-card px-4 py-3 space-y-3" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SheetMark text={isComplete ? "KYC complete" : `KYC ${progressPct}%`} tone={isComplete ? "done" : "waiting"} />
            <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{filledCount} of {REQUIRED_KEYS.length} captured · none needed to save</span>
          </div>
          <div className="h-1.5 w-full" style={{ border: RULE_SOFT }}>
            <div className="h-full bg-foreground transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <SheetMark text="Welcome call" tone={welcomed ? "done" : "waiting"} />
            <SheetMark text="Bank and KYC" tone={isComplete ? "done" : "waiting"} />
            {checklist?.agreement ? (
              <button onClick={() => navigate(`/crm/agreements?bookingId=${row.BookingId}`)} className={`${KEY_LINE} h-7 px-2 ml-auto`}>
                Agreement: {checklist.agreement.Status} <ChevronRight size={11} />
              </button>
            ) : isComplete && !welcomed ? (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle size={12} /> The welcome call starts agreement prep.</span>
            ) : null}
          </div>
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Block title="Bank">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {field("BankName", "Bank")}
                {field("BranchName", "Branch")}
                {field("AccountNo", "Account number")}
                {field("IfscCode", "IFSC")}
                {field("AccountHolderName", "Account holder", "text", "sm:col-span-2")}
              </div>
            </Block>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Block title="Identity">
                {field("PanNo", "PAN")}
                {field("AadhaarNo", "Aadhaar number")}
              </Block>
              <Block title="Occupation and income">
                {field("Occupation", "Occupation")}
                {field("AnnualIncome", "Annual income (₹)", "number")}
              </Block>
            </div>
            <Block title="Financing" note="How is this purchase paid for?">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(["SelfFunded", "LoanFinanced"] as const).map((opt) => (
                  <button key={opt} type="button" disabled={locked}
                    onClick={() => setForm((f) => ({ ...f, FinancingType: opt }))}
                    className={`${form.FinancingType === opt ? KEY_INK : KEY_LINE} h-9 px-3 disabled:!opacity-70`}>
                    {opt === "SelfFunded" ? "Self-funded" : "Loan-financed"}
                  </button>
                ))}
              </div>
              {form.FinancingType === "LoanFinanced" && !loanDetail?.HasLoanRecord && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-2" style={{ border: RULE_SOFT }}>
                  <AlertTriangle size={12} /> No loan on file yet: capture it on Home Loan Tracking once the bank and sanction are known.
                </p>
              )}
            </Block>
          </>
        )}

        <div className="flex flex-wrap justify-between items-center gap-2 pt-3" style={{ borderTop: RULE }}>
          <span className="text-xs text-muted-foreground">{!locked && hasErrors ? "Fix the marked fields before saving." : ""}</span>
          <div className="flex gap-2">
            {locked ? (
              <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Close</button>
            ) : (
              <>
                {/* Cancel puts back what is on file and locks again, without closing. */}
                <button onClick={() => { setTouched(false); setUiLocked(true); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-4`}><Save size={13} /> {saving ? "Saving…" : "Save"}</button>
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
  const navigate = useNavigate();
  usePageRights("crm-customer-bank-details");
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [search, setSearch] = useState("");
  const [activeRow, setActiveRow] = useState<any | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });

  const { data: list = [], isLoading, isError, error } = useQuery({ queryKey: ["crm-bank-details-list", cpb], queryFn: () => fetchList(cpb), staleTime: 30_000 });

  // ?bookingId=X (e.g. from Bookings' "Bank details") opens that booking once. It used to do nothing when the booking
  // wasn't listed (not approved yet, or outside the user's projects); it now says so.
  useEffect(() => {
    if (!bkgFilter || deepLinkOpened || isLoading) return;
    setDeepLinkOpened(true);
    const row = list.find((r: any) => String(r.BookingId) === bkgFilter);
    if (row) setActiveRow(row);
    else toast.error("That booking isn't here: only approved bookings in your projects are listed.");
  }, [bkgFilter, list, deepLinkOpened, isLoading]);

  const counts = useMemo(() => ({
    all: list.length,
    complete: list.filter((r: any) => r.IsComplete).length,
    pending: list.filter((r: any) => !r.IsComplete).length,
    welcomedPending: list.filter((r: any) => !r.IsComplete && r.LastCallOutcome === "Welcomed").length,
  }), [list]);

  const filtered = useMemo(() => {
    let rows = list as any[];
    if (statusFilter === "Pending") rows = rows.filter((r) => !r.IsComplete);
    if (statusFilter === "Complete") rows = rows.filter((r) => r.IsComplete);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.ApplicantName?.toLowerCase().includes(q) || r.BookingNo?.toLowerCase().includes(q) || r.ProjectName?.toLowerCase().includes(q) || r.Mobile?.includes(q));
    return rows;
  }, [list, statusFilter, search]);

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking", size: 120, cell: (i) => <span className="font-heading text-xs font-semibold tabular-nums">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 200,
      cell: (i) => (
        <div className="min-w-0">
          <div className="font-medium truncate"><ApplicantNames name={i.row.original.ApplicantName} bookingId={i.row.original.BookingId} applicationId={i.row.original.ApplicationId} /></div>
          <div className="text-xs text-muted-foreground tabular-nums">{i.row.original.Mobile}</div>
        </div>
      ) },
    { id: "projectUnit", header: "Project / unit", size: 200, enableSorting: false,
      cell: (i) => <span className="text-xs">{[i.row.original.ProjectName, i.row.original.UnitNo].filter(Boolean).join(" · ") || "—"}</span> },
    { id: "financing", header: "Financing", size: 120, enableSorting: false,
      cell: (i) => <span className="text-xs">{i.row.original.FinancingType === "LoanFinanced" ? "Loan" : i.row.original.FinancingType === "SelfFunded" ? "Self-funded" : "—"}</span> },
    { id: "call", header: "Welcome call", size: 130, enableSorting: false,
      cell: (i) => <SheetMark text={i.row.original.LastCallOutcome === "Welcomed" ? "Welcomed" : "Not yet"} tone={i.row.original.LastCallOutcome === "Welcomed" ? "done" : "waiting"} /> },
    { accessorKey: "IsComplete", header: "KYC", size: 120,
      cell: (i) => <SheetMark text={i.row.original.IsComplete ? "Complete" : "Pending"} tone={i.row.original.IsComplete ? "done" : "waiting"} /> },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Bank Details"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Customer Bank Details"
        subtitle="Bank, identity, income and financing for each approved booking, captured before the agreement is prepared."
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Approved bookings", value: counts.all, note: "Under these filters", go: "All" as StatusFilter },
                { label: "KYC pending", value: counts.pending, note: `${counts.welcomedPending} already welcomed`, go: "Pending" as StatusFilter },
                { label: "KYC complete", value: counts.complete, note: "Every detail on file", go: "Complete" as StatusFilter },
                { label: "Complete", value: `${counts.all ? Math.round((counts.complete / counts.all) * 100) : 0}%`, note: "Of the approved bookings", go: "Complete" as StatusFilter },
              ].map((x) => (
                <div key={x.label}>
                  <button onClick={() => setStatusFilter(x.go)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="flex items-stretch overflow-x-auto overflow-y-hidden" style={{ borderBottom: RULE }}>
              {([["All", counts.all], ["Pending", counts.pending], ["Complete", counts.complete]] as [StatusFilter, number][]).map(([key, n]) => (
                <button key={key} onClick={() => setStatusFilter(key)}
                  className={`inline-flex items-center gap-2 px-4 h-11 font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${statusFilter === key ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`}
                  style={{ borderRight: RULE_SOFT }}>
                  {key} <span className="tabular-nums">{n}</span>
                </button>
              ))}
            </div>
            <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer, mobile, booking or project…"
                className="h-9 w-full sm:w-72 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />
            </div>
            {isError ? (
              <p className="px-5 py-10 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : (
              <DataTable data={filtered} columns={columns} searchable={false} loading={isLoading} className="border-0"
                onRowClick={(row) => setActiveRow(row.original)} getRowId={(r: any) => String(r.BookingId)}
                emptyMessage={search || statusFilter !== "All" ? "No booking matches." : "No approved bookings yet."} />
            )}
          </div>
        </div>
      </SheetShell>

      {activeRow && (
        <BankDetailDialog
          row={activeRow}
          onClose={() => { setActiveRow(null); if (bkgFilter) navigate("/crm/customer-bank-details", { replace: true }); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["crm-bank-details-list"] })}
        />
      )}
    </>
  );
};

export default CrmCustomerBankDetails;
