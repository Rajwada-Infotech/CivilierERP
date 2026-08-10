import type { DbPayment, PaymentRecord } from "./types";

export function maskCardNumber(num: string | null): string {
  const digits = (num || "").replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `•••• ${digits.slice(-4)}`;
}

export function blankForm(): Omit<PaymentRecord, "id"> {
  return {
    paymentName: "",
    notes: "",
    mode: "",
    amount: null,
    baseAmount: null,
    date: new Date().toISOString().slice(0, 10),
    bankId: null,
    bankName: "",
    project: "",
    projectSite: "",
    company: "",
    expenseRef: "",
    expenseId: "",
    docNo: "",
    parentDocNo: "",
    rootExBDocNo: "",
    docType: "",
    status: "Draft",
    displayStatus: "Draft",
    chequeNo: "",
    chequeLotId: null,
    chequeLotNumber: "",
    chequeDate: "",
    chequeAccountNumber: "",
    chequeIfsc: "",
    isPostDated: false,
    neftNumber: "",
    upiTransactionId: "",
    rtgsReference: "",
    impsReference: "",
    cardReference: "",
    cardId: null,
    cardDisplay: "",
    cgstRate: null,
    sgstRate: null,
    igstRate: null,
    billingTermsData: null,
    paidTo: "",
    supplierContact: "",
    contractId: "",
    partyId: null,
    expenseHeadAllocations: [],
  };
}

export function dbToRecord(item: DbPayment): PaymentRecord {
  return {
    id: String(item.PPaymentID),
    paymentName: item.PPaymentName || "",
    notes: item.PRemarks || "",
    paidTo: item.PSupplierName || "",
    supplierContact: item.PSupplierContact || "",
    mode: item.PMode || "",
    amount: item.PAmount ?? null,
    date: item.PDate?.slice(0, 10) || "",
    bankId: item.PBankID ?? null,
    bankName: (item.PBankName && item.PBankName !== "N/A") ? item.PBankName : "",
    project: item.PProjectName || item.PProject || "",
    projectSite: item.PProjectName || item.PProject || "",
    company: item.PCompany || "",
    expenseRef: item.PExpenseRef || "",
    expenseId: item.PExpenseId ? String(item.PExpenseId) : "",
    docNo: item.DocNo || "",
    parentDocNo: item.ParentDocNo || "",
    rootExBDocNo: item.RootExBDocNo || "",
    docType: item.PDocType || "",
    status: (item as any).Status || "Draft",
    displayStatus: (item as any).DisplayStatus || (item as any).Status || "Draft",
    chequeNo: item.PChequeNo || "",
    chequeLotId: item.PChequeLotId ?? null,
    chequeLotNumber: item.PChequeLotNumber || "",
    chequeDate: item.PChequeDate?.slice(0, 10) || "",
    chequeAccountNumber: item.PChequeAccountNumber || "",
    chequeIfsc: item.PChequeIfsc || "",
    isPostDated: !!item.PIsPostDated,
    neftNumber: item.PNeftNumber || "",
    upiTransactionId: item.PUpiTransactionId || "",
    rtgsReference: item.PRtgsReference || "",
    impsReference: item.PImpsReference || "",
    cardReference: item.PCardReference || "",
    cardId: item.PCardId ?? null,
    cardDisplay: item.PCardId
      ? [
          item.PCardNetwork,
          maskCardNumber(item.PCardNumber ?? null),
          item.PCardHolderName,
        ]
          .filter(Boolean)
          .join(" · ")
      : "",
    baseAmount: null,
    cgstRate: null,
    sgstRate: null,
    igstRate: null,
    billingTermsData: null,
    contractId: String((item as { ContractId?: number }).ContractId ?? ""),
    partyId: (item as any).PPartyId ?? null,
    expenseHeadAllocations: Array.isArray((item as any).EExpenseHeadAllocations)
      ? (item as any).EExpenseHeadAllocations.map((a: any) => ({
          _key: `eha-${a.allocationId}`,
          lHeadId: a.lHeadId ?? null,
          label: a.lHeadName ?? null,
          code: a.lHeadCode ?? null,
          amount: Number(a.amount) || 0,
        }))
      : [],
  };
}
