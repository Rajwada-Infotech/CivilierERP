// CrmApplicationVerify.tsx
//
// Dedicated, single-purpose screen for the Level-1 verification checklist.
// This does NOT live inside CrmApplication.tsx's giant detail dialog —
// it's its own route (`/crm/applications/verify/:id`), meant to be opened
// only at the moment someone is actually doing L1 verification (from the
// Approval Inbox's "open" arrow, or a "Verify" button on the Applications
// list). Everything else about the Application (documents upload, payment
// plan editing, booking creation, etc.) still lives on the main page.
//
// DEEP REBUILD — the old version of this screen showed one flat summary
// card at the top and a plain list of checklist labels below it, so a
// verifier could tick every box without the underlying data ever being in
// front of them. That's the exact "blind approve" problem this page exists
// to prevent. This version instead groups the application into the same
// seven areas CHECKLIST_ITEMS (crmApplicationChecklist.js) covers, shows
// the REAL data for that area first, and puts that area's checklist
// control immediately underneath it — so ticking a box means looking at
// the thing next to it, not scrolling past a wall of labels.
//
// Every field rendered below is sourced from a route that already exists
// in this codebase (no invented columns):
//   - Application core fields         -> GET /api/crm/applications/:id
//   - Co-applicants                   -> GET /api/crm/co-applicants/application/:id
//   - Customer's own bank/KYC record  -> GET /api/crm/customer-bank-details/application/:id
//     (this is where ChequeNo/ChequeDate/TransactionRef and the KYC-form
//     copies of PAN/Aadhaar/Occupation/Income actually live — see
//     CrmApplication.tsx's own loadApplicationIntoWizard for the same
//     pattern)
//   - Deposit bank name (DepositBankId -> name) -> GET /api/bank-master
//     (same BId/BName shape CrmApplication.tsx's fetchAllBanks uses)
//   - Documents                       -> GET /api/crm/booking-documents/application/:id
//
// Talks to the exact same checklist backend as before
// (crmApplicationChecklist.js via crmApplications.js's /:id/checklist/*
// routes) — nothing about the check/uncheck/flag/resubmit action logic
// changes here, only what's rendered around it.
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import {
  ArrowLeft, CheckCircle2, Circle, AlertTriangle, Loader2,
  User, Building2, IndianRupee, Landmark, Users2, FileBadge, Briefcase,
  Phone, Mail, IdCard, MapPin, FileText,
} from "lucide-react";

const API = "/api/crm/applications";
const CO_APPLICANT_API = "/api/crm/co-applicants";
const BANK_DETAIL_API = "/api/crm/customer-bank-details";
const DOC_API = "/api/crm/booking-documents";
const BANK_MASTER_API = "/api/bank-master";

// Mirrors approvalService.js's CRM_APPROVER_ROLES — client-side only, same
// pattern CrmApplication.tsx and ApprovalActions.tsx both already use. The
// server is the real gate on every action below.
const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];

