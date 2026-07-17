import { toast } from "sonner";
import type {
  DiscountConfig,
  EmiConfig,
  EmiScheduleRow,
  ExpenseRecord,
  GrnGstData,
  PriceBreakdown,
  SelectedDoc,
  GRNItemLine,
} from "./types";

export function fmt(n: number) {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Round a quantity to 3 decimal places, clearing JS floating-point drift
// (e.g. 499.99 - 400 = 99.99000000000001 → 99.99). Quantities coming from
// GRN line items (receivedQty/remainingQty) can carry this drift, so any
// sum or direct display of them should pass through here first.
export function round3(n: number) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

// Display a quantity with at most 3 decimal places (no trailing zero padding).
export function fmtQty(n: number) {
  return round3(n).toLocaleString("en-IN", { maximumFractionDigits: 3 });
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
  igstRate = 0,
): PriceBreakdown {
  // Normalise: support both legacy single config and new array
  const terms = Array.isArray(discount) ? discount : [discount];
  const activeTerms = terms.filter((d) => d.applicable);

  // Separate pre-GST and post-GST terms
  const preGstActive = activeTerms.filter((d) => d.appliedOn !== "post-gst");
  const postGstActive = activeTerms.filter((d) => d.appliedOn === "post-gst");

  // Build annotated term lists (normalise deductionType → termType)
  const toAnnotated = (d: DiscountConfig) => ({
    ...d,
    termType: (d.deductionType ?? "Deduction") as "Addition" | "Deduction",
  });

  const preGstTerms = preGstActive.map(toAnnotated);
  const postGstTerms = postGstActive.map(toAnnotated);

  // Apply pre-GST terms sequentially
  let runningBase = basicAmount;
  let netDiscountDelta = 0; // positive = net deduction, negative = net addition

  for (const d of preGstTerms) {
    const amt =
      d.type === "percentage" ? (runningBase * d.value) / 100 : d.value;
    if (d.termType === "Addition") {
      runningBase += amt;
      netDiscountDelta -= amt;
    } else {
      const clamped = Math.min(amt, runningBase);
      runningBase = Math.max(0, runningBase - clamped);
      netDiscountDelta += clamped;
    }
  }

  const taxableAmount = Math.max(0, runningBase);
  const cgstAmount = (taxableAmount * cgstRate) / 100;
  const sgstAmount = (taxableAmount * sgstRate) / 100;
  const igstAmount = (taxableAmount * igstRate) / 100;
  let grossAmount = taxableAmount + cgstAmount + sgstAmount + igstAmount;

  // Apply post-GST terms sequentially
  for (const d of postGstTerms) {
    const amt =
      d.type === "percentage" ? (grossAmount * d.value) / 100 : d.value;
    if (d.termType === "Addition") {
      grossAmount += amt;
      netDiscountDelta -= amt;
    } else {
      const clamped = Math.min(amt, grossAmount);
      grossAmount = Math.max(0, grossAmount - clamped);
      netDiscountDelta += clamped;
    }
  }

  const rounded = Math.round(grossAmount);
  const roundOff = rounded - grossAmount;

  return {
    basicAmount,
    discountAmount: netDiscountDelta,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    grossAmount,
    roundOff,
    netAmount: rounded,
    preGstTerms,
    postGstTerms,
  };
}

/**
 * Compute the net payable for a GRN-linked booking by applying billing terms
 * on top of the live GRN gross (incl-GST) amount.  Mirrors the modal's
 * grnNetPayable useMemo so the list table and summary card stay in sync.
 *
 * @param grnTotal  - GRN TotalAmount (incl. GST)
 * @param terms     - billing terms array from the record (billingTerms)
 */
export function computeGrnNetWithTerms(
  grnTotal: number,
  terms: DiscountConfig[],
  basicAmount?: number,
): number {
  // Split by pre/post-GST
  const preTerms = terms.filter((t) => t.appliedOn !== "post-gst");
  const postTerms = terms.filter((t) => t.appliedOn === "post-gst");

  if (preTerms.length === 0) {
    // No pre-GST terms — apply all post-GST terms on gross directly
    let running = grnTotal;
    for (const t of postTerms) {
      const amt =
        t.type === "percentage"
          ? (running * (t.value ?? 0)) / 100
          : (t.value ?? 0);
      if (t.deductionType === "Addition") running += amt;
      else running = Math.max(0, running - amt);
    }
    return Math.round(running);
  }

  // Derive effective GST rates from basicAmount (base) and grnTotal (incl-GST)
  const base = basicAmount ?? 0;
  const gst = Math.max(0, grnTotal - base);
  const effectiveGSTRate = base > 0 ? (gst / base) * 100 : 0;
  // Split GST rate evenly for CGST/SGST (used for recomputation)
  const effectiveCGSTRate = effectiveGSTRate / 2;
  const effectiveSGSTRate = effectiveGSTRate / 2;

  // Apply pre-GST terms on base
  let runningBase = base;
  for (const t of preTerms) {
    const amt =
      t.type === "percentage"
        ? (runningBase * (t.value ?? 0)) / 100
        : (t.value ?? 0);
    if (t.deductionType === "Addition") runningBase += amt;
    else runningBase = Math.max(0, runningBase - amt);
  }

  // Recompute GST on adjusted base
  const adjCGST = (runningBase * effectiveCGSTRate) / 100;
  const adjSGST = (runningBase * effectiveSGSTRate) / 100;
  let running = runningBase + adjCGST + adjSGST;

  // Apply post-GST terms on adjusted gross
  for (const t of postTerms) {
    const amt =
      t.type === "percentage"
        ? (running * (t.value ?? 0)) / 100
        : (t.value ?? 0);
    if (t.deductionType === "Addition") running += amt;
    else running = Math.max(0, running - amt);
  }

  return Math.round(running);
}

export function computeGrnGst(grnGst: GrnGstData): PriceBreakdown {
  const grossAmount =
    grnGst.totals.taxableAmount +
    grnGst.totals.cgstAmount +
    grnGst.totals.sgstAmount +
    grnGst.totals.igstAmount;
  const rounded = Math.round(grossAmount);
  return {
    basicAmount: grnGst.totals.taxableAmount,
    discountAmount: 0,
    taxableAmount: grnGst.totals.taxableAmount,
    cgstAmount: grnGst.totals.cgstAmount,
    sgstAmount: grnGst.totals.sgstAmount,
    igstAmount: grnGst.totals.igstAmount,
    grossAmount,
    roundOff: rounded - grossAmount,
    netAmount: rounded,
    preGstTerms: [],
    postGstTerms: [],
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
    bookingDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    financialYear: "",
    companyId: null,
    poId: null,
    supplier: "",
    supplierLHeadId: null,
    supplierGstRegistered: undefined,
    projectSite: "",
    materialCategory: "",
    invoiceReference: "",
    basicAmount: 0,
    cgstRate: 0,
    sgstRate: 0,
    igstRate: 0,
    discount: defaultDiscount(),
    emi: defaultEmi(),
    /** Default payment type for new bookings. */
    paymentType: "full",
    partialAmount: 0,
    netAmount: null,
    grnTotalAmount: null,
    status: "Draft",
    remarks: "",
    billingTermId: null,
    billingTermName: "",
    billingTerms: [],
    tcId: null,
    tcName: "",
    tcText: "",
    vendorInvoiceNo: "",
    vendorInvoiceDate: "",
    costCenter: "",
    glAccount: "",
    workDoneRef: "",
    additionalCharges: [],
    paymentTermId: null,
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
      // Backend double-stringifies (JSON.stringify on an already-stringified string),
      // so we may need two rounds of JSON.parse to get the actual array.
      let parsed = JSON.parse(row.EBillingTermsData);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
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

  // EProjectName stores the enterprise ID for the project site (e.g. "42").
  // The backend JOINs enterprise on EProjectName=id and returns EProjectDisplayName.
  const projectEnterpriseId = row.EProjectName
    ? parseInt(row.EProjectName, 10)
    : null;
  const projectEnterpriseIdValid =
    projectEnterpriseId && Number.isFinite(projectEnterpriseId);

  return {
    id: String(id),
    bookingName: row.EName ?? "",
    bookingReference:
      row.EDocNo ??
      (row.ESourceType === "GRN" && (row.sourceDocNo || row.ESourceId)
        ? `Pending Items — ${row.sourceDocNo ?? `GRN #${row.ESourceId}`}`
        : id
          ? `Draft #${id}`
          : ""),
    docTypeName: row.DocTypeName ?? "",
    bookingDate: row.EDocDate ? row.EDocDate.slice(0, 10) : "",
    dueDate: row.EReminder ? row.EReminder.slice(0, 10) : "",
    financialYear: row.EFinYear ?? "",
    companyId: row.ECompanyId ? parseInt(row.ECompanyId, 10) : null,
    companyName: row.ECompanyName ?? "",
    poId: null,
    supplier: row.ESupplierName ?? row.EName ?? "",
    supplierLHeadId: row.ESupplierId ?? row.LHeadId ?? null,
    supplierGstRegistered:
      row.ESupplierGstRegistered != null
        ? Boolean(Number(row.ESupplierGstRegistered))
        : undefined,
    projectSite: projectEnterpriseIdValid ? String(projectEnterpriseId) : "",
    projectName: row.EProjectDisplayName || row.projectName || "",
    materialCategory: row.EDocumentType ?? "",
    invoiceReference: row.EDocNo ?? "",
    // For GRN-linked bookings, basicAmount = qty × rate (no GST) stored in EAmount.
    // EGrnTotalAmount is the incl-GST total used only for netAmount display.
    basicAmount: parseFloat(row.EAmount) || 0,
    cgstRate: row.ECgstRate ? parseFloat(row.ECgstRate) : 0,
    sgstRate: row.ESgstRate ? parseFloat(row.ESgstRate) : 0,
    igstRate: row.EIgstRate ? parseFloat(row.EIgstRate) : 0,
    discount,
    emi,
    paymentType: row.EPaymentType === "partial" ? "partial" : "full",
    partialAmount: row.EPartialAmount ? parseFloat(row.EPartialAmount) : 0,
    // For GRN-linked bookings, prefer the stored ENetAmount (net after billing terms).
    // Fall back to EGrnTotalAmount (incl-GST, before terms) if ENetAmount not set,
    // then fall back to EAmount for non-GRN / very old records.
    netAmount: row.ENetAmount
      ? parseFloat(row.ENetAmount)
      : row.EGrnTotalAmount != null
        ? parseFloat(row.EGrnTotalAmount)
        : parseFloat(row.EAmount) || 0,
    grnTotalAmount:
      row.EGrnTotalAmount != null ? parseFloat(row.EGrnTotalAmount) : null,
    status: (row.EStatus ?? row.Status ?? "Draft") as any,
    remarks: row.ERemarks ?? "",
    billingTermId: row.EBillingTermId ? parseInt(row.EBillingTermId, 10) : null,
    billingTermName: row.EBillingTermName ?? "",
    billingTerms,
    tcId: row.ETCId ? parseInt(row.ETCId, 10) : null,
    tcName: row.ETCName ?? "",
    tcText: row.ETCText ?? "",
    eSourceType:
      (row.ESourceType as
        | "PO"
        | "WO"
        | "WO_PO"
        | "GRN"
        | "TOD"
        | "WORK_DONE"
        | null) ?? null,
    eSourceId: row.ESourceId ? parseInt(row.ESourceId, 10) : null,
    sourceDocNo: row.sourceDocNo ?? null,
    vendorInvoiceNo: row.EVendorInvoiceNo ?? "",
    vendorInvoiceDate: row.EVendorInvoiceDate
      ? row.EVendorInvoiceDate.slice(0, 10)
      : "",
    costCenter: row.ECostCenter ?? "",
    glAccount: row.EGLAccount ?? "",
    workDoneRef: row.EWorkDoneRef ?? "",
    paymentTermId: row.PaymentTermId ?? null,
    additionalCharges: (() => {
      try {
        if (!row.EAdditionalCharges) return [];
        const parsed = JSON.parse(row.EAdditionalCharges);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
    billStatus: (row.EBillStatus as any) ?? null,
    totalPaid: row.ETotalPaid != null ? parseFloat(row.ETotalPaid) : undefined,
    remainingAmount:
      row.ERemainingAmount != null
        ? parseFloat(row.ERemainingAmount)
        : undefined,
  };
}

/**
 * Generate a human-readable fallback name for an expense booking.
 * Used when the user hasn't typed a name and the source doc has no description.
 * The backend schema requires EName to be a non-empty string (min 1 char).
 */
function fallbackBookingName(): string {
  const d = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `Expense ${d}`;
}

export function recordToDb(
  form: Omit<ExpenseRecord, "id">,
  netAmount: number,
  docTypeId?: number | null,
) {
  // EName is required (schema: min(1)). Never send null/empty — fall back to a
  // dated label so the POST/PUT never fails purely due to a missing name.
  const eName = (form.bookingName ?? "").trim() || fallbackBookingName();

  return {
    EName: eName,
    // Supplier chosen directly on the form — only actually used by the backend
    // when the booking has no PO/WO/GRN source to derive the supplier from
    // (direct/manual "Other Expenses" bookings); harmless to always send it.
    LHeadId: form.supplierLHeadId ?? null,
    // projectSite holds the enterprise ID string (e.g. "42") for the project site
    EProjectName: form.projectSite || null,
    EDocumentType: form.materialCategory || null,
    EDocDate: form.bookingDate || null,
    /** Prevent NULL being sent to NOT NULL column */
    EAmount: Number(form.basicAmount) || 0,
    ENetAmount: Math.round((Number(netAmount) || 0) * 100) / 100,
    ECgstRate: Number(form.cgstRate) || 0,
    ESgstRate: Number(form.sgstRate) || 0,
    EIgstRate: Number(form.igstRate) || 0,
    EPaymentType: form.paymentType === "partial" ? "partial" : "full",
    EPartialAmount:
      form.paymentType === "partial" ? Number(form.partialAmount) || 0 : null,
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
    EVendorInvoiceNo: form.vendorInvoiceNo || null,
    EVendorInvoiceDate: form.vendorInvoiceDate || null,
    EAdditionalCharges:
      form.additionalCharges && form.additionalCharges.length > 0
        ? JSON.stringify(form.additionalCharges)
        : null,
    ECostCenter: form.costCenter || null,
    EGLAccount: form.glAccount || null,
    EWorkDoneRef: form.workDoneRef || null,
    PaymentTermId: form.paymentTermId ?? null,
  };
}

// ─── Document-selector helpers ─────────────────────────────────────────────────

export function resolveGstRates(
  doc: SelectedDoc,
  fallbackCgst: number,
  fallbackSgst: number,
) {
  if (doc.kind === "GRN") return { cgst: 0, sgst: 0 };

  if (doc.kind === "PO" || doc.kind === "WORK_DONE" || doc.kind === "WO_PO") {
    // Prefer rates derived from PO line items
    if (
      doc.derivedCgstRate != null &&
      (doc.derivedCgstRate > 0 || doc.derivedSgstRate != null)
    ) {
      return {
        cgst: doc.derivedCgstRate ?? 0,
        sgst: doc.derivedSgstRate ?? 0,
      };
    }
    // Fall back to top-level GST blob
    if (doc.gst?.applicable) {
      const { type, rate } = doc.gst;
      if (type === "cgst_sgst") return { cgst: rate / 2, sgst: rate / 2 };
      if (type === "igst") return { cgst: rate, sgst: 0 };
    }
    return { cgst: 0, sgst: 0 };
  }

  return { cgst: fallbackCgst, sgst: fallbackSgst };
}

/** Derives pre-tax subtotal and weighted-average CGST/SGST rates from PO line items */
export function derivePOGst(poItems: any[]): {
  subtotal: number;
  cgstRate: number;
  sgstRate: number;
} {
  if (!Array.isArray(poItems) || poItems.length === 0)
    return { subtotal: 0, cgstRate: 0, sgstRate: 0 };

  let subtotal = 0;
  let totalCgstAmt = 0;
  let totalSgstAmt = 0;

  for (const item of poItems) {
    const qty = Number(item.quantity ?? item.Quantity ?? 0);
    const rate = Number(item.rate ?? item.Rate ?? 0);
    const base = Math.round(qty * rate * 100) / 100;

    // per-item GST rate stored as total % (e.g. 28 means 14+14)
    const totalGstRate = Number(
      item.gstRate ?? item.GstRate ?? item.tax ?? item.Tax ?? 0,
    );
    // prefer stored split; fall back to half/half
    const cgst = Number(item.cgstRate ?? item.CgstRate ?? totalGstRate / 2);
    const sgst = Number(item.sgstRate ?? item.SgstRate ?? totalGstRate / 2);

    subtotal += base;
    totalCgstAmt += Math.round(((base * cgst) / 100) * 100) / 100;
    totalSgstAmt += Math.round(((base * sgst) / 100) * 100) / 100;
  }

  subtotal = Math.round(subtotal * 100) / 100;
  // Weighted average rates
  const cgstRate =
    subtotal > 0 ? Math.round((totalCgstAmt / subtotal) * 100 * 100) / 100 : 0;
  const sgstRate =
    subtotal > 0 ? Math.round((totalSgstAmt / subtotal) * 100 * 100) / 100 : 0;

  return { subtotal, cgstRate, sgstRate };
}

export function parseGRNItemsFromRaw(raw: unknown): GRNItemLine[] {
  try {
    if (Array.isArray(raw)) return raw as GRNItemLine[];
    if (typeof raw === "string" && raw.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as GRNItemLine[];
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Something went wrong");
    /* fall through */
  }
  return [];
}
