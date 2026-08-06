import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  CalendarDays,
  Truck,
  User,
  Package,
  Banknote,
  TrendingUp,
  CreditCard,
  Receipt,
  StickyNote,
  CheckCircle2,
  Clock,
  AlertCircle,
  Edit,
  FileText,
  Wallet,
  Printer,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { parseJsonArray } from "@/utils/parseJsonArray";
import {
  computeBreakdown,
  fmt,
  fmtQty,
} from "@/pages/material/ExpenseBooking/helpers";
import type { ExpenseRecord } from "@/pages/material/ExpenseBooking/types";
import { GLAccountPath } from "@/components/finance/GLAccountPath";

interface GRNItemLine {
  itemName?: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom?: string;
  rate?: number;
  quantity?: number;
  totalAmount?: number;
}

interface ExpenseBookingPreviewModalProps {
  previewRecord: ExpenseRecord | null;
  onClose: () => void;
  onEdit: (record: ExpenseRecord) => void;
}

export function ExpenseBookingPreviewModal({
  previewRecord,
  onClose,
  onEdit,
}: ExpenseBookingPreviewModalProps) {
  // GRN item-level GST breakdown (fetched when eSourceType === 'GRN')
  const [grnBreakdown, setGrnBreakdown] = useState<{
    items: {
      itemName: string;
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

  // Billing terms fetched from master (used when EBillingTermsData is empty
  // but the record has a billingTermId pointing to the master)
  const [masterBillingTerms, setMasterBillingTerms] = useState<any[]>([]);

  const [previewTab, setPreviewTab] = useState<"details" | "posting">(
    "details",
  );
  const [invPostingData, setInvPostingData] = useState<any | null>(null);
  const [invPostingLoading, setInvPostingLoading] = useState(false);
  const [invPosting, setInvPosting] = useState(false);
  const [invPostingError, setInvPostingError] = useState<string | null>(null);

  // Fetch invoice posting data when posting tab opens
  useEffect(() => {
    if (previewTab !== "posting" || !previewRecord?.id) return;
    setInvPostingLoading(true);
    setInvPostingData(null);
    fetchWithAuth(`/api/expense-booking/${previewRecord.id}/posting`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setInvPostingData(d ?? null))
      .catch(() => setInvPostingData(null))
      .finally(() => setInvPostingLoading(false));
  }, [previewTab, previewRecord?.id]);

  // Auto-post as soon as the posting tab's data has loaded and it isn't
  // posted yet — no manual "Post to GL" click; the journal entry is created
  // the moment the user looks at the posting tab.
  useEffect(() => {
    if (
      previewTab !== "posting" ||
      invPostingLoading ||
      !invPostingData ||
      invPostingData.isPosted ||
      invPosting ||
      !previewRecord?.id
    )
      return;
    const recordId = previewRecord.id;
    setInvPosting(true);
    setInvPostingError(null);
    fetchWithAuth(`/api/expense-booking/${recordId}/post-to-gl`, { method: "POST" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error ?? "Posting failed");
        setInvPostingData((prev: any) => ({
          ...prev,
          isPosted: true,
          jvNo: body.jvNo,
          jvId: body.jvId,
        }));
      })
      .catch((err: any) => setInvPostingError(err.message ?? "Posting failed"))
      .finally(() => setInvPosting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewTab, invPostingLoading, invPostingData, previewRecord?.id]);

  useEffect(() => {
    setGrnBreakdown(null);
    if (!previewRecord) return;

    /**
     * Given a GRNID, fetch /api/grns/:id/gst-breakdown and call setGrnBreakdown.
     * Falls back to synthesizing from inclGST + stored rates if the API returns
     * empty totals (e.g. GRN has no item-level HSN data yet).
     */
    const loadGrnBreakdown = async (grnId: number) => {
      try {
        const r = await fetchWithAuth(`/api/grns/${grnId}/gst-breakdown`);
        const data = r.ok ? await r.json() : null;
        if (data?.totals?.totalInclGST > 0) {
          setGrnBreakdown(data);
          return;
        }
      } catch {
        /* fall through to synthesis */
      }
      // Synthesis fallback: back-calculate from stored incl-GST total + rates.
      // Only fires when the per-item breakdown API returned zero/empty.
      const inclGST = previewRecord.grnTotalAmount ?? 0;
      if (inclGST > 0) {
        const cgstRate = previewRecord.cgstRate ?? 0;
        const sgstRate = previewRecord.sgstRate ?? 0;
        const totalGstRate = cgstRate + sgstRate;
        const base =
          totalGstRate > 0
            ? Math.round((inclGST / (1 + totalGstRate / 100)) * 100) / 100
            : inclGST;
        const cgst = Math.round(((base * cgstRate) / 100) * 100) / 100;
        const sgst = Math.round(((base * sgstRate) / 100) * 100) / 100;
        setGrnBreakdown({
          items: [],
          totals: {
            totalBase: base,
            totalCGST: cgst,
            totalSGST: sgst,
            totalGST: cgst + sgst,
            totalInclGST: inclGST,
          },
        });
      }
    };

    /**
     * Multi-GRN combined invoices (see backend/services/invoiceLinking.js)
     * merge several GRNs raised against the same PO into one booking —
     * eSourceId is only the primary/first of them. Fetching just that one
     * GRN's breakdown (the old behavior) silently understated the total by
     * however much the other linked GRNs contributed. Fetch every linked
     * GRN's breakdown in parallel and sum them instead.
     */
    const loadMergedGrnBreakdown = async (grnIds: number[]) => {
      const results = await Promise.all(
        grnIds.map(async (id) => {
          try {
            const r = await fetchWithAuth(`/api/grns/${id}/gst-breakdown`);
            return r.ok ? await r.json() : null;
          } catch {
            return null;
          }
        }),
      );
      const valid = results.filter(
        (d): d is NonNullable<typeof d> => !!d?.totals,
      );
      if (valid.length === 0) return;
      const merged = valid.reduce(
        (acc, d) => ({
          items: [...acc.items, ...(d.items ?? [])],
          totals: {
            totalBase: acc.totals.totalBase + (d.totals.totalBase ?? 0),
            totalCGST: acc.totals.totalCGST + (d.totals.totalCGST ?? 0),
            totalSGST: acc.totals.totalSGST + (d.totals.totalSGST ?? 0),
            totalGST: acc.totals.totalGST + (d.totals.totalGST ?? 0),
            totalInclGST:
              acc.totals.totalInclGST + (d.totals.totalInclGST ?? 0),
          },
        }),
        {
          items: [] as any[],
          totals: {
            totalBase: 0,
            totalCGST: 0,
            totalSGST: 0,
            totalGST: 0,
            totalInclGST: 0,
          },
        },
      );
      if (merged.totals.totalInclGST > 0) setGrnBreakdown(merged);
    };

    const { eSourceType, eSourceId, linkedGrnIds } = previewRecord;
    const isMultiGRN = !!(linkedGrnIds && linkedGrnIds.length > 1);

    if (eSourceType === "GRN" && isMultiGRN) {
      loadMergedGrnBreakdown(linkedGrnIds!);
    } else if (eSourceType === "GRN" && eSourceId) {
      // Direct GRN link — load its breakdown immediately.
      loadGrnBreakdown(eSourceId);
    } else if ((eSourceType === "PO" || eSourceType === "WO_PO") && eSourceId) {
      // PO-linked booking: find the GRN(s) created against this PO,
      // then load the most recent one's GST breakdown.
      // This is the authoritative source for GST because the PO itself
      // stores rates/GST at booking time, but the GRN holds the actual
      // received quantities and item-level HSN rates used for payment.
      fetchWithAuth(`/api/grns/by-po/${eSourceId}`)
        .then((r) => (r.ok ? r.json().catch(() => ({})) : []))
        .then((grns: { GRNID: number }[]) => {
          if (Array.isArray(grns) && grns.length > 0) {
            // grns is ordered newest-first (ORDER BY GRNID DESC)
            loadGrnBreakdown(grns[0].GRNID);
          }
          // If no GRNs exist for this PO, grnBreakdown stays null →
          // modal falls back to standard breakdown using stored rates.
        })
        .catch(() => {
          /* non-fatal — standard breakdown will be shown */
        });
    }

    // Fetch billing terms master to hydrate terms when EBillingTermsData is missing
    fetchWithAuth("/api/billing-terms")
      .then((r) => (r.ok ? r.json().catch(() => ({})) : []))
      .then((data) => setMasterBillingTerms(Array.isArray(data) ? data : []))
      .catch(() => {});
    // linkedGrnIds is included below on top of id — the preview opens with
    // a list-derived record first (optimistic), then a fresher /:id fetch
    // lands moments later with the same id but a possibly-corrected
    // linkedGrnIds. Without this, that correction would silently never
    // re-trigger the fetch above.
  }, [previewRecord?.id, previewRecord?.linkedGrnIds?.join(",")]);

  // ── All hooks MUST be declared before any conditional return ──────────────
  // Normalise billingTerms — prefer saved EBillingTermsData; if empty but
  // billingTermId exists, hydrate from the fetched master record so the modal
  // always shows the applied terms and their correct amounts.
  const billingTerms = React.useMemo(() => {
    if (!previewRecord) return [];
    const saved = parseJsonArray(previewRecord.billingTerms ?? []);
    if (saved.length > 0) return saved;
    if (previewRecord.billingTermId && masterBillingTerms.length > 0) {
      const master = masterBillingTerms.find(
        (m: any) =>
          String(m.BillingTermID) === String(previewRecord.billingTermId),
      );
      if (master) {
        return [
          {
            applicable: true,
            type: master.CalculationType === "flat" ? "fixed" : "percentage",
            value: master.DiscountValue ?? 0,
            appliedOn:
              master.CalculationType === "After GST" ? "post-gst" : "pre-gst",
            deductionType:
              master.DeductionType === "Addition" ? "Addition" : "Deduction",
            masterTermId: master.BillingTermID,
            masterTermName: master.Name ?? previewRecord.billingTermName ?? "",
            _key: `master-${master.BillingTermID}`,
          },
        ];
      }
    }
    return [];
  }, [
    previewRecord?.billingTerms,
    previewRecord?.billingTermId,
    previewRecord?.billingTermName,
    masterBillingTerms,
  ]);

  // For GRN: compute Net Payable from fetched GRN data + billing terms,
  // respecting pre-GST vs post-GST ordering:
  //   - Before GST terms: adjust base first, recompute GST on adjusted base, then gross
  //   - After GST terms:  apply on gross after GST
  const grnNetPayable = React.useMemo(() => {
    if (!grnBreakdown) return null;

    const origBase = grnBreakdown.totals.totalBase;
    const origCGST = grnBreakdown.totals.totalCGST;
    const origSGST = grnBreakdown.totals.totalSGST;
    const origGross = grnBreakdown.totals.totalInclGST;

    // Effective GST rates derived from actual GRN item totals
    const effectiveCGSTRate = origBase > 0 ? (origCGST / origBase) * 100 : 0;
    const effectiveSGSTRate = origBase > 0 ? (origSGST / origBase) * 100 : 0;

    const preTerms = billingTerms.filter(
      (t: any) => t.appliedOn !== "post-gst",
    );
    const postTerms = billingTerms.filter(
      (t: any) => t.appliedOn === "post-gst",
    );

    // Step 1: apply pre-GST terms to base
    let runningBase = origBase;
    for (const t of preTerms) {
      const amt =
        t.type === "percentage"
          ? (runningBase * (t.value ?? 0)) / 100
          : (t.value ?? 0);
      if (t.deductionType === "Addition") runningBase += amt;
      else runningBase = Math.max(0, runningBase - amt);
    }

    // Step 2: recompute GST on adjusted base
    const adjCGST = (runningBase * effectiveCGSTRate) / 100;
    const adjSGST = (runningBase * effectiveSGSTRate) / 100;
    const gross =
      preTerms.length > 0 ? runningBase + adjCGST + adjSGST : origGross;

    // Step 3: apply post-GST terms on gross
    let running = gross;
    for (const t of postTerms) {
      const amt =
        t.type === "percentage"
          ? (running * (t.value ?? 0)) / 100
          : (t.value ?? 0);
      if (t.deductionType === "Addition") running += amt;
      else running = Math.max(0, running - amt);
    }

    return Math.round(running);
  }, [grnBreakdown, billingTerms]);

  // ── Guard: nothing to render ───────────────────────────────────────────────
  if (!previewRecord) return null;

  // ── Derived values (non-hooks, safe after the guard) ──────────────────────
  const hasEmi = !!(
    previewRecord.emi?.enabled && previewRecord.emi?.installmentCount
  );

  // For the standard (non-GRN) breakdown, use computeBreakdown for GST components
  const effectiveTerms =
    billingTerms.length > 0 ? billingTerms : previewRecord.discount;
  const rbd = computeBreakdown(
    previewRecord.basicAmount,
    previewRecord.cgstRate,
    previewRecord.sgstRate,
    effectiveTerms,
    previewRecord.igstRate ?? 0,
  );
  const hasIgst = (previewRecord.igstRate || 0) > 0;
  const hasDiscount =
    previewRecord.discount && (previewRecord.discount.value || 0) > 0;
  const cgstAmt = rbd.cgstAmount;
  const sgstAmt = rbd.sgstAmount;
  const igstAmt = rbd.igstAmount ?? 0;

  // Net Payable: GRN records use grnNetPayable (live calc from GRN data + terms).
  // Non-GRN records use rbd.netAmount (computeBreakdown from stored fields).
  const displayNetAmount =
    grnNetPayable !== null ? grnNetPayable : rbd.netAmount;

  const displayRemainingAmount = Math.max(
    0,
    displayNetAmount - (previewRecord.totalPaid ?? 0),
  );

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 expense-preview-modal">
      <style>{`
        @media print {
          body > * { display: none !important; }
          .expense-preview-modal { display: block !important; position: static !important; background: white !important; box-shadow: none !important; max-height: none !important; overflow: visible !important; border: none !important; border-radius: 0 !important; transform: none !important; padding: 0 !important; }
          .expense-preview-inner { max-height: none !important; overflow: visible !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; max-width: 100% !important; width: 100% !important; }
          .expense-preview-print-hide { display: none !important; }
        }
      `}</style>
      <div className="expense-preview-inner bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] sm:max-h-[92vh] overflow-y-auto">

        {/* ── Sticky header ── */}
        <div className="sticky top-0 bg-card z-10 border-b border-border expense-preview-print-hide">
          <div className="flex items-start justify-between px-4 sm:px-6 py-4 gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                  <Receipt size={13} className="text-emerald-500" />
                </div>
                <h2 className="font-heading font-bold text-sm sm:text-base font-mono truncate max-w-[160px] sm:max-w-none">
                  {previewRecord.bookingReference ?? "—"}
                </h2>
                <StatusBadge status={previewRecord.status} />
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 ml-9">Invoice</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                <Printer size={13} /><span className="hidden sm:inline">Print</span>
              </button>
              <button
                onClick={() => { onClose(); onEdit(previewRecord); }}
                className="inline-flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-white text-xs font-semibold bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 shadow-sm transition"
              >
                <Edit size={13} /><span className="hidden sm:inline">Edit</span>
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex items-center gap-1 px-4 sm:px-6 pt-1 border-b border-border bg-card expense-preview-print-hide">
          {(["details", "posting"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setPreviewTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors capitalize
                ${
                  previewTab === tab
                    ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
            >
              {tab === "details" ? (
                <FileText size={12} />
              ) : (
                <Wallet size={12} />
              )}
              {tab === "details" ? "Details" : "Posting"}
            </button>
          ))}
        </div>

        {previewTab === "posting" && (
          <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet size={14} className="text-emerald-600" />
                <span className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground">
                  Journal Entry — Invoice Posting
                </span>
              </div>
              {invPostingLoading ? (
                <span className="text-[10px] text-muted-foreground">Loading…</span>
              ) : invPostingData?.isPosted ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                  Posted · {invPostingData.jvNo}
                </span>
              ) : null}
            </div>

            {invPostingLoading ? (
              <div className="rounded-xl border border-border py-10 text-center text-xs text-muted-foreground">
                Loading posting details…
              </div>
            ) : !invPostingData ? (
              <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
                Could not load posting data.
              </div>
            ) : (() => {
              const { isGrnLinked, baseAmount, taxAmount, totalAmount, accounts, grnBreakdown } = invPostingData;
              const isMultiGrn = isGrnLinked && Array.isArray(grnBreakdown) && grnBreakdown.length > 1;
              const fmtAmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const fmtGrnDate = (d: string | null) =>
                d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
              type PostRow = { key: string; label: string; code: string | null; side: "debit" | "credit"; amount: number };
              type PostGroup = { groupKey: string; docNo: string | null; date: string | null; rows: PostRow[] };
              // GRN-linked: base clears the GRN provision; tax (if any) is
              // recognized as confirmed ITC (GST Credit Available) — mirrors
              // backend/routes/expenseBooking.js's post-to-gl line construction.
              // A combined invoice groups the legs by GRN (one group per
              // GRN, each dated with that GRN's own entry date) instead of
              // lumping every GRN's contribution into one row per account.
              const grnRows = (g: any): PostRow[] => [
                { key: "pgrn",     label: accounts?.pgrn?.label     ?? "Provision for Pending GRN A/c", code: accounts?.pgrn?.code ?? null,     side: "debit",  amount: g.baseAmount },
                ...(g.taxAmount > 0
                  ? [{ key: "gstCredit", label: accounts?.gstCredit?.label ?? "GST Credit Available", code: accounts?.gstCredit?.code ?? null, side: "debit" as const, amount: g.taxAmount }]
                  : []),
                { key: "supplier", label: accounts?.supplier?.label  ?? "Supplier / Creditor A/c",       code: accounts?.supplier?.code ?? null,  side: "credit", amount: g.totalAmount },
              ];
              const groups: PostGroup[] = isGrnLinked
                ? isMultiGrn
                  ? grnBreakdown.map((g: any) => ({ groupKey: String(g.grnId), docNo: g.docNo, date: g.date, rows: grnRows(g) }))
                  : [{ groupKey: "single", docNo: null, date: null, rows: grnRows({ baseAmount, taxAmount, totalAmount }) }]
                : [
                    {
                      groupKey: "direct",
                      docNo: null,
                      date: null,
                      rows: [
                        { key: "purchase", label: accounts?.purchase?.label  ?? "Purchase A/c",                  code: accounts?.purchase?.code ?? null,  side: "debit",  amount: totalAmount },
                        { key: "supplier", label: accounts?.supplier?.label  ?? "Supplier / Creditor A/c",       code: accounts?.supplier?.code ?? null,  side: "credit", amount: totalAmount },
                      ],
                    },
                  ];
              return (
                <>
                  {isGrnLinked && (
                    <div className="text-[10px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-1.5 border border-border/50">
                      GRN-linked invoice — Provision for Pending GRN is debited (reversing the GRN posting); Supplier is credited.
                      {isMultiGrn && " Combines multiple GRNs — grouped below by GRN with its own entry date."}
                    </div>
                  )}

                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] bg-muted/40 border-b border-border px-2 sm:px-4 py-2.5 text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground font-semibold gap-1 sm:gap-2">
                      <span>Account</span>
                      <span className="text-right">Debit (₹)</span>
                      <span className="text-right">Credit (₹)</span>
                    </div>
                    {groups.map((group) => (
                      <div key={group.groupKey}>
                        {isMultiGrn && (
                          <div className="flex items-center gap-2 px-2 sm:px-4 py-1.5 bg-muted/20 border-b border-border/50">
                            <span className="text-[10px] font-mono font-semibold text-primary">{group.docNo}</span>
                            <span className="text-[10px] text-muted-foreground">{fmtGrnDate(group.date)}</span>
                          </div>
                        )}
                        {group.rows.map((row) => (
                          <div key={row.key} className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-2 sm:px-4 py-3 border-b border-border/50 last:border-b-0 items-center gap-1 sm:gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${row.side === "debit" ? "bg-emerald-500" : "bg-rose-500"}`} />
                              <span className="text-[11px] sm:text-xs text-foreground break-words sm:truncate min-w-0" title={row.code ? `${row.label} (${row.code})` : row.label}>
                                {row.label}{row.code ? ` (${row.code})` : ""}
                              </span>
                            </div>
                            <span className="text-xs text-right font-mono text-emerald-700 dark:text-emerald-400">
                              {row.side === "debit" ? fmtAmt(row.amount) : ""}
                            </span>
                            <span className="text-xs text-right font-mono text-rose-600 dark:text-rose-400">
                              {row.side === "credit" ? fmtAmt(row.amount) : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] px-2 sm:px-4 py-3 bg-muted/30 border-t-2 border-border text-xs font-bold gap-1 sm:gap-2">
                      <span className="uppercase tracking-widest text-muted-foreground text-[10px]">Total</span>
                      <span className="text-right text-emerald-600 dark:text-emerald-400 font-mono">{fmtAmt(totalAmount)}</span>
                      <span className="text-right text-rose-600 dark:text-rose-400 font-mono">{fmtAmt(totalAmount)}</span>
                    </div>
                  </div>

                  {invPostingData.isPosted ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                      <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">
                        Posted to General Ledger as <span className="font-semibold">{invPostingData.jvNo}</span>. Entries are visible in the Trial Balance.
                      </p>
                    </div>
                  ) : invPostingError ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
                      <AlertCircle size={13} className="text-destructive flex-shrink-0" />
                      <p className="text-xs text-destructive">
                        Auto-posting failed: {invPostingError}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/20 px-4 py-3">
                      <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">
                        Posting to General Ledger…
                      </p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {previewTab === "details" && (
        <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">
          {/* ── Section 1: Booking Info ── */}
          <div>
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <CalendarDays size={10} className="text-emerald-600 dark:text-emerald-400" />
              Booking Information
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {([
                { label: "Booking Date", value: previewRecord.bookingDate },
                { label: "Due Date", value: previewRecord.dueDate },
                { label: "Document Type", value: previewRecord.docTypeName || previewRecord.materialCategory },
                {
                  label: "Source Document",
                  value: previewRecord.sourceDocNo
                    || (previewRecord.eSourceType && previewRecord.eSourceId ? `${previewRecord.eSourceType}-${previewRecord.eSourceId}` : null)
                    || (previewRecord.purchaseOrderId ? `PO-${previewRecord.purchaseOrderId}` : null)
                    || (previewRecord.workOrderId ? `WO-${previewRecord.workOrderId}` : null),
                  mono: true,
                },
                { label: "Company", value: previewRecord.companyName || (previewRecord.companyId ? `Company #${previewRecord.companyId}` : null) },
                { label: "Project / Site", value: previewRecord.projectName || (previewRecord.projectId ? `Project #${previewRecord.projectId}` : null) },
              ] as { label: string; value: any; mono?: boolean }[]).map(({ label, value, mono }) => (
                <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                  <p className={`text-xs font-semibold truncate ${mono ? "font-mono text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{value || "—"}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section 2: Vendor / Supplier ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Truck
                size={10}
                className="text-emerald-600 dark:text-emerald-400"
              />{" "}
              Vendor / Supplier
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 flex items-center gap-3 bg-muted/30 border border-border rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <User
                    size={14}
                    className="text-emerald-600 dark:text-emerald-400"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Supplier / Contractor
                  </p>
                  <p className="text-sm font-semibold truncate">
                    {previewRecord.supplier || "—"}
                  </p>
                </div>
              </div>
              {previewRecord.materialCategory && (
                <div className="flex-1 flex items-center gap-3 bg-muted/30 border border-border rounded-xl px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Package size={14} className="text-emerald-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Material Category
                    </p>
                    <p className="text-sm font-semibold truncate">
                      {previewRecord.materialCategory}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Section 3: Amount Breakdown ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Banknote
                size={10}
                className="text-emerald-600 dark:text-emerald-400"
              />{" "}
              Amount Breakdown
            </p>

            {/* ── GRN per-item breakdown (accurate) ── */}
            {grnBreakdown ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/15 bg-emerald-500/[0.05]">
                    <Truck size={11} className="text-emerald-500 shrink-0" />
                    <span className="text-[10px] font-heading font-semibold text-emerald-700 dark:text-emerald-300">
                      GST Breakdown by Item
                    </span>
                  </div>
                  {grnBreakdown.items.length === 0 && null}
                  <div
                    className="overflow-x-auto"
                    style={{
                      display:
                        grnBreakdown.items.length === 0 ? "none" : undefined,
                    }}
                  >
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-emerald-500/10 bg-muted/10">
                          <th className="px-3 py-1.5 text-left text-muted-foreground font-heading uppercase tracking-wider text-[9px]">
                            Item
                          </th>
                          <th className="px-3 py-1.5 text-right text-muted-foreground font-heading uppercase tracking-wider text-[9px]">
                            Qty
                          </th>
                          <th className="px-3 py-1.5 text-right text-foreground font-heading uppercase tracking-wider text-[9px]">
                            Incl.
                          </th>
                          <th className="px-3 py-1.5 text-right text-emerald-600 dark:text-emerald-400 font-heading uppercase tracking-wider text-[9px]">
                            Base
                          </th>
                          <th className="px-3 py-1.5 text-right text-orange-600 dark:text-orange-400 font-heading uppercase tracking-wider text-[9px]">
                            Tax
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-500/[0.08]">
                        {grnBreakdown.items.map((item, idx) => (
                          <tr key={idx} className="hover:bg-emerald-500/[0.05]">
                            <td className="px-3 py-1.5 font-medium text-foreground max-w-[120px] truncate">
                              {item.itemName || `Item ${idx + 1}`}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-foreground">
                              {fmtQty(item.receivedQty)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-foreground">
                              ₹{fmt(item.totalAmountInclGST)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                              ₹{fmt(item.baseAmount)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-semibold text-orange-600 dark:text-orange-400">
                              ₹{fmt(item.gstAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-emerald-500/20 bg-muted/10">
                        <tr>
                          <td
                            colSpan={2}
                            className="px-3 py-1.5 text-[9px] font-heading uppercase text-muted-foreground"
                          >
                            Totals
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-foreground">
                            ₹{fmt(grnBreakdown.totals.totalInclGST)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            ₹{fmt(grnBreakdown.totals.totalBase)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs font-bold text-orange-600 dark:text-orange-400">
                            ₹{fmt(grnBreakdown.totals.totalGST)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
                {/* Cumulative GST summary — recomputes GST when pre-GST terms adjust the base.
                Row order mirrors how the amount is actually derived: pre-GST terms
                adjust the base BEFORE tax, so they render before CGST/SGST/Gross;
                post-GST terms adjust the gross AFTER tax, so they render after it. */}
                {(() => {
                  const origBase = grnBreakdown.totals.totalBase;
                  const origCGST = grnBreakdown.totals.totalCGST;
                  const origSGST = grnBreakdown.totals.totalSGST;
                  const origGross = grnBreakdown.totals.totalInclGST;
                  const effectiveCGSTRate =
                    origBase > 0 ? (origCGST / origBase) * 100 : 0;
                  const effectiveSGSTRate =
                    origBase > 0 ? (origSGST / origBase) * 100 : 0;

                  const preTerms = billingTerms.filter(
                    (t: any) => t.appliedOn !== "post-gst",
                  );
                  const postTerms = billingTerms.filter(
                    (t: any) => t.appliedOn === "post-gst",
                  );

                  // Running base after pre-GST terms, captured per-term for display
                  const preTermRows: { term: any; base: number; amt: number }[] =
                    [];
                  let taxableBase = origBase;
                  for (const t of preTerms) {
                    const amt =
                      t.type === "percentage"
                        ? (taxableBase * (t.value ?? 0)) / 100
                        : (t.value ?? 0);
                    preTermRows.push({ term: t, base: taxableBase, amt });
                    if (t.deductionType === "Addition") taxableBase += amt;
                    else taxableBase = Math.max(0, taxableBase - amt);
                  }

                  const hasPreTerms = preTerms.length > 0;
                  const displayCGST = hasPreTerms
                    ? (taxableBase * effectiveCGSTRate) / 100
                    : origCGST;
                  const displaySGST = hasPreTerms
                    ? (taxableBase * effectiveSGSTRate) / 100
                    : origSGST;
                  const displayGross = hasPreTerms
                    ? taxableBase + displayCGST + displaySGST
                    : origGross;

                  // Running gross after post-GST terms, captured per-term for display
                  const postTermRows: { term: any; base: number; amt: number }[] =
                    [];
                  let runGross = displayGross;
                  for (const t of postTerms) {
                    const amt =
                      t.type === "percentage"
                        ? (runGross * (t.value ?? 0)) / 100
                        : (t.value ?? 0);
                    postTermRows.push({ term: t, base: runGross, amt });
                    if (t.deductionType === "Addition") runGross += amt;
                    else runGross = Math.max(0, runGross - amt);
                  }

                  const renderTermRow = (
                    row: { term: any; amt: number },
                    isPreGst: boolean,
                    i: number,
                  ) => {
                    const { term: t, amt } = row;
                    const isAdd = t.deductionType === "Addition";
                    return (
                      <div
                        key={t._key ?? t.masterTermId ?? `${isPreGst}-${i}`}
                        className={`flex items-center justify-between px-4 py-2.5 ${isAdd ? "bg-emerald-500/5" : "bg-red-500/5"}`}
                      >
                        <p
                          className={`text-xs flex items-center gap-1.5 ${isAdd ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                        >
                          <TrendingUp size={10} />
                          {t.masterTermName || `Term ${i + 1}`}
                          <span className="font-mono text-[10px] opacity-70">
                            {t.type === "percentage"
                              ? `${t.value ?? 0}%`
                              : `₹${fmt(t.value ?? 0)}`}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            ({isPreGst ? "pre-GST" : "post-GST"})
                          </span>
                        </p>
                        <p
                          className={`font-mono text-sm font-semibold ${isAdd ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
                        >
                          {isAdd ? "+ " : "− "}₹{fmt(amt)}
                        </p>
                      </div>
                    );
                  };

                  return (
                    <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/50 text-sm">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                        <div>
                          <p className="text-xs font-medium">Basic Amount</p>
                          <p className="text-[10px] text-muted-foreground">
                            Pre-tax value (excl. GST)
                          </p>
                        </div>
                        <p className="font-mono text-sm font-semibold">
                          ₹{fmt(origBase)}
                        </p>
                      </div>
                      {preTermRows.map((row, i) => renderTermRow(row, true, i))}
                      {displayCGST > 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5">
                          <div>
                            <p className="text-xs text-muted-foreground">
                              CGST
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Central GST
                            </p>
                          </div>
                          <p className="font-mono text-sm text-foreground/80">
                            + ₹{fmt(displayCGST)}
                          </p>
                        </div>
                      )}
                      {displaySGST > 0 && (
                        <div className="flex items-center justify-between px-4 py-2.5">
                          <div>
                            <p className="text-xs text-muted-foreground">
                              SGST
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              State GST
                            </p>
                          </div>
                          <p className="font-mono text-sm text-foreground/80">
                            + ₹{fmt(displaySGST)}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20">
                        <div>
                          <p className="text-xs font-medium">Gross Amount</p>
                          <p className="text-[10px] text-muted-foreground">
                            Basic + CGST + SGST
                          </p>
                        </div>
                        <p className="font-mono text-sm font-semibold">
                          ₹{fmt(displayGross)}
                        </p>
                      </div>
                      {postTermRows.map((row, i) => renderTermRow(row, false, i))}
                    </div>
                  );
                })()}
                <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <p className="text-xs font-heading font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                    Net Payable
                  </p>
                  <p className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
                    ₹{fmt(displayNetAmount)}
                  </p>
                </div>
              </div>
            ) : (
              /* ── Standard breakdown (non-GRN) ── */
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="divide-y divide-border/60">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                    <p className="text-xs text-muted-foreground">
                      Basic Amount
                    </p>
                    <p className="font-mono text-sm font-semibold">
                      ₹{fmt(previewRecord.basicAmount)}
                    </p>
                  </div>
                  {!hasIgst && (previewRecord.cgstRate || 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">CGST</p>
                      <p className="font-mono text-sm text-foreground/80">
                        + ₹{fmt(cgstAmt)}
                      </p>
                    </div>
                  )}
                  {!hasIgst && (previewRecord.sgstRate || 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">SGST</p>
                      <p className="font-mono text-sm text-foreground/80">
                        + ₹{fmt(sgstAmt)}
                      </p>
                    </div>
                  )}
                  {hasIgst && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-muted-foreground">IGST</p>
                      <p className="font-mono text-sm text-foreground/80">
                        + ₹{fmt(igstAmt)}
                      </p>
                    </div>
                  )}
                  {!hasIgst &&
                    (previewRecord.cgstRate || 0) === 0 &&
                    (previewRecord.sgstRate || 0) === 0 && (
                      <div className="flex items-center justify-between px-4 py-2.5">
                        <p className="text-xs text-muted-foreground">GST</p>
                        <p className="text-xs text-muted-foreground">
                          Not applicable
                        </p>
                      </div>
                    )}
                  {/* Billing Terms — rendered directly from billingTerms so they
                      always appear regardless of applicable flag. Pre-GST terms use
                      basicAmount as base; post-GST terms use gross (basic + GST). */}
                  {billingTerms.map((t: any, i: number) => {
                    const isPreGst = t.appliedOn !== "post-gst";
                    const gross =
                      rbd.taxableAmount +
                      rbd.cgstAmount +
                      rbd.sgstAmount +
                      (rbd.igstAmount ?? 0);
                    const base = isPreGst ? previewRecord.basicAmount : gross;
                    const amt =
                      t.type === "percentage"
                        ? (base * (t.value ?? 0)) / 100
                        : (t.value ?? 0);
                    const isAdd = t.deductionType === "Addition";
                    return (
                      <div
                        key={t._key ?? t.masterTermId ?? i}
                        className={`flex items-center justify-between px-4 py-2.5 ${isAdd ? "bg-emerald-500/5" : "bg-red-500/5"}`}
                      >
                        <p
                          className={`text-xs flex items-center gap-1.5 ${isAdd ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                        >
                          <TrendingUp size={10} />
                          {t.masterTermName || `Term ${i + 1}`}
                          <span className="font-mono text-[10px] bg-current/10 px-1.5 py-0.5 rounded opacity-70">
                            {t.type === "percentage"
                              ? `${t.value ?? 0}%`
                              : `₹${fmt(t.value ?? 0)}`}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            ({isPreGst ? "pre-GST" : "post-GST"})
                          </span>
                        </p>
                        <p
                          className={`font-mono text-sm font-semibold ${isAdd ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
                        >
                          {isAdd ? "+ " : "− "}₹{fmt(amt)}
                        </p>
                      </div>
                    );
                  })}
                  {/* Legacy single-discount fallback (no billing terms array) */}
                  {billingTerms.length === 0 && hasDiscount && (
                    <div className="flex items-center justify-between px-4 py-2.5 bg-red-500/5">
                      <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                        <TrendingUp size={10} />
                        Discount
                        {previewRecord.discount?.type === "percentage" &&
                        previewRecord.discount?.value ? (
                          <span className="font-mono text-[10px] bg-red-500/10 px-1.5 py-0.5 rounded">
                            {previewRecord.discount.value}%
                          </span>
                        ) : null}
                      </p>
                      <p className="font-mono text-sm text-red-500 dark:text-red-400">
                        − ₹{fmt((rbd as any).discountAmount)}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-emerald-500/10 border-t border-emerald-500/20">
                  <p className="text-xs font-heading font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                    Net Payable
                  </p>
                  <p className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400">
                    ₹{fmt(displayNetAmount)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Section 4: EMI Details ── */}
          {hasEmi && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <CreditCard
                  size={10}
                  className="text-emerald-600 dark:text-emerald-400"
                />{" "}
                EMI / Installment Plan
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Installments
                  </p>
                  <p className="font-mono text-lg font-bold text-violet-600 dark:text-violet-400">
                    {previewRecord.emi!.installmentCount}
                  </p>
                  <p className="text-[10px] text-muted-foreground">total</p>
                </div>
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Per EMI
                  </p>
                  <p className="font-mono text-base font-bold text-violet-600 dark:text-violet-400">
                    ₹{fmt(previewRecord.emi!.emiAmount ?? 0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">amount</p>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Start Date
                  </p>
                  <p className="text-sm font-semibold">
                    {previewRecord.emi!.startDate || "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">first emi</p>
                </div>
                <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Frequency
                  </p>
                  <p className="text-sm font-semibold capitalize">
                    {previewRecord.emi!.frequency || "Monthly"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">cycle</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Section 5: GRN Items ── */}
          {previewRecord.grnItems &&
            Array.isArray(previewRecord.grnItems) &&
            previewRecord.grnItems.length > 0 && (
              <div className="border-t border-border/60 pt-4">
                <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Truck
                    size={10}
                    className="text-emerald-600 dark:text-emerald-400"
                  />{" "}
                  GRN Items Summary
                  <span className="ml-auto font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-full border border-border">
                    {previewRecord.grnItems.length} items
                  </span>
                </p>
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/40 border-b border-border">
                          <th className="text-left px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Item
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Ordered
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
                            Received
                          </th>
                          <th className="text-right px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                            Remaining
                          </th>
                          <th className="text-left px-3 py-2 text-[10px] font-heading uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                            UOM
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {(previewRecord.grnItems as GRNItemLine[]).map(
                          (item, idx) => (
                            <tr key={idx} className="hover:bg-muted/20">
                              <td className="px-3 py-2.5 font-medium max-w-[140px] truncate">
                                {item.itemName || `Item ${idx + 1}`}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                                {item.orderedQty}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                                {fmtQty(item.receivedQty)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono hidden sm:table-cell">
                                <span
                                  className={
                                    item.remainingQty > 0
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {fmtQty(item.remainingQty)}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                                {item.uom || "—"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

          {/* ── Section 6: Invoice & Allocation ── */}
          {(previewRecord.vendorInvoiceNo ||
            previewRecord.costCenter ||
            previewRecord.glAccount ||
            previewRecord.workDoneRef ||
            (previewRecord.additionalCharges &&
              previewRecord.additionalCharges.length > 0)) && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <FileText
                  size={10}
                  className="text-emerald-600 dark:text-emerald-400"
                />{" "}
                Invoice &amp; Allocation
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {([
                  { label: "Vendor Invoice No", value: previewRecord.vendorInvoiceNo, mono: true },
                  { label: "Vendor Invoice Date", value: previewRecord.vendorInvoiceDate },
                  { label: "Cost Centre", value: previewRecord.costCenter },
                  // GL Account is rendered separately below (as its full nested
                  // chart-of-accounts path) when it's a proper ledger-master
                  // reference; only fall back to a plain tile for legacy
                  // free-text-only records that predate the GL master link.
                  ...(!previewRecord.glAccountId
                    ? [{ label: "GL Account", value: previewRecord.glAccount }]
                    : []),
                  { label: "Work Done Ref", value: previewRecord.workDoneRef, mono: true, accent: "text-violet-600 dark:text-violet-400" },
                ] as { label: string; value: any; mono?: boolean; accent?: string }[])
                  .filter((f) => !!f.value)
                  .map(({ label, value, mono, accent }) => (
                    <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                      <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                      <p className={`text-xs font-semibold truncate ${mono ? `font-mono ${accent ?? "text-emerald-600 dark:text-emerald-400"}` : "text-foreground"}`}>{value}</p>
                    </div>
                  ))}
              </div>
              {previewRecord.glAccountId && (
                <div className="mt-3 px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">GL Account (Chart of Accounts)</p>
                  <GLAccountPath
                    glAccountName={previewRecord.glAccountName || previewRecord.glAccount}
                    glAccountGroupId={previewRecord.glAccountGroupId}
                  />
                </div>
              )}
              {previewRecord.additionalCharges &&
                previewRecord.additionalCharges.length > 0 && (
                  <div className="mt-3 rounded-xl border border-border overflow-hidden">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/30 border-b border-border">
                      Additional Charges
                    </p>
                    <div className="divide-y divide-border/50">
                      {previewRecord.additionalCharges.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-3 py-2"
                        >
                          <span className="text-xs text-foreground">
                            {c.label || `Charge ${i + 1}`}
                          </span>
                          <span className="font-mono text-xs font-semibold">
                            ₹{fmt(c.amount || 0)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
                        <span className="text-xs font-semibold">
                          Total Additional
                        </span>
                        <span className="font-mono text-xs font-bold">
                          ₹
                          {fmt(
                            previewRecord.additionalCharges.reduce(
                              (s, c) => s + (c.amount || 0),
                              0,
                            ),
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
            </div>
          )}

          {/* ── Section 7: Bill Status & Payment Summary ── */}
          {previewRecord.billStatus && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <Wallet
                  size={10}
                  className="text-emerald-600 dark:text-emerald-400"
                />{" "}
                Bill Status
              </p>
              <div className="flex flex-wrap gap-3 mb-3">
                <div
                  className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border font-semibold ${
                    previewRecord.billStatus === "Paid"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                      : previewRecord.billStatus === "Partially Paid"
                        ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                        : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400"
                  }`}
                >
                  {previewRecord.billStatus === "Paid" ? (
                    <CheckCircle2 size={11} />
                  ) : previewRecord.billStatus === "Partially Paid" ? (
                    <Clock size={11} />
                  ) : (
                    <AlertCircle size={11} />
                  )}
                  {previewRecord.billStatus}
                </div>
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="divide-y divide-border/60">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10">
                    <p className="text-xs text-muted-foreground">Net Payable</p>
                    <p className="font-mono text-sm font-semibold">
                      ₹{fmt(displayNetAmount)}
                    </p>
                  </div>
                  {(previewRecord.totalPaid ?? 0) > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Total Paid
                      </p>
                      <p className="font-mono text-sm text-emerald-600 dark:text-emerald-400 font-semibold">
                        ₹{fmt(previewRecord.totalPaid ?? 0)}
                      </p>
                    </div>
                  )}
                  {displayRemainingAmount > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5 bg-amber-500/5">
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Remaining
                      </p>
                      <p className="font-mono text-sm text-amber-600 dark:text-amber-400 font-semibold">
                        ₹{fmt(displayRemainingAmount)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Section 7b: Traceability Chain — clickable Linked Documents ── */}
          <DocumentChainPanel docType="expense" id={previewRecord.id ? Number(previewRecord.id) : null} />
          {previewRecord.billStatus && (
            <div className="flex items-center gap-1.5 text-[10px] -mt-2">
              <span
                className={`px-2.5 py-1.5 rounded-lg font-semibold border ${
                  previewRecord.billStatus === "Paid"
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                    : previewRecord.billStatus === "Partially Paid"
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400"
                      : "bg-muted border-border text-muted-foreground"
                }`}
              >
                {previewRecord.billStatus}
              </span>
            </div>
          )}

          {/* ── Section 8: Billing Terms ── */}
          {billingTerms.length > 0 && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <Receipt
                  size={10}
                  className="text-emerald-600 dark:text-emerald-400"
                />{" "}
                Billing Terms
              </p>
              <div className="bg-muted/20 border border-border rounded-xl px-4 py-3 text-sm text-foreground">
                {billingTerms.length > 0 ? (
                  <div className="space-y-2">
                    {billingTerms.map((t: any, idx: number) => (
                      <div
                        key={t?._key ?? t?.masterTermId ?? idx}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="font-medium text-sm">
                          {t?.masterTermName ||
                            t?.TermName ||
                            t?.Name ||
                            `Term ${idx + 1}`}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          {t?.deductionType === "Addition"
                            ? "+"
                            : t?.deductionType === "Deduction"
                              ? "−"
                              : ""}
                          {t?.type === "percentage"
                            ? `${t?.value ?? 0}%`
                            : `₹${fmt(t?.value ?? 0)}`}
                          {t?.appliedOn === "pre-gst" ? (
                            <span className="ml-1 text-[10px] text-muted-foreground/60">
                              (pre-GST)
                            </span>
                          ) : t?.appliedOn === "post-gst" ? (
                            <span className="ml-1 text-[10px] text-muted-foreground/60">
                              (post-GST)
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
          )}

          {/* ── Section 9: Remarks ── */}
          {previewRecord.remarks && (
            <div className="border-t border-border/60 pt-4">
              <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
                <StickyNote
                  size={10}
                  className="text-emerald-600 dark:text-emerald-400"
                />{" "}
                Remarks
              </p>
              <div className="bg-muted/20 border border-border rounded-xl px-4 py-3 text-sm text-foreground leading-relaxed">
                {previewRecord.remarks}
              </div>
            </div>
          )}

          {/* ── Section 10: Approval Status ── */}
          <div className="border-t border-border/60 pt-4">
            <p className="text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <CheckCircle2
                size={10}
                className="text-emerald-600 dark:text-emerald-400"
              />{" "}
              Approval Status
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-xl px-4 py-2.5">
                <StatusBadge status={previewRecord.status} />
                <span className="text-xs text-muted-foreground">
                  Current Status
                </span>
              </div>
              {previewRecord.status === "Approved" && (
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-xl">
                  <CheckCircle2 size={11} /> Approved & Processed
                </div>
              )}
              {previewRecord.status === "Pending" && (
                <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl">
                  <Clock size={11} /> Awaiting Approval
                </div>
              )}
              {previewRecord.status === "Rejected" && (
                <div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl">
                  <AlertCircle size={11} /> Rejected — Review Required
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        <div className="border-t border-border px-5 sm:px-6 py-3 bg-muted/10 expense-preview-print-hide">
          <p className="text-[10px] text-muted-foreground">
            ID: <span className="font-mono">{previewRecord.id || "—"}</span>
          </p>
        </div>

      </div>
    </div>,
    document.body,
  );
}
