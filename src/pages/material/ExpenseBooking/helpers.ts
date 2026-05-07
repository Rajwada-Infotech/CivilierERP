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
  discount: DiscountConfig,
): PriceBreakdown {
  const discountAmount = discount.applicable
    ? discount.type === "percentage"
      ? (basicAmount * discount.value) / 100
      : discount.value
    : 0;

  const taxableAmount = Math.max(0, basicAmount - discountAmount);
  const cgstAmount = (taxableAmount * cgstRate) / 100;
  const sgstAmount = (taxableAmount * sgstRate) / 100;
  const grossAmount = taxableAmount + cgstAmount + sgstAmount;
  const rounded = Math.round(grossAmount);
  const roundOff = rounded - grossAmount;

  return {
    basicAmount,
    discountAmount,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    grossAmount,
    roundOff,
    netAmount: rounded,
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
    netAmount: null,
    status: "Draft",
    remarks: "",
    billingTermId: null,
    billingTermName: "",
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

  // paymentType is derived from EEmiPayment but currently not persisted in record.
  // Keeping this local variable for forward compatibility.
  // const paymentType = row.EEmiPayment ? "partial" : "full";

  let discount: DiscountConfig = defaultDiscount();


  try {
    if (row.EDiscountData)
      discount = { ...defaultDiscount(), ...JSON.parse(row.EDiscountData) };
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
    netAmount: row.ENetAmount
      ? parseFloat(row.ENetAmount)
      : parseFloat(row.EAmount) || 0,
    status: (row.EStatus ?? row.Status ?? "Draft") as any,
    remarks: row.ERemarks ?? "",
    billingTermId: row.EBillingTermId ? parseInt(row.EBillingTermId, 10) : null,
    billingTermName: row.EBillingTermName ?? "",
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

    /** FIXED: Prevent NULL being sent to NOT NULL column */
    EAmount: Number(form.basicAmount) || 0,
    ENetAmount: Number(netAmount) || 0,
    ECgstRate: Number(form.cgstRate) || 0,
    ESgstRate: Number(form.sgstRate) || 0,

    EDiscountData: JSON.stringify(form.discount),
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
  };
}
