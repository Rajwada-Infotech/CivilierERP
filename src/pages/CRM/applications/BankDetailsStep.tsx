// Wizard step: Bank / KYC.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { BANK_DETAIL_API, EMPTY_BANK, inputCls, labelCls } from "./config";

// ── Step 3: Bank / KYC — identity & bank details only ────────────────────────
// Identity fields the Customer master already captures at intake — when the
// KYC form loads with no bank-detail row saved yet, the backend pre-fills
// these from dbo.CrmCustomer and flags the response _prefilledFrom:
// "customer". Those (and only those) fields render locked/view-only below,
// with an explicit "Edit" toggle to recheck and confirm against the
// customer — never silently editable as if freshly typed. Once this form is
// saved once, its own CrmCustomerBankDetail row exists going forward, so
// later loads return real saved data (no _prefilledFrom flag) and every
// field is a normal, already-unlocked input.
const KYC_PREFILL_KEYS = ["PanNo", "AccountHolderName", "AadhaarNo", "Occupation", "AnnualIncome"] as const;

// Bank/KYC fields are NOT mandatory — matches the backend's own stance
// (business decision 2026-09-15, see validateAgreementPreparationPrerequisites
// in crmWorkflowGuards.js: "Agreement prep no longer requires a
// CrmCustomerBankDetail row to exist or be filled in", and the PUT
// /application/:id save route itself never required any of these either).
// This form used to enforce a stricter client-side rule than the backend
// ever did — kept "in sync" with a backend constant that had already moved
// on, so this step blocked staff from proceeding on data nothing downstream
// actually required. Empty now; format validation (IFSC/PAN/Aadhaar shape)
// below still applies whenever a value IS provided.
const BANK_STEP_REQUIRED_FIELDS: [keyof typeof EMPTY_BANK, string][] = [];

// The one format check for this form — used by Next and by autosave.
const bankFormatError = (b: any): string | null => {
  if (b.IfscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.IfscCode.toUpperCase())) return "Invalid IFSC format (e.g. HDFC0001234)";
  if (b.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(b.PanNo.toUpperCase())) return "Invalid PAN format (e.g. ABCDE1234F)";
  if (b.AadhaarNo && !/^\d{12}$/.test(b.AadhaarNo)) return "Aadhaar must be exactly 12 digits";
  return null;
};

