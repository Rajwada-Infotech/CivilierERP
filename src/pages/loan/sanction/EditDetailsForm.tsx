import { AlertTriangle, Pencil, Save, X as XIcon } from "lucide-react";
import { type CompanyOption, type BankRecord } from "@/api/bankMasterApi";
import { PAYMENT_MODES } from "@/pages/finance/payment/types";
import { DateInput } from "@/components/ui/date-input";
import { LOAN_BANK_PAYMENT_MODES, inputCls, labelCls } from "./shared";
import { LoanChequePicker } from "./LoanChequePicker";
import { SectionLabel } from "./parts";
import type { LoanSanctionState } from "./useLoanSanction";

// Editing the safe administrative and term fields of an already-sanctioned loan.
export function EditDetailsForm({ ls }: { ls: LoanSanctionState }) {
  const { viewingLoan, editingDetails, setEditingDetails, editForm, setEditForm, savingDetails, companies, banksForCompany, handleSaveDetails, isInterCompanyType, isCustomerLoanType, isBankLoan, paidEmis } = ls;
  return (
    <>
      {editingDetails && (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4 space-y-4">
          <SectionLabel icon={Pencil} label="Edit Loan Details" />
          {paidEmis > 0 && viewingLoan?.Status !== "Closed" && (
            <p className="text-[0.6875rem] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 -mt-2">
              <AlertTriangle size={11} /> {paidEmis} installment{paidEmis === 1 ? " is" : "s are"} already paid and stay as they are. Changing the amount, interest or tenure rebuilds only the unpaid installments for the principal still outstanding.
            </p>
          )}
          {viewingLoan?.Status === "Closed" && (
            <p className="text-[0.6875rem] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 -mt-2">
              <AlertTriangle size={11} /> This loan is closed: only Loan Doc No, Purpose, Remarks and bank A/C tags can be edited.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelCls}>Loan Doc No.</label>
              <input
                className={inputCls}
                value={editForm.loanDocNo}
                onChange={(e) => setEditForm((f) => ({ ...f, loanDocNo: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Loan Date</label>
              <DateInput
                className={inputCls}
                disabled={viewingLoan?.Status === "Closed"}
                value={editForm.loanDate}
                onChange={(e) => setEditForm((f) => ({ ...f, loanDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Amount</label>
              <input
                type="number"
                className={inputCls}
                disabled={viewingLoan?.Status === "Closed"}
                value={editForm.amount}
                onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Tenure (months)</label>
              <input
                type="number"
                className={inputCls}
                disabled={viewingLoan?.Status === "Closed"}
                value={editForm.tenureMonths}
                onChange={(e) => setEditForm((f) => ({ ...f, tenureMonths: e.target.value.replace(/[^0-9]/g, "") }))}
              />
            </div>
            <div className="space-y-1.5 col-span-2 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
              <span className="text-sm font-medium text-foreground">Interest-bearing loan</span>
              <button
                type="button"
                disabled={viewingLoan?.Status === "Closed"}
                onClick={() => setEditForm((f) => ({ ...f, hasInterest: !f.hasInterest }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                  editForm.hasInterest ? "bg-emerald-500" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                    editForm.hasInterest ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {editForm.hasInterest && (
              <div className="space-y-1.5">
                <label className={labelCls}>Interest Rate (% p.a.)</label>
                <input
                  type="number"
                  className={inputCls}
                  disabled={viewingLoan?.Status === "Closed"}
                  value={editForm.interestRate}
                  onChange={(e) => setEditForm((f) => ({ ...f, interestRate: e.target.value.replace(/[^0-9.]/g, "") }))}
                />
              </div>
            )}
            {isInterCompanyType && !editForm.hasInterest && (
              <div className="space-y-1.5">
                <label className={labelCls}>Repayment Due Date</label>
                <DateInput
                  className={inputCls}
                  disabled={viewingLoan?.Status === "Closed"}
                  value={editForm.dueDate}
                  min={editForm.loanDate || undefined}
                  onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            )}
            {(isInterCompanyType || isCustomerLoanType) && (
              <>
                <div className="space-y-1.5">
                  <label className={labelCls}>Lender Bank A/C</label>
                  <select
                    className={inputCls}
                    value={editForm.lenderBankAccountId}
                    onChange={(e) => setEditForm((f) => ({ ...f, lenderBankAccountId: e.target.value }))}
                  >
                    <option value="">— No bank A/C tag —</option>
                    {banksForCompany(viewingLoan?.LenderCompanyName || "").map((b: BankRecord) => (
                      <option key={b.BId} value={b.BId}>{b.BName}</option>
                    ))}
                  </select>
                </div>
                {/* Borrower Bank A/C only applies to
                    Inter-Company — a Customer Loan's borrower
                    is external, with no bank account of ours
                    to tag. */}
                {isInterCompanyType && (
                  <div className="space-y-1.5">
                    <label className={labelCls}>Borrower Bank A/C</label>
                    <select
                      className={inputCls}
                      value={editForm.borrowerBankAccountId}
                      onChange={(e) => setEditForm((f) => ({ ...f, borrowerBankAccountId: e.target.value }))}
                    >
                      <option value="">— No bank A/C tag —</option>
                      {banksForCompany(viewingLoan?.BorrowerCompanyName || "").map((b: BankRecord) => (
                        <option key={b.BId} value={b.BId}>{b.BName}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
            {viewingLoan?.Status !== "Closed" && viewingLoan?.LenderCompanyId != null && (
              <div className="space-y-1.5">
                <label className={labelCls}>Lender Company</label>
                <select
                  className={inputCls}
                  value={editForm.lenderCompanyId}
                  onChange={(e) => setEditForm((f) => ({ ...f, lenderCompanyId: e.target.value, lenderBankAccountId: "" }))}
                >
                  {companies.map((c: CompanyOption) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
            )}
            {viewingLoan?.Status !== "Closed" && viewingLoan?.BorrowerCompanyId != null && (
              <div className="space-y-1.5">
                <label className={labelCls}>Borrower Company</label>
                <select
                  className={inputCls}
                  value={editForm.borrowerCompanyId}
                  onChange={(e) => setEditForm((f) => ({ ...f, borrowerCompanyId: e.target.value, borrowerBankAccountId: "" }))}
                >
                  {companies.map((c: CompanyOption) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5 col-span-2">
              <label className={labelCls}>Disbursed Via</label>
              <div className="flex flex-wrap gap-2">
                {((isBankLoan || (isCustomerLoanType && !!viewingLoan?.LenderCustomerId)) ? LOAN_BANK_PAYMENT_MODES : PAYMENT_MODES).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setEditForm((f) => ({
                        ...f,
                        paymentMode: m,
                        isPostDated: m === "Post-Dated Cheque",
                        ...(m !== "Cheque" && m !== "Post-Dated Cheque" ? { chequeLotId: "", chequeLotNumber: "", chequeNo: "", chequeDate: "" } : {}),
                        ...(["Cash", "Cheque", "Post-Dated Cheque", "Demand Draft"].includes(m) ? { digitalRefNumber: "" } : {}),
                        ...(m !== "Demand Draft" ? { demandDraftNo: "", demandDraftDate: "" } : {}),
                      }))
                    }
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      editForm.paymentMode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {(editForm.paymentMode === "Cheque" || editForm.paymentMode === "Post-Dated Cheque") &&
              (isBankLoan || (isCustomerLoanType && !!viewingLoan?.LenderCustomerId) ? (
                <>
                  <div className="space-y-1.5">
                    <label className={labelCls}>Cheque Number</label>
                    <input className={inputCls} value={editForm.chequeNo} onChange={(e) => setEditForm((f) => ({ ...f, chequeNo: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelCls}>Cheque Date</label>
                    <DateInput className={inputCls} value={editForm.chequeDate} onChange={(e) => setEditForm((f) => ({ ...f, chequeDate: e.target.value }))} />
                  </div>
                </>
              ) : (
                <LoanChequePicker
                  bankId={editForm.lenderBankAccountId ? Number(editForm.lenderBankAccountId) : null}
                  chequeLotId={editForm.chequeLotId}
                  chequeNo={editForm.chequeNo}
                  chequeDate={editForm.chequeDate}
                  isPostDated={editForm.paymentMode === "Post-Dated Cheque"}
                  onLotChange={(lot) => setEditForm((f) => ({ ...f, chequeLotId: String(lot.CId), chequeLotNumber: lot.ChequeLotNumber, chequeNo: "" }))}
                  onChequeNoChange={(v) => setEditForm((f) => ({ ...f, chequeNo: v }))}
                  onChequeDateChange={(v) => setEditForm((f) => ({ ...f, chequeDate: v }))}
                />
              ))}
            {editForm.paymentMode === "Demand Draft" && (
              <>
                <div className="space-y-1.5">
                  <label className={labelCls}>DD Reference Number</label>
                  <input className={inputCls} value={editForm.demandDraftNo} onChange={(e) => setEditForm((f) => ({ ...f, demandDraftNo: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelCls}>DD Date</label>
                  <DateInput className={inputCls} value={editForm.demandDraftDate} onChange={(e) => setEditForm((f) => ({ ...f, demandDraftDate: e.target.value }))} />
                </div>
              </>
            )}
            {!!editForm.paymentMode && !["Cash", "Cheque", "Post-Dated Cheque", "Demand Draft"].includes(editForm.paymentMode) && (
              <div className="space-y-1.5">
                <label className={labelCls}>Reference Number</label>
                <input className={inputCls} placeholder="UTR / Ref No" value={editForm.digitalRefNumber} onChange={(e) => setEditForm((f) => ({ ...f, digitalRefNumber: e.target.value }))} />
              </div>
            )}
            <div className="space-y-1.5 col-span-2">
              <label className={labelCls}>Purpose</label>
              <input
                className={inputCls}
                value={editForm.purpose}
                onChange={(e) => setEditForm((f) => ({ ...f, purpose: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <label className={labelCls}>Remarks</label>
              <input
                className={inputCls}
                value={editForm.remarks}
                onChange={(e) => setEditForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingDetails(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              <XIcon size={12} /> Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveDetails}
              disabled={savingDetails}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium btn-module text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Save size={12} /> {savingDetails ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
