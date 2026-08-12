import { formatINR } from "@/utils/formatCurrency";
import type { ExportColumn } from "@/lib/export";

// ─── Payment mode styling ───────────────────────────────────────────────────

export const MODE_STYLE: Record<
  string,
  { ring: string; text: string; dot: string }
> = {
  Cash: {
    ring: "ring-emerald-500/30 bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  Cheque: {
    ring: "ring-blue-500/30 bg-blue-500/10",
    text: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  "Post-Dated Cheque": {
    ring: "ring-indigo-500/30 bg-indigo-500/10",
    text: "text-indigo-600 dark:text-indigo-400",
    dot: "bg-indigo-500",
  },
  UPI: {
    ring: "ring-violet-500/30 bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  Card: {
    ring: "ring-amber-500/30 bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  NEFT: {
    ring: "ring-cyan-500/30 bg-cyan-500/10",
    text: "text-cyan-600 dark:text-cyan-400",
    dot: "bg-cyan-500",
  },
  RTGS: {
    ring: "ring-orange-500/30 bg-orange-500/10",
    text: "text-orange-600 dark:text-orange-400",
    dot: "bg-orange-500",
  },
  IMPS: {
    ring: "ring-pink-500/30 bg-pink-500/10",
    text: "text-pink-600 dark:text-pink-400",
    dot: "bg-pink-500",
  },
};

// ─── IFSC → bank display name lookup ────────────────────────────────────────

export const IFSC_BANK_MAP: Record<string, string> = {
  SBIN: "SBI", SBIM: "SBI", SBIP: "SBI",
  HDFC: "HDFC", HDFB: "HDFC",
  ICIC: "ICICI",
  AXIS: "Axis", UTIB: "Axis",
  KKBK: "Kotak", KOTAK: "Kotak",
  PUNB: "PNB", PSIB: "PSB",
  UBIN: "Union Bank",
  BARB: "Bank of Baroda", BKID: "Bank of India",
  CNRB: "Canara", CORP: "Corporation",
  IOBA: "IOB", IDIB: "Indian Bank",
  YESB: "Yes Bank", RATN: "RBL", DCBL: "DCB",
  FDRL: "Federal", KVBL: "KVB", CSBK: "CSB",
  INDB: "IndusInd", IDFC: "IDFC First",
  CIUB: "City Union", TMBL: "Tamilnad",
  NKGS: "NKGSB", MSNU: "Mudhol",
  ALLA: "Allahabad", ANDB: "Andhra",
  DENA: "Dena", VIJB: "Vijaya",
  ORBC: "Oriental", UCBA: "UCO",
  SCBL: "Standard Chartered", CITI: "Citi",
  HSBC: "HSBC", DEUT: "Deutsche",
  SIBL: "SIB", LAVB: "Lakshmi Vilas",
};

// ─── Export columns ──────────────────────────────────────────────────────────

// Company / Project lead so exports can be filtered/grouped by entity at a
// glance, then follows the visible desktop table's own column order
// (Payment Purpose → Doc No → Expense Ref → Amount → Status), appending the
// supplementary detail fields the compact table doesn't have room for.
export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Company", accessor: "company" },
  { header: "Project", accessor: "project" },
  { header: "Payment Purpose", accessor: "paymentName" },
  { header: "Doc No", accessor: "docNo" },
  { header: "Expense Ref", accessor: "expenseRef" },
  { header: "Amount", accessor: (r: any) => formatINR(Number(r.amount || 0)) },
  // displayStatus (Cheque Cancelled / Bounced / Cleared / Issued / …) is
  // the real, currently-shown status — the raw `status` field is only the
  // underlying approval state (Approved/Pending/Rejected), which is why a
  // cancelled or bounced cheque still exported as "Approved" before.
  { header: "Status", accessor: (r: any) => r.displayStatus || r.status || "—" },
  { header: "Paid To", accessor: "paidTo" },
  { header: "Mode", accessor: "mode" },
  { header: "Date", accessor: "date" },
  { header: "Bank", accessor: "bankName" },
  { header: "Cheque No", accessor: "chequeNo" },
];
