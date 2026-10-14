// Constants and helpers shared by the Loan Sanction page and its parts.
import { type ExportColumn } from "@/lib/export";
import { PAYMENT_MODES } from "@/pages/finance/payment/types";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { type LoanSanction, type LoanType, type InterestCalcType, type LoanPayment } from "@/api/loanSanctionApi";

// A Bank Loan is disbursed by an external bank, not paid out through any of
// our own cash-handling modes — scoped down from the full PAYMENT_MODES
// list (which includes Cash/UPI/Card/IMPS, none of which make sense for a
// bank-to-company loan) to just the modes a bank would actually use.
export const LOAN_BANK_PAYMENT_MODES = ["NEFT", "RTGS", "Demand Draft", "Cheque"] as const;

export const ACCENT = "#22c55e";
export const LOAN_TYPES: LoanType[] = ["Inter-Company", "Bank Loan", "Customer Loan"];

// Common lending benchmarks — shown as quick picks in the dropdown-cum-text
// field, but the field always accepts a typed custom value too.
export const STANDARD_INTEREST_RATES = [6, 8, 9, 10, 12, 15, 18];
export const STANDARD_TENURES = [3, 6, 12, 18, 24, 36, 48, 60];

// Mirrors backend/routes/loanSanction.js's buildEmiSchedule EMI formula —
// this is only a live estimate shown while filling the form; the real
// schedule is generated server-side on sanction.
export function estimateEmi(
  amount: number,
  annualRatePct: number,
  tenureMonths: number,
  interestType: InterestCalcType = "CI",
): number {
  const n = Math.max(1, tenureMonths || 1);
  if (!annualRatePct || annualRatePct <= 0) return amount / n;
  if (interestType === "SI") {
    const totalInterest = amount * (annualRatePct / 100) * (n / 12);
    return amount / n + totalInterest / n;
  }
  const r = annualRatePct / 12 / 100;
  return (amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export const EMPTY_FORM = {
  loanType: "Inter-Company" as LoanType,
  loanDocNo: "",
  lenderCompanyId: "",
  // Bank Loan only — the external lending bank's name (free-typed, or
  // picked from the Major/Minor list — same picker Received Payment uses
  // for a customer's bank). Not one of OUR OWN registered bank accounts;
  // the lender can be any bank, whether or not we happen to also have an
  // account there.
  lenderBankName: "",
  // Inter-Company only — which specific bank account of the lender/borrower
  // company the funds moved between (distinct from lenderBankName, which is
  // only for the Bank Loan type where the lender IS an external bank).
  lenderBankAccountId: "",
  // Customer Loan's second direction — "Customer to Company" (a customer
  // lends TO us), mirroring Bank Loan's shape rather than the original
  // "Company to Customer" one. "toCustomer" (the original, default)
  // preserves existing behavior for anyone not touching this toggle.
  customerLoanDirection: "toCustomer" as "toCustomer" | "toCompany",
  lenderCustomerId: "",
  lenderCustomerSource: "AH" as "AH" | "CRM",
  // Descriptive only (which bank the money came from) — same BankNamePicker
  // Received Payment/Bank Loan use; the customer itself gets a real GL head
  // via ensureLoanLedgerHead regardless of which bank they used.
  lenderCustomerBankName: "",
  borrowerCompanyId: "",
  borrowerCustomerId: "",
  borrowerCustomerSource: "AH" as "AH" | "CRM",
  borrowerBankAccountId: "",
  loanDate: new Date().toISOString().slice(0, 10),
  amount: "",
  hasInterest: false,
  interestType: "CI" as InterestCalcType,
  interestRate: "",
  tenureMonths: "",
  // Only used for a no-breakdown loan (Inter-Company simple transfer, no
  // interest/tenure) — the single overall repayment due date.
  dueDate: "",
  purpose: "",
  remarks: "",
  paymentMode: "Cash" as string,
  chequeLotId: "",
  chequeLotNumber: "",
  chequeNo: "",
  chequeDate: "",
  isPostDated: false,
  digitalRefNumber: "",
  // Demand Draft carries its own ref number + date, same as Cheque has
  // chequeNo/chequeDate, rather than sharing the single generic
  // digitalRefNumber field NEFT/RTGS use.
  demandDraftNo: "",
  demandDraftDate: "",
};

export const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

export const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "—";

// What a repayment was actually paid WITH — a Loan EMI is always settled
// through Finance > Payment first (see migration 340's NewPaymentId link),
// which is where mode/cheque/bank/reference are genuinely captured.
// Returns:
//   string  — a human-readable description of the instrument (cheque/NEFT/UPI etc.)
//   null    — PaymentMode is empty even though NewPaymentId is set (not expected)
//   "NOT_ON_FILE" — NewPaymentId is null: this row pre-dates migration 340;
//                   the caller should render "Payment mode not on file" in muted style.
// What the loan's own disbursement was paid WITH (distinct from
// paymentInstrumentLabel below, which is for a repayment) — LoanSanction
// carries its own PaymentMode/ChequeNo directly, no NewPayment link needed.
export function sanctionInstrumentLabel(loan: LoanSanction): string | null {
  if (!loan.PaymentMode) return null;
  if (loan.PaymentMode === "Cheque" || loan.PaymentMode === "Post-Dated Cheque") {
    return loan.ChequeNo
      ? `Cheque #${loan.ChequeNo}${loan.ChequeDate ? ` dated ${new Date(loan.ChequeDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}`
      : loan.PaymentMode;
  }
  return loan.DigitalRefNumber ? `${loan.PaymentMode} (Ref: ${loan.DigitalRefNumber})` : loan.PaymentMode;
}

// Same info as sanctionInstrumentLabel, compressed for the list table's
// narrow Status column — "#353123 · 19 Aug" instead of "Cheque #353123
// dated 19 Aug 2026". Truncating the full label there cut off the date
// (the actually useful half) rather than the redundant filler words.
export function sanctionInstrumentLabelCompact(loan: LoanSanction): string | null {
  if (!loan.PaymentMode) return null;
  if (loan.PaymentMode === "Cheque" || loan.PaymentMode === "Post-Dated Cheque") {
    if (!loan.ChequeNo) return loan.PaymentMode;
    const date = loan.ChequeDate
      ? new Date(loan.ChequeDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : null;
    return `#${loan.ChequeNo}${date ? ` · ${date}` : ""}`;
  }
  return loan.DigitalRefNumber ? `${loan.PaymentMode} · ${loan.DigitalRefNumber}` : loan.PaymentMode;
}

export function paymentInstrumentLabel(p: LoanPayment): string | null | "NOT_ON_FILE" {
  // BUG 3 FIX: distinguish "no NewPaymentId at all" from "has one but mode blank"
  if (p.NewPaymentId == null) return "NOT_ON_FILE";
  if (!p.PaymentMode) return null;
  if (p.PaymentMode === "Cheque" || p.PaymentMode === "Post-Dated Cheque") {
    const chequeInfo = p.ChequeNo ? `Cheque #${p.ChequeNo}${p.ChequeDate ? ` dated ${new Date(p.ChequeDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}${p.BankName ? ` (${p.BankName})` : ""}` : p.PaymentMode;
    return chequeInfo;
  }
  const ref = p.NeftNumber || p.UpiTransactionId || p.RtgsReference || p.ImpsReference;
  if (ref) return `${p.PaymentMode} (Ref: ${ref})${p.BankName ? ` — ${p.BankName}` : ""}`;
  return p.BankName ? `${p.PaymentMode} — ${p.BankName}` : p.PaymentMode;
}

export const LOAN_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Loan No", accessor: "LoanNo" },
  { header: "Type", accessor: "LoanType" },
  { header: "Lender", accessor: (r: any) => r.LenderCompanyName || r.LenderBankName || "—" },
  { header: "Borrower", accessor: (r: any) => r.BorrowerCompanyName || r.BorrowerCustomerName || "—" },
  { header: "Loan Date", accessor: (r: any) => fmtDate(r.LoanDate) },
  { header: "Amount", accessor: (r: any) => fmt(r.Amount) },
  { header: "Interest Rate", accessor: (r: any) => (r.HasInterest && r.InterestRate != null ? `${r.InterestRate}%` : "—") },
  { header: "Tenure (Months)", accessor: (r: any) => r.TenureMonths ?? "—" },
  { header: "EMI Progress", accessor: (r: any) => `${r.PaidEMIs ?? 0}/${r.TotalEMIs ?? 0}` },
  { header: "Status", accessor: "Status" },
  { header: "Purpose", accessor: (r: any) => r.Purpose || "—" },
];

export const LOAN_TYPE_COLORS: Record<LoanType, string> = {
  "Inter-Company": "#3b82f6",
  "Bank Loan": "#0ea5e9",
  "Customer Loan": "#f59e0b",
};

export const inputCls =
  "w-full border border-foreground/40 focus:border-foreground bg-card px-3 py-2 text-sm text-foreground focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-60";
export const labelCls = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

// Drawing-sheet ink: a heading, a rule, and the two key styles.
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
export const ACT_DEL = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors";
