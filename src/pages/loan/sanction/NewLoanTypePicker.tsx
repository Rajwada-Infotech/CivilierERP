import { FileText, Upload } from "lucide-react";
import { LOAN_BANK_PAYMENT_MODES, LOAN_TYPES, inputCls, labelCls } from "./shared";
import type { LoanSanctionState } from "./useLoanSanction";

// Create mode only: the loan type, customer-loan direction and loan doc no.
export function NewLoanTypePicker({ ls }: { ls: LoanSanctionState }) {
  const { form, pendingDocumentFile, setPendingDocumentFile, documentInputRef, set, readOnly } = ls;
  return (
    <>
      {!readOnly && (
        <>
          <div className="space-y-2">
            <label className={labelCls}>Loan Type <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {LOAN_TYPES.map((lt) => (
                <button
                  key={lt}
                  type="button"
                  onClick={() => {
                    set("loanType", lt);
                    // Inter-Company defaults to a simple transfer —
                    // interest & tenure only apply once explicitly toggled on.
                    if (lt === "Inter-Company") {
                      set("hasInterest", false);
                    } else if (form.loanType === "Inter-Company") {
                      set("hasInterest", true);
                    }
                    // Bank Loan's payment mode is scoped to
                    // LOAN_BANK_PAYMENT_MODES (NEFT/RTGS/Demand
                    // Draft/Cheque) — "Cash" (the form's overall
                    // default) isn't one of them, so switching
                    // into Bank Loan without resetting would leave
                    // every mode button unselected. Customer Loan
                    // only needs the same reset once its
                    // direction toggle (below) picks "Customer to
                    // Company" — handled there, not here.
                    if (lt === "Bank Loan" && !(LOAN_BANK_PAYMENT_MODES as readonly string[]).includes(form.paymentMode)) {
                      set("paymentMode", "NEFT");
                    }
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.loanType === lt
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-border text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {lt}
                </button>
              ))}
            </div>
          </div>
          {form.loanType === "Customer Loan" && (
            <div className="space-y-2">
              <label className={labelCls}>Direction</label>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { key: "toCustomer", label: "Company → Customer", hint: "We lend to the customer" },
                    { key: "toCompany", label: "Customer → Company", hint: "The customer lends to us" },
                  ] as const
                ).map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => {
                      set("customerLoanDirection", d.key);
                      if (d.key === "toCompany" && !(LOAN_BANK_PAYMENT_MODES as readonly string[]).includes(form.paymentMode)) {
                        set("paymentMode", "NEFT");
                      }
                    }}
                    className={`px-3 py-2 rounded-lg text-left text-sm font-medium border transition-colors ${
                      form.customerLoanDirection === d.key
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-border text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    <span className="block">{d.label}</span>
                    <span className="block text-[0.6875rem] font-normal opacity-75">{d.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <label className={labelCls}>Loan Doc No.</label>
            <div className="flex items-center gap-2">
              <input
                className={inputCls}
                placeholder="e.g. an external reference or agreement number"
                value={form.loanDocNo}
                onChange={(e) => set("loanDocNo", e.target.value)}
              />
              <input
                ref={documentInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setPendingDocumentFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => documentInputRef.current?.click()}
                title="Attach loan document (agreement, sanction letter etc.)"
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  pendingDocumentFile
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border text-muted-foreground hover:bg-muted/40"
                }`}
              >
                <Upload size={12} />
                {pendingDocumentFile ? "Attached" : "Attach"}
              </button>
            </div>
            {pendingDocumentFile && (
              <p className="text-[0.6875rem] text-muted-foreground flex items-center gap-1.5">
                <FileText size={11} /> {pendingDocumentFile.name}
                <button
                  type="button"
                  onClick={() => setPendingDocumentFile(null)}
                  className="text-muted-foreground hover:text-destructive underline underline-offset-2"
                >
                  remove
                </button>
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
