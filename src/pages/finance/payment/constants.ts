import { formatINR } from "@/utils/formatCurrency";
import { printStatusLabel } from "@/utils/printStatus";
import type { ExportColumn } from "@/lib/export";

// ─── Payment mode styling ───────────────────────────────────────────────────

export const MODE_STYLE: Record<
  string,
  { ring: string; text: string; dot: string }
> = {
  Cash: {
    ring: "ring-foreground/30 bg-primary/10",
    text: "text-foreground",
    dot: "bg-foreground",
  },
  Cheque: {
    ring: "ring-foreground/30 bg-primary/10",
    text: "text-foreground",
    dot: "bg-foreground",
  },
  "Post-Dated Cheque": {
    ring: "ring-border bg-muted/60",
    text: "text-foreground",
    dot: "bg-foreground",
  },
  UPI: {
    ring: "ring-border bg-muted/60",
    text: "text-foreground",
    dot: "bg-foreground",
  },
  Card: {
    ring: "ring-amber-500/30 bg-[#ffe2021a]",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  NEFT: {
    ring: "ring-foreground/30 bg-primary/10",
    text: "text-foreground",
    dot: "bg-foreground",
  },
  RTGS: {
    ring: "ring-orange-500/30 bg-primary/10",
    text: "text-foreground",
    dot: "bg-foreground",
  },
  IMPS: {
    ring: "ring-pink-500/30 bg-primary/10",
    text: "text-foreground",
    dot: "bg-foreground",
  },
  "Demand Draft": {
    ring: "ring-foreground/30 bg-primary/10",
    text: "text-foreground",
    dot: "bg-foreground",
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
  { header: "Status", accessor: (r: any) => printStatusLabel(r.displayStatus || r.status) || "—" },
  { header: "Paid To", accessor: "paidTo" },
  { header: "Mode", accessor: "mode" },
  { header: "Date", accessor: "date" },
  { header: "Bank", accessor: "bankName" },
  { header: "Cheque No", accessor: "chequeNo" },
];
