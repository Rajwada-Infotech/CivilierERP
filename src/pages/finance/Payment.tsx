import React from "react";
import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPayments,
  getPaymentById,
  addPayment,
  updatePayment,
  deletePayment,
  getPaymentChain,
} from "@/api/newPaymentApi";
import type { PaymentChainResponse, PaymentChainItem, DisplayStatus } from "@/api/newPaymentApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getOABalanceByRef, getOAAdjustmentsForInvoice, type OAInvoiceAdjustment } from "@/api/onAccountApi";
import { getPaymentReasonOptions } from "@/api/paymentReasonApi";
import { getCompanyById } from "@/api/enterpriseApi";
import type { CompanyDetail } from "@/api/enterpriseApi";
import { ExportMenu } from "@/components/ExportMenu";
import { toast } from "sonner";
import { formatINR } from "@/utils/formatCurrency";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import {
  Banknote,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Plus,
  RotateCcw,
  Check,
  Edit,
  Trash2,
  AlertCircle,
  FileText,
  ChevronDown,
  Receipt,
  Building2,
  FolderKanban,
  CalendarDays,
  Landmark,
  Wallet,
  Link2,
  X,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Truck,
  Hash,
  BookOpen,
  CalendarClock,
  AlertTriangle,
  Search,
  Eye,
  Printer,
  ArrowRight,
  RefreshCw,
  History,
  Users,
} from "lucide-react";
import type { ExportColumn } from "@/lib/export";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { computeGrnNetWithTerms } from "@/pages/material/ExpenseBooking/helpers";

// ─── Extracted modules (types, constants, API helpers, sub-components) ────────
import type {
  DbPayment,
  BankOption,
  ExpenseOption,
  PaymentRecord,
  ChainSummary,
  BookingFilters,
  GRNRef,
} from "./payment/types";
import { PAYMENT_MODES } from "./payment/types";
import { EXPORT_COLUMNS, MODE_STYLE } from "./payment/constants";
import {
  fetchBankOptions,
  bankNameFromIfsc,
  normaliseExpenseOptions,
  fetchExpenseDetail,
  fetchExpenseGRNs,
  fetchPaymentSummary,
  fetchWorkDoneById,
  fetchCompanyOptions,
  fetchProjectOptions,
  fetchSupplierOptions,
  fetchFinYearOptions,
} from "./payment/api";
import { blankForm, dbToRecord } from "./payment/formHelpers";
import {
  Field,
  SectionHeader,
  ReadOnlyField,
  AutoFillBanner,
  ModeBadge,
} from "./payment/components/FormFields";
import { FilterBar } from "./payment/components/FilterBar";
import { ExpenseBookingPicker } from "./payment/components/ExpenseBookingPicker";
import { PaymentGRNBadges } from "./payment/components/PaymentGRNBadges";
import { ModeInfoBanner } from "./payment/components/ModeInfoBanner";
import { ChequePanel } from "./payment/components/ChequePanel";
import { DigitalRefPanel } from "./payment/components/DigitalRefPanel";
import { CardPanel } from "./payment/components/CardPanel";
import { getPayableEmis, payLoan, type PayableEmi } from "@/api/loanSanctionApi";
import { computePaymentStatus, deriveBillStatus, resolveOutstanding } from "./payment/partialPayment";
import { previewOAAdjustment } from "@/api/onAccountAdjustment";

// ─── Main component ───────────────────────────────────────────────────────────

