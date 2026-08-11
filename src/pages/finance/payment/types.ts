// ─── Types shared across the Payment page and its sub-components ──────────────
import type { ExpenseHeadAllocationRow } from "@/pages/material/ExpenseBooking/types";
export type { ExpenseHeadAllocationRow };

export interface DbPayment {
  PPaymentID: number;
  PPaymentName: string | null;
  PRemarks?: string | null;
  PMode: string | null;
  PAmount: number | null;
  PDocType: string | null;
  PDate: string | null;
  PBankID: number | null;
  PBankName: string | null;
  PProject: string | null;
  PProjectName?: string | null;
  PCompany: string | null;
  PSupplierName?: string | null;
  PSupplierContact?: string | null;
  PExpenseRef: string | null;
  DocNo?: string | null;
  ParentDocNo?: string | null;
  RootExBDocNo?: string | null;
  Status?: string;
  DisplayStatus?: string;
  // Cheque
  PChequeNo?: string | null;
  PChequeLotId?: number | null;
  PChequeLotNumber?: string | null;
  PChequeDate?: string | null;
  PChequeAccountNumber?: string | null;
  PChequeIfsc?: string | null;
  PIsPostDated?: boolean;
  // Digital
  PNeftNumber?: string | null;
  PUpiTransactionId?: string | null;
  PRtgsReference?: string | null;
  PImpsReference?: string | null;
  PCardReference?: string | null;
  PCardId?: number | null;
  PCardNumber?: string | null;
  PCardNetwork?: string | null;
  PCardHolderName?: string | null;
  PExpenseId?: number | null;
}

export interface BankOption {
  id: number;
  label: string;
  accountNumber?: string | null;
  ifscCode?: string | null;
  branch?: string | null;
  accountType?: string | null;
}

export interface CardOption {
  id: number;
  bank_id: number | null;
  card_holder_name: string | null;
  card_number: string | null;
  card_network: string | null;
  card_type: string | null;
  status: boolean;
}

export interface ChequeLot {
  CId: number;
  ChequeLotNumber: string;
  AccountNumber: string | null;
  IFSCCode: string | null;
  ChequeStartNumber: number | null;
  ChequeEndNumber: number | null;
  TotalCheques: number | null;
  RemainingCheques: number | null;
  BankId: number | null;
  BankName: string | null;
  BankBranch: string | null;
  BankAccountType: string | null;
  Remarks: string | null;
}

export interface ExpenseOption {
  id: string;
  value: string;
  label: string;
  type?: "booking" | "emi";
  expenseBookingId?: number;
  docNo?: string;
  projectName?: string;
  supplierName?: string;
  partyName?: string;
  partyId?: number | null;
  amount?: number;
  companyId?: number | null;
  companyName?: string;
  financialYear?: string;
  installmentNo?: number;
  refNumber?: string | null;
  dueDate?: string | null;
  status?: string;
  parentDocNo?: string;
  billStatus?: string;
  totalPaid?: number;
  remainingAmount?: number;
}

export interface ExpenseDetail {
  Eid: number;
  EDocNo: string | null;
  ParentDocNo?: string | null;
  RootExBDocNo?: string | null;
  EProjectName: string | null;
  EProjectDisplayName?: string | null;
  ECompanyId: number | null;
  EAmount: number | null;
  ENetAmount: number | null;
  EDocumentType: string | null;
  DocTypeName: string | null;
  ESourceType?: string | null;
  ESourceId?: number | null;
  // GST breakdown
  ECgstRate?: number | null;
  ESgstRate?: number | null;
  EIgstRate?: number | null;
  EBillingTermsData?: string | null;
  EDiscountData?: string | null;
}

export interface GRNRef {
  GRNID: number;
  GRNNo: string;
  GRNDate?: string;
  SupplierName?: string;
  PONumber?: string;
  Status?: string;
  ProjectName?: string;
}

export interface PaymentRecord {
  id: string;
  paymentName: string;
  // A genuine remarks/notes field, distinct from paymentName ("Payment
  // Purpose") — stored as PRemarks on dbo.NewPayment.
  notes: string;
  paidTo: string;
  supplierContact: string;
  mode: string;
  amount: number | null;
  date: string;
  bankId: number | null;
  bankName: string;
  project: string;
  company: string;
  projectSite: string;
  expenseRef: string;
  expenseId: string;
  docNo: string;
  parentDocNo: string;
  rootExBDocNo: string;
  docType: string;
  status: string;
  displayStatus: string;
  // Cheque
  chequeNo: string;
  chequeLotId: number | null;
  chequeLotNumber: string;
  chequeDate: string;
  chequeAccountNumber: string;
  chequeIfsc: string;
  isPostDated: boolean;
  // Digital
  neftNumber: string;
  upiTransactionId: string;
  rtgsReference: string;
  impsReference: string;
  cardReference: string;
  cardId: number | null;
  cardDisplay: string; // read-only summary (network + last4 + holder) of the selected card, if any
  // GST breakdown from linked expense
  baseAmount: number | null;
  cgstRate: number | null;
  sgstRate: number | null;
  igstRate: number | null;
  billingTermsData: string | null;
  // Optional: tags this payment as an on-account advance against a
  // Contract when no expense booking exists yet (backend/services/contractLedger.js).
  contractId: string;
  // Party (AccountHeadMaster LHeadId) for direct-invoice payments that have no
  // linked GRN/PO/WorkDone. Stored as PPartyId on NewPayment so resolvePartyFromRef
  // can derive it for On Account credit logic.
  partyId: number | null;
  // Direct Expense Payment (migration 303, dbo.ExpenseHeadAllocation) — pay
  // one or more Expense Heads straight from the bank instead of a Party.
  // When set (non-empty), this takes priority over partyId at posting time.
  expenseHeadAllocations: ExpenseHeadAllocationRow[];
  // TDS (migration 304) — snapshot taken at payment time. For an
  // invoice-linked payment this is inherited read-only from the invoice's
  // own snapshot (never user-chosen here); for a direct payment it's
  // user-selected. Either way the backend always re-derives/re-validates
  // it, this is just what got persisted.
  tdsId: number | null;
  tdsNature: string | null;
  tdsName: string | null;
  tdsPercentage: number | null;
  tdsAmount: number;
}

export const PAYMENT_MODES = [
  "Cash",
  "Cheque",
  "Post-Dated Cheque",
  "NEFT",
  "UPI",
  "RTGS",
  "IMPS",
  "Card",
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface ChainSummary {
  docNo: string | null;
  status: string | null;
  billStatus: string | null;
  netAmount: number;
  /** TDS withheld at source on this invoice (0 when not applicable) —
   * deducted from netAmount before computing what's actually still payable. */
  tdsAmount: number;
  /** netAmount − tdsAmount, floored at 0 — what's actually payable in cash. */
  payableAfterTds: number;
  totalPaid: number;
  remaining: number;
  payments: {
    id: number;
    docNo: string | null;
    date: string | null;
    mode: string | null;
    amount: number;
    status: string | null;
  }[];
  chain: {
    mrDocNo: string | null;
    workDoneRef: string | null;
    poNo: string | null;
    grnNo: string | null;
    expenseDocNo: string | null;
    vendorInvoiceNo: string | null;
    vendorInvoiceDate: string | null;
  };
  supplier: {
    id: number;
    name: string | null;
    code: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    gst: string | null;
    pan: string | null;
  } | null;
}

export type BookingFilters = {
  company: string;
  project: string;
  year: string;
  supplier: string;
};
