import { Percent } from "lucide-react";
import { type CompanyOption, type BankRecord } from "@/api/bankMasterApi";
import { PAYMENT_MODES } from "@/pages/finance/payment/types";
import { MODE_STYLE } from "@/pages/finance/payment/constants";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { type CustomerOption } from "@/api/loanSanctionApi";
import { DateInput } from "@/components/ui/date-input";
import { LOAN_BANK_PAYMENT_MODES, STANDARD_INTEREST_RATES, STANDARD_TENURES, fmt, inputCls, labelCls } from "./shared";
import { LoanChequePicker } from "./LoanChequePicker";
import { CustomerComboField, ComboField } from "./parts";
import type { LoanSanctionState } from "./useLoanSanction";

// Create mode: parties, amount and terms, disbursement instrument, documents.
export function NewLoanForm({ ls }: { ls: LoanSanctionState }) {
  const { form, setForm, companies, customers, banksForCompany, schedule, set, companyName, isInterCompanyType, isCustomerLoan, isBankLoan, isCustomerToCompany, isExternalLenderLoan, estimatedEmi, estimatedTotalRepayable, estimatedTotalInterest } = ls;
  return (
    <>
      <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="space-y-2">
            <label className={labelCls}>
              Lender {isBankLoan ? "Bank" : isCustomerToCompany ? "Customer" : "Company"} <span className="text-red-500">*</span>
            </label>
            {isBankLoan ? (
              // Any bank the loan is actually from — not
              // restricted to one of our own registered
              // company-linked bank accounts (those are a
              // different thing entirely: where WE bank, not
              // who lent US money). Same Major/Minor bank
              // picker Received Payment uses for a customer's
              // bank, since this is exactly the same kind of
              // field — a bank identified by name only.
              <BankNamePicker
                value={form.lenderBankName}
                onChange={(v) => set("lenderBankName", v)}
                placeholder="Select the lending bank…"
                otherPlaceholder="Lending bank's name"
                className={inputCls}
              />
            ) : isCustomerToCompany ? (
              <CustomerComboField
                customers={customers as CustomerOption[]}
                value={form.lenderCustomerId}
                onChange={(id, source) => {
                  set("lenderCustomerId", id);
                  setForm((f) => ({ ...f, lenderCustomerSource: source }));
                }}
                inputClassName={inputCls}
              />
            ) : (
              <select
                className={inputCls}
                value={form.lenderCompanyId}
                onChange={(e) => {
                  set("lenderCompanyId", e.target.value);
                  // A bank A/C picked for the previous company no
                  // longer applies once the company changes.
                  set("lenderBankAccountId", "");
                }}
              >
                <option value="">— Select —</option>
                {companies.map((c: CompanyOption) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {/* Which bank the customer actually sent the money
              from — descriptive only (same role as Bank Loan's
              own lender-bank field), not itself a GL account. */}
          {isCustomerToCompany && (
            <div className="space-y-2">
              <label className={labelCls}>Customer's Bank</label>
              <BankNamePicker
                value={form.lenderCustomerBankName}
                onChange={(v) => set("lenderCustomerBankName", v)}
                placeholder="Select the customer's bank…"
                otherPlaceholder="Customer's bank name"
                className={inputCls}
              />
            </div>
          )}
          <div className="space-y-2">
            <label className={labelCls}>Borrower {isCustomerLoan && !isCustomerToCompany ? "Customer" : "Company"} <span className="text-red-500">*</span></label>
            {isCustomerLoan && !isCustomerToCompany ? (
              <CustomerComboField
                customers={customers as CustomerOption[]}
                value={form.borrowerCustomerId}
                onChange={(id, source) => {
                  set("borrowerCustomerId", id);
                  setForm((f) => ({ ...f, borrowerCustomerSource: source }));
                }}
                inputClassName={inputCls}
              />
            ) : (
              <select
                className={inputCls}
                value={form.borrowerCompanyId}
                onChange={(e) => {
                  set("borrowerCompanyId", e.target.value);
                  set("borrowerBankAccountId", "");
                }}
              >
                <option value="">— Select —</option>
                {companies.map((c: CompanyOption) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Lender Bank A/C — which of the lender COMPANY's own
              bank accounts the funds left from. Only meaningful
              when the lender actually is one of our companies
              (Inter-Company, or Customer Loan's original
              Company-to-Customer direction) — Bank Loan's lender
              is external (own field above), and Customer-to-
              Company's lender is a customer, neither has a bank
              account of ours to tag here. */}
          {(isInterCompanyType || (isCustomerLoan && !isCustomerToCompany)) && (
            <div className="space-y-2">
              <label className={labelCls}>Lender Bank A/C</label>
              <select
                className={inputCls}
                value={form.lenderBankAccountId}
                onChange={(e) => set("lenderBankAccountId", e.target.value)}
                disabled={!form.lenderCompanyId}
              >
                <option value="">— Select —</option>
                {banksForCompany(companyName(form.lenderCompanyId)).map((b: BankRecord) => (
                  <option key={b.BId} value={b.BId}>
                    {b.BName}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Borrower Bank A/C — which of the borrower COMPANY's
              own bank accounts receives the funds. Applies to
              Inter-Company AND every "external lender, we're
              the borrower" shape (Bank Loan, Customer-to-
              Company) — the original Customer Loan direction's
              borrower is external and has no bank account of
              ours to tag. */}
          {(isInterCompanyType || isExternalLenderLoan) && (
            <div className="space-y-2">
              <label className={labelCls}>Borrower Bank A/C</label>
              <select
                className={inputCls}
                value={form.borrowerBankAccountId}
                onChange={(e) => set("borrowerBankAccountId", e.target.value)}
                disabled={!form.borrowerCompanyId}
              >
                <option value="">— Select —</option>
                {banksForCompany(companyName(form.borrowerCompanyId)).map((b: BankRecord) => (
                  <option key={b.BId} value={b.BId}>
                    {b.BName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <label className={labelCls}>Loan Date <span className="text-red-500">*</span></label>
            <DateInput
              className={inputCls}
              value={form.loanDate}
              onChange={(e) => set("loanDate", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className={labelCls}>Amount <span className="text-red-500">*</span></label>
            <input
              type="number"
              className={inputCls}
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
            />
          </div>
          {isInterCompanyType && !form.hasInterest && (
            <div className="space-y-2">
              <label className={labelCls}>Repayment Due Date</label>
              <DateInput
                className={inputCls}
                value={form.dueDate}
                min={form.loanDate || undefined}
                onChange={(e) => set("dueDate", e.target.value)}
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                No EMIs — whole amount due back on this date.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border px-3.5 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {isInterCompanyType ? "Activate Interest & Tenure" : "Interest-bearing loan"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isInterCompanyType
                ? "Off = a simple transfer with no schedule; on = structured with interest and a repayment tenure"
                : "Turn off for an interest-free loan"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => set("hasInterest", !form.hasInterest)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              form.hasInterest ? "bg-emerald-500" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                form.hasInterest ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {(!isInterCompanyType || form.hasInterest) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {form.hasInterest && (
              <div className="space-y-2">
                <label className={labelCls}>Interest Rate (% p.a.)</label>
                <ComboField
                  value={form.interestRate}
                  onChange={(v) => set("interestRate", v.replace(/[^0-9.]/g, ""))}
                  options={STANDARD_INTEREST_RATES.map((r) => ({ value: String(r), label: `${r}% p.a.` }))}
                  placeholder="Select or type a rate"
                  inputClassName={inputCls}
                />
              </div>
            )}
            <div className="space-y-2">
              <label className={labelCls}>Tenure (months)</label>
              <ComboField
                value={form.tenureMonths}
                onChange={(v) => set("tenureMonths", v.replace(/[^0-9]/g, ""))}
                options={STANDARD_TENURES.map((t) => ({ value: String(t), label: `${t} months` }))}
                placeholder="Select or type a tenure"
                inputClassName={inputCls}
              />
            </div>
          </div>
        )}
        {(form.interestRate || form.tenureMonths) && form.amount && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Percent size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Estimated EMI:{" "}
                <span className="font-semibold text-foreground">{fmt(estimatedEmi)}</span> / month for{" "}
                {form.tenureMonths || 1} month{Number(form.tenureMonths) === 1 ? "" : "s"}
                {form.hasInterest && form.interestRate ? ` at ${form.interestRate}% p.a.` : " (flat, no interest)"}.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-emerald-500/15">
              <div>
                <p className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
                  Total Interest
                </p>
                <p className="text-sm font-semibold text-foreground">{fmt(estimatedTotalInterest)}</p>
              </div>
              <div>
                <p className="text-[0.625rem] uppercase tracking-widest text-muted-foreground">
                  Total Repayable
                </p>
                <p className="text-sm font-semibold text-foreground">{fmt(estimatedTotalRepayable)}</p>
              </div>
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">
              Full installment-by-installment breakdown is generated on sanctioning.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <label className={labelCls}>Payment Mode</label>
          <div className="flex flex-wrap gap-2">
            {(isExternalLenderLoan ? LOAN_BANK_PAYMENT_MODES : PAYMENT_MODES).map((m) => {
              const s = MODE_STYLE[m] ?? { ring: "ring-border bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" };
              const active = form.paymentMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    set("paymentMode", m);
                    set("isPostDated", m === "Post-Dated Cheque");
                    if (m !== "Cheque" && m !== "Post-Dated Cheque") {
                      set("chequeLotId", "");
                      set("chequeLotNumber", "");
                      set("chequeNo", "");
                      set("chequeDate", "");
                    }
                    // Demand Draft gets its own ref+date pair
                    // below, not the shared Reference Number
                    // field NEFT/RTGS/UPI use.
                    if (["Cash", "Cheque", "Post-Dated Cheque", "Demand Draft"].includes(m)) {
                      set("digitalRefNumber", "");
                    }
                    if (m !== "Demand Draft") {
                      set("demandDraftNo", "");
                      set("demandDraftDate", "");
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-semibold border transition-all ring-1 ${
                    active
                      ? `${s.ring} ${s.text} border-transparent shadow-sm`
                      : "bg-background border-border text-muted-foreground ring-transparent hover:border-primary/40"
                  }`}
                >
                  {active && <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />}
                  {m}
                </button>
              );
            })}
          </div>
        </div>

        {(() => {
          const isChequeMode = form.paymentMode === "Cheque" || form.paymentMode === "Post-Dated Cheque";
          const isDemandDraftMode = form.paymentMode === "Demand Draft";
          // Inter-Company/Customer Loan (Company-to-Customer
          // direction) only: the lender company's own tagged
          // bank A/C (which bank the funds actually left from)
          // — cheque lots are scoped to that specific bank, not
          // shown at all until it's picked. Bank Loan and
          // Customer-to-Company's cheque doesn't come from any
          // lot of ours at all (see the isExternalLenderLoan
          // branch below) — the external party issues it, not us.
          const chequeLotBankId = isExternalLenderLoan
            ? null
            : (form.lenderBankAccountId ? Number(form.lenderBankAccountId) : null);
          // Nothing to show for Cash, and (for Inter-Company/
          // Customer Loan) nothing to show for Cheque mode
          // until a bank is actually picked — skip the grid
          // entirely rather than leaving an empty gap. Bank
          // Loan/Customer-to-Company's cheque fields don't need
          // a bank picked first (they're free-typed), so this
          // guard doesn't apply to them.
          if (form.paymentMode === "Cash" || (isChequeMode && !isExternalLenderLoan && !chequeLotBankId)) return null;
          return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {isChequeMode && isExternalLenderLoan && (
            // A cheque disbursed BY an external bank/customer
            // isn't drawn from any cheque lot of ours —
            // free-typed fields, same as the Reference Number
            // field below handles NEFT/RTGS.
            <>
              <div className="space-y-2">
                <label className={labelCls}>Cheque Number</label>
                <input
                  className={inputCls}
                  placeholder="Cheque number"
                  value={form.chequeNo}
                  onChange={(e) => set("chequeNo", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className={labelCls}>Cheque Date</label>
                <DateInput
                  className={inputCls}
                  value={form.chequeDate}
                  onChange={(e) => set("chequeDate", e.target.value)}
                />
              </div>
            </>
          )}
          {isChequeMode && !isExternalLenderLoan && (
            <LoanChequePicker
              bankId={chequeLotBankId}
              chequeLotId={form.chequeLotId}
              chequeNo={form.chequeNo}
              chequeDate={form.chequeDate}
              isPostDated={form.isPostDated}
              onLotChange={(lot) => {
                set("chequeLotId", String(lot.CId));
                set("chequeLotNumber", lot.ChequeLotNumber);
                set("chequeNo", "");
              }}
              onChequeNoChange={(v) => set("chequeNo", v)}
              onChequeDateChange={(v) => set("chequeDate", v)}
            />
          )}

          {/* Demand Draft carries its own ref number + date,
              same as Cheque has a number + date, rather than
              sharing the single generic Reference Number field
              NEFT/RTGS use below. */}
          {isDemandDraftMode && (
            <>
              <div className="space-y-2">
                <label className={labelCls}>DD Reference Number</label>
                <input
                  className={inputCls}
                  placeholder="Demand Draft number"
                  value={form.demandDraftNo}
                  onChange={(e) => set("demandDraftNo", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className={labelCls}>DD Date</label>
                <DateInput
                  className={inputCls}
                  value={form.demandDraftDate}
                  onChange={(e) => set("demandDraftDate", e.target.value)}
                />
              </div>
            </>
          )}

          {!isChequeMode && !isDemandDraftMode && (
            <div className="space-y-2">
              <label className={labelCls}>Reference Number</label>
              <input
                className={inputCls}
                placeholder="UTR / Ref No"
                value={form.digitalRefNumber}
                onChange={(e) => set("digitalRefNumber", e.target.value)}
              />
            </div>
          )}
        </div>
          );
        })()}
        <div className="grid grid-cols-2 gap-5 mt-5">
          <div className="space-y-2">
            <label className={labelCls}>Purpose</label>
            <input
              className={inputCls}
              placeholder="e.g. Working capital support"
              value={form.purpose}
              onChange={(e) => set("purpose", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className={labelCls}>Remarks</label>
            <input
              className={inputCls}
              placeholder="Optional notes…"
              value={form.remarks}
              onChange={(e) => set("remarks", e.target.value)}
            />
          </div>
        </div>
      </>
    </>
  );
}
