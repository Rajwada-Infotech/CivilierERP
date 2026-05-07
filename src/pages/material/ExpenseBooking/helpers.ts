import type {
  DiscountConfig,
  EmiConfig,
  EmiScheduleRow,
  ExpenseRecord,
  PriceBreakdown,
} from "./types";

export function fmt(n: number) {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function defaultDiscount(): DiscountConfig {
  return {
    applicable: false,
    type: "percentage",
    value: 0,
    appliedOn: "pre-gst",
    masterTermId: null,
    masterTermName: null,
  };
}

export function defaultEmi(): EmiConfig {
  return {
    enabled: false,
    installmentCount: 0,
    emiAmount: 0,
    startDate: "",
    schedule: [],
  };
}

export function computeBreakdown(
  basicAmount: number,
  cgstRate: number,
  sgstRate: number,
  discount: DiscountConfig | DiscountConfig[],
): PriceBreakdown {
  const terms = Array.isArray(discount) ? discount : [discount];
  const activeTerms = terms.filter((d) => d.applicable);

  // Split into pre-GST and post-GST terms
  const preGstTerms = activeTerms.filter(
    (d) => !d.appliedOn || d.appliedOn === "pre-gst",
  );
  const postGstTerms = activeTerms.filter((d) => d.appliedOn === "post-gst");

  // Apply pre-GST terms sequentially
  let runningBase = basicAmount;
  let preGstDeductionTotal = 0;
  let preGstAdditionTotal = 0;

  for (const d of preGstTerms) {
    const amt =
      d.type === "percentage" ? (runningBase * d.value) / 100 : d.value;
    const isDeduction = d.termType !== "Addition"; // default = Deduction (legacy)
    if (isDeduction) {
      const clamped = Math.min(amt, runningBase);
      preGstDeductionTotal += clamped;
      runningBase -= clamped;
    } else {
      preGstAdditionTotal += amt;
      runningBase += amt;
    }
  }

  const taxableAmount = Math.max(0, runningBase);
  const cgstAmount = (taxableAmount * cgstRate) / 100;
  const sgstAmount = (taxableAmount * sgstRate) / 100;
  let grossAmount = taxableAmount + cgstAmount + sgstAmount;

  // Apply post-GST terms sequentially
  let postGstDeductionTotal = 0;
  let postGstAdditionTotal = 0;

  for (const d of postGstTerms) {
    const base = basicAmount; // post-GST terms apply on original basic
    const amt = d.type === "percentage" ? (base * d.value) / 100 : d.value;
    if (d.termType !== "Addition") {
      postGstDeductionTotal += amt;
      grossAmount -= amt;
    } else {
      postGstAdditionTotal += amt;
      grossAmount += amt;
    }
  }

  grossAmount = Math.max(0, grossAmount);
  const rounded = Math.round(grossAmount);
  const roundOff = rounded - grossAmount;

  return {
    basicAmount,
    // legacy field: total deduction for backward compat
    discountAmount: preGstDeductionTotal + postGstDeductionTotal,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    grossAmount,
    roundOff,
    netAmount: rounded,
    // extended breakdown fields
    preGstDeductionTotal,
    preGstAdditionTotal,
    postGstDeductionTotal,
    postGstAdditionTotal,
    preGstTerms,
    postGstTerms,
  };
}

export function generateEmiSchedule(
  netAmount: number,
  installmentCount: number,
  startDate: string,
  baseDocNo = "",
): EmiScheduleRow[] {
  if (!installmentCount || !startDate || installmentCount <= 0) return [];

  const baseAmount = Math.floor((netAmount / installmentCount) * 100) / 100;
  const lastAmount =
    Math.round((netAmount - baseAmount * (installmentCount - 1)) * 100) / 100;

  return Array.from({ length: installmentCount }, (_, i) => {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + i);
    const padded = String(i + 1).padStart(2, "0");

    return {
      installmentNo: i + 1,
      dueDate: d.toISOString().slice(0, 10),
      amount: i === installmentCount - 1 ? lastAmount : baseAmount,
      status: "Pending" as const,
      refNumber: baseDocNo ? `${baseDocNo}-EMI-${padded}` : `EMI-${padded}`,
    };
  });
}

export function blankForm(): Omit<ExpenseRecord, "id"> {
  return {
    bookingName: "",
    bookingReference: "",
    docTypeName: "",
    bookingDate: "",
    dueDate: "",
    financialYear: "",
    companyId: null,
    poId: null,
    supplier: "",
    projectSite: "",
    materialCategory: "",
    invoiceReference: "",
    basicAmount: 0,
    cgstRate: 18,
    sgstRate: 0,
    discount: defaultDiscount(),
    emi: defaultEmi(),
    /** Default payment type for new bookings. */
    paymentType: "full",
    partialAmount: 0,
    netAmount: null,
    status: "Draft",
    remarks: "",
    billingTermId: null,
    billingTermName: "",
    billingTerms: [],
    tcId: null,
    tcName: "",
    tcText: "",
  };
}