export const BankDetailsStep: React.FC<{
  applicationId: number;
  applicantName?: string;
  applicantAddress?: string;
  onRegisterSave?: (fn: null | (() => Promise<void>)) => void;
}> = ({ applicationId, applicantName, applicantAddress, onRegisterSave }) => {
  const [bank, setBank] = useState({ ...EMPTY_BANK });
  const [bankSaving, setBankSaving] = useState(false);
  const [bankLoaded, setBankLoaded] = useState(false);
  // Which of KYC_PREFILL_KEYS are currently locked (auto-fetched from the
  // customer record, not yet reviewed/confirmed by staff this time around).
  const [kycLocked, setKycLocked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setBankLoaded(false);
    setBank({ ...EMPTY_BANK });
    setKycLocked(new Set());
    fetchWithAuth(`${BANK_DETAIL_API}/application/${applicationId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d) return;
        setBank({
          BankName: d.BankName || "", BranchName: d.BranchName || "", AccountNo: d.AccountNo || "",
          IfscCode: d.IfscCode || "", AccountHolderName: d.AccountHolderName || "",
          PanNo: d.PanNo || "", AadhaarNo: d.AadhaarNo || "",
          Occupation: d.Occupation || "", AnnualIncome: d.AnnualIncome != null ? String(d.AnnualIncome) : "",
        });
        if (d._prefilledFrom === "customer") {
          const locked = new Set<string>();
          KYC_PREFILL_KEYS.forEach((k) => { if (d[k] !== null && d[k] !== undefined && String(d[k]).trim() !== "") locked.add(k); });
          setKycLocked(locked);
        }
      })
      .finally(() => { if (!cancelled) setBankLoaded(true); });
    return () => { cancelled = true; };
  }, [applicationId]);

  const saveBank = useCallback(async (silent = false) => {
    // Block here, not just downstream at agreement prep — this is the one
    // place this data is actually typed in, so a gap caught here is a
    // one-field fix; the same gap caught later (validateAgreementPreparationPrerequisites
    // in crmWorkflowGuards.js) reads as "why won't the agreement create" with
    // no obvious link back to this step, or worse, looks like a fetch bug on
    // a completely different screen (the Booking-tab Bank Details view).
    const missing = BANK_STEP_REQUIRED_FIELDS.filter(([key]) => !String((bank as any)[key] || "").trim());
    if (missing.length) {
      const msg = `Missing required field(s): ${missing.map(([, label]) => label).join(", ")}`;
      toast.error(msg);
      throw new Error(msg);
    }
    const formatError = bankFormatError(bank);
    if (formatError) { toast.error(formatError); throw new Error(formatError); }
    setBankSaving(true);
    try {
      const res = await fetchWithAuth(`${BANK_DETAIL_API}/application/${applicationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bank),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      if (!silent) toast.success("Bank/KYC details saved");
    } catch (e: any) {
      toast.error(translateError(e.message));
      throw e;
    } finally {
      setBankSaving(false);
    }
  }, [applicationId, bank]);

  useEffect(() => {
    onRegisterSave?.(() => saveBank(true));
    return () => onRegisterSave?.(null);
  }, [onRegisterSave, saveBank]);

  // Autosave: a second after typing stops, what is typed is saved to the
  // application — Next pressed or not. Skipped quietly while a PAN / IFSC /
  // Aadhaar is still half-typed; Next still checks and reports those.
  const typed = useRef(false);
  useEffect(() => {
    if (!bankLoaded) return;
    if (!typed.current) { typed.current = true; return; }
    if (bankFormatError(bank)) return;
    const t = setTimeout(() => {
      fetchWithAuth(`${BANK_DETAIL_API}/application/${applicationId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bank),
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [bank, bankLoaded, applicationId]);
  useEffect(() => { typed.current = false; }, [applicationId]);

  return (
    <div className="space-y-4">
      <div className=" border border-border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">KYC / Bank Details</label>
          <button onClick={() => saveBank()} disabled={bankSaving || !bankLoaded}
            className="text-xs px-2.5 py-1 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40">
            {bankSaving ? "Saving..." : "Save"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ["BankName", "Bank Name"], ["BranchName", "Branch"], ["AccountNo", "Account No"], ["IfscCode", "IFSC Code"],
            ["AccountHolderName", "Account Holder Name"], ["PanNo", "PAN (Permanent Account Number)"], ["AadhaarNo", "Aadhaar No"],
            ["Occupation", "Occupation"], ["AnnualIncome", "Annual Income"],
          ].map(([key, label]) => (
            <div key={key}>
              <label className={labelCls}>{label}{BANK_STEP_REQUIRED_FIELDS.some(([rk]) => rk === key) && " *"}</label>
              {kycLocked.has(key) ? (
                <div className="flex items-center justify-between gap-2 bg-muted/30 px-2 py-1.5 border border-border">
                  <span className="text-sm text-foreground truncate">{(bank as any)[key] || "—"} <span className="text-xs text-muted-foreground">(auto-fetched from customer)</span></span>
                  <button type="button" onClick={() => setKycLocked((s) => { const next = new Set(s); next.delete(key); return next; })}
                    className="text-xs text-primary hover:underline shrink-0">
                    Edit
                  </button>
                </div>
              ) : (
                <input value={(bank as any)[key]}
                  onChange={(e) => {
                    const val = ["IfscCode", "PanNo"].includes(key) ? e.target.value.toUpperCase() : e.target.value;
                    setBank((b) => ({ ...b, [key]: val }));
                  }}
                  className={inputCls} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