const Payment: React.FC = () => {
  const rights = usePageRights("new-payment");
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const queryClient = useQueryClient();
  const location = useLocation();
  const [page, setPage] = useState(1);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState(""); // stores numeric ID for display
  const [companyNameFilter, setCompanyNameFilter] = useState(""); // stores label for backend
  const [projectFilter, setProjectFilter] = useState("");
  const [finYearFilter, setFinYearFilter] = useState("");
  const [docNumberFilter, setDocNumberFilter] = useState("");
  const [docDateFilter, setDocDateFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const PAGE_SIZE = 20;

  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<PaymentRecord, "id">>(blankForm());
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Re-issue (bounced cheque replacement) context
  const [reissueCtx, setReissueCtx] = useState<{
    replacesPaymentId: number;
    replacesDocNo: string;
    amount: number;
    paymentName: string;
    companyName: string;
    expenseRef: string | null;
    bounceReason: string | null;
  } | null>(null);
  const [bounceCharge, setBounceCharge] = useState<string>("");
  const [viewingRec, setViewingRec] = useState<PaymentRecord | null>(null);
  const [viewingCompanyDetail, setViewingCompanyDetail] =
    useState<CompanyDetail | null>(null);
  const [viewingChain, setViewingChain] = useState<ChainSummary | null>(null);
  const [viewingGrnTotal, setViewingGrnTotal] = useState<number>(0);
  const [viewingOaBalance, setViewingOaBalance] = useState<number>(0);
  const [paymentChainData, setPaymentChainData] = useState<PaymentChainResponse | null>(null);
  const [loadingChain, setLoadingChain] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "chain" | "posting">("details");
  const [pmtPostingData, setPmtPostingData] = useState<any | null>(null);
  const [pmtPostingLoading, setPmtPostingLoading] = useState(false);
  const [pmtPosting, setPmtPosting] = useState(false);
  const [pmtPostingError, setPmtPostingError] = useState<string | null>(null);
  const [formChainData, setFormChainData] = useState<PaymentChainResponse | null>(null);
  const [loadingFormChain, setLoadingFormChain] = useState(false);
  // Known totalPaid injected by "Pay Remaining" — overrides stale opt.totalPaid from DB
  const [formKnownTotalPaid, setFormKnownTotalPaid] = useState<number | null>(null);
  // Live remaining from payment-summary (excludes bounced) — used in partial payment panel
  const [formLiveRemaining, setFormLiveRemaining] = useState<number | null>(null);
  // On Account balance for the selected invoice's party
  const [oaBalance, setOaBalance] = useState<number>(0);
  // "Use on-account balance for this payment" checkbox — defaults to true
  // (preserves the existing auto-apply-at-approval behavior); unchecking
  // keeps the party's balance untouched (OASkipAutoApply on save).
  const [useOnAccountBalance, setUseOnAccountBalance] = useState(true);
  // Context injected from the On A/C Adjustment page
  const [oaAdjustCtx, setOaAdjustCtx] = useState<{
    partyId: number; partyName: string; partyTypeCode: string; availableBalance: number; sourceDocNo: string;
    invoiceDocNo?: string | null; invoiceRemaining?: number | null;
  } | null>(null);

  // Open the detail modal and eagerly fetch the company logo
  const openViewRec = async (rec: PaymentRecord) => {
    setViewingRec(rec);
    setViewingCompanyDetail(null);
    setViewingChain(null);
    setViewingGrnTotal(0);
    setViewingOaBalance(0);
    setPaymentChainData(null);
    setDetailTab("details");
    setPmtPostingData(null);
    const matched = companyOptions.find(
      (c) => c.label === rec.company || String(c.id) === rec.company,
    );
    if (matched) {
      try {
        const detail = await getCompanyById(Number(matched.id));
        setViewingCompanyDetail(detail);
      } catch {
        /* logo not critical */
      }
    }
    if (rec.expenseId) {
      fetchPaymentSummary(rec.expenseId)
        .then(setViewingChain)
        .catch(() => {});
      // Fetch GRN breakdown to get GST-inclusive total (bypasses stale ENetAmount in payment-summary)
      fetchWithAuth(`/api/expense-booking/${rec.expenseId}`)
        .then((r) => r.ok ? r.json() : null)
        .then(async (eb: any) => {
          if (eb?.ESourceType === "GRN" && eb?.ESourceId) {
            const br = await fetchWithAuth(`/api/grns/${eb.ESourceId}/gst-breakdown`);
            if (br.ok) {
              const bd = await br.json();
              const total = bd?.totals?.totalInclGST ?? 0;
              if (total > 0) setViewingGrnTotal(total);
            }
          }
        })
        .catch(() => {});
    }
    if (rec.expenseRef) {
      setLoadingChain(true);
      getPaymentChain(rec.expenseRef)
        .then(setPaymentChainData)
        .catch(() => {})
        .finally(() => setLoadingChain(false));
      getOABalanceByRef(rec.expenseRef)
        .then((b) => setViewingOaBalance(b.balance ?? 0))
        .catch(() => {});
    }
  };

  // Fetch payment posting data when posting tab opens
  useEffect(() => {
    if (detailTab !== "posting" || !viewingRec?.id) return;
    setPmtPostingLoading(true);
    setPmtPostingData(null);
    const url = viewingRec.expenseRef
      ? `/api/new-payment/chain-posting/${encodeURIComponent(viewingRec.expenseRef)}`
      : `/api/new-payment/${viewingRec.id}/posting`;
    fetchWithAuth(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPmtPostingData(d ?? null))
      .catch(() => setPmtPostingData(null))
      .finally(() => setPmtPostingLoading(false));
  }, [detailTab, viewingRec?.id, viewingRec?.expenseRef]);

  // Auto-post as soon as posting data has loaded — no manual "Post to GL"
  // click. Entries post one at a time (posting the next only after the
  // current one resolves, via re-running whenever pmtPostingData changes)
  // rather than all at once, since each hits the same doc-number lock.
  useEffect(() => {
    if (detailTab !== "posting" || pmtPostingLoading || pmtPosting) return;
    const entries: any[] = pmtPostingData?.entries ?? [];
    const next = entries.find((e) => !e.isPosted && !e.isBounced);
    if (!next) return;
    const url =
      next.type === "bounce_charge"
        ? `/api/new-payment/${next.pmtId}/post-bounce-charge-to-gl`
        : `/api/new-payment/${next.pmtId}/post-to-gl`;
    setPmtPosting(true);
    setPmtPostingError(null);
    fetchWithAuth(url, { method: "POST" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error ?? "Posting failed");
        setPmtPostingData((prev: any) => ({
          ...prev,
          entries: prev.entries.map((e: any) =>
            e.pmtId === next.pmtId && e.type === next.type
              ? { ...e, isPosted: true, jvNo: body.jvNo }
              : e,
          ),
        }));
      })
      .catch((err: any) => setPmtPostingError(err.message ?? "Posting failed"))
      .finally(() => setPmtPosting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTab, pmtPostingLoading, pmtPostingData, pmtPosting]);

  // Deep-link support — Trial Balance drill-down (Level 3) navigates here as
  // /payments?view=<PPaymentID>, so this payment's receipt should open
  // automatically in view mode, regardless of which page it's on.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId) return;
    const id = parseInt(viewId, 10);
    if (!Number.isFinite(id)) return;
    getPaymentById(id)
      .then((row) => {
        if (row) openViewRec(dbToRecord(row));
        else toast.error(`Payment #${id} not found`);
      })
      .catch(() => toast.error("Failed to load the linked payment"))
      .finally(() => {
        searchParams.delete("view");
        setSearchParams(searchParams, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect On A/C Adjustment context passed from OnAccountAdjustment page
  useEffect(() => {
    const oa = (location.state as any)?.oaAdjust;
    if (!oa?.partyId) return;
    setOaAdjustCtx(oa);
    setOaBalance(oa.availableBalance ?? 0);
    setView("form");
    // Pre-fill the supplier/contractor name so the user doesn't have to type it
    setForm((prev) => ({
      ...prev,
      paidTo: oa.partyName ?? prev.paidTo,
    }));
    window.history.replaceState({}, "", location.pathname);
  }, []);

  // Detect bounce re-issue context passed from BRS page
  useEffect(() => {
    const ri = (location.state as any)?.reissue;
    if (!ri?.replacesPaymentId) return;
    setReissueCtx(ri);
    setBounceCharge("");
    setView("form");
    window.history.replaceState({}, "", location.pathname);

    // Fetch the full original payment record to pre-fill all fields
    fetchWithAuth(`/api/new-payment/${ri.replacesPaymentId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => {
        if (!data) return;
        setForm((prev) => ({
          ...prev,
          paymentName: data.PPaymentName ?? ri.paymentName ?? prev.paymentName,
          amount:      data.PAmount      != null ? parseFloat(data.PAmount) : (ri.amount ?? prev.amount),
          expenseRef:  data.PExpenseRef  ?? ri.expenseRef  ?? prev.expenseRef,
          company:     data.PCompanyName ?? data.PCompany  ?? ri.company    ?? prev.company,
          project:     data.PProjectName ?? data.PProject  ?? ri.project    ?? prev.project,
          projectSite: data.PProjectName ?? data.PProject  ?? ri.project    ?? prev.projectSite,
          bankId:      data.PBankID      ?? ri.bankId      ?? prev.bankId,
          paidTo:      data.PSupplierName ?? prev.paidTo,
          supplierContact: data.PSupplierContact ?? prev.supplierContact,
          docType:     data.PDocType     ?? prev.docType,
        }));
      })
      .catch(() => {
        // Fallback to the BRS-provided summary if the fetch fails
        setForm((prev) => ({
          ...prev,
          paymentName: ri.paymentName ?? prev.paymentName,
          amount:      ri.amount      ?? prev.amount,
          expenseRef:  ri.expenseRef  ?? prev.expenseRef,
          company:     ri.company     ?? prev.company,
          project:     ri.project     ?? prev.project,
          bankId:      ri.bankId      ?? prev.bankId,
        }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Print/PDF payment voucher
  const handlePrintPayment = (
    rec: PaymentRecord,
    companyDetail: CompanyDetail | null,
    chain: ChainSummary | null = null,
  ) => {
    const logoHtml = companyDetail?.logo
      ? `<img src="${companyDetail.logo}" alt="Logo" style="height:60px;max-width:180px;object-fit:contain;" />`
      : `<span style="font-size:18px;font-weight:800;color:#4f46e5;">${companyDetail?.name ?? rec.company ?? "—"}</span>`;

    const companyAddress = [
      companyDetail?.address,
      companyDetail?.address_line2,
      companyDetail?.city,
      companyDetail?.state,
      companyDetail?.pincode,
    ]
      .filter(Boolean)
      .join(", ");

    const statusColor: Record<string, string> = {
      Draft: "#64748b",
      Pending: "#d97706",
      Approved: "#059669",
      Rejected: "#dc2626",
    };
    const sColor = statusColor[rec.status] ?? "#64748b";

    const modeColor: Record<string, string> = {
      Cheque: "#4f46e5",
      "Post-Dated Cheque": "#7c3aed",
      NEFT: "#0891b2",
      UPI: "#059669",
      RTGS: "#d97706",
      IMPS: "#ea580c",
      Cash: "#16a34a",
    };
    const mColor = modeColor[rec.mode] ?? "#4f46e5";

    const field = (label: string, value: string | null | undefined) =>
      value
        ? `<tr>
            <td style="padding:7px 12px;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;width:160px;">${label}</td>
            <td style="padding:7px 12px;font-size:13px;font-weight:500;color:#111827;">${value}</td>
           </tr>`
        : "";

    const sectionTitle = (label: string) =>
      `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#4f46e5;margin:20px 0 8px;">${label}</div>`;

    const supplier = chain?.supplier ?? null;
    const docChain = chain?.chain ?? null;

    const supplierRows = supplier
      ? [
          field("Supplier Name", supplier.name),
          field("Supplier Code", supplier.code),
          field("Address", supplier.address),
          field("Contact No.", supplier.phone),
          field("Email", supplier.email),
          field("GST No.", supplier.gst),
          field("PAN No.", supplier.pan),
        ].join("")
      : "";

    const docRefRows = [
      field("Invoice No.", docChain?.vendorInvoiceNo || null),
      field("Invoice Date", docChain?.vendorInvoiceDate || null),
      field("Purchase Order Ref.", docChain?.poNo || null),
      field("GRN Ref.", docChain?.grnNo || null),
      field("Material Request Ref.", docChain?.mrDocNo || null),
      field(
        "Expense Booking Ref.",
        docChain?.expenseDocNo || rec.expenseRef || null,
      ),
    ].join("");

    const paymentRows = [
      field("Payment Ref", rec.docNo || "—"),
      field("Payment Purpose", rec.paymentName),
      field("Paid To", rec.paidTo),
      field("Date", rec.date || "—"),
      field("Mode", rec.mode || "—"),
      field("Bank Account", rec.bankName || null),
      field(
        "Reference / Txn ID",
        rec.chequeNo
          ? `Cheque #${rec.chequeNo}`
          : rec.neftNumber ||
              rec.upiTransactionId ||
              rec.rtgsReference ||
              rec.impsReference ||
              rec.cardReference ||
              null,
      ),
      field("Cheque Date", rec.chequeDate || null),
      field("Cheque Lot", rec.chequeLotNumber || null),
      field("Card Used", rec.cardDisplay || null),
      field("Company", rec.company || "—"),
      field("Project", rec.project || "—"),
      field("Project Site", rec.projectSite || null),
      field("Parent Doc", rec.parentDocNo || null),
    ].join("");

    const baseAmount = rec.baseAmount ?? null;
    const cgstRate = rec.cgstRate ?? null;
    const sgstRate = rec.sgstRate ?? null;
    const igstRate = rec.igstRate ?? null;
    const hasTaxDetails =
      baseAmount != null && (cgstRate || sgstRate || igstRate);
    const cgstAmt =
      hasTaxDetails && cgstRate ? (baseAmount! * cgstRate) / 100 : 0;
    const sgstAmt =
      hasTaxDetails && sgstRate ? (baseAmount! * sgstRate) / 100 : 0;
    const igstAmt =
      hasTaxDetails && igstRate ? (baseAmount! * igstRate) / 100 : 0;

    const taxRows = hasTaxDetails
      ? [
          field("Taxable Amount", formatINR(baseAmount!)),
          cgstRate ? field(`CGST (${cgstRate}%)`, formatINR(cgstAmt)) : "",
          sgstRate ? field(`SGST (${sgstRate}%)`, formatINR(sgstAmt)) : "",
          igstRate ? field(`IGST (${igstRate}%)`, formatINR(igstAmt)) : "",
        ].join("")
      : "";

    const printedAt = new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const signBlock = (label: string) =>
      `<div style="flex:1;text-align:center;">
         <div style="border-top:1px solid #9ca3af;margin:36px 12px 6px;"></div>
         <div style="font-size:11px;color:#6b7280;">${label}</div>
       </div>`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payment Receipt — ${rec.docNo || rec.paymentName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111827; padding: 36px; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; }
    tr:nth-child(even) { background: #f9fafb; }
    @media print { body { padding: 16px; } button { display: none !important; } }
  </style>
</head>
<body>
  <!-- Company header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #4f46e5;margin-bottom:8px;">
    <div>
      ${logoHtml}
      ${companyAddress ? `<div style="margin-top:6px;font-size:11px;color:#6b7280;max-width:340px;">${companyAddress}</div>` : ""}
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">
        ${[companyDetail?.phone_number, companyDetail?.email].filter(Boolean).join("  ·  ")}
      </div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">
        ${[companyDetail?.gst_no ? `GSTIN: ${companyDetail.gst_no}` : null, companyDetail?.pan ? `PAN: ${companyDetail.pan}` : null].filter(Boolean).join("  ·  ")}
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:800;color:#4f46e5;letter-spacing:-0.5px;">PAYMENT RECEIPT</div>
      <div style="font-size:14px;font-weight:700;font-family:monospace;color:#111827;margin-top:4px;">${rec.docNo || "—"}</div>
      <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;align-items:center;">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${sColor}18;color:${sColor};border:1px solid ${sColor}40;">
          ${rec.status}
        </span>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${mColor}18;color:${mColor};border:1px solid ${mColor}40;">
          ${rec.mode}
        </span>
      </div>
    </div>
  </div>

  <!-- Amount highlight -->
  <div style="margin:18px 0 8px;padding:16px 20px;background:linear-gradient(135deg,#4f46e510,#7c3aed10);border-radius:12px;border:1px solid #4f46e520;display:flex;align-items:center;justify-content:space-between;">
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:2px;">Payment Amount</div>
      <div style="font-size:28px;font-weight:800;color:#4f46e5;font-family:monospace;">${formatINR(rec.amount ?? 0)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:2px;">Payment Date</div>
      <div style="font-size:16px;font-weight:700;color:#111827;">${rec.date || "—"}</div>
    </div>
  </div>

  ${supplierRows ? sectionTitle("Supplier / Vendor Information") : ""}
  ${supplierRows ? `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;"><table><tbody>${supplierRows}</tbody></table></div>` : ""}

  ${sectionTitle("Payment Information")}
  <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <table><tbody>${paymentRows}${docRefRows}</tbody></table>
  </div>

  ${taxRows ? sectionTitle("Tax Details") : ""}
  ${taxRows ? `<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;"><table><tbody>${taxRows}</tbody></table></div>` : ""}

  <!-- Signatories -->
  <div style="display:flex;gap:8px;margin-top:48px;">
    ${signBlock("Prepared By")}
    ${signBlock("Approved By")}
    ${signBlock("Authorized Signatory")}
  </div>

  <!-- Footer -->
  <div style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;">
    <span>This is a system-generated receipt and does not require a physical signature.</span>
    <span>Printed: ${printedAt}</span>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank", "width=860,height=720");
    if (!win) {
      URL.revokeObjectURL(blobUrl);
      toast.error("Pop-up blocked — please allow pop-ups.");
      return;
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    win.onload = () => {
      win.focus();
      win.print();
    };
  };
  const [loadingExpense, setLoadingExpense] = useState(false);
  const [syncingBalances, setSyncingBalances] = useState(false);
  const [linkedGRNs, setLinkedGRNs] = useState<GRNRef[]>([]);
  const [grnGstBreakdown, setGrnGstBreakdown] = useState<{
    items: {
      itemName: string;
      hsnCode: string;
      gstPercent: number;
      receivedQty: number;
      totalAmountInclGST: number;
      baseAmount: number;
      cgstRate: number;
      cgstAmount: number;
      sgstRate: number;
      sgstAmount: number;
      gstAmount: number;
    }[];
    totals: {
      totalBase: number;
      totalCGST: number;
      totalSGST: number;
      totalGST: number;
      totalInclGST: number;
    };
  } | null>(null);
  const [oaAdjustmentsForInvoice, setOaAdjustmentsForInvoice] = useState<
    OAInvoiceAdjustment[]
  >([]);
  const [, setSupplierBookingFilter] = useState("");
  const [bookingFilters, setBookingFilters] = useState<BookingFilters>({
    company: "",
    project: "",
    year: "",
    supplier: "",
  });

  // ── Queries ────────────────────────────────────────────────────────────────

  const {
    data: dbData,
    isLoading,
    isError,
    refetch: refetchPayments,
  } = useQuery({
    queryKey: [
      "payments",
      page,
      supplierFilter,
      companyNameFilter,
      projectFilter,
      finYearFilter,
      docNumberFilter,
      docDateFilter,
    ],
    queryFn: () =>
      getPayments(
        page,
        PAGE_SIZE,
        supplierFilter,
        companyNameFilter,
        projectFilter,
        finYearFilter,
        docNumberFilter,
        docDateFilter,
      ),
    staleTime: 0,
  });

  const { data: banks = [] } = useQuery<BankOption[]>({
    queryKey: ["bank-options-payment"],
    queryFn: fetchBankOptions,
  });

  const { data: enterprises = [] } = useQuery<{ id: number; label: string }[]>({
    queryKey: ["company-options-payment-filter"],
    queryFn: fetchCompanyOptions,
  });

  // Companies fetched with business_type=C from enterprise table
  const companyOptions = enterprises;

  const { data: projectOptions = [] } = useQuery<
    {
      id: number;
      label: string;
      belongs_to?: number | null;
      company_id?: number | null;
    }[]
  >({
    queryKey: ["project-options-payment-filter"],
    queryFn: fetchProjectOptions,
  });

  const { data: supplierOptions = [] } = useQuery<
    { id: number; label: string }[]
  >({
    queryKey: ["supplier-options-payment-filter"],
    queryFn: fetchSupplierOptions,
  });

  const { data: finYearOptions = [] } = useQuery<
    { id: number; label: string }[]
  >({
    queryKey: ["fin-year-options-payment-filter"],
    queryFn: fetchFinYearOptions,
  });

  const dbItems: DbPayment[] = Array.isArray(dbData?.data) ? dbData.data : [];
  const totalPages: number = dbData?.totalPages ?? 1;
  const totalRecords: number = dbData?.total ?? 0;
  const records: PaymentRecord[] = dbItems.map(dbToRecord);

  // Fetch full detail (name + logo + address) for the selected company — used in PDF export
  const { data: selectedCompanyDetail = null } = useQuery<CompanyDetail | null>(
    {
      queryKey: ["company-detail-export", companyFilter],
      queryFn: () =>
        companyFilter
          ? getCompanyById(Number(companyFilter))
          : Promise.resolve(null),
      enabled: !!companyFilter,
    },
  );

  const { data: paymentReasons = [] } = useQuery({
    queryKey: ["payment-reason-options"],
    queryFn: getPaymentReasonOptions,
    staleTime: 5 * 60_000,
  });

  const { data: expenseOptions = [] } = useQuery<ExpenseOption[]>({
    queryKey: ["expense-options-payment", oaAdjustCtx?.partyId ?? null],
    queryFn: async () => {
      const url = oaAdjustCtx?.partyId
        ? `/api/expense-booking/options?partyId=${oaAdjustCtx.partyId}`
        : "/api/expense-booking/options";
      const res = await fetchWithAuth(url);
      if (!res.ok) return [];
      const raw = await res.json().catch(() => ({}));
      const items: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      return normaliseExpenseOptions(items);
    },
    staleTime: 0,
  });

  // ── Contract source ─────────────────────────────────────────────────────────
  const [selectedContract, setSelectedContract] = useState<any | null>(null);
  const { data: contractOptions = [], isLoading: contractsLoading } = useQuery<any[]>({
    queryKey: ["payment-contracts"],
    queryFn: async () => {
      const r = await fetchWithAuth("/api/contract?status=Approved");
      return r.ok ? r.json() : [];
    },
    staleTime: 60_000,
  });
  const handleContractSelect = (contract: any) => {
    const purpose = `Payment to ${contract.ContactPerson || "Contractor"} for ${contract.Reason || contract.NatureOfContract || "contract work"}`;
    setSelectedContract(contract);
    setLinkedGRNs([]);
    // Resolve Company/Project against the actual dropdown option lists
    // rather than trusting the contract's own denormalized name strings —
    // the Company/Project <select>s match by exact label string, and a
    // casing/whitespace difference between dbo.enterprise (source of these
    // dropdowns) and the contract's own joined name silently left the
    // select unmatched (shows "Select company…" despite a value being set).
    // Matching by id first and reading the label back from the option list
    // guarantees it's a string the select actually has.
    const companyOpt = companyOptions.find((c) => c.id === contract.CompanyId);
    const projectOpt = projectOptions.find((p) => p.id === contract.ProjectId);
    const companyLabel = companyOpt?.label || contract.CompanyName || String(contract.CompanyId || "");
    const projectLabel = projectOpt?.label || contract.ProjectName || String(contract.ProjectId || "");
    setForm((prev) => ({
      ...prev,
      paymentName: purpose,
      expenseRef: contract.DocNo || "",
      // Clear any stale invoice-side link — picking a contract supersedes
      // it. Previously this cleanup happened via a *separate* onChange("")
      // call fired right after this handler by the picker, which raced
      // with this setForm and usually won, wiping out the company/project/
      // party fields being set below. Doing it in the same update instead.
      expenseId: "",
      parentDocNo: "",
      rootExBDocNo: "",
      docType: "",
      contractId: contract.ContractId != null ? String(contract.ContractId) : "",
      company: companyLabel,
      project: projectLabel,
      projectSite: projectLabel,
      // Payee/Party was never set here before — the field stayed on
      // whatever (or nothing) was previously selected.
      partyId: contract.ContactPartyId ?? prev.partyId,
      paidTo: contract.ContactPerson || prev.paidTo,
      // Default to what's still outstanding on the contract, not its full
      // value — most payments against an already-active contract are
      // another advance/installment, not the whole thing at once. Falls
      // back to the full contract amount only for a brand-new contract
      // with nothing paid yet (PendingAmount === ContractAmount then
      // anyway, so this is really just a null/undefined guard).
      amount:
        contract.PendingAmount != null
          ? Math.max(Number(contract.PendingAmount), 0)
          : (contract.ContractAmount ?? prev.amount),
    }));
  };
  const clearContractLink = () => {
    setSelectedContract(null);
    setForm((prev) => ({
      ...prev,
      paymentName: "",
      expenseRef: "",
      contractId: "",
      company: "",
      project: "",
      projectSite: "",
      partyId: null,
      paidTo: "",
      amount: null,
    }));
  };

  // ── Loan EMI source ──────────────────────────────────────────────────────
  const [selectedLoanEmi, setSelectedLoanEmi] = useState<PayableEmi | null>(null);
  const [loanPaymentDetailsOpen, setLoanPaymentDetailsOpen] = useState(false);
  const [loanLateFee, setLoanLateFee] = useState("");
  const [loanPaymentNotes, setLoanPaymentNotes] = useState("");
  const { data: loanEmiOptions = [], isLoading: loanEmisLoading } = useQuery<PayableEmi[]>({
    queryKey: ["payment-loan-emis"],
    queryFn: getPayableEmis,
    staleTime: 60_000,
  });
  const handleLoanEmiSelect = (emi: PayableEmi) => {
    setSelectedLoanEmi(emi);
    setSelectedContract(null);
    setLoanLateFee("");
    setLoanPaymentNotes("");
    setForm((prev) => ({
      ...prev,
      paymentName: `Loan EMI ${emi.InstallmentNo} — ${emi.LoanNo} (${emi.BorrowerName})`,
      expenseRef: "",
      expenseId: "",
      contractId: "",
      amount: Number(emi.EMIAmount),
    }));
    // Late fee / loan-specific charges are collected separately — a Loan
    // EMI payment isn't just an amount, it may also carry a late charge the
    // regular payment form has no field for.
    setLoanPaymentDetailsOpen(true);
  };
  // Only clears the loan-side selection state — deliberately does NOT touch
  // paymentName/amount, since this also fires defensively whenever an
  // invoice/contract is picked (to un-highlight a previous loan pick), and
  // must not stomp on the fields that selection just set.
  const clearLoanEmiLink = () => {
    setSelectedLoanEmi(null);
    setLoanLateFee("");
    setLoanPaymentNotes("");
  };

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalAmount = dbItems.reduce((s, p) => s + (p.PAmount || 0), 0);
  const chequeCount = dbItems.filter(
    (p) => p.PMode === "Cheque" || p.PMode === "Post-Dated Cheque",
  ).length;
  const cashCount = dbItems.filter((p) => p.PMode === "Cash").length;

  // ── Form helpers ───────────────────────────────────────────────────────────

  const set = <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => setForm((prev) => ({ ...prev, [field]: value }));

  const openNew = () => {
    setEditingId(null);
    setForm(blankForm());
    setLinkedGRNs([]);
    setSupplierBookingFilter("");
    setBookingFilters({ company: "", project: "", year: "", supplier: "" });
    setSelectedContract(null);
    setSelectedLoanEmi(null);
    setLoanPaymentDetailsOpen(false);
    setFormLiveRemaining(null);
    setFormKnownTotalPaid(null);
    setView("form");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openEdit = (rec: PaymentRecord) => {
    setSelectedContract(null);
    setSelectedLoanEmi(null);
    setLoanPaymentDetailsOpen(false);
    setEditingId(rec.id);
    const { id, ...rest } = rec;
    const matchedOption = rest.expenseRef
      ? expenseOptions.find(
          (o) =>
            o.label.startsWith(rest.expenseRef + " ") ||
            o.label.startsWith(rest.expenseRef + " —"),
        )
      : undefined;
    setForm({ ...rest, expenseId: matchedOption?.id ?? "" });
    setLinkedGRNs([]);
    setSupplierBookingFilter("");
    setBookingFilters({ company: "", project: "", year: "", supplier: "" });
    setView("form");
  };

  const cancelForm = () => {
    setView("list");
    setEditingId(null);
    setForm(blankForm());
    setLinkedGRNs([]);
    setSupplierBookingFilter("");
    setBookingFilters({ company: "", project: "", year: "", supplier: "" });
    setSelectedContract(null);
    setSelectedLoanEmi(null);
    setLoanPaymentDetailsOpen(false);
  };

  const blank = blankForm();
  const isDirty = (Object.keys(blank) as (keyof typeof blank)[]).some(
    (k) => String(form[k] ?? "") !== String(blank[k] ?? ""),
  );

  const canSave = !!(
    form.paymentName.trim() &&
    form.mode &&
    form.date &&
    (Number(form.amount) > 0 || form.expenseRef)
  );

  const handleReset = () => {
    setForm(blankForm());
    setLinkedGRNs([]);
    setSupplierBookingFilter("");
    setBookingFilters({ company: "", project: "", year: "", supplier: "" });
  };

  // ── Mode change — clear irrelevant fields ──────────────────────────────────

  const handleModeChange = (newMode: string) => {
    const today = new Date().toISOString().slice(0, 10);
    setForm((prev) => ({
      ...prev,
      mode: newMode,
      isPostDated: newMode === "Post-Dated Cheque",
      // Clear cheque fields when switching away from cheque modes
      ...(newMode !== "Cheque" && newMode !== "Post-Dated Cheque"
        ? {
            chequeNo: "",
            chequeLotId: null,
            chequeLotNumber: "",
            chequeDate: "",
            chequeAccountNumber: "",
            chequeIfsc: "",
          }
        : {
            // Auto-fill cheque date to today if not already set
            chequeDate: prev.chequeDate || today,
          }),
      // Clear digital fields when switching away from digital modes
      ...(!["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(newMode)
        ? {
            neftNumber: "",
            upiTransactionId: "",
            rtgsReference: "",
            impsReference: "",
            cardReference: "",
            cardId: null,
          }
        : {}),
    }));
  };

  // ── Expense booking selection → auto-fill ──────────────────────────────────

  const handleExpenseSelect = useCallback(
    async (expenseId: string, amountOverride?: number) => {
      // Reset known total paid unless this is a Pay Remaining call (amountOverride set)
      if (amountOverride == null) setFormKnownTotalPaid(null);
      if (!expenseId) {
        setForm((prev) => ({
          ...prev,
          expenseId: "",
          expenseRef: "",
          parentDocNo: "",
          rootExBDocNo: "",
          project: "",
          company: "",
          amount: null,
          docType: "",
          partyId: null,
          paidTo: "",
        }));
        return;
      }

      const selectedOption = expenseOptions.find((o) => o.id === expenseId);
      if (selectedOption?.type === "emi") {
        const parentDocNo =
          selectedOption.parentDocNo ||
          selectedOption.refNumber?.replace(/-EMI-\d+$/i, "") ||
          selectedOption.docNo?.replace(/-EMI-\d+$/i, "") ||
          "";
        const padded = String(selectedOption.installmentNo ?? 1).padStart(
          2,
          "0",
        );
        const emiSuffix = `EMI-${padded}`;
        const ref =
          selectedOption.refNumber ||
          (selectedOption.parentDocNo
            ? `${selectedOption.parentDocNo}-${emiSuffix}`
            : selectedOption.docNo
              ? `${selectedOption.docNo}-${emiSuffix}`
              : emiSuffix);
        setForm((prev) => ({
          ...prev,
          expenseId,
          expenseRef: ref,
          parentDocNo,
          rootExBDocNo: parentDocNo,
          project: selectedOption.projectName || "",
          company: (() => {
            const name = selectedOption.companyName;
            if (name && name.trim()) return name.trim();
            const matched = companyOptions.find(
              (c) => c.id === selectedOption.companyId,
            );
            return matched?.label || String(selectedOption.companyId ?? "");
          })(),
          amount: selectedOption.amount ?? null,
          docType: `EMI-${padded}`,
          partyId: selectedOption.partyId ?? null,
          paidTo: selectedOption.supplierName || prev.paidTo,
        }));
        if (selectedOption.expenseBookingId) {
          fetchExpenseGRNs(String(selectedOption.expenseBookingId))
            .then((grns) => {
              setLinkedGRNs(grns);
              if (grns.length > 0 && grns[0].ProjectName) {
                setForm((prev) => ({
                  ...prev,
                  projectSite: grns[0].ProjectName!,
                }));
              }
            })
            .catch(() => setLinkedGRNs([]));
        }
        return;
      }

      setLoadingExpense(true);
      try {
        const detail = await fetchExpenseDetail(expenseId);
        if (!detail) throw new Error("Not found");
        const parentDocNo = detail.ParentDocNo || detail.EDocNo || "";
        const rootExBDocNo = detail.RootExBDocNo || detail.EDocNo || "";
        setForm((prev) => ({
          ...prev,
          expenseId,
          expenseRef: detail.EDocNo || "",
          parentDocNo,
          rootExBDocNo,
          project: detail.EProjectDisplayName || detail.EProjectName || "",
          company: (() => {
            const name = (detail as any).ECompanyName;
            if (name && name.trim()) return name.trim();
            // Fall back to label from the enterprise options list
            const matched = companyOptions.find(
              (c) => c.id === detail.ECompanyId,
            );
            return matched?.label || String(detail.ECompanyId ?? "");
          })(),
          // If an override is provided (Pay Remaining flow), always use it.
          // Otherwise use remainingAmount from the options list (reflects partial payments).
          // Fall back to full invoice amount if remaining is not available.
          amount: (() => {
            if (amountOverride != null) return amountOverride;
            const fullAmt = detail.ENetAmount
              ? parseFloat(String(detail.ENetAmount))
              : (detail as any).EGrnTotalAmount
                ? parseFloat((detail as any).EGrnTotalAmount)
                : (detail.EAmount ?? null);
            const remaining = selectedOption?.remainingAmount;
            if (remaining != null && remaining > 0 && fullAmt != null && remaining < fullAmt) {
              return remaining;
            }
            return fullAmt;
          })(),
          docType: detail.DocTypeName || detail.EDocumentType || "",
          // For GRN: baseAmount = pre-tax base (totalBase), rates from DB.
          // GST breakdown API will override these with precise per-item values.
          // If EGrnTotalAmount is set but breakdown hasn't loaded yet,
          // zero out GST rates to avoid double-counting on the incl-GST figure.
          baseAmount: (detail as any).EGrnTotalAmount
            ? parseFloat((detail as any).EGrnTotalAmount) // will be overridden by GRN breakdown
            : (detail.EAmount ?? null),
          // Zero out GST rates for GRN records — the GRN breakdown fetch below
          // will set correct totalBase + rates. Without this, if the breakdown
          // API fails, cgstRate applied on EGrnTotalAmount (incl-GST) would double-count GST.
          cgstRate: (detail as any).EGrnTotalAmount
            ? 0
            : (detail.ECgstRate ?? null),
          sgstRate: (detail as any).EGrnTotalAmount
            ? 0
            : (detail.ESgstRate ?? null),
          igstRate: (detail as any).EGrnTotalAmount
            ? 0
            : (detail.EIgstRate ?? null),
          billingTermsData:
            detail.EBillingTermsData ?? detail.EDiscountData ?? null,
          partyId: selectedOption?.partyId ?? null,
          paidTo: selectedOption?.supplierName || prev.paidTo,
        }));

        // For WORK_DONE entries, resolve project from the linked WorkDone record
        if (detail.EDocumentType === "WORK_DONE" && detail.ESourceId) {
          const wd = await fetchWorkDoneById(detail.ESourceId);
          if (wd?.ProjectName) {
            setForm((prev) => ({ ...prev, projectSite: wd.ProjectName! }));
          }
        }

        const grns = await fetchExpenseGRNs(expenseId);
        setLinkedGRNs(grns);
        if (grns.length > 0 && grns[0].ProjectName) {
          setForm((prev) => ({ ...prev, projectSite: grns[0].ProjectName! }));
        } else if (detail.EProjectDisplayName || detail.EProjectName) {
          setForm((prev) => ({
            ...prev,
            projectSite:
              detail.EProjectDisplayName || detail.EProjectName || "",
          }));
        }

        // Helper: given a GRNID, fetch its item-level GST breakdown and populate
        // grnGstBreakdown + form rates. Used by both GRN-direct and PO-indirect paths.
        const applyGrnBreakdown = async (grnId: number | string) => {
          try {
            const bdRes = await fetchWithAuth(
              `/api/grns/${grnId}/gst-breakdown`,
            );
            if (bdRes.ok) {
              const bd = await bdRes.json();
              setGrnGstBreakdown(bd);
              // Override form amounts with correct values from GRN item-level GST breakdown,
              // then apply billing terms (pre/post-GST) to arrive at the true Net Payable.
              if (bd?.totals?.totalInclGST > 0) {
                setGrnGstBreakdown(bd);
                const t = bd.totals;
                const avgCGST =
                  t.totalBase > 0 ? (t.totalCGST / t.totalBase) * 100 : 0;
                const avgSGST =
                  t.totalBase > 0 ? (t.totalSGST / t.totalBase) * 100 : 0;

                // Parse billing terms from the expense detail
                let billingTerms: any[] = [];
                try {
                  const raw =
                    detail.EBillingTermsData ?? detail.EDiscountData ?? null;
                  if (raw) {
                    let parsed = JSON.parse(raw);
                    if (typeof parsed === "string") parsed = JSON.parse(parsed);
                    billingTerms = Array.isArray(parsed) ? parsed : [];
                  }
                } catch {
                  /* ignore parse errors */
                }

                // Compute net payable: apply billing terms on GRN gross with
                // correct pre/post-GST ordering (same logic as MaterialExpenseBooking)
                const netPayable =
                  billingTerms.length > 0
                    ? computeGrnNetWithTerms(
                        t.totalInclGST,
                        billingTerms,
                        t.totalBase,
                      )
                    : Math.round(t.totalInclGST * 100) / 100;

                setForm((prev) => ({
                  ...prev,
                  amount: amountOverride != null ? amountOverride : netPayable,
                  baseAmount: Math.round(t.totalBase * 100) / 100,
                  cgstRate: Math.round(avgCGST * 100) / 100,
                  sgstRate: Math.round(avgSGST * 100) / 100,
                  igstRate: 0,
                }));
              }
            }
          } catch {
            /* non-fatal */
          }
        };

        // Same as applyGrnBreakdown, but sums the breakdown across every
        // linked GRN instead of fetching just one — the total for a
        // combined invoice is the sum of all its source GRNs, not any
        // single one of them.
        const applyMultiGrnBreakdown = async (grnIds: number[]) => {
          try {
            const results = await Promise.all(
              grnIds.map((id) =>
                fetchWithAuth(`/api/grns/${id}/gst-breakdown`)
                  .then((r) => (r.ok ? r.json() : null))
                  .catch(() => null),
              ),
            );
            const valid = results.filter(
              (bd): bd is NonNullable<typeof bd> =>
                !!bd && bd.totals?.totalInclGST > 0,
            );
            if (valid.length === 0) return;

            const totals = valid.reduce(
              (acc, bd) => ({
                totalBase: acc.totalBase + (bd.totals.totalBase || 0),
                totalCGST: acc.totalCGST + (bd.totals.totalCGST || 0),
                totalSGST: acc.totalSGST + (bd.totals.totalSGST || 0),
                totalGST: acc.totalGST + (bd.totals.totalGST || 0),
                totalInclGST: acc.totalInclGST + (bd.totals.totalInclGST || 0),
              }),
              { totalBase: 0, totalCGST: 0, totalSGST: 0, totalGST: 0, totalInclGST: 0 },
            );
            const items = valid.flatMap((bd) => bd.items ?? []);
            const combined = { items, totals };
            setGrnGstBreakdown(combined);

            const avgCGST =
              totals.totalBase > 0 ? (totals.totalCGST / totals.totalBase) * 100 : 0;
            const avgSGST =
              totals.totalBase > 0 ? (totals.totalSGST / totals.totalBase) * 100 : 0;

            let billingTerms: any[] = [];
            try {
              const raw = detail.EBillingTermsData ?? detail.EDiscountData ?? null;
              if (raw) {
                let parsed = JSON.parse(raw);
                if (typeof parsed === "string") parsed = JSON.parse(parsed);
                billingTerms = Array.isArray(parsed) ? parsed : [];
              }
            } catch {
              /* ignore parse errors */
            }

            const netPayable =
              billingTerms.length > 0
                ? computeGrnNetWithTerms(
                    totals.totalInclGST,
                    billingTerms,
                    totals.totalBase,
                  )
                : Math.round(totals.totalInclGST * 100) / 100;

            setForm((prev) => ({
              ...prev,
              amount: amountOverride != null ? amountOverride : netPayable,
              baseAmount: Math.round(totals.totalBase * 100) / 100,
              cgstRate: Math.round(avgCGST * 100) / 100,
              sgstRate: Math.round(avgSGST * 100) / 100,
              igstRate: 0,
            }));
          } catch {
            /* non-fatal */
          }
        };

        // Multi-GRN combined invoices (see MaterialExpenseBooking's
        // "combine multiple GRNs" flow) have several source GRNs, not one —
        // applyGrnBreakdown(detail.ESourceId) would only fetch the primary
        // GRN's breakdown and silently overwrite the correct combined
        // amount with just that one GRN's total. Sum every linked GRN's
        // breakdown instead.
        let linkedGrnIds: number[] = [];
        try {
          const raw = (detail as any).ELinkedGrnIds;
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) linkedGrnIds = parsed;
          }
        } catch {
          /* not multi-GRN */
        }

        // If this expense is linked to a GRN directly, fetch the per-item GST breakdown.
        // For PO/WO_PO-linked bookings, find the GRN created against that PO and use its breakdown —
        // because the actual GST lives in the GRN items (PO stores rates but GRN stores received actuals).
        if (linkedGrnIds.length > 1) {
          await applyMultiGrnBreakdown(linkedGrnIds);
        } else if (detail.ESourceType === "GRN" && detail.ESourceId) {
          await applyGrnBreakdown(detail.ESourceId);
        } else if (
          (detail.ESourceType === "PO" || detail.ESourceType === "WO_PO") &&
          detail.ESourceId
        ) {
          try {
            const poGrnsRes = await fetchWithAuth(
              `/api/grns/by-po/${detail.ESourceId}`,
            );
            if (poGrnsRes.ok) {
              const poGrns: { GRNID: number }[] = await poGrnsRes.json();
              if (Array.isArray(poGrns) && poGrns.length > 0) {
                // grns returned newest-first; use most recent GRN's breakdown
                await applyGrnBreakdown(poGrns[0].GRNID);
              }
            }
          } catch {
            /* non-fatal — breakdown stays null, standard cgstRate/sgstRate used */
          }
        } else {
          setGrnGstBreakdown(null);
        }

        // Show any On Account adjustments already applied to this invoice
        // (see backend/utils/oaAdjustments.js) — e.g. "On A/C adjusted with
        // ₹30,000 from Shiv Shakti Building Materials" — so picking the
        // same invoice again for payment doesn't look like the adjustment
        // never happened.
        getOAAdjustmentsForInvoice(detail.EDocNo || "").then(
          setOaAdjustmentsForInvoice,
        );

        // When amountOverride is provided (Pay Remaining / partial invoice click),
        // use it directly — it was computed from live chain data.
        // Otherwise, the useEffect on formChainData handles setting formLiveRemaining
        // once the chain loads (correct: uses ENetAmount and excludes bounce charges).
        if (amountOverride != null) {
          setFormLiveRemaining(amountOverride);
        }
      } catch {
        toast.error("Could not load expense booking details.");
      } finally {
        setLoadingExpense(false);
      }
    },
    [expenseOptions, companyOptions],
  );

  // Auto-select the matching invoice for re-issue once expenseOptions loads
  useEffect(() => {
    if (!reissueCtx || !expenseOptions.length || form.expenseId) return;
    const ref = reissueCtx.expenseRef;
    if (!ref) return;
    const opt =
      expenseOptions.find((o) => o.docNo === ref) ??
      expenseOptions.find(
        (o) =>
          o.label.startsWith(ref + " ") || o.label.startsWith(ref + " —"),
      );
    if (opt) handleExpenseSelect(opt.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseOptions, reissueCtx]);

  // Auto-select the invoice + fill filters when coming from On A/C Adjustment
  useEffect(() => {
    if (!oaAdjustCtx?.invoiceDocNo || !expenseOptions.length || form.expenseId) return;
    const ref = oaAdjustCtx.invoiceDocNo;
    const opt =
      expenseOptions.find((o) => o.docNo === ref) ??
      expenseOptions.find((o) => o.value === ref) ??
      expenseOptions.find((o) => o.label.startsWith(ref + " ") || o.label.startsWith(ref + " —"));
    if (!opt) return;
    // Fill the filter bar so it matches the invoice context
    setBookingFilters({
      company: opt.companyName ?? "",
      project: opt.projectName ?? "",
      year: opt.financialYear ?? "",
      supplier: opt.supplierName ?? opt.partyName ?? "",
    });
    // Select the invoice — this fills company, project, amount in the form
    handleExpenseSelect(opt.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseOptions, oaAdjustCtx?.invoiceDocNo]);

  // When OA Adjust context is active: cap the payment amount at min(invoiceAmount, oaBalance)
  useEffect(() => {
    if (!oaAdjustCtx || form.amount == null || form.amount <= 0) return;
    const oaBal = oaAdjustCtx.availableBalance;
    const cappedAmount = Math.min(form.amount, oaBal);
    if (cappedAmount !== form.amount) {
      setForm((prev) => ({ ...prev, amount: cappedAmount }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.amount, oaAdjustCtx?.availableBalance]);

  // Fetch On Account balance when invoice changes
  useEffect(() => {
    setUseOnAccountBalance(true); // reset to default for the newly-selected invoice
    if (!form.expenseRef) { setOaBalance(0); return; }
    getOABalanceByRef(form.expenseRef)
      .then((d) => setOaBalance(d.balance ?? 0))
      .catch(() => setOaBalance(0));
  }, [form.expenseRef]);

  // Invoice outstanding before any on-account offset — same computation the
  // "On Account Balance" card's preview uses, hoisted here so the actual
  // Amount field (what gets paid via this bank/cheque transaction) can react
  // to it too instead of only the informational preview text reacting.
  const oaInvoiceRemaining = useMemo(() => {
    if (!form.expenseRef) return 0;
    const opt = expenseOptions.find(
      (o) => o.id === form.expenseId || o.docNo === form.expenseRef,
    );
    const grnTotal = grnGstBreakdown?.totals?.totalInclGST ?? 0;
    const netAmt = grnTotal > 0 ? grnTotal : (opt?.amount ?? 0);
    return resolveOutstanding(netAmt, formLiveRemaining, formKnownTotalPaid ?? opt?.totalPaid);
  }, [form.expenseRef, form.expenseId, expenseOptions, grnGstBreakdown, formLiveRemaining, formKnownTotalPaid]);

  const oaPreview = useMemo(
    () => (oaBalance > 0.01 ? previewOAAdjustment(oaBalance, oaInvoiceRemaining) : null),
    [oaBalance, oaInvoiceRemaining],
  );

  // Real-time: the actual bank/cheque Amount due is the invoice outstanding
  // minus whatever on-account credit is being applied — recompute the moment
  // the toggle changes (or the balance/invoice does), not just the preview text.
  useEffect(() => {
    if (!form.expenseRef || !oaPreview || oaPreview.applyAmount <= 0) return;
    const target = useOnAccountBalance ? oaPreview.invoiceRemainingAfter : oaInvoiceRemaining;
    setForm((prev) => (prev.amount === target ? prev : { ...prev, amount: target }));
  }, [useOnAccountBalance, oaPreview, oaInvoiceRemaining, form.expenseRef]);

  // Fetch payment chain for the form view whenever an invoice is linked
  useEffect(() => {
    if (!form.expenseRef) {
      setFormChainData(null);
      return;
    }
    let cancelled = false;
    setLoadingFormChain(true);
    getPaymentChain(form.expenseRef)
      .then((data) => { if (!cancelled) setFormChainData(data); })
      .catch(() => { if (!cancelled) setFormChainData(null); })
      .finally(() => { if (!cancelled) setLoadingFormChain(false); });
    return () => { cancelled = true; };
  }, [form.expenseRef]);

  // Once chain data loads, derive the live remaining from chain payments (source of truth).
  // ENetAmount is the net payable (base + GST + adjustments). BounceCharge is excluded
  // because it's paid to the bank, not the supplier.
  useEffect(() => {
    if (!formChainData || editingId) return;
    const inv = formChainData.invoice;
    if (!inv) return;
    const fullAmt = parseFloat(String(inv.ENetAmount ?? inv.EAmount ?? 0)) || 0;
    if (!fullAmt) return;
    const { totalPaid: paidExcludingBounced, remaining: liveRemaining } =
      computePaymentStatus(fullAmt, formChainData.payments);
    // formLiveRemaining is always the true invoice outstanding (excludes bounced payments).
    setFormLiveRemaining(liveRemaining);

    // When re-issuing a bounced cheque, pre-fill with the bounced payment's original amount
    // (not the full outstanding) — re-issue clears only that specific bounced cheque.
    if (reissueCtx) {
      const bouncedPayment = formChainData.payments.find(
        (p) => p.PPaymentID === reissueCtx.replacesPaymentId
      );
      if (bouncedPayment) {
        const bouncedAmt = parseFloat(String(bouncedPayment.PAmount ?? 0)) || 0;
        setForm((prev) => ({ ...prev, amount: bouncedAmt }));
      }
      return;
    }

    if (paidExcludingBounced > 0 && liveRemaining > 0) {
      setForm((prev) => ({ ...prev, amount: liveRemaining }));
    }
  }, [formChainData, editingId, reissueCtx]);

  const clearExpenseLink = () => {
    setForm((prev) => ({
      ...prev,
      expenseId: "",
      expenseRef: "",
      parentDocNo: "",
      rootExBDocNo: "",
      project: "",
      company: "",
      amount: null,
      docType: "",
      baseAmount: null,
      cgstRate: null,
      sgstRate: null,
      igstRate: null,
      billingTermsData: null,
    }));
    setLinkedGRNs([]);
    setGrnGstBreakdown(null);
    setOaAdjustmentsForInvoice([]);
    setFormLiveRemaining(null);
    setFormKnownTotalPaid(null);
    setSupplierBookingFilter("");
  };

  // ── Bank selection ─────────────────────────────────────────────────────────

  const handleBankSelect = (bankIdStr: string) => {
    if (!bankIdStr) {
      set("bankId", null);
      set("bankName", "");
      return;
    }
    const bank = banks.find((b) => String(b.id) === bankIdStr);
    set("bankId", bank?.id ?? null);
    set("bankName", bank?.label?.split(" — ")[0] ?? "");
    // Reset cheque lot when bank changes
    set("chequeLotId", null);
    set("chequeLotNumber", "");
    set("chequeNo", "");
    // Reset selected card when bank changes (cards are bank-specific)
    set("cardId", null);
  };

  // ── Validation ─────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    if (!form.paymentName.trim()) {
      toast.error("Payment purpose is required.");
      return false;
    }
    if (!form.mode) {
      toast.error("Please select a payment mode.");
      return false;
    }
    if (!form.date) {
      toast.error("Payment date is required.");
      return false;
    }

    const isChequeMode =
      form.mode === "Cheque" || form.mode === "Post-Dated Cheque";
    const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(
      form.mode,
    );

    if (isChequeMode) {
      if (!form.bankId) {
        toast.error("Please select a bank account.");
        return false;
      }
      if (!form.chequeLotId) {
        toast.error("No active cheque lot found for the selected bank.");
        return false;
      }
      if (!form.chequeNo) {
        toast.error("Please select a cheque number from the lot.");
        return false;
      }
      if (form.mode === "Post-Dated Cheque" && !form.chequeDate) {
        toast.error("Post-dated cheque requires a cheque date.");
        return false;
      }
      if (form.mode === "Post-Dated Cheque" && form.chequeDate) {
        const validUntil = new Date(form.chequeDate);
        validUntil.setMonth(validUntil.getMonth() + 3);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (validUntil < today) {
          toast.error("This post-dated cheque has expired. Please select a valid cheque date.");
          return false;
        }
      }
    }

    if (form.mode === "Cash" && !form.amount) {
      toast.error("Amount is required for Cash payment.");
      return false;
    }

    if (isDigitalMode) {
      if (!form.bankId) {
        toast.error("Please select a bank account.");
        return false;
      }
      if (form.mode === "NEFT" && !form.neftNumber.trim()) {
        toast.error("NEFT UTR number is required.");
        return false;
      }
      if (form.mode === "UPI" && !form.upiTransactionId.trim()) {
        toast.error("UPI Transaction ID is required.");
        return false;
      }
      if (form.mode === "RTGS" && !form.rtgsReference.trim()) {
        toast.error("RTGS reference is required.");
        return false;
      }
      if (form.mode === "IMPS" && !form.impsReference.trim()) {
        toast.error("IMPS reference is required.");
        return false;
      }
      if (form.mode === "Card" && !form.cardReference.trim()) {
        toast.error("Card transaction/approval ID is required.");
        return false;
      }
    }

    return true;
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validate()) return;

    const payload = {
      // BaseTransactionSchema fields
      companyId: form.company || null,
      projectId: form.projectSite || form.project || null,
      docDate: form.date || "",
      docTypeId: form.docType || null,
      remarks: form.paymentName || null,
      // PaymentPayloadSchema fields
      supplierId: form.expenseRef || null,
      partyId: form.partyId ?? null,
      bankId: form.bankId ?? null,
      amount: form.amount ?? 0,
      // Extended payment fields (passed through for backend processing)
      bankName: form.bankName || null,
      parentDocNo: form.parentDocNo || null,
      rootExBDocNo: form.rootExBDocNo || null,
      mode: form.mode || null,
      // Cheque
      chequeNo: form.chequeNo || null,
      chequeLotId: form.chequeLotId ?? null,
      chequeLotNumber: form.chequeLotNumber || null,
      chequeDate: form.chequeDate || null,
      chequeAccountNumber: form.chequeAccountNumber || null,
      chequeIfsc: form.chequeIfsc || null,
      isPostDated: form.isPostDated,
      // Digital
      neftNumber: form.neftNumber || null,
      upiTransactionId: form.upiTransactionId || null,
      rtgsReference: form.rtgsReference || null,
      impsReference: form.impsReference || null,
      cardReference: form.cardReference || null,
      cardId: form.cardId ?? null,
      ContractId: form.contractId ? Number(form.contractId) : null,
      // "Keep the balance on his on account" — unchecked means don't let the
      // approve-time hook auto-apply this party's on-account balance.
      oaSkipAutoApply: oaBalance > 0.01 ? !useOnAccountBalance : undefined,
      // Re-issue fields
      ...(reissueCtx ? {
        ReplacesPaymentId: reissueCtx.replacesPaymentId,
        BounceCharge: bounceCharge ? parseFloat(bounceCharge) : null,
        // Total = original amount + bounce charge
        amount: (form.amount ?? 0) + (bounceCharge ? parseFloat(bounceCharge) : 0),
      } : {}),
    } as any;

    try {
      setSaving(true);
      if (editingId) {
        await updatePayment(editingId, payload);
        toast.success("Payment updated.");
      } else {
        await addPayment(payload);
        // A Loan EMI payment isn't just a NewPayment record — it also has to
        // actually settle the EMI on the loan itself (mark it paid, run the
        // payoff/early-closure check, generate the payment ref). That's what
        // the loan-sanction backend's own /pay endpoint does; this triggers
        // it right after the payment record is created.
        if (selectedLoanEmi) {
          try {
            const res = await payLoan(selectedLoanEmi.LoanId, {
              emiIds: [selectedLoanEmi.EMIId],
              paymentDate: form.date,
              lateFee: loanLateFee || undefined,
              notes: loanPaymentNotes || `Paid via Payment — ${form.paymentName}`,
            });
            toast.success(
              res.loanClosed
                ? `Loan ${selectedLoanEmi.LoanNo} fully repaid and closed. Ref: ${res.paymentRef}`
                : `EMI settled on ${selectedLoanEmi.LoanNo}. Ref: ${res.paymentRef}`,
            );
            queryClient.invalidateQueries({ queryKey: ["payment-loan-emis"] });
            queryClient.invalidateQueries({ queryKey: ["loan-sanctions"] });
          } catch (loanErr: any) {
            toast.error(
              `Payment saved, but the loan EMI could not be settled: ${loanErr.message}. Settle it manually from the Loan Sanction page.`,
            );
          }
        } else {
          toast.success(reissueCtx ? "Re-issue payment saved. Linked to original." : "Payment saved.");
        }
      }
      queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["expense-options-payment"] });
      cancelForm();
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    try {
      await deletePayment(id);
      toast.success("Payment deleted.");
      queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["expense-options-payment"] });
      setDeleteId(null);
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const isChequeMode =
    form.mode === "Cheque" || form.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(
    form.mode,
  );
  const isCashMode = form.mode === "Cash";

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Payments"]} />
      <FinanceShell
        title="Payment Management"
        subtitle="Record and track payments linked to expense bookings"
        icon={Wallet}
        action={
          view === "list" ? (
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {rights.canCreate && (
                <Button
                  onClick={openNew}
                  className="shrink-0 gradient-accent text-white shadow-sm font-heading font-semibold px-3 sm:px-4 py-1.5 text-xs h-auto"
                >
                  <Plus size={13} className="sm:mr-1" />
                  <span className="hidden sm:inline">New Payment</span>
                </Button>
              )}
              <ExportMenu
                data={records as unknown as Record<string, unknown>[]}
                columns={EXPORT_COLUMNS}
                title="Payment Management"
                filename="payments"
                subtitle={
                  companyFilter
                    ? `Company: ${companyOptions.find((c) => String(c.id) === companyFilter)?.label || companyFilter}`
                    : undefined
                }
                companyName={
                  selectedCompanyDetail?.name ||
                  selectedCompanyDetail?.short_name ||
                  undefined
                }
                logoBase64={selectedCompanyDetail?.logo || undefined}
                disabled={
                  !rights.canExport || isLoading || records.length === 0
                }
              />
              <button
                onClick={() => refetchPayments()}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors"
                style={{ color: "#818cf8" }}
              >
                <RefreshCw size={13} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          ) : undefined
        }
      >
        {/* ── Summary stats ── */}
        {view === "list" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              {
                label: "Total Paid",
                value: formatINR(totalAmount),
                icon: Banknote,
                ring: "ring-primary/20",
                bg: "bg-primary/10",
                blob: "bg-primary",
                borderL: "border-l-primary",
                color: "text-primary",
              },
              {
                label: "By Cheque",
                value: String(chequeCount),
                icon: Clock,
                ring: "ring-amber-500/20",
                bg: "bg-amber-500/10",
                blob: "bg-amber-500",
                borderL: "border-l-amber-500",
                color: "text-amber-500",
              },
              {
                label: "By Cash",
                value: String(cashCount),
                icon: CheckCircle2,
                ring: "ring-emerald-500/20",
                bg: "bg-emerald-500/10",
                blob: "bg-emerald-500",
                borderL: "border-l-emerald-500",
                color: "text-emerald-500",
              },
            ].map(
              ({
                label,
                value,
                icon: Icon,
                ring,
                bg,
                blob,
                borderL,
                color,
              }) => (
                <div
                  key={label}
                  className={`relative glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 overflow-hidden border-l-2 ${ring} ${borderL}`}
                >
                  <div
                    className={`absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-4 translate-x-4 ${blob}`}
                  />
                  <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold font-heading text-foreground leading-none">
                      {value}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
                      {label}
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* FORM VIEW                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {view === "form" && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: isDark
                ? "rgba(12,14,22,0.55)"
                : "rgba(255,255,255,0.80)",
              border: isDark
                ? "1px solid rgba(99,102,241,0.20)"
                : "1px solid rgba(99,102,241,0.18)",
              backdropFilter: "blur(20px) saturate(160%)",
              WebkitBackdropFilter: "blur(20px) saturate(160%)",
              boxShadow: isDark
                ? "0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)"
                : "0 8px 40px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
            }}
          >
            {/* Form header */}
            <div
              className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 relative overflow-hidden"
              style={{
                background: isDark
                  ? "rgba(99,102,241,0.10)"
                  : "rgba(99,102,241,0.06)",
                borderBottom: isDark
                  ? "1px solid rgba(99,102,241,0.18)"
                  : "1px solid rgba(99,102,241,0.14)",
              }}
            >
              {/* Left accent stripe */}
              <div
                className="absolute left-0 top-0 bottom-0 w-0.5"
                style={{
                  background:
                    "linear-gradient(to bottom, transparent 10%, #6366f1 30%, #6366f1 70%, transparent 90%)",
                }}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={cancelForm}
                  className="flex items-center gap-1.5 text-sm transition-colors hover:opacity-70"
                  style={{ color: isDark ? "#94a3b8" : "#6366f1" }}
                >
                  <ArrowLeft size={15} />
                  <span className="hidden sm:inline">Back</span>
                </button>
                <span
                  style={{
                    color: isDark
                      ? "rgba(99,102,241,0.4)"
                      : "rgba(99,102,241,0.3)",
                  }}
                >
                  |
                </span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center"
                    style={{
                      background: "rgba(99,102,241,0.18)",
                      border: "1px solid rgba(99,102,241,0.30)",
                    }}
                  >
                    <Receipt size={12} style={{ color: "#818cf8" }} />
                  </div>
                  <h2
                    className="text-sm font-heading font-bold"
                    style={{ color: isDark ? "#e0e7ff" : "#3730a3" }}
                  >
                    {editingId ? "Edit Payment" : "New Payment"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-6 space-y-7">
              {/* ── 1. Link Expense Booking ── */}
              <div className="space-y-3">
                <SectionHeader icon={Link2} label="Expense Booking" />

                {/* Filter bar + picker — only shown before a booking is linked */}
                {!form.expenseRef &&
                  (() => {
                    const filteredOptions = expenseOptions.filter((o) => {
                      // Never show fully-paid invoices in the new payment dropdown
                      if ((o as any).billStatus === "Paid") return false;
                      if (
                        bookingFilters.company &&
                        (o.companyName ?? "") !== bookingFilters.company
                      )
                        return false;
                      if (
                        bookingFilters.project &&
                        (o.projectName ?? "") !== bookingFilters.project
                      )
                        return false;
                      if (
                        bookingFilters.year &&
                        (o.financialYear ?? "") !== bookingFilters.year
                      )
                        return false;
                      if (
                        bookingFilters.supplier &&
                        (o.supplierName ?? "") !== bookingFilters.supplier
                      )
                        return false;
                      return true;
                    });

                    return (
                      <div className="space-y-3">
                        <FilterBar
                          companyOptions={companyOptions}
                          projectOptions={projectOptions}
                          supplierOptions={supplierOptions}
                          finYearOptions={finYearOptions}
                          filters={bookingFilters}
                          selectedCompanyId={
                            bookingFilters.company
                              ? (companyOptions.find(
                                  (c) => c.label === bookingFilters.company,
                                )?.id ?? null)
                              : null
                          }
                          onChange={(key, val) => {
                            setBookingFilters((prev) => {
                              const next = { ...prev, [key]: val };
                              // When company changes, clear project if it no longer belongs to the new company
                              if (key === "company") {
                                const newCompanyId = val
                                  ? (companyOptions.find((c) => c.label === val)
                                      ?.id ?? null)
                                  : null;
                                if (prev.project) {
                                  const projStillValid = newCompanyId
                                    ? projectOptions.some(
                                        (p) =>
                                          p.label === prev.project &&
                                          (p.belongs_to === newCompanyId ||
                                            p.company_id === newCompanyId),
                                      )
                                    : true;
                                  if (!projStillValid) next.project = "";
                                }
                              }
                              return next;
                            });
                          }}
                        />
                        <ExpenseBookingPicker
                          options={filteredOptions}
                          value={form.expenseId}
                          onChange={handleExpenseSelect}
                          loading={loadingExpense}
                          contracts={contractOptions}
                          contractsLoading={contractsLoading}
                          selectedContract={selectedContract}
                          onContractSelect={handleContractSelect}
                          onContractClear={clearContractLink}
                          loanEmis={loanEmiOptions}
                          loanEmisLoading={loanEmisLoading}
                          selectedLoanEmi={selectedLoanEmi}
                          onLoanEmiSelect={handleLoanEmiSelect}
                          onLoanEmiClear={clearLoanEmiLink}
                        />
                        {selectedLoanEmi && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                            <span>
                              Late fee: <span className="font-mono font-medium text-foreground/80">{loanLateFee ? formatINR(Number(loanLateFee)) : "—"}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setLoanPaymentDetailsOpen(true)}
                              className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
                            >
                              Edit loan payment details
                            </button>
                          </p>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          {filteredOptions.length === 0 && !loadingExpense && (
                            <p className="text-[11px] text-muted-foreground">Invoice not visible?</p>
                          )}
                          <button
                            type="button"
                            disabled={syncingBalances}
                            className="flex items-center gap-1 text-[11px] text-primary underline underline-offset-2 hover:opacity-80 transition-opacity disabled:opacity-50"
                            onClick={async () => {
                              setSyncingBalances(true);
                              try {
                                const r = await fetchWithAuth("/api/new-payment/recalculate-balances", { method: "POST" });
                                const d = await r.json().catch(() => ({}));
                                await queryClient.invalidateQueries({ queryKey: ["expense-options-payment"] });
                                toast.success(`Balances synced (${d.updated ?? 0} invoices updated)`);
                              } catch {
                                toast.error("Sync failed — please try again.");
                              } finally {
                                setSyncingBalances(false);
                              }
                            }}
                          >
                            {syncingBalances && <div className="w-2.5 h-2.5 border border-primary border-t-transparent rounded-full animate-spin" />}
                            {syncingBalances ? "Syncing…" : "Sync invoice balances"}
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                {!form.expenseRef && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-1">
                    <Field label="Company">
                      <div className="relative">
                        <Building2
                          size={13}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <select
                          value={(() => {
                            const asNum = parseInt(form.company, 10);
                            if (
                              !isNaN(asNum) &&
                              String(asNum) === form.company.trim()
                            )
                              return String(asNum);
                            const matched = companyOptions.find(
                              (c) => c.label === form.company,
                            );
                            return matched ? String(matched.id) : "";
                          })()}
                          onChange={(e) => {
                            const id = e.target.value;
                            const label =
                              companyOptions.find((c) => String(c.id) === id)
                                ?.label || "";
                            set("company", label);
                            set("project", "");
                            set("projectSite", "");
                          }}
                          className="w-full appearance-none pl-8 pr-7 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">Select company…</option>
                          {companyOptions.map((c) => (
                            <option key={c.id} value={String(c.id)}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={11}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                    </Field>
                    <Field label="Project / Site">
                      <div className="relative">
                        <FolderKanban
                          size={13}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <select
                          value={(() => {
                            const matched = projectOptions.find(
                              (p) =>
                                p.label === form.project ||
                                p.label === form.projectSite,
                            );
                            return matched ? String(matched.id) : "";
                          })()}
                          onChange={(e) => {
                            const id = e.target.value;
                            const label =
                              projectOptions.find((p) => String(p.id) === id)
                                ?.label || "";
                            set("project", label);
                            set("projectSite", label);
                          }}
                          className="w-full appearance-none pl-8 pr-7 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">Select project…</option>
                          {(() => {
                            const asNum = parseInt(form.company, 10);
                            const companyId =
                              !isNaN(asNum) &&
                              String(asNum) === form.company.trim()
                                ? asNum
                                : (companyOptions.find(
                                    (c) => c.label === form.company,
                                  )?.id ?? null);
                            return (
                              companyId
                                ? projectOptions.filter(
                                    (p) => p.company_id === companyId,
                                  )
                                : projectOptions
                            ).map((p) => (
                              <option key={p.id} value={String(p.id)}>
                                {p.label}
                              </option>
                            ));
                          })()}
                        </select>
                        <ChevronDown
                          size={11}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                    </Field>
                    <Field
                      label="Payee / Party"
                      hint="Required for On Account tracking — who this payment is being made to"
                    >
                      <div className="relative">
                        <Users
                          size={13}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                        <select
                          value={form.partyId !== null ? String(form.partyId) : ""}
                          onChange={(e) => {
                            const id = e.target.value;
                            const opt = supplierOptions.find((s) => String(s.id) === id);
                            set("partyId", id ? Number(id) : null);
                            set("paidTo", opt?.label || "");
                          }}
                          className="w-full appearance-none pl-8 pr-7 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">Select party…</option>
                          {supplierOptions.map((s) => (
                            <option key={s.id} value={String(s.id)}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={11}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                    </Field>
                  </div>
                )}

                {form.expenseRef && selectedContract && (
                  <AutoFillBanner
                    docNo={selectedContract.DocNo || form.expenseRef}
                    label="Linked to contract"
                    onClear={clearContractLink}
                  />
                )}

                {form.expenseRef && !selectedContract && (
                  <AutoFillBanner
                    docNo={form.expenseRef}
                    onClear={clearExpenseLink}
                  />
                )}

                {form.expenseRef && selectedContract && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-1">
                    <Field label="Company">
                      <div className="flex items-center gap-2">
                        <Building2
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={form.company}
                          placeholder="From contract"
                        />
                      </div>
                    </Field>
                    <Field label="Project / Site">
                      <div className="flex items-center gap-2">
                        <FolderKanban
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={form.projectSite}
                          placeholder="From contract"
                        />
                      </div>
                    </Field>
                    <Field label="Contractor">
                      <div className="flex items-center gap-2">
                        <Users
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={selectedContract.ContactPerson || form.paidTo || ""}
                          placeholder="From contract"
                        />
                      </div>
                    </Field>
                    <Field label="Contract Doc No">
                      <div className="flex items-center gap-2">
                        <FileText
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={selectedContract.DocNo || form.expenseRef}
                          placeholder="Auto-fetched"
                        />
                      </div>
                    </Field>
                  </div>
                )}

                {form.expenseRef && !selectedContract && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-1">
                    <Field label="Company">
                      <div className="flex items-center gap-2">
                        <Building2
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={(() => {
                            // form.company may be a raw ID string if ECompanyName was blank
                            const asNum = parseInt(form.company, 10);
                            if (
                              !isNaN(asNum) &&
                              String(asNum) === form.company.trim()
                            ) {
                              return (
                                companyOptions.find((c) => c.id === asNum)
                                  ?.label || form.company
                              );
                            }
                            return form.company;
                          })()}
                          placeholder="From expense booking"
                        />
                      </div>
                    </Field>
                    <Field label="Project / Site">
                      <div className="flex items-center gap-2">
                        <FolderKanban
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={form.projectSite}
                          placeholder="From linked GRN"
                        />
                      </div>
                    </Field>
                    <Field label="Supplier / Party">
                      <div className="flex items-center gap-2">
                        <FolderKanban
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={
                            expenseOptions.find((o) => o.id === form.expenseId)
                              ?.supplierName || form.paidTo || ""
                          }
                          placeholder={reissueCtx ? "—" : "From expense booking"}
                        />
                      </div>
                    </Field>
                    <Field label="Doc Type">
                      <div className="flex items-center gap-2">
                        <FileText
                          size={13}
                          className="text-muted-foreground shrink-0"
                        />
                        <ReadOnlyField
                          value={form.docType}
                          placeholder="From expense booking"
                        />
                      </div>
                    </Field>
                  </div>
                )}

                {form.expenseRef && linkedGRNs.length > 0 && (
                  <div className="mt-3">
                    <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-heading font-semibold text-teal-600 dark:text-teal-400">
                        <Truck size={12} /> Linked GRNs ({linkedGRNs.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {linkedGRNs.map((g) => (
                          <div
                            key={g.GRNID}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-teal-500/30 bg-background text-xs"
                          >
                            <Truck
                              size={11}
                              className="text-teal-500 shrink-0"
                            />
                            <span className="font-mono font-semibold text-teal-600 dark:text-teal-400">
                              {g.GRNNo}
                            </span>
                            {g.PONumber && (
                              <span className="text-muted-foreground hidden sm:inline">
                                · PO: {g.PONumber}
                              </span>
                            )}
                            {g.GRNDate && (
                              <span className="text-muted-foreground">
                                {g.GRNDate.slice(0, 10)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Outstanding Balance Card ── */}
              {form.expenseRef && (() => {
                const opt = expenseOptions.find((o) => o.id === form.expenseId || o.docNo === form.expenseRef);
                if (!opt || opt.type === "emi") return null;
                // opt.amount is the stored ENetAmount (GST + billing terms
                // already applied server-side) — normally correct, but a
                // handful of GRN-linked bookings have it stuck at the base
                // (pre-GST) amount from before ENetAmount was computed
                // correctly at save time. When there are no active billing
                // terms on this invoice, the live GST-inclusive GRN total is
                // exactly what ENetAmount should equal, so prefer it when it
                // disagrees — self-heals the stale-data case without
                // touching billing-terms-adjusted invoices, where opt.amount
                // legitimately differs from the raw GST-inclusive total.
                let hasActiveBillingTerms = false;
                try {
                  const bt = form.billingTermsData
                    ? JSON.parse(form.billingTermsData)
                    : [];
                  hasActiveBillingTerms =
                    Array.isArray(bt) && bt.some((t: any) => t?.applicable);
                } catch {
                  /* malformed/legacy data — treat as no active terms */
                }
                const grnInclTotal = grnGstBreakdown?.totals?.totalInclGST ?? 0;
                const netAmt =
                  !hasActiveBillingTerms &&
                  grnInclTotal > 0 &&
                  Math.abs(grnInclTotal - (opt.amount ?? 0)) > 0.01
                    ? grnInclTotal
                    : (opt.amount ?? 0);
                // Use live chain-derived values when available (excludes bounced, subtracts bounce charges).
                // Fall back to stale DB opt.totalPaid only when chain hasn't loaded yet.
                const livePaid = formLiveRemaining != null ? Math.max(0, netAmt - formLiveRemaining) : null;
                const paid = livePaid ?? opt.totalPaid ?? 0;
                const remaining = formLiveRemaining ?? (opt.remainingAmount != null
                  ? opt.remainingAmount
                  : Math.max(0, netAmt - paid));
                const bStatus = deriveBillStatus(paid, remaining, netAmt);
                return (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-primary flex items-center gap-1.5">
                        <Wallet size={9} /> Invoice Balance
                      </p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        bStatus === "Paid"
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                          : bStatus === "Partially Paid"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                          : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
                      }`}>
                        {bStatus}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Invoice Total</p>
                        <p className="font-mono text-xs font-bold text-foreground">{formatINR(netAmt)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Paid</p>
                        <p className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatINR(paid)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Outstanding</p>
                        <p className={`font-mono text-xs font-bold ${remaining > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                          {formatINR(remaining)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}


              {/* ── On A/C Adjustment context banner ── */}
              {oaAdjustCtx && (
                <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-700 dark:text-blue-400">
                      On A/C Adjustment — {oaAdjustCtx.partyName}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select an invoice for this party — the On A/C balance will auto-apply on save
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Source: {oaAdjustCtx.sourceDocNo}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">
                      {typeof formatINR === "function" ? formatINR(oaAdjustCtx.availableBalance) : `₹${oaAdjustCtx.availableBalance}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setOaAdjustCtx(null); setOaBalance(0); }}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* ── On Account Balance section ── */}
              {form.expenseRef && oaBalance > 0.01 && (() => {
                const preview = oaPreview;
                if (!preview || preview.applyAmount <= 0) return null; // invoice already fully covered — nothing to offer

                return (
                  <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.07] via-emerald-500/[0.03] to-transparent overflow-hidden shadow-sm">
                    <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-emerald-500/10">
                      <div className="flex items-center gap-2.5">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/15 shrink-0">
                          <Wallet size={15} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                            On Account Balance
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Available for this supplier</p>
                        </div>
                      </div>
                      <span className="font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        {formatINR(oaBalance)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setUseOnAccountBalance(!useOnAccountBalance)}
                      className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-emerald-500/[0.04] transition-colors"
                    >
                      {/* Toggle switch */}
                      <span
                        className={`relative shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors ${useOnAccountBalance ? "bg-emerald-500" : "bg-muted-foreground/25"}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${useOnAccountBalance ? "translate-x-4" : "translate-x-0"}`}
                        />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground">
                          Use on-account balance for this payment
                        </p>
                        {useOnAccountBalance ? (
                          <div className="mt-2 rounded-lg border border-emerald-500/20 bg-background/60 divide-y divide-emerald-500/10 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-1.5 text-[11px]">
                              <span className="text-muted-foreground">Adjusted from balance</span>
                              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                {formatINR(preview.applyAmount)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between px-3 py-1.5 text-[11px]">
                              <span className="text-muted-foreground">
                                {preview.isFullyCovered ? "Invoice status" : "Remaining outstanding"}
                              </span>
                              {preview.isFullyCovered ? (
                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 size={11} /> Fully settled
                                </span>
                              ) : (
                                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                                  {formatINR(preview.invoiceRemainingAfter)}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Balance stays untouched — {formatINR(oaBalance)} kept on his on-account.
                          </p>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })()}

              {/* ── 2. Payment Details ── */}
              <div className="space-y-3">
                <SectionHeader icon={Receipt} label="Payment Details" />
                {editingId && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Doc No">
                      <ReadOnlyField value={form.docNo} placeholder="—" />
                    </Field>
                    <Field label="Root ExB Doc No">
                      <ReadOnlyField
                        value={form.rootExBDocNo}
                        placeholder="Standalone payment"
                      />
                    </Field>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Payment Purpose" required>
                    <select
                      value={form.paymentName}
                      onChange={(e) => set("paymentName", e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">— Select reason —</option>
                      {paymentReasons.map((r) => (
                        <option key={r.id} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Payment Date" required>
                    <div className="relative">
                      <CalendarDays
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      />
                      <input
                        type="date"
                        value={form.date}
                        onChange={(e) => set("date", e.target.value)}
                        className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                      />
                    </div>
                  </Field>
                </div>

                {oaAdjustmentsForInvoice.length > 0 && (
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 space-y-1">
                    {oaAdjustmentsForInvoice.map((adj, i) => (
                      <p key={i} className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <Wallet size={12} className="shrink-0" />
                        On A/C adjusted with <span className="font-mono font-semibold">{formatINR(adj.amount)}</span> from <span className="font-semibold">{adj.partyName}</span>
                      </p>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label="Amount (₹)"
                    required={isCashMode}
                    hint={
                      grnGstBreakdown
                        ? "Auto-filled from GRN item totals (incl. GST) — editable if needed."
                        : selectedContract
                          ? "Defaults to the contract's pending balance — lower this for a partial advance."
                          : form.expenseRef
                            ? "Net amount from expense booking — editable if needed."
                            : undefined
                    }
                  >
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold pointer-events-none">
                        ₹
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.amount ?? ""}
                        onChange={(e) =>
                          set("amount", parseFloat(e.target.value) || null)
                        }
                        placeholder="0.00"
                        className="w-full pl-7 pr-3 py-2 rounded-lg text-sm font-mono bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60"
                      />
                    </div>
                  </Field>
                  {(form.amount ?? 0) > 0 &&
                    (() => {
                      // Only render a breakdown when we have reliable GST data:
                      // either a GRN item-level breakdown OR explicit GST rates on the booking.
                      const hasGrnBreakdown = !!(
                        grnGstBreakdown &&
                        grnGstBreakdown.totals.totalInclGST > 0
                      );
                      const hasExplicitGst =
                        (form.cgstRate ?? 0) > 0 ||
                        (form.sgstRate ?? 0) > 0 ||
                        (form.igstRate ?? 0) > 0;
                      const hasBaseAmount = !!(
                        form.baseAmount && form.baseAmount > 0
                      );

                      // Don't render if we can't compute a meaningful breakdown
                      if (!hasGrnBreakdown && !hasExplicitGst && !hasBaseAmount)
                        return null;

                      const base = hasBaseAmount
                        ? form.baseAmount!
                        : (form.amount ?? 0);
                      const cgstRate = form.cgstRate ?? 0;
                      const sgstRate = form.sgstRate ?? 0;
                      const igstRate = form.igstRate ?? 0;

                      // Parse billing terms — must be an array of term objects.
                      // EDiscountData is a legacy flat discount object {applicable,type,value}
                      // and must NOT be treated as billing terms; skip it if not an array.
                      let billingTerms: {
                        masterTermName?: string;
                        type: string;
                        value: number;
                        appliedOn: string;
                        deductionType?: string;
                        applicable?: boolean;
                      }[] = [];
                      try {
                        if (form.billingTermsData) {
                          const parsed = JSON.parse(form.billingTermsData);
                          // Only treat as billing terms if it's a proper array
                          // with items that have an `appliedOn` field (billing term shape).
                          if (
                            Array.isArray(parsed) &&
                            parsed.length > 0 &&
                            parsed[0].appliedOn !== undefined
                          ) {
                            billingTerms = parsed.filter(
                              (t: any) => t.applicable !== false,
                            );
                          }
                        }
                      } catch {
                        /* ignore */
                      }

                      const preGst = billingTerms.filter(
                        (t) => t.appliedOn !== "post-gst",
                      );
                      const postGst = billingTerms.filter(
                        (t) => t.appliedOn === "post-gst",
                      );

                      // Apply pre-GST terms sequentially to taxable base, then
                      // recompute GST on adjusted base. Post-GST terms apply on gross.
                      let taxable = base;
                      const preGstRows: {
                        term: (typeof preGst)[0];
                        amt: number;
                      }[] = [];
                      for (const t of preGst) {
                        const amt =
                          t.type === "percentage"
                            ? (taxable * t.value) / 100
                            : t.value;
                        preGstRows.push({ term: t, amt });
                        if (t.deductionType === "Addition") taxable += amt;
                        else taxable = Math.max(0, taxable - amt);
                      }

                      // Derive effective GST rates from GRN breakdown to recompute
                      // GST correctly on the adjusted taxable base.
                      const effectiveCGSTRate =
                        grnGstBreakdown && grnGstBreakdown.totals.totalBase > 0
                          ? (grnGstBreakdown.totals.totalCGST /
                              grnGstBreakdown.totals.totalBase) *
                            100
                          : cgstRate;
                      const effectiveSGSTRate =
                        grnGstBreakdown && grnGstBreakdown.totals.totalBase > 0
                          ? (grnGstBreakdown.totals.totalSGST /
                              grnGstBreakdown.totals.totalBase) *
                            100
                          : sgstRate;

                      // When pre-GST terms exist, recompute GST on adjusted base.
                      // Otherwise use exact per-item sums from GRN breakdown.
                      const hasPreTerms = preGstRows.length > 0;
                      const cgst = hasPreTerms
                        ? (taxable * effectiveCGSTRate) / 100
                        : grnGstBreakdown
                          ? grnGstBreakdown.totals.totalCGST
                          : (taxable * cgstRate) / 100;
                      const sgst = hasPreTerms
                        ? (taxable * effectiveSGSTRate) / 100
                        : grnGstBreakdown
                          ? grnGstBreakdown.totals.totalSGST
                          : (taxable * sgstRate) / 100;
                      const igst = hasPreTerms
                        ? 0
                        : grnGstBreakdown
                          ? 0
                          : (taxable * igstRate) / 100;
                      let gross = hasPreTerms
                        ? taxable + cgst + sgst + igst
                        : grnGstBreakdown
                          ? grnGstBreakdown.totals.totalInclGST
                          : taxable + cgst + sgst + igst;

                      // Apply post-GST terms sequentially on gross
                      const postGstRows: {
                        term: (typeof postGst)[0];
                        amt: number;
                      }[] = [];
                      for (const t of postGst) {
                        const amt =
                          t.type === "percentage"
                            ? (gross * t.value) / 100
                            : t.value;
                        postGstRows.push({ term: t, amt });
                        if (t.deductionType === "Addition") gross += amt;
                        else gross = Math.max(0, gross - amt);
                      }

                      // Net Payable = gross after all term adjustments, rounded to nearest rupee
                      const net = Math.round(gross);
                      const roundOff = net - gross;

                      const hasGst = cgst + sgst + igst > 0;
                      const hasTerms =
                        preGstRows.length > 0 || postGstRows.length > 0;

                      const Row = ({
                        label,
                        sub,
                        value,
                        color,
                        bold,
                        large,
                      }: {
                        label: string;
                        sub?: string;
                        value: string;
                        color?: string;
                        bold?: boolean;
                        large?: boolean;
                      }) => (
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <span
                              className={`text-xs ${bold ? "font-heading font-semibold text-foreground" : "text-muted-foreground"}`}
                            >
                              {label}
                            </span>
                            {sub && (
                              <p className="text-[10px] text-muted-foreground/60">
                                {sub}
                              </p>
                            )}
                          </div>
                          <span
                            className={`font-mono shrink-0 ${large ? "text-base font-bold text-primary" : bold ? "text-sm font-semibold text-foreground" : `text-xs ${color ?? "text-muted-foreground"}`}`}
                          >
                            {value}
                          </span>
                        </div>
                      );

                      return (
                        <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <TrendingUp
                              size={13}
                              className="text-primary shrink-0"
                            />
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">
                              Payment Breakdown
                            </p>
                          </div>

                          {/* ── GST Summary Cards (cumulative) ── */}
                          {grnGstBreakdown &&
                            grnGstBreakdown.totals.totalInclGST > 0 && (
                              <>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                                  {[
                                    {
                                      label: "Base Amount",
                                      value: grnGstBreakdown.totals.totalBase,
                                      cls: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
                                    },
                                    {
                                      label: "CGST",
                                      value: grnGstBreakdown.totals.totalCGST,
                                      cls: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
                                    },
                                    {
                                      label: "SGST",
                                      value: grnGstBreakdown.totals.totalSGST,
                                      cls: "border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300",
                                    },
                                    {
                                      label: "Total GST",
                                      value: grnGstBreakdown.totals.totalGST,
                                      cls: "border-orange-500/30 bg-orange-500/5 text-orange-700 dark:text-orange-300",
                                    },
                                  ].map(({ label, value, cls }) => (
                                    <div
                                      key={label}
                                      className={`rounded-lg border px-3 py-2 ${cls}`}
                                    >
                                      <div className="text-[10px] font-heading uppercase tracking-wider opacity-70">
                                        {label}
                                      </div>
                                      <div className="text-sm font-mono font-bold mt-1">
                                        {formatINR(value)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="px-4 py-2.5 bg-muted/10 border border-blue-500/10 rounded-lg flex flex-wrap items-center gap-1.5 text-[11px] font-mono mb-2">
                                  <span className="text-blue-600 dark:text-blue-400 font-semibold">
                                    {formatINR(
                                      grnGstBreakdown.totals.totalBase,
                                    )}
                                  </span>
                                  <span className="text-muted-foreground">
                                    (base)
                                  </span>
                                  <span className="text-muted-foreground">
                                    +
                                  </span>
                                  <span className="text-violet-600 dark:text-violet-400 font-semibold">
                                    {formatINR(
                                      grnGstBreakdown.totals.totalCGST,
                                    )}
                                  </span>
                                  <span className="text-muted-foreground">
                                    (CGST)
                                  </span>
                                  <span className="text-muted-foreground">
                                    +
                                  </span>
                                  <span className="text-violet-600 dark:text-violet-400 font-semibold">
                                    {formatINR(
                                      grnGstBreakdown.totals.totalSGST,
                                    )}
                                  </span>
                                  <span className="text-muted-foreground">
                                    (SGST)
                                  </span>
                                  <span className="text-muted-foreground">
                                    =
                                  </span>
                                  <span className="text-foreground font-bold">
                                    {formatINR(
                                      grnGstBreakdown.totals.totalInclGST,
                                    )}
                                  </span>
                                </div>
                              </>
                            )}

                          <div className="space-y-1.5">
                            {/* Base — for GRN breakdown always show totalBase (pre-tax),
                                not form.baseAmount which may still hold the incl-GST figure
                                if the setForm override hasn't landed yet */}
                            <Row
                              label="Basic Amount"
                              sub={grnGstBreakdown ? "Excl. GST" : undefined}
                              value={formatINR(
                                grnGstBreakdown
                                  ? grnGstBreakdown.totals.totalBase
                                  : base,
                              )}
                            />

                            {/* Pre-GST billing terms */}
                            {preGstRows.map(({ term, amt }, i) => {
                              const isAdd = term.deductionType === "Addition";
                              return (
                                <Row
                                  key={i}
                                  label={term.masterTermName ?? `Term ${i + 1}`}
                                  sub={`${isAdd ? "Addition" : "Deduction"} · Before GST${term.type === "percentage" ? ` · ${term.value}%` : ""}`}
                                  value={(isAdd ? "+ " : "− ") + formatINR(amt)}
                                  color={
                                    isAdd
                                      ? "text-green-500"
                                      : "text-destructive"
                                  }
                                />
                              );
                            })}

                            {/* Taxable subtotal — only show if pre-GST terms changed it */}
                            {preGstRows.length > 0 && (
                              <>
                                <div className="border-t border-border/40 pt-1" />
                                <Row
                                  label="Taxable Amount"
                                  sub="After pre-GST adjustments"
                                  value={formatINR(taxable)}
                                  bold
                                />
                              </>
                            )}

                            {/* GST */}
                            {hasGst && (
                              <>
                                {preGstRows.length === 0 && (
                                  <div className="border-t border-border/40 pt-1" />
                                )}
                                {grnGstBreakdown ? (
                                  /* Cumulative GST totals */
                                  <>
                                    {grnGstBreakdown.totals.totalCGST > 0 && (
                                      <Row
                                        label="CGST"
                                        value={formatINR(
                                          grnGstBreakdown.totals.totalCGST,
                                        )}
                                        color="text-primary"
                                      />
                                    )}
                                    {grnGstBreakdown.totals.totalSGST > 0 && (
                                      <Row
                                        label="SGST"
                                        value={formatINR(
                                          grnGstBreakdown.totals.totalSGST,
                                        )}
                                        color="text-primary"
                                      />
                                    )}
                                  </>
                                ) : (
                                  /* Non-GRN: single averaged rate is the actual rate */
                                  <>
                                    {cgst > 0 && (
                                      <Row
                                        label={`CGST @ ${cgstRate}%`}
                                        value={formatINR(cgst)}
                                        color="text-primary"
                                      />
                                    )}
                                    {sgst > 0 && (
                                      <Row
                                        label={`SGST @ ${sgstRate}%`}
                                        value={formatINR(sgst)}
                                        color="text-primary"
                                      />
                                    )}
                                    {igst > 0 && (
                                      <Row
                                        label={`IGST @ ${igstRate}%`}
                                        value={formatINR(igst)}
                                        color="text-primary"
                                      />
                                    )}
                                  </>
                                )}
                              </>
                            )}

                            {/* Gross before post-GST — use the pre-computed `gross`
                                variable which equals totalInclGST when a GRN breakdown
                                is available, avoiding the double-count from
                                (inclGST base) + cgst + sgst */}
                            {(hasGst || hasTerms) && (
                              <>
                                <div className="border-t border-border/40 pt-1" />
                                <Row
                                  label="Gross Amount"
                                  sub={
                                    hasGst
                                      ? "Taxable + GST"
                                      : "Before post-GST adjustments"
                                  }
                                  value={formatINR(gross)}
                                  bold
                                />
                              </>
                            )}

                            {/* Post-GST billing terms */}
                            {postGstRows.map(({ term, amt }, i) => {
                              const isAdd = term.deductionType === "Addition";
                              return (
                                <Row
                                  key={i}
                                  label={term.masterTermName ?? `Term ${i + 1}`}
                                  sub={`${isAdd ? "Addition" : "Deduction"} · After GST${term.type === "percentage" ? ` · ${term.value}%` : ""}`}
                                  value={(isAdd ? "+ " : "− ") + formatINR(amt)}
                                  color={
                                    isAdd
                                      ? "text-green-500"
                                      : "text-destructive"
                                  }
                                />
                              );
                            })}

                            {/* Round off */}
                            {Math.abs(roundOff) >= 0.01 && (
                              <Row
                                label="Round Off"
                                value={
                                  (roundOff >= 0 ? "+ " : "− ") +
                                  formatINR(Math.abs(roundOff))
                                }
                              />
                            )}

                            {/* Net payable */}
                            <div className="border-t border-border/60 pt-1.5" />
                            <Row
                              label="Net Payable"
                              value={formatINR(net)}
                              bold
                              large
                            />

                            {/* ── Payment calculation chain ── */}
                            {(() => {
                              const entered = Number(form.amount ?? 0);
                              if (entered <= 0 || Math.abs(entered - net) < 0.01) return null;

                              const opt = expenseOptions.find(
                                (o) => o.id === form.expenseId || o.docNo === form.expenseRef,
                              );
                              const prevOutstanding = resolveOutstanding(
                                net,
                                formLiveRemaining,
                                formKnownTotalPaid ?? opt?.totalPaid,
                              );
                              const alreadyPaid = Math.max(0, net - prevOutstanding);
                              const afterThisPayment = Math.max(0, prevOutstanding - entered);
                              const isExact   = Math.abs(entered - prevOutstanding) < 0.01;
                              const isPartial = !isExact && entered < prevOutstanding;
                              const isOver    = !isExact && entered > prevOutstanding;

                              const chainColor = isOver
                                ? "border-amber-500/30 bg-amber-500/5"
                                : isExact
                                  ? "border-emerald-500/30 bg-emerald-500/5"
                                  : "border-blue-500/30 bg-blue-500/5";

                              return (
                                <div className={`mt-3 rounded-xl border px-4 py-3.5 space-y-1.5 text-sm ${chainColor}`}>
                                  {/* Step 1: Net − Already Paid = Outstanding (only when there are prior payments) */}
                                  {alreadyPaid > 0.01 && (
                                    <>
                                      <div className="flex justify-between items-center text-muted-foreground">
                                        <span>Net payable</span>
                                        <span className="font-mono">{formatINR(net)}</span>
                                      </div>
                                      <div className="flex justify-between items-center text-muted-foreground">
                                        <span>Already paid</span>
                                        <span className="font-mono text-emerald-600 dark:text-emerald-400">− {formatINR(alreadyPaid)}</span>
                                      </div>
                                      <div className="flex justify-between items-center font-semibold border-t border-border/30 pt-1.5">
                                        <span>Outstanding</span>
                                        <span className="font-mono">{formatINR(prevOutstanding)}</span>
                                      </div>
                                    </>
                                  )}

                                  {/* Step 2: Outstanding − This payment = Remaining */}
                                  <div className={`flex justify-between items-center text-muted-foreground ${alreadyPaid > 0.01 ? "pt-1" : ""}`}>
                                    <span>Outstanding{alreadyPaid <= 0.01 ? ` (full invoice)` : ""}</span>
                                    <span className="font-mono">{formatINR(prevOutstanding)}</span>
                                  </div>
                                  <div className="flex justify-between items-center text-muted-foreground">
                                    <span>This payment</span>
                                    <span className="font-mono text-primary">− {formatINR(entered)}</span>
                                  </div>
                                  <div className={`flex justify-between items-center font-bold border-t border-border/30 pt-1.5 ${
                                    isExact || isOver
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-amber-600 dark:text-amber-400"
                                  }`}>
                                    <span className="flex items-center gap-1.5">
                                      {isExact
                                        ? <><CheckCircle2 size={12} /> Fully settled</>
                                        : isPartial
                                          ? "Remaining"
                                          : <><Wallet size={12} /> On A/c for {form.paidTo || "Supplier"}</>}
                                    </span>
                                    <span className="font-mono text-base">
                                      {isOver ? `+ ${formatINR(entered - prevOutstanding)}` : formatINR(afterThisPayment)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })()}
                </div>
              </div>

              {/* ── Payment Chain (form view) ── */}
              {form.expenseRef && (formChainData?.payments?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-background/60">
                    <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      <History size={9} /> Payment Chain
                    </p>
                    <div className="flex items-center gap-2.5">
                      {selectedContract && selectedContract.PendingAmount != null && (
                        <span className="text-[10px] font-mono font-semibold text-amber-600 dark:text-amber-400">
                          Pending {formatINR(Math.max(selectedContract.PendingAmount, 0))}
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {formChainData!.payments.length} attempt{formChainData!.payments.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    {loadingFormChain ? (
                      <p className="text-[11px] text-muted-foreground text-center py-2">Loading…</p>
                    ) : (
                      formChainData!.payments.map((p: PaymentChainItem, idx: number) => {
                        const ds = p.DisplayStatus;
                        const borderCls =
                          ds === "Success" || ds === "Cheque Cleared"
                            ? "border-emerald-500"
                            : ds === "Cheque Bounced"
                            ? "border-red-500"
                            : ds === "Reissued"
                            ? "border-violet-500"
                            : ds === "Cheque Issued"
                            ? "border-blue-500"
                            : ds === "Pending"
                            ? "border-amber-500"
                            : "border-border";
                        const badgeCls =
                          ds === "Success" || ds === "Cheque Cleared"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                            : ds === "Cheque Bounced"
                            ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20"
                            : ds === "Reissued"
                            ? "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
                            : ds === "Cheque Issued"
                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                            : ds === "Pending"
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                            : "bg-muted text-muted-foreground border-border";
                        return (
                          <div key={p.PPaymentID} className={`flex gap-2.5 pl-3 border-l-2 ${borderCls}`}>
                            <div className="min-w-0 flex-1 py-0.5 space-y-0.5">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[11px] font-semibold text-foreground">
                                    {p.DocNo ?? `#${p.PPaymentID}`}
                                  </span>
                                  {idx === formChainData!.payments.length - 1 && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-semibold">LATEST</span>
                                  )}
                                </div>
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${badgeCls}`}>{ds}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                                <span>{p.PDate ? new Date(p.PDate).toLocaleDateString("en-IN") : "—"}</span>
                                <span>·</span>
                                <span className="font-mono font-semibold text-foreground">{formatINR(p.PAmount ?? 0)}</span>
                                <span>·</span>
                                <span>{p.PMode ?? "—"}</span>
                                {(() => {
                                  const bank = p.PBankName || bankNameFromIfsc(p.PChequeIfsc);
                                  return bank ? <><span>·</span><span className="font-medium text-foreground/70">{bank}</span></> : null;
                                })()}
                                {p.PChequeNo && <><span>·</span><span>Chq {p.PChequeNo}</span></>}
                                {(p.BounceCharge ?? 0) > 0 && (
                                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                                    +{formatINR(p.BounceCharge!)} bank charge
                                  </span>
                                )}
                              </div>
                              {p.BounceReason && (
                                <p className="text-[10px] text-red-600 dark:text-red-400 italic">
                                  Bounced: {p.BounceReason}
                                  {p.BounceDate && <> on {new Date(p.BounceDate).toLocaleDateString("en-IN")}</>}
                                </p>
                              )}
                              {p.ReplacementDocNo && (
                                <p className="text-[10px] text-violet-600 dark:text-violet-400">
                                  Reissued as {p.ReplacementDocNo}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* ── Re-issue banner ── */}
              {reissueCtx && (
                <div className="flex items-start gap-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/30 px-4 py-3">
                  <RefreshCw size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      Re-issuing bounced payment
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Replaces <span className="font-mono font-medium">{reissueCtx.replacesDocNo}</span>
                      {reissueCtx.bounceReason && <> · <span className="italic">{reissueCtx.bounceReason}</span></>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Original amount: <span className="font-mono font-semibold">{formatINR(reissueCtx.amount)}</span>
                      {bounceCharge && parseFloat(bounceCharge) > 0 && (
                        <> + bounce charge: <span className="font-mono font-semibold text-red-500">{formatINR(parseFloat(bounceCharge))}</span>
                        {" "}= <span className="font-mono font-semibold text-foreground">{formatINR(reissueCtx.amount + parseFloat(bounceCharge))}</span></>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setReissueCtx(null); setBounceCharge(""); }}
                    className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Cancel re-issue"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* ── Bounce Charge (re-issue only) ── */}
              {reissueCtx && (
                <div className="space-y-3">
                  <SectionHeader icon={AlertTriangle} label="Bounce Charge" />
                  <Field label="Bank Bounce Charge" hint="Optional — added on top of the original payment amount">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-semibold pointer-events-none">₹</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={bounceCharge}
                        onChange={(e) => setBounceCharge(e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60 font-mono"
                      />
                    </div>
                  </Field>
                </div>
              )}

              {/* ── 3. Payment Mode ── */}
              <div className="space-y-3">
                <SectionHeader icon={Wallet} label="Payment Mode" />
                <Field label="Mode" required>
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_MODES.filter((m) => !reissueCtx || m !== "Cash").map((m) => {
                      const s = MODE_STYLE[m] ?? {
                        ring: "ring-border bg-muted",
                        text: "text-muted-foreground",
                        dot: "bg-muted-foreground",
                      };
                      const active = form.mode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleModeChange(m)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-heading font-semibold border transition-all ring-1 ${
                            active
                              ? `${s.ring} ${s.text} border-transparent shadow-sm`
                              : "bg-background border-border text-muted-foreground ring-transparent hover:border-primary/40"
                          }`}
                        >
                          {active && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${s.dot}`}
                            />
                          )}
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                {form.mode && <ModeInfoBanner mode={form.mode} />}
              </div>

              {/* ── 4. Bank Account ── */}
              <div className="space-y-3">
                <SectionHeader icon={Landmark} label="Bank Account" />
                <Field
                  label="Bank"
                  required={isChequeMode || isDigitalMode}
                  hint={
                    !form.mode
                      ? "Select a payment mode first."
                      : isCashMode
                        ? "Not applicable for cash payments."
                        : isChequeMode
                          ? "Required — used to filter cheque lots."
                          : "Bank account from which the transfer was made."
                  }
                >
                  <div
                    className={`relative ${isCashMode || !form.mode ? "opacity-40 pointer-events-none" : ""}`}
                  >
                    <Landmark
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <select
                      value={form.bankId ? String(form.bankId) : ""}
                      onChange={(e) => handleBankSelect(e.target.value)}
                      disabled={isCashMode || !form.mode}
                      className="w-full appearance-none pl-8 pr-9 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed"
                    >
                      <option value="">— Select bank account —</option>
                      {banks.map((b) => (
                        <option key={b.id} value={String(b.id)}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {!isCashMode &&
                    !!form.mode &&
                    form.bankId &&
                    (() => {
                      const selected = banks.find((b) => b.id === form.bankId);
                      if (!selected) return null;
                      const details = [
                        selected.ifscCode && `IFSC: ${selected.ifscCode}`,
                        selected.branch && `Branch: ${selected.branch}`,
                        selected.accountType && `Type: ${selected.accountType}`,
                      ].filter(Boolean);
                      if (!details.length) return null;
                      return (
                        <p className="text-[11px] text-muted-foreground/70 mt-1 pl-1">
                          {details.join(" · ")}
                        </p>
                      );
                    })()}
                </Field>
              </div>

              {/* ── 5. Mode-specific section ── */}

              {/* Cash — nothing extra, amount above is sufficient */}
              {isCashMode && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-center gap-2.5">
                  <Banknote size={14} className="text-emerald-500 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Cash payment — enter the amount above and save.
                  </p>
                </div>
              )}

              {/* Cheque / Post-Dated Cheque */}
              {isChequeMode && (
                <div className="space-y-3">
                  <SectionHeader
                    icon={BookOpen}
                    label={
                      form.mode === "Post-Dated Cheque"
                        ? "Post-Dated Cheque Details"
                        : "Cheque Details"
                    }
                    badge={
                      form.mode === "Post-Dated Cheque" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/20">
                          <CalendarClock size={9} /> Scheduled
                        </span>
                      ) : null
                    }
                  />
                  <ChequePanel
                    bankId={form.bankId}
                    form={form}
                    set={set}
                    isPostDated={form.mode === "Post-Dated Cheque"}
                  />
                </div>
              )}

              {/* NEFT / UPI / RTGS / IMPS / Card */}
              {isDigitalMode && (
                <div className="space-y-3">
                  <SectionHeader icon={Hash} label={`${form.mode} Reference`} />
                  {form.mode === "Card" && (
                    <CardPanel bankId={form.bankId} form={form} set={set} />
                  )}
                  <DigitalRefPanel mode={form.mode} form={form} set={set} />
                </div>
              )}

              {/* ── Save footer ── */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-3 border-t border-border">
                <p className="text-[11px] text-muted-foreground hidden sm:block">
                  {canSave ? (
                    <span className="text-emerald-500 font-medium">
                      Ready to save
                    </span>
                  ) : (
                    "Fill in the required fields to save"
                  )}
                </p>
                <div className="flex items-center gap-2 sm:ml-auto">
                  <button
                    onClick={handleReset}
                    disabled={!isDirty && !editingId}
                    className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw size={12} />
                    {editingId ? "Cancel" : "Reset"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !canSave}
                    className="flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity whitespace-nowrap"
                  >
                    {saving ? (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : editingId ? (
                      <Check size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    {saving
                      ? "Saving…"
                      : editingId
                        ? "Update Payment"
                        : "Save Payment"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* LIST VIEW                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {view === "list" && (
          <>
            {/* ── Filter Panel ── */}
            {(() => {
              const hasActiveFilters = !!(
                companyFilter ||
                projectFilter ||
                finYearFilter ||
                docNumberFilter ||
                docDateFilter ||
                supplierFilter
              );
              const clearAll = () => {
                setCompanyFilter("");
                setCompanyNameFilter("");
                setProjectFilter("");
                setFinYearFilter("");
                setDocNumberFilter("");
                setDocDateFilter("");
                setSupplierFilter("");
                setPage(1);
              };
              return (
                <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                  {/* Header / toggle */}
                  <button
                    type="button"
                    onClick={() => setShowFilters((v) => !v)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-5 h-5 rounded bg-primary/10">
                        <Search size={11} className="text-primary" />
                      </div>
                      <span className="text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
                        Filters
                      </span>
                      {hasActiveFilters && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-primary text-primary-foreground">
                          {
                            [
                              companyFilter,
                              projectFilter,
                              finYearFilter,
                              docNumberFilter,
                              docDateFilter,
                              supplierFilter,
                            ].filter(Boolean).length
                          }{" "}
                          active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {hasActiveFilters && (
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearAll();
                          }}
                          className="text-[11px] text-destructive/70 hover:text-destructive font-heading transition-colors cursor-pointer"
                        >
                          Clear all
                        </span>
                      )}
                      <ChevronDown
                        size={13}
                        className={`text-muted-foreground transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`}
                      />
                    </div>
                  </button>

                  {/* Collapsible grid */}
                  {showFilters && (
                    <div className="border-t border-border px-4 py-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                        {/* 1. Company */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Building2 size={10} /> Company
                          </label>
                          <div className="relative">
                            <select
                              value={companyFilter}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCompanyFilter(val);
                                const label = val
                                  ? (companyOptions.find(
                                      (c) => String(c.id) === val,
                                    )?.label ?? val)
                                  : "";
                                setCompanyNameFilter(label);
                                // Clear project filter if it doesn't belong to new company
                                if (projectFilter && val) {
                                  const stillValid = projectOptions.some(
                                    (p) =>
                                      p.label === projectFilter &&
                                      (p.belongs_to === Number(val) ||
                                        p.company_id === Number(val)),
                                  );
                                  if (!stillValid) setProjectFilter("");
                                }
                                setPage(1);
                              }}
                              className="w-full appearance-none pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="">All Companies</option>
                              {companyOptions.map((c) => (
                                <option key={c.id} value={String(c.id)}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={11}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                            />
                          </div>
                        </div>

                        {/* 2. Project */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <FolderKanban size={10} /> Project
                          </label>
                          <div className="relative">
                            <select
                              value={projectFilter}
                              onChange={(e) => {
                                setProjectFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full appearance-none pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="">All Projects</option>
                              {(companyFilter
                                ? projectOptions.filter(
                                    (p) =>
                                      p.belongs_to === Number(companyFilter) ||
                                      p.company_id === Number(companyFilter),
                                  )
                                : projectOptions
                              ).map((p) => (
                                <option key={p.id} value={p.label}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={11}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                            />
                          </div>
                        </div>

                        {/* 3. Fin Year */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <CalendarDays size={10} /> Fin Year
                          </label>
                          <div className="relative">
                            <select
                              value={finYearFilter}
                              onChange={(e) => {
                                setFinYearFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full appearance-none pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="">All Fin Years</option>
                              {finYearOptions.map((y) => (
                                <option key={y.id} value={y.label}>
                                  {y.label}
                                </option>
                              ))}
                            </select>
                            <ChevronDown
                              size={11}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                            />
                          </div>
                        </div>

                        {/* 4. Document Number */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Hash size={10} /> Document Number
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="e.g. PAY-2024-001"
                              value={docNumberFilter}
                              onChange={(e) => {
                                setDocNumberFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            {docNumberFilter && (
                              <button
                                onClick={() => {
                                  setDocNumberFilter("");
                                  setPage(1);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 5. Document Date */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <FileText size={10} /> Document Date
                          </label>
                          <div className="relative">
                            <input
                              type="date"
                              value={docDateFilter}
                              onChange={(e) => {
                                setDocDateFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                            />
                            {docDateFilter && (
                              <button
                                onClick={() => {
                                  setDocDateFilter("");
                                  setPage(1);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 6. Supplier / Contractor */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Truck size={10} /> Supplier / Contractor
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search name…"
                              value={supplierFilter}
                              onChange={(e) => {
                                setSupplierFilter(e.target.value);
                                setPage(1);
                              }}
                              className="w-full pl-3 pr-7 py-2 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            {supplierFilter && (
                              <button
                                onClick={() => {
                                  setSupplierFilter("");
                                  setPage(1);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Active filter chips — always visible when filters set */}
                  {hasActiveFilters && (
                    <div className="flex flex-wrap gap-1.5 px-4 pb-3 border-t border-border/50 pt-2.5">
                      {companyFilter &&
                        (() => {
                          const co = companyOptions.find(
                            (c) => String(c.id) === companyFilter,
                          );
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-primary/10 text-primary border border-primary/20">
                              <Building2 size={9} />
                              {co?.label || companyFilter}
                              <button
                                onClick={() => {
                                  setCompanyFilter("");
                                  setCompanyNameFilter("");
                                  setPage(1);
                                }}
                                className="ml-0.5 hover:text-destructive"
                              >
                                <X size={9} />
                              </button>
                            </span>
                          );
                        })()}
                      {projectFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-violet-500/10 text-violet-600 border border-violet-500/20">
                          <FolderKanban size={9} />
                          {projectFilter}
                          <button
                            onClick={() => {
                              setProjectFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                      {finYearFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-amber-500/10 text-amber-600 border border-amber-500/20">
                          <CalendarDays size={9} />
                          FY {finYearFilter}
                          <button
                            onClick={() => {
                              setFinYearFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                      {docNumberFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                          <Hash size={9} />
                          {docNumberFilter}
                          <button
                            onClick={() => {
                              setDocNumberFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                      {docDateFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-cyan-500/10 text-cyan-600 border border-cyan-500/20">
                          <FileText size={9} />
                          Date: {docDateFilter}
                          <button
                            onClick={() => {
                              setDocDateFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                      {supplierFilter && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-heading bg-teal-500/10 text-teal-600 border border-teal-500/20">
                          <Truck size={9} />
                          {supplierFilter}
                          <button
                            onClick={() => {
                              setSupplierFilter("");
                              setPage(1);
                            }}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {isLoading && (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                Loading payments…
              </div>
            )}

            {isError && (
              <div className="text-center py-16 text-destructive text-sm">
                Failed to load payments. Please log in and try again.
              </div>
            )}

            {!isLoading && !isError && (
              <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-border">
                  {records.length === 0 && (
                    <div className="text-center py-14 text-muted-foreground text-sm">
                      <AlertCircle
                        size={20}
                        className="mx-auto mb-2 opacity-30"
                      />
                      No payments yet.
                    </div>
                  )}
                  {records.map((rec) => (
                    <div key={rec.id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-heading font-semibold text-sm text-foreground truncate">
                          {rec.paymentName}
                        </span>
                        <ModeBadge mode={rec.mode} />
                      </div>
                      {rec.paidTo && (
                        <p className="text-xs text-muted-foreground truncate">
                          Paid to{" "}
                          <span className="text-foreground font-medium">
                            {rec.paidTo}
                          </span>
                        </p>
                      )}
                      {rec.docNo && (
                        <span className="inline-block font-mono text-[11px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                          {rec.docNo}
                        </span>
                      )}
                      {rec.expenseRef && (
                        <span className="inline-block font-mono text-[11px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md">
                          {rec.expenseRef}
                        </span>
                      )}
                      {rec.chequeNo && (
                        <span className="inline-block font-mono text-[11px] bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-md">
                          Chq #{rec.chequeNo}
                        </span>
                      )}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{rec.date}</span>
                        <span className="font-mono font-semibold text-foreground">
                          {formatINR(rec.amount ?? 0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col gap-1">
                          <ApprovalStatusChain
                            table="NewPayment"
                            recordId={rec.id}
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <ApprovalActions
                            status={rec.status}
                            recordId={Number(rec.id)}
                            endpoint="/api/new-payment"
                            submitOnly
                            onSuccess={() => {
                              queryClient.invalidateQueries({
                                queryKey: ["payments"],
                                exact: false,
                              });
                              queryClient.invalidateQueries({
                                queryKey: ["expense-options-payment"],
                              });
                              refetchPayments();
                              window.dispatchEvent(
                                new CustomEvent("approval-action"),
                              );
                            }}
                          />
                          <button
                            onClick={() => openViewRec(rec)}
                            title="View details"
                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Eye size={12} />
                          </button>
                          {rights.canEdit && (
                            <button
                              onClick={() => openEdit(rec)}
                              className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                              <Edit size={12} />
                            </button>
                          )}
                          {rights.canDelete && (
                            <button
                              onClick={() => setDeleteId(rec.id)}
                              className="p-1.5 rounded-md border border-destructive/30 text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table — compact, no horizontal scroll */}
                <div className="hidden sm:block">
                  <table className="w-full text-sm table-fixed">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="px-4 py-3.5 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[22%]">
                          Payment Purpose
                        </th>
                        <th className="px-4 py-3.5 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[16%]">
                          Doc No
                        </th>
                        <th className="px-4 py-3.5 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[22%]">
                          Expense Ref
                        </th>
                        <th className="px-4 py-3.5 text-right text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[10%]">
                          Amount
                        </th>
                        <th className="px-4 py-3.5 text-left text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[14%]">
                          Status
                        </th>
                        <th className="px-4 py-3.5 text-right text-[11px] font-heading uppercase tracking-wider text-muted-foreground w-[16%]">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {records.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="text-center py-14 text-muted-foreground text-sm"
                          >
                            <AlertCircle
                              size={18}
                              className="mx-auto mb-2 opacity-30"
                            />
                            No payments yet. Click "New Payment" to get started.
                          </td>
                        </tr>
                      )}
                      {records.map((rec) => (
                        <tr
                          key={rec.id}
                          className="hover:bg-muted/20 transition-colors"
                        >
                          {/* Payment purpose + paid-to + date + bank stacked */}
                          <td className="px-4 py-4">
                            <p className="font-heading font-medium text-foreground text-xs truncate">
                              {rec.paymentName || "—"}
                            </p>
                            {rec.paidTo && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                                Paid to{" "}
                                <span className="text-foreground/80">
                                  {rec.paidTo}
                                </span>
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {rec.date || "—"}
                            </p>
                            {rec.bankName && (
                              <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{rec.bankName}</p>
                            )}
                          </td>
                          {/* Doc No + Mode + Cheque/Ref stacked */}
                          <td className="px-4 py-4">
                            <span className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              {rec.docNo || "—"}
                            </span>
                            <div className="mt-1">
                              <ModeBadge mode={rec.mode} />
                            </div>
                            {(rec.chequeNo || rec.neftNumber || rec.upiTransactionId || rec.rtgsReference || rec.impsReference || rec.cardReference) && (
                              <p className="font-mono text-[10px] text-blue-500 mt-0.5 truncate">
                                {rec.chequeNo ? `#${rec.chequeNo}` : rec.neftNumber || rec.upiTransactionId || rec.rtgsReference || rec.impsReference || rec.cardReference}
                              </p>
                            )}
                          </td>
                          {/* Expense Ref + GRN stacked */}
                          <td className="px-4 py-4">
                            {rec.expenseRef ? (
                              <span className="font-mono text-[11px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md block w-fit truncate max-w-full">
                                {rec.expenseRef}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                            <div className="mt-1">
                              <PaymentGRNBadges
                                expenseId={rec.expenseId || ""}
                              />
                            </div>
                          </td>
                          {/* Amount */}
                          <td className="px-4 py-4 font-mono text-xs font-semibold text-right whitespace-nowrap">
                            {formatINR(rec.amount ?? 0)}
                          </td>
                          {/* Status */}
                          <td className="px-4 py-4">
                            <div className="flex flex-col gap-1">
                              {rec.displayStatus && rec.displayStatus !== rec.status ? (
                                <span className={`inline-flex items-center justify-center w-28 py-px rounded text-[9px] font-semibold border whitespace-nowrap ${
                                  rec.displayStatus === "Success" || rec.displayStatus === "Cheque Cleared"
                                    ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                                  : rec.displayStatus === "Pending"
                                    ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                  : rec.displayStatus === "Cheque Issued"
                                    ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800"
                                  : rec.displayStatus === "Cheque Bounced"
                                    ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
                                  : rec.displayStatus === "Reissued"
                                    ? "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-800"
                                  : "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-950/40 dark:text-gray-400 dark:border-gray-800"
                                }`}>
                                  {rec.displayStatus}
                                </span>
                              ) : (
                                <StatusBadge status={rec.status} />
                              )}
                              {rec.status === "Pending" && (
                                <ApprovalStatusChain
                                  table="NewPayment"
                                  recordId={rec.id}
                                />
                              )}
                            </div>
                          </td>
                          {/* Actions */}
                          <td className="px-3 py-4">
                            <div className="flex items-center gap-1.5 justify-end flex-wrap">
                              <ApprovalActions
                                status={rec.status}
                                recordId={Number(rec.id)}
                                endpoint="/api/new-payment"
                                submitOnly
                                onSuccess={() => {
                                  queryClient.invalidateQueries({
                                    queryKey: ["payments"],
                                    exact: false,
                                  });
                                  queryClient.invalidateQueries({
                                    queryKey: ["expense-options-payment"],
                                  });
                                  refetchPayments();
                                  window.dispatchEvent(
                                    new CustomEvent("approval-action"),
                                  );
                                }}
                              />
                              <button
                                onClick={() => openViewRec(rec)}
                                title="View details"
                                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                              >
                                <Eye size={12} />
                              </button>
                              {rights.canEdit && (
                                <button
                                  onClick={() => openEdit(rec)}
                                  className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                  <Edit size={12} />
                                </button>
                              )}
                              {rights.canDelete && (
                                <button
                                  onClick={() => setDeleteId(rec.id)}
                                  className="p-1.5 rounded-md border border-destructive/30 text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-2 px-1">
                <p className="text-xs text-muted-foreground">
                  Page {page} of {totalPages} · {totalRecords} total
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pg = page <= 3 ? i + 1 : page - 2 + i;
                    if (pg < 1 || pg > totalPages) return null;
                    return (
                      <button
                        key={pg}
                        onClick={() => setPage(pg)}
                        className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${pg === page ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                      >
                        {pg}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </FinanceShell>

      {/* Payment detail view modal */}
      {viewingRec && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setViewingRec(null);
            setViewingChain(null);
          }}
        >
          <div
            className="w-full max-w-4xl rounded-xl bg-card border border-border shadow-xl overflow-hidden flex flex-col max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Receipt size={15} className="text-primary" />
                </div>
                <div>
                  <h3 className="font-heading font-semibold text-foreground text-sm">
                    Payment Details
                  </h3>
                  {viewingRec.docNo && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {viewingRec.docNo}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  setViewingRec(null);
                  setViewingChain(null);
                }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Tab strip */}
            {viewingRec.expenseRef && (
              <div className="flex border-b border-border px-5 bg-muted/10">
                {(["details", "chain", "posting"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setDetailTab(t)}
                    className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                      detailTab === t
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "details" ? "Details" : t === "chain" ? "Payment Chain" : "Posting"}
                    {t === "chain" && paymentChainData && (
                      <span className="ml-1.5 text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
                        {paymentChainData.payments.length}
                      </span>
                    )}
                    {t === "posting" && pmtPostingData?.isPosted && (
                      <span className="ml-1.5 text-[9px] bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded-full font-semibold">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Body */}
            <div className="p-5 space-y-4 flex-1 overflow-y-auto">

              {/* ── Payment Chain Tab ── */}
              {detailTab === "chain" && viewingRec.expenseRef && (
                <div className="space-y-3">
                  {/* Invoice summary */}
                  {paymentChainData?.invoice && (() => {
                    // Use live GRN breakdown total when available (viewingGrnTotal), chain endpoint GrnTotalAmount as fallback
                    const chainInvoiceTotal = viewingGrnTotal > 0 ? viewingGrnTotal : Number(
                      (paymentChainData.invoice.ESourceType === "GRN" && paymentChainData.invoice.GrnTotalAmount)
                        ? paymentChainData.invoice.GrnTotalAmount
                        : (paymentChainData.invoice.ENetAmount ?? paymentChainData.invoice.EAmount ?? 0)
                    );
                    // Sum non-bounced Approved payments, subtract bounce charge (bank fee, not supplier payment)
                    const {
                      totalPaid: chainTotalPaid,
                      bounceChargeTotal: chainBounceTotal,
                      remaining: chainOutstanding,
                    } = computePaymentStatus(chainInvoiceTotal, paymentChainData.payments);
                    return (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                      <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-primary mb-2">
                        Invoice Summary
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[9px] text-muted-foreground uppercase">Invoice Total</p>
                          <p className="font-mono text-xs font-bold text-foreground">
                            {formatINR(chainInvoiceTotal)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] text-muted-foreground uppercase">Paid</p>
                          <p className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            {formatINR(chainTotalPaid)}
                          </p>
                          {chainBounceTotal > 0 && (
                            <p className="text-[8px] text-red-500 dark:text-red-400 font-mono">+{formatINR(chainBounceTotal)} bounce</p>
                          )}
                        </div>
                        <div>
                          <p className="text-[9px] text-muted-foreground uppercase">Outstanding</p>
                          <p className={`font-mono text-xs font-bold ${chainOutstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {formatINR(chainOutstanding)}
                          </p>
                        </div>
                      </div>
                    </div>
                    );
                  })()}

                  {/* Timeline */}
                  {loadingChain ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">Loading chain…</div>
                  ) : paymentChainData?.payments.length === 0 ? (
                    <p className="text-center text-xs text-muted-foreground py-6">No payments found for this invoice.</p>
                  ) : (
                    <div className="relative">
                      {/* Vertical line */}
                      <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                      <div className="space-y-3 pl-8">
                        {paymentChainData?.payments.map((p: PaymentChainItem) => {
                          const ds = p.DisplayStatus as DisplayStatus;
                          const borderColor =
                            ds === "Success" || ds === "Cheque Cleared" ? "border-l-emerald-500" :
                            ds === "Pending" ? "border-l-amber-500" :
                            ds === "Cheque Issued" ? "border-l-blue-500" :
                            ds === "Cheque Bounced" ? "border-l-red-500" :
                            ds === "Reissued" ? "border-l-violet-500" :
                            "border-l-gray-400";
                          const dotColor =
                            ds === "Success" || ds === "Cheque Cleared" ? "bg-emerald-500" :
                            ds === "Pending" ? "bg-amber-500" :
                            ds === "Cheque Issued" ? "bg-blue-500" :
                            ds === "Cheque Bounced" ? "bg-red-500" :
                            ds === "Reissued" ? "bg-violet-500" :
                            "bg-gray-400";
                          const badgeClass =
                            ds === "Success" || ds === "Cheque Cleared" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400" :
                            ds === "Pending" ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400" :
                            ds === "Cheque Issued" ? "bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400" :
                            ds === "Cheque Bounced" ? "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400" :
                            ds === "Reissued" ? "bg-violet-500/10 border-violet-500/20 text-violet-700 dark:text-violet-400" :
                            "bg-gray-500/10 border-gray-500/20 text-gray-700 dark:text-gray-400";
                          return (
                            <div key={p.PPaymentID} className="relative">
                              {/* Dot */}
                              <div className={`absolute -left-5 top-3 w-2.5 h-2.5 rounded-full border-2 border-background ${dotColor}`} />
                              <div className={`rounded-lg border border-l-2 bg-card p-3 space-y-1.5 ${borderColor}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-[10px] font-semibold text-foreground">{p.DocNo ?? "—"}</span>
                                    {p.PDate && <span className="text-[10px] text-muted-foreground">· {p.PDate.slice(0, 10)}</span>}
                                  </div>
                                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}>
                                    {ds}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                  <span className="font-mono font-semibold text-foreground text-xs">{formatINR(Number(p.PAmount ?? 0))}</span>
                                  {p.PMode && <span>· {p.PMode}</span>}
                                  {p.PChequeNo && <span>· Chq #{p.PChequeNo}</span>}
                                </div>
                                {p.BounceDate && (
                                  <div className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
                                    <AlertTriangle size={9} />
                                    Bounced {p.BounceDate.slice(0,10)}{p.BounceReason ? ` — ${p.BounceReason}` : ""}
                                  </div>
                                )}
                                {p.ReplacementDocNo && (
                                  <div className="text-[10px] text-violet-600 dark:text-violet-400 flex items-center gap-1">
                                    <RefreshCw size={9} /> Reissued as {p.ReplacementDocNo}
                                  </div>
                                )}
                                {p.OriginalDocNo && (
                                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <ArrowLeft size={9} /> Replaces {p.OriginalDocNo}
                                  </div>
                                )}
                                {p.BounceCharge && Number(p.BounceCharge) > 0 && (
                                  <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-dashed border-red-300 dark:border-red-800">
                                    <span className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1">
                                      <AlertTriangle size={9} /> Bounce charge (separate)
                                    </span>
                                    <span className="font-mono text-[11px] font-semibold text-red-600 dark:text-red-400">
                                      {formatINR(Number(p.BounceCharge))}
                                    </span>
                                  </div>
                                )}
                                {/* Reissue button for bounced payments with no replacement */}
                                {ds === "Cheque Bounced" && !p.ReplacementDocNo && (
                                  <button
                                    className="text-[10px] font-semibold text-primary hover:underline flex items-center gap-1 mt-0.5"
                                    onClick={() => {
                                      setViewingRec(null);
                                      setViewingChain(null);
                                      setReissueCtx({
                                        replacesPaymentId: p.PPaymentID,
                                        replacesDocNo: p.DocNo ?? "",
                                        amount: Number(p.PAmount ?? 0),
                                        paymentName: "",
                                        companyName: viewingRec?.company ?? "",
                                        expenseRef: viewingRec?.expenseRef ?? null,
                                        bounceReason: p.BounceReason ?? null,
                                      });
                                      setBounceCharge("");
                                      setView("form");
                                    }}
                                  >
                                    <RefreshCw size={9} /> Reissue Payment
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Details Tab (default) ── */}
              {detailTab === "details" && (
                <>

              {/* Status + Mode row */}
              <div className="flex items-center gap-2">
                <StatusBadge status={viewingRec.status} />
                <ModeBadge mode={viewingRec.mode} />
                {viewingChain?.billStatus && (
                  <span
                    className={`flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg border ${
                      viewingChain.billStatus === "Paid"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                        : viewingChain.billStatus === "Partially Paid"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                          : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
                    }`}
                  >
                    {viewingChain.billStatus === "Paid" ? (
                      <CheckCircle2 size={10} />
                    ) : viewingChain.billStatus === "Partially Paid" ? (
                      <Clock size={10} />
                    ) : (
                      <AlertCircle size={10} />
                    )}
                    {viewingChain.billStatus}
                  </span>
                )}
              </div>

              {/* Company info */}
              {viewingCompanyDetail && (
                <div className="rounded-xl border border-border bg-muted/10 p-3 flex items-center gap-3">
                  {viewingCompanyDetail.logo ? (
                    <img
                      src={viewingCompanyDetail.logo}
                      alt="Company logo"
                      className="h-9 w-auto max-w-[110px] object-contain shrink-0"
                    />
                  ) : (
                    <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
                      <Receipt size={14} className="text-primary" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-heading font-semibold text-foreground truncate">
                      {viewingCompanyDetail.name || viewingRec.company}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {[
                        viewingCompanyDetail.address,
                        viewingCompanyDetail.city,
                        viewingCompanyDetail.state,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {[
                        viewingCompanyDetail.phone_number,
                        viewingCompanyDetail.email,
                        viewingCompanyDetail.gst_no
                          ? `GSTIN: ${viewingCompanyDetail.gst_no}`
                          : null,
                        viewingCompanyDetail.pan
                          ? `PAN: ${viewingCompanyDetail.pan}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join("  ·  ")}
                    </p>
                  </div>
                </div>
              )}

              {/* Supplier / Vendor info */}
              {viewingChain?.supplier && (
                <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-1.5">
                  <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <Building2 size={9} className="text-primary" /> Supplier /
                    Vendor
                  </p>
                  <p className="text-xs font-medium text-foreground">
                    {viewingChain.supplier.name}
                    {viewingChain.supplier.code ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · {viewingChain.supplier.code}
                      </span>
                    ) : null}
                  </p>
                  {viewingChain.supplier.address && (
                    <p className="text-[10px] text-muted-foreground">
                      {viewingChain.supplier.address}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {[
                      viewingChain.supplier.phone,
                      viewingChain.supplier.email,
                      viewingChain.supplier.gst
                        ? `GSTIN: ${viewingChain.supplier.gst}`
                        : null,
                      viewingChain.supplier.pan
                        ? `PAN: ${viewingChain.supplier.pan}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join("  ·  ")}
                  </p>
                </div>
              )}

              {/* Traceability chain */}
              {viewingChain && (
                <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-2.5">
                  <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    <ArrowRight size={9} className="text-primary" /> Document
                    Chain
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    {viewingChain.chain.mrDocNo && (
                      <>
                        <span className="bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-400 px-2 py-1 rounded-md font-mono font-semibold">
                          MR: {viewingChain.chain.mrDocNo}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    {viewingChain.chain.workDoneRef && (
                      <>
                        <span className="bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-400 px-2 py-1 rounded-md font-mono font-semibold">
                          WD: {viewingChain.chain.workDoneRef}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    {viewingChain.chain.poNo && (
                      <>
                        <span className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-1 rounded-md font-mono font-semibold">
                          PO: {viewingChain.chain.poNo}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    {viewingChain.chain.grnNo && (
                      <>
                        <span className="bg-teal-500/10 border border-teal-500/20 text-teal-700 dark:text-teal-400 px-2 py-1 rounded-md font-mono font-semibold">
                          GRN: {viewingChain.chain.grnNo}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    {viewingChain.chain.expenseDocNo && (
                      <>
                        <span className="bg-primary/10 border border-primary/20 text-primary px-2 py-1 rounded-md font-mono font-semibold">
                          {viewingChain.chain.expenseDocNo}
                        </span>
                        <ArrowRight
                          size={9}
                          className="text-muted-foreground shrink-0"
                        />
                      </>
                    )}
                    <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-2 py-1 rounded-md font-mono font-semibold">
                      {viewingRec.docNo || "This Payment"}
                    </span>
                  </div>

                  {/* Payment summary strip */}
                  {viewingChain.netAmount > 0 && (() => {
                    const grnTotal = viewingGrnTotal > 0 ? viewingGrnTotal
                      : paymentChainData?.invoice?.GrnTotalAmount
                        ? parseFloat(String(paymentChainData.invoice.GrnTotalAmount))
                        : 0;
                    const displayNet = grnTotal > 0 ? grnTotal : viewingChain.netAmount;
                    // Exclude bounce charges — they're bank fees, not supplier payments
                    const chainStatus = computePaymentStatus(displayNet, paymentChainData?.payments);
                    const displayTotalPaid = paymentChainData?.payments?.length
                      ? chainStatus.totalPaid
                      : viewingChain.totalPaid;
                    const displayBounceTotal = chainStatus.bounceChargeTotal;
                    const displayRemaining = Math.max(0, displayNet - displayTotalPaid);
                    return (
                    <div className="flex items-center gap-2 pt-1 border-t border-border/60 mt-2">
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Net Payable
                        </p>
                        <p className="font-mono text-xs font-bold text-foreground">
                          {formatINR(displayNet)}
                        </p>
                      </div>
                      <div className="w-px h-6 bg-border" />
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Total Paid
                        </p>
                        <p className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          {formatINR(displayTotalPaid)}
                        </p>
                        {displayBounceTotal > 0 && (
                          <p className="text-[8px] text-red-500 dark:text-red-400 font-mono">+{formatINR(displayBounceTotal)} bounce</p>
                        )}
                      </div>
                      <div className="w-px h-6 bg-border" />
                      <div className="flex-1 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                          Remaining
                        </p>
                        <p
                          className={`font-mono text-xs font-bold ${displayRemaining > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                        >
                          {formatINR(displayRemaining)}
                        </p>
                      </div>
                      {viewingOaBalance > 0 && (
                        <>
                          <div className="w-px h-6 bg-border" />
                          <div className="flex-1 text-center">
                            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
                              On A/C
                            </p>
                            <p className="font-mono text-xs font-bold text-violet-500 dark:text-violet-400">
                              {formatINR(viewingOaBalance)}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                    );
                  })()}

                  {/* Vendor invoice if present */}
                  {viewingChain.chain.vendorInvoiceNo && (
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1 border-t border-border/60">
                      <FileText size={9} />
                      Vendor Invoice:
                      <span className="font-mono font-semibold text-foreground">
                        {viewingChain.chain.vendorInvoiceNo}
                      </span>
                      {viewingChain.chain.vendorInvoiceDate && (
                        <span className="text-muted-foreground">
                          ({viewingChain.chain.vendorInvoiceDate})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Grid of fields */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Payment Purpose", value: viewingRec.paymentName },
                  { label: "Paid To", value: [viewingRec.supplierContact, viewingRec.paidTo].filter(Boolean).join(" · ") || "—" },
                  { label: "Amount", value: formatINR(viewingRec.amount ?? 0) },
                  { label: "Date", value: viewingRec.date || "—" },
                  { label: "Mode", value: viewingRec.mode || "—" },
                  { label: "Company", value: viewingRec.company || "—" },
                  { label: "Project", value: viewingRec.project || "—" },
                  {
                    label: "Project Site",
                    value: viewingRec.projectSite || "—",
                  },
                  { label: "Expense Ref", value: viewingRec.expenseRef || "—" },
                  ...(viewingRec.bankName
                    ? [{ label: "Bank", value: viewingRec.bankName }]
                    : []),
                  ...(viewingRec.chequeNo
                    ? [
                        {
                          label: "Cheque No.",
                          value: `#${viewingRec.chequeNo}`,
                        },
                      ]
                    : []),
                  ...(viewingRec.chequeDate
                    ? [{ label: "Cheque Date", value: viewingRec.chequeDate }]
                    : []),
                  ...(viewingRec.chequeLotNumber
                    ? [
                        {
                          label: "Cheque Lot",
                          value: viewingRec.chequeLotNumber,
                        },
                      ]
                    : []),
                  ...(viewingRec.neftNumber
                    ? [{ label: "NEFT Ref.", value: viewingRec.neftNumber }]
                    : []),
                  ...(viewingRec.upiTransactionId
                    ? [
                        {
                          label: "UPI Txn ID",
                          value: viewingRec.upiTransactionId,
                        },
                      ]
                    : []),
                  ...(viewingRec.rtgsReference
                    ? [{ label: "RTGS Ref.", value: viewingRec.rtgsReference }]
                    : []),
                  ...(viewingRec.impsReference
                    ? [{ label: "IMPS Ref.", value: viewingRec.impsReference }]
                    : []),
                  ...(viewingRec.cardReference
                    ? [{ label: "Card Ref.", value: viewingRec.cardReference }]
                    : []),
                  ...(viewingRec.cardDisplay
                    ? [{ label: "Card Used", value: viewingRec.cardDisplay }]
                    : []),
                  ...(viewingRec.parentDocNo
                    ? [{ label: "Parent Doc", value: viewingRec.parentDocNo }]
                    : []),
                ].map(({ label, value }) => (
                  <div key={label} className="space-y-0.5">
                    <p className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                      {label}
                    </p>
                    <p className="text-xs font-medium text-foreground truncate">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              </>
              )}

              {/* ── Posting Tab ── */}
              {detailTab === "posting" && (
                <div className="flex flex-col gap-4 h-full">
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <BookOpen size={14} className="text-primary" />
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      GL Postings — Full Payment Chain
                    </span>
                  </div>

                  {pmtPostingLoading ? (
                    <div className="rounded-xl border border-border py-10 text-center text-xs text-muted-foreground">Loading posting details…</div>
                  ) : !pmtPostingData ? (
                    <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">Could not load posting data.</div>
                  ) : !pmtPostingData.entries?.length ? (
                    <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">No approved payments to post yet.</div>
                  ) : (() => {
                    const fmtAmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const fmtDate = (d: string) => d ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)) : "—";
                    type ChainEntry = {
                      date: string; docNo: string; pmtId: number; type: "payment" | "bounce_charge";
                      amount: number; mode: string; bounceReason?: string;
                      isBounced?: boolean;
                      accounts: any; isPosted: boolean; jvNo: string | null;
                    };
                    const entries: ChainEntry[] = pmtPostingData.entries;
                    return (
                      <div className="space-y-4">
                        {entries.map((entry, idx) => {
                          const isPayment = entry.type === "payment";
                          const isBounce = entry.type === "bounce_charge";
                          const isBouncedPayment = isPayment && !!entry.isBounced;
                          const rows = isPayment
                            ? [
                                { label: entry.accounts?.supplier?.label ?? "Supplier / Creditor A/c", code: entry.accounts?.supplier?.code, side: "debit" as const },
                                { label: entry.accounts?.bank?.label ?? "Bank A/c", code: entry.accounts?.bank?.code, side: "credit" as const },
                              ]
                            : [
                                { label: entry.accounts?.bankCharges?.label ?? "Bank Charges (Other Expenses)", code: entry.accounts?.bankCharges?.code, side: "debit" as const },
                                { label: entry.accounts?.bank?.label ?? "Bank A/c", code: entry.accounts?.bank?.code, side: "credit" as const },
                              ];

                          const entryKey = `${entry.pmtId}-${entry.type}`;

                          return (
                            <div key={entryKey} className={`rounded-xl border overflow-hidden ${isBounce ? "border-rose-500/30" : isBouncedPayment ? "border-rose-500/20 opacity-60" : "border-border"}`}>
                              {/* Entry header */}
                              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isBounce ? "bg-rose-500/5 border-rose-500/20" : isBouncedPayment ? "bg-rose-500/5 border-rose-500/10" : "bg-muted/40 border-border"}`}>
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  <span className={`text-[10px] font-semibold uppercase tracking-widest ${isBounce ? "text-rose-600" : isBouncedPayment ? "text-rose-500" : "text-muted-foreground"}`}>
                                    {isBounce ? "Bounce Charge" : "Payment"}
                                  </span>
                                  <span className="text-[10px] font-mono text-muted-foreground">{entry.docNo}</span>
                                  <span className="text-[10px] text-muted-foreground">{fmtDate(entry.date)}</span>
                                  {entry.mode && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{entry.mode}</span>
                                  )}
                                  {isBounce && entry.bounceReason && (
                                    <span className="text-[9px] text-rose-500 italic">{entry.bounceReason}</span>
                                  )}
                                  {isBouncedPayment && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/20 font-medium">
                                      Cheque Bounced — not postable
                                    </span>
                                  )}
                                </div>
                                {isBouncedPayment ? null : entry.isPosted ? (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-medium whitespace-nowrap">
                                    ✓ {entry.jvNo}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                                    <span className="w-2.5 h-2.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                    Posting…
                                  </span>
                                )}
                              </div>

                              {/* Dr/Cr rows */}
                              <div className="divide-y divide-border/50">
                                <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground font-semibold gap-2">
                                  <span>Account</span>
                                  <span className="text-right">Debit (₹)</span>
                                  <span className="text-right">Credit (₹)</span>
                                </div>
                                {rows.map((row, ri) => (
                                  <div key={ri} className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-2.5 items-center gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${row.side === "debit" ? "bg-emerald-500" : "bg-rose-500"}`} />
                                      <span className="text-xs text-foreground truncate">
                                        {row.label}{row.code ? ` (${row.code})` : ""}
                                      </span>
                                    </div>
                                    <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400">
                                      {row.side === "debit" ? fmtAmt(entry.amount) : ""}
                                    </span>
                                    <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400">
                                      {row.side === "credit" ? fmtAmt(entry.amount) : ""}
                                    </span>
                                  </div>
                                ))}
                                <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-4 py-2 bg-muted/30 text-xs font-bold gap-2">
                                  <span className="uppercase tracking-widest text-muted-foreground text-[10px]">Total</span>
                                  <span className="text-right text-emerald-600 dark:text-emerald-400 font-mono">{fmtAmt(entry.amount)}</span>
                                  <span className="text-right text-rose-600 dark:text-rose-400 font-mono">{fmtAmt(entry.amount)}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                      </div>
                    );
                  })()}
                  {pmtPostingError && (
                    <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 mt-2">
                      <AlertCircle size={13} className="text-destructive flex-shrink-0" />
                      <p className="text-xs text-destructive">
                        Auto-posting failed: {pmtPostingError}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Posting tab — invoice summary bar pinned above footer */}
            {detailTab === "posting" && pmtPostingData?.invoiceTotal > 0 && (() => {
              const fmtAmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const totalPosted = (pmtPostingData.entries ?? [])
                .filter((e: any) => e.type === "payment" && !e.isBounced)
                .reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
              const remaining = Math.max(0, pmtPostingData.invoiceTotal - totalPosted);
              return (
                <div className={`flex items-center justify-between px-5 py-2.5 border-t text-[11px] font-medium ${
                  remaining <= 0.01
                    ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400"
                }`}>
                  <span>
                    {remaining <= 0.01
                      ? `Invoice fully posted — ₹${fmtAmt(pmtPostingData.invoiceTotal)} cleared`
                      : `Posted ₹${fmtAmt(totalPosted)} of ₹${fmtAmt(pmtPostingData.invoiceTotal)}`}
                  </span>
                  {remaining > 0.01 && (
                    <span className="font-semibold">₹{fmtAmt(remaining)} outstanding</span>
                  )}
                </div>
              );
            })()}

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
              {rights.canPrint && (
                <button
                  onClick={() =>
                    handlePrintPayment(
                      viewingRec,
                      viewingCompanyDetail,
                      viewingChain,
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <Printer size={12} /> Print / PDF
                </button>
              )}
              {rights.canEdit && (
                <button
                  onClick={() => {
                    setViewingRec(null);
                    setViewingChain(null);
                    openEdit(viewingRec);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <Edit size={12} /> Edit
                </button>
              )}
              <button
                onClick={() => {
                  setViewingRec(null);
                  setViewingChain(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium gradient-accent text-white shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-card border border-border shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-destructive/10 shrink-0">
                <Trash2 size={16} className="text-destructive" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-foreground">
                  Delete Payment
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Are you sure you want to delete this payment? This cannot be
                  undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteId && handleDelete(deleteId)}
                className="px-4 py-2 rounded-lg text-sm font-heading font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loan Payment Details — late fee / notes specific to a Loan EMI payment.
          Separate from the main payment form since a loan repayment carries
          charges (bank-applied or company-set late fee) that don't apply to
          invoice/contract payments. */}
      {loanPaymentDetailsOpen && selectedLoanEmi && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-card border border-border shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
                <Receipt size={16} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-heading font-semibold text-foreground">
                  Loan Payment Details
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedLoanEmi.LoanNo} · EMI {selectedLoanEmi.InstallmentNo} · {formatINR(selectedLoanEmi.EMIAmount)}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground">
                Late Fee ({selectedLoanEmi.LoanType === "Bank Loan" ? "bank-applied" : "company-set"}, optional)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={loanLateFee}
                onChange={(e) => setLoanLateFee(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {selectedLoanEmi.IsOverdue && (
                <p className="text-[11px] text-red-500">This installment is overdue — a late fee may apply.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground">
                Notes (optional)
              </label>
              <input
                type="text"
                value={loanPaymentNotes}
                onChange={(e) => setLoanPaymentNotes(e.target.value)}
                placeholder="Reason for late fee, remarks…"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  clearLoanEmiLink();
                  setLoanPaymentDetailsOpen(false);
                  // Selecting a loan EMI cleared the invoice/contract side
                  // and set form fields directly — undo that too so
                  // cancelling leaves a clean form, not a half-filled one.
                  setForm((prev) => ({ ...prev, paymentName: "", amount: null }));
                }}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel Loan Payment
              </button>
              <button
                onClick={() => setLoanPaymentDetailsOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-heading font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Payment;