export function dbToRecord(row: any): ExpenseRecord {
  let emi: EmiConfig = defaultEmi();
  try {
    if (row.EEmiData) {
      const parsed = JSON.parse(row.EEmiData);
      emi = {
        ...defaultEmi(),
        ...parsed,
        schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [],
      };
    } else if (row.EEmiPayment) {
      emi = {
        ...defaultEmi(),
        enabled: true,
        installmentCount: row.EInstallmentCount ?? 0,
        emiAmount: parseFloat(row.EEmiAmount) || 0,
        startDate: row.EEmiStartDate ? row.EEmiStartDate.slice(0, 10) : "",
        schedule: [],
      };
    }
  } catch {
    /* ignore */
  }

  // Billing Terms & Discount (Merge Conflict Resolved)
  let discount: DiscountConfig = defaultDiscount();
  let billingTerms: DiscountConfig[] = [];

  try {
    if (row.EBillingTermsData) {
      const parsed = JSON.parse(row.EBillingTermsData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        billingTerms = parsed.map((t: any, i: number) => ({
          ...defaultDiscount(),
          ...t,
          _key: `loaded-${i}`,
        }));
        // Legacy support: use first applicable term as single discount
        const first = billingTerms.find((t) => t.applicable);
        if (first) discount = first;
      }
    } else if (row.EDiscountData) {
      discount = { ...defaultDiscount(), ...JSON.parse(row.EDiscountData) };
      if (discount.applicable) {
        billingTerms = [{ ...discount, _key: "loaded-0" }];
      }
    }
  } catch {
    /* ignore */
  }

  const rawId = row.Eid ?? row.EId ?? row.eid ?? row.EID ?? row.id;
  const id = rawId == null || rawId === "" ? "" : String(rawId);

  return {
    id: String(id),
    bookingName: row.EName ?? "",
    bookingReference: row.EDocNo ?? (id ? `Draft #${id}` : ""),
    docTypeName: row.DocTypeName ?? "",
    bookingDate: row.EDocDate ? row.EDocDate.slice(0, 10) : "",
    dueDate: row.EReminder ? row.EReminder.slice(0, 10) : "",
    financialYear: "",
    companyId: row.ECompanyId ? parseInt(row.ECompanyId, 10) : null,
    poId: null,
    supplier: row.EProjectName || "",
    projectSite: row.EProjectName || "",
    materialCategory: row.EDocumentType ?? "",
    invoiceReference: row.EDocNo ?? "",
    basicAmount: parseFloat(row.EAmount) || 0,
    cgstRate: row.ECgstRate ? parseFloat(row.ECgstRate) : 18,
    sgstRate: row.ESgstRate ? parseFloat(row.ESgstRate) : 0,
    discount,
    emi,
    paymentType: (row.EPaymentType as "full" | "partial") ?? "full",
    partialAmount: row.EPartialAmount ? parseFloat(row.EPartialAmount) : 0,
    netAmount: row.ENetAmount
      ? parseFloat(row.ENetAmount)
      : parseFloat(row.EAmount) || 0,
    status: (row.EStatus ?? row.Status ?? "Draft") as any,
    remarks: row.ERemarks ?? "",
    billingTermId: row.EBillingTermId ? parseInt(row.EBillingTermId, 10) : null,
    billingTermName: row.EBillingTermName ?? "",
    billingTerms,
    tcId: row.ETCId ? parseInt(row.ETCId, 10) : null,
    tcName: row.ETCName ?? "",
    tcText: row.ETCText ?? "",
  };
}

export function recordToDb(
  form: Omit<ExpenseRecord, "id">,
  netAmount: number,
  docTypeId?: number | null,
) {
  return {
    EName: form.bookingName || null,
    EProjectName: form.supplier || form.projectSite || null,
    EDocumentType: form.materialCategory || null,
    EDocDate: form.bookingDate || null,
    /** Prevent NULL being sent to NOT NULL column */
    EAmount: Number(form.basicAmount) || 0,
    ENetAmount: Number(netAmount) || 0,
    ECgstRate: Number(form.cgstRate) || 0,
    ESgstRate: Number(form.sgstRate) || 0,
    EDiscountData: JSON.stringify(form.discount),
    EBillingTermsData: JSON.stringify(form.billingTerms ?? []),
    EDocNo: form.bookingReference || null,
    EDocTypeId: docTypeId ?? null,
    EFinYear: form.financialYear || null,
    EEmiPayment: form.emi.enabled,
    EEmiData: JSON.stringify(form.emi),
    EInstallmentCount: form.emi.enabled ? form.emi.installmentCount : null,
    EEmiAmount: form.emi.enabled ? form.emi.emiAmount : null,
    EEmiStartDate:
      form.emi.enabled && form.emi.startDate ? form.emi.startDate : null,
    EReminder: form.dueDate || null,
    ERemarks: form.remarks || null,
    EStatus: form.status ?? "Draft",
    ECompanyId: form.companyId ?? null,
    EBillingTermId: form.billingTermId ?? null,
    EBillingTermName: form.billingTermName || null,
    ETCId: form.tcId ?? null,
    ETCName: form.tcName || null,
    ETCText: form.tcText || null,
    EPaymentType: form.paymentType ?? "full",
    EPartialAmount:
      form.paymentType === "partial" ? Number(form.partialAmount) || 0 : null,
  };
}