function getUserRoleFromToken(): string | null {
  try {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

// One icon per checklist item key / section header — falls back to a plain
// circle for any key not listed (e.g. a future item added to CHECKLIST_ITEMS
// on the backend that this map hasn't been updated for yet).
const ITEM_ICON: Record<string, typeof User> = {
  ApplicantKyc: User,
  ProjectUnitRate: Building2,
  PaymentPlanAmounts: IndianRupee,
  BankDepositMode: Landmark,
  BrokerDetails: Users2,
  SourceAssignment: Briefcase,
  Documents: FileBadge,
};

type ChecklistItem = {
  ItemKey: string;
  ItemLabel: string;
  CheckStatus: "Pending" | "Checked" | "NeedsRecheck";
  Remarks: string | null;
};

function fmtInr(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN");
}

// Small label/value pair used everywhere in the detail sections below.
function Field({ label, value, icon: Icon, warn }: { label: string; value: React.ReactNode; icon?: typeof User; warn?: boolean }) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      {Icon && <Icon size={12} className="text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-sm break-words ${warn ? "text-red-600 font-medium" : "text-foreground"}`}>
          {value === null || value === undefined || value === "" ? "—" : value}
        </div>
      </div>
    </div>
  );
}

export default function CrmApplicationVerify() {
  const { id } = useParams<{ id: string }>();
  const applicationId = id ? parseInt(id, 10) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const role = getUserRoleFromToken();
  const isApprover = CRM_APPROVER_ROLES.includes((role || "").toLowerCase());

  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flaggingKey, setFlaggingKey] = useState<string | null>(null);

  const { data: appData, isLoading: appLoading } = useQuery({
    queryKey: ["crm-app-verify-detail", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${applicationId}`);
      if (!r.ok) throw new Error("Failed to load application");
      return r.json();
    },
    enabled: !!applicationId,
  });

  const { data: checklistData, isLoading: checklistLoading, refetch: refetchChecklist } = useQuery({
    queryKey: ["crm-app-verify-checklist", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${applicationId}/checklist`);
      if (!r.ok) throw new Error("Failed to load checklist");
      return r.json();
    },
    enabled: !!applicationId,
  });

  // ── The real data every checklist item is actually verifying ──
  const { data: coApplicants = [] } = useQuery({
    queryKey: ["crm-app-verify-co-applicants", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${CO_APPLICANT_API}/application/${applicationId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!applicationId,
  });

  const { data: bankDetail } = useQuery({
    queryKey: ["crm-app-verify-bank-detail", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${BANK_DETAIL_API}/application/${applicationId}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!applicationId,
  });

  const { data: docData } = useQuery({
    queryKey: ["crm-app-verify-documents", applicationId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${DOC_API}/application/${applicationId}`);
      return r.ok ? r.json() : { documents: [] };
    },
    enabled: !!applicationId,
  });

  // Deposit bank is stored as an Id on the Application (DepositBankId) —
  // resolve it to a name the same way CrmApplication.tsx's own bank picker
  // does (BId/BName from /api/bank-master), instead of showing a raw
  // number to whoever is verifying it.
  const { data: allBanks = [] } = useQuery({
    queryKey: ["crm-app-verify-bank-master"],
    queryFn: async () => {
      try {
        const r = await fetchWithAuth(BANK_MASTER_API);
        return r.ok ? r.json() : [];
      } catch {
        return [];
      }
    },
    staleTime: 5 * 60_000,
  });

  const a = appData?.application;
  const items: ChecklistItem[] = checklistData?.items || [];
  const itemByKey: Record<string, ChecklistItem> = {};
  for (const it of items) itemByKey[it.ItemKey] = it;
  const checkedCount = items.filter((it) => it.CheckStatus === "Checked").length;
  const allChecked = checklistData?.allChecked;
  const applicationStatus = checklistData?.applicationStatus;
  const canVerify = isApprover && applicationStatus === "Pending";

  const depositBank = a?.DepositBankId
    ? (allBanks as any[]).find((b) => String(b.BId) === String(a.DepositBankId))
    : null;

  async function fireAction(itemKey: string, action: "check" | "uncheck" | "flag" | "resubmit", body?: object) {
    setBusyKey(itemKey);
    try {
      const res = await fetchWithAuth(`${API}/${applicationId}/checklist/${itemKey}/${action}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");

      if (action === "flag") {
        setRemarks((p) => ({ ...p, [itemKey]: "" }));
        setFlaggingKey(null);
      }
      if (data.status === "Approved") {
        toast.success("All checklist items verified — application approved");
        queryClient.invalidateQueries({ queryKey: ["crm-applications"] });
        queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
      }
      await refetchChecklist();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyKey(null);
    }
  }

  // The checkbox itself is the real toggle: click when Pending/NeedsRecheck
  // -> check (no remark required). Click when Checked -> uncheck (a plain
  // retract, no remark — see uncheckItem()'s own comment for why this is
  // intentionally NOT the same action as "Flag for Recheck").
  function handleToggle(it: ChecklistItem) {
    if (!canVerify || busyKey) return;
    if (it.CheckStatus === "Checked") {
      fireAction(it.ItemKey, "uncheck");
    } else {
      fireAction(it.ItemKey, "check");
    }
  }

  // The checklist control block, shared by every section below — this is
  // what sits directly under each section's real data, so ticking it means
  // "I looked at what's above and it's correct" rather than "I trust this
  // blindly."
  function ChecklistControl({ itemKey }: { itemKey: string }) {
    const it = itemByKey[itemKey];
    if (!it) return null;
    const Icon = ITEM_ICON[it.ItemKey] || Circle;
    const busy = busyKey === it.ItemKey;
    const isFlagging = flaggingKey === it.ItemKey;

    return (
      <div className="mt-3 pt-3 border-t border-dashed border-border">
        <div className="flex items-start gap-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={it.CheckStatus === "Checked"}
            disabled={!canVerify || busy}
            onClick={() => handleToggle(it)}
            className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              it.CheckStatus === "Checked"
                ? "bg-green-600 border-green-600"
                : it.CheckStatus === "NeedsRecheck"
                  ? "border-red-400 bg-red-50"
                  : "border-border hover:border-primary"
            }`}
            title={it.CheckStatus === "Checked" ? "Click to uncheck" : "Click to mark checked"}
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin text-white" />
            ) : it.CheckStatus === "Checked" ? (
              <CheckCircle2 size={14} className="text-white" />
            ) : null}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Icon size={12} className="text-muted-foreground shrink-0" />
                {it.ItemLabel}
              </p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${
                it.CheckStatus === "Checked" ? "text-green-600 bg-green-50 border-green-200"
                : it.CheckStatus === "NeedsRecheck" ? "text-red-600 bg-red-50 border-red-200"
                : "text-muted-foreground bg-muted/50 border-border"
              }`}>
                {it.CheckStatus === "Checked" ? "Checked" : it.CheckStatus === "NeedsRecheck" ? "Needs Recheck" : "Pending"}
              </span>
            </div>

            {it.Remarks && (
              <p className="text-xs text-muted-foreground mt-1">
                {it.CheckStatus === "NeedsRecheck" ? "Reviewer note: " : "Remark: "}{it.Remarks}
              </p>
            )}

            {/* Flag for Recheck — deliberately separate from the checkbox, since
                it always needs a remark and sends the item to the preparer,
                unlike a plain uncheck. */}
            {canVerify && it.CheckStatus !== "NeedsRecheck" && (
              isFlagging ? (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    autoFocus
                    value={remarks[it.ItemKey] || ""}
                    onChange={(e) => setRemarks((p) => ({ ...p, [it.ItemKey]: e.target.value }))}
                    placeholder="What needs to be fixed? (required)"
                    rows={2}
                    className="w-full text-xs rounded-md border border-border px-2 py-1.5 bg-background"
                  />
                  <div className="flex gap-1.5">
                    <button
                      disabled={busy || !(remarks[it.ItemKey] || "").trim()}
                      onClick={() => fireAction(it.ItemKey, "flag", { remarks: remarks[it.ItemKey] })}
                      className="text-xs px-2.5 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                    >
                      {busy ? "…" : "Send for Recheck"}
                    </button>
                    <button
                      onClick={() => setFlaggingKey(null)}
                      className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setFlaggingKey(it.ItemKey)}
                  className="mt-1.5 text-[11px] text-red-600 hover:underline"
                >
                  Flag for Recheck
                </button>
              )
            )}

            {applicationStatus === "Pending" && it.CheckStatus === "NeedsRecheck" && (
              <button
                onClick={() => fireAction(it.ItemKey, "resubmit")}
                disabled={busy}
                className="mt-1.5 text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 disabled:opacity-40"
              >
                {busy ? "…" : "I've revised this — resend for recheck"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Wraps a section's real-data grid + its ChecklistControl in one card, so
  // the data and the checkbox that verifies it are visually one unit.
  function Section({ title, icon: Icon, children, itemKey }: { title: string; icon: typeof User; children: React.ReactNode; itemKey: string }) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
          <Icon size={14} className="text-muted-foreground" /> {title}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
          {children}
        </div>
        <ChecklistControl itemKey={itemKey} />
      </div>
    );
  }

  if (!applicationId) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No application specified.
      </div>
    );
  }

  const customerAddress = [a?.CustomerAddress, a?.CustomerCity, a?.CustomerState, a?.CustomerPincode].filter(Boolean).join(", ");
  const panMismatch = !!(bankDetail?.PanNo && a?.PanNo && String(bankDetail.PanNo).trim().toUpperCase() !== String(a.PanNo).trim().toUpperCase());
  const documents = docData?.documents || [];
  const hasIdentityProof = documents.some((d: any) => d.DocumentType === "IdentityProof");
  const hasAddressProof = documents.some((d: any) => d.DocumentType === "AddressProof");
  const tokenComputedAmount = a?.TokenType === "Percentage" && a?.TokenValue && a?.BookingAmount
    ? (Number(a.BookingAmount) * Number(a.TokenValue)) / 100
    : null;

  return (
    <SalesAutoShell
      title="Level 1 Verification"
      subtitle="Every checklist item sits under the data it verifies — check it because you looked, not because it's there"
      action={
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
      }
    >
      {(appLoading || checklistLoading) && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading application…
        </div>
      )}

      {!appLoading && !checklistLoading && a && (
        <div className="max-w-3xl mx-auto space-y-4">
          {/* ── Header: who/what, status, progress ── */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{a.ApplicantName}</p>
                <p className="text-xs text-muted-foreground">{a.ApplicationNo} · {a.Mobile}{a.Email ? ` · ${a.Email}` : ""}</p>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${
                applicationStatus === "Pending" ? "text-blue-600 bg-blue-50 border-blue-200" : "text-muted-foreground bg-muted/50 border-border"
              }`}>
                {applicationStatus}
              </span>
            </div>
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-foreground">Checklist progress</span>
                <span className="text-xs text-muted-foreground">{checkedCount}/{items.length} checked</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${items.length ? (checkedCount / items.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <button
              onClick={() => navigate(`/crm/applications?id=${applicationId}`)}
              className="text-[11px] text-primary hover:underline"
            >
              View full application details →
            </button>
          </div>

          {!canVerify && applicationStatus === "Pending" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              You're viewing this checklist read-only — verifying requires admin, super_admin, or marketing_head.
            </div>
          )}
          {applicationStatus !== "Pending" && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 flex items-center gap-2">
              <CheckCircle2 size={14} className="shrink-0" />
              This application is {String(applicationStatus).toLowerCase()} — verification is closed.
            </div>
          )}

          {/* ── 1. Applicant & Co-Applicant KYC ── */}
          <Section title="Applicant & Co-Applicant KYC" icon={User} itemKey="ApplicantKyc">
            <Field label="Applicant" value={a.ApplicantName} icon={User} />
            <Field label="Mobile" value={a.Mobile} icon={Phone} />
            <Field label="Alt. Mobile" value={a.AltMobile} icon={Phone} />
            <Field label="Email" value={a.Email} icon={Mail} />
            <Field label="PAN (customer master)" value={a.PanNo} icon={IdCard} warn={panMismatch} />
            <Field label="Customer No." value={a.CustomerNo} icon={FileBadge} />
            <div className="col-span-2 sm:col-span-3">
              <Field label="Address" value={customerAddress} icon={MapPin} />
            </div>

            {bankDetail && (bankDetail.PanNo || bankDetail.AadhaarNo || bankDetail.AccountHolderName) && (
              <div className="col-span-2 sm:col-span-3 mt-1 pt-2 border-t border-border/60">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">As captured on the KYC / bank details form</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                  <Field label="PAN (KYC form)" value={bankDetail.PanNo} warn={panMismatch} />
                  <Field label="Aadhaar No." value={bankDetail.AadhaarNo} />
                  <Field label="Account Holder Name" value={bankDetail.AccountHolderName} />
                  <Field label="Occupation" value={bankDetail.Occupation} />
                  <Field label="Annual Income" value={bankDetail.AnnualIncome != null && bankDetail.AnnualIncome !== "" ? fmtInr(bankDetail.AnnualIncome) : "—"} />
                </div>
                {panMismatch && (
                  <p className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                    <AlertTriangle size={12} className="shrink-0" /> PAN on the customer master doesn't match the PAN on the KYC form — resolve before checking this off.
                  </p>
                )}
              </div>
            )}

            <div className="col-span-2 sm:col-span-3 mt-1 pt-2 border-t border-border/60">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Co-applicants {coApplicants.length ? `(${coApplicants.length})` : "— none on this application"}
              </p>
              {(coApplicants as any[]).length > 0 && (
                <div className="space-y-2">
                  {(coApplicants as any[]).map((co: any) => (
                    <div key={co.Id} className="rounded-lg bg-muted/30 px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                      <Field label="Name" value={co.Relation ? `${co.Name} (${co.Relation})` : co.Name} />
                      <Field label="Mobile" value={co.Mobile} />
                      <Field label="Email" value={co.Email} />
                      <Field label="PAN" value={co.PanNo} />
                      <Field label="Aadhaar No." value={co.AadhaarNo} />
                      <Field label="Occupation" value={co.Occupation} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {/* ── 2. Project, Unit & Rate ── */}
          <Section title="Project, Unit & Rate" icon={Building2} itemKey="ProjectUnitRate">
            <Field label="Company" value={a.CompanyName} />
            <Field label="Project" value={a.ProjectMasterName || a.InterestedProject} />
            <Field label="Unit" value={a.PreferredUnitName || a.InterestedUnit} />
            <Field label="Unit Type" value={a.UnitTypeFromMaster} />
            <Field label="Unit Area" value={a.UnitAreaSqFt ? `${a.UnitAreaSqFt} sqft` : "—"} />
            <Field label="Rate / SqFt" value={fmtInr(a.RatePerSqFt)} icon={IndianRupee} />
            {!!a.UnitUnavailableForBooking && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs text-red-600 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" /> This unit currently conflicts with another active booking or hold — resolve before approving.
                </p>
              </div>
            )}
          </Section>

          {/* ── 3. Payment Plan & Amounts ── */}
          <Section title="Payment Plan & Amounts" icon={IndianRupee} itemKey="PaymentPlanAmounts">
            <Field label="Payment Plan" value={a.PaymentPlanName} />
            <Field label="Token / Booking Type" value={a.TokenType} />
            <Field
              label="Token Value"
              value={a.TokenValue != null && a.TokenValue !== "" ? (a.TokenType === "Percentage" ? `${a.TokenValue}%` : fmtInr(a.TokenValue)) : "—"}
            />
            <Field label="Booking Amount" value={fmtInr(a.BookingAmount)} />
            {tokenComputedAmount !== null && (
              <Field label="Computed Token Amount" value={fmtInr(tokenComputedAmount)} />
            )}
          </Section>

          {/* ── 4. Deposit Bank, Mode & Instrument ── */}
          <Section title="Deposit Bank, Payment Mode & Instrument" icon={Landmark} itemKey="BankDepositMode">
            <Field label="Deposited To (Company Bank)" value={depositBank?.BName} />
            <Field label="Payment Mode" value={a.PaymentMode} />
            {a.PaymentMode === "Cheque" && (
              <>
                <Field label="Cheque No." value={bankDetail?.ChequeNo} />
                <Field label="Cheque Date" value={fmtDate(bankDetail?.ChequeDate)} />
              </>
            )}
            {a.PaymentMode && !["Cheque", "Cash"].includes(a.PaymentMode) && (
              <Field label="Transaction Reference" value={bankDetail?.TransactionRef} />
            )}
            {a.PaymentMode === "Cash" && (
              <Field label="Instrument Reference" value="Not required for cash" />
            )}

            {bankDetail && (bankDetail.BankName || bankDetail.AccountNo) && (
              <div className="col-span-2 sm:col-span-3 mt-1 pt-2 border-t border-border/60">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Customer's source account (from KYC form)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                  <Field label="Bank Name" value={bankDetail.BankName} />
                  <Field label="Branch" value={bankDetail.BranchName} />
                  <Field label="Account No." value={bankDetail.AccountNo} />
                  <Field label="IFSC Code" value={bankDetail.IfscCode} />
                </div>
              </div>
            )}
          </Section>

          {/* ── 5. Broker / Channel Partner ── */}
          <Section title="Broker / Channel Partner" icon={Users2} itemKey="BrokerDetails">
            {a.BrokerName ? (
              <>
                <Field label="Broker" value={a.BrokerName} />
                <Field label="Brokerage Rate" value={a.BrokerageRatePercent != null && a.BrokerageRatePercent !== "" ? `${a.BrokerageRatePercent}%` : "—"} />
                <Field label="Payout Plan" value={
                  a.BrokeragePaymentPlan === "TwoPart" ? "Two-part payout"
                  : a.BrokeragePaymentPlan === "AgreementOnly" ? "Agreement-only payout"
                  : "One-time — full commission once Booking Amount is paid"
                } />
                <Field label="Channel Partner" value={a.ChannelPartnerName} />
              </>
            ) : (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-sm text-muted-foreground">Direct — no broker on this application.</p>
              </div>
            )}
          </Section>

          {/* ── 6. Source & Assigned To ── */}
          <Section title="Source & Assigned To" icon={Briefcase} itemKey="SourceAssignment">
            <Field label="Source" value={a.Source} />
            <Field label="Platform" value={a.PlatformName} />
            <Field label="Campaign" value={a.CampaignName} />
            <Field label="Ad" value={a.AdName} />
            <Field label="Assigned To" value={a.AssigneeName} />
            <Field label="Assigned By" value={a.AssignedByName} />
            <Field label="Applied On" value={fmtDate(a.DateOfApply)} />
          </Section>

          {/* ── 7. Documents ── */}
          <Section title="Documents" icon={FileBadge} itemKey="Documents">
            {documents.length > 0 ? (
              <div className="col-span-2 sm:col-span-3 space-y-1.5">
                {documents.map((d: any) => (
                  <div key={d.Id} className="flex items-center gap-2 text-xs rounded-md bg-muted/30 px-2.5 py-1.5">
                    <FileText size={12} className="text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground">{d.DocumentType}</span>
                    <span className="text-muted-foreground truncate">— {d.FileName}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-sm text-red-600 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" /> No documents uploaded yet.
                </p>
              </div>
            )}
            {documents.length > 0 && (!hasIdentityProof || !hasAddressProof) && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" />
                  Missing: {[!hasIdentityProof && "Identity Proof", !hasAddressProof && "Address Proof"].filter(Boolean).join(", ")}
                </p>
              </div>
            )}
          </Section>

          {allChecked && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700 flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0" />
              All items verified — this application has been approved.
            </div>
          )}
        </div>
      )}
    </SalesAutoShell>
  );
}