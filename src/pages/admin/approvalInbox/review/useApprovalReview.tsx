// Everything the review panel holds: the record's full detail, the work-allocation detail, the approval
// chain, and what is derived from them. The panel and its sections read from this one object.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { type ApprovalTable } from "@/components/ApprovalStatusChain";
import { MODULE_CONFIG, MODULE_APPROVAL_TABLE, fmtDate, fmtAmount, getEffectiveAmount, PREVIEW_HIDDEN_KEYS, stripDbPrefix, isIdField, isJsonBlob, labelizeKey, extractLineItems, formatPreviewValue } from "../config";
import { getRungAssignment, getEngineers, type RungAssignmentDetail, type Engineer } from "@/api/dependencyActivityAssignmentApi";
import { ClipboardCheck, UserCheck, Printer, FileDown } from "lucide-react";
import { printMasterPreview, downloadMasterPreviewPdf, type PreviewSection } from "@/utils/masterPreviewPrint";
import { toast } from "sonner";
import { loadMRCompany, mrDocFromRecord, printMaterialRequest, downloadMaterialRequestPdf } from "@/utils/materialRequestDocument";
import { printPurchaseOrder, downloadPurchaseOrderPdf } from "@/utils/purchaseOrderDocument";
import { printGrn, downloadGrnPdf } from "@/utils/grnDocument";
import { printVehicleInOut, downloadVehicleInOutPdf } from "@/utils/vehicleInOutDocument";
import { ChainData, fmtWhen, displayName, ChainNode, ApprovalReviewPanelProps, WoActivity } from "./parts";

export function useApprovalReview({ item, open, onClose, onActionDone }: ApprovalReviewPanelProps) {
  const navigate = useNavigate();
  const cfg = MODULE_CONFIG[item.Module];
  const Icon = cfg?.icon ?? ClipboardCheck;
  const approvalTable: ApprovalTable | undefined = MODULE_APPROVAL_TABLE[item.Module];

  // Both modules key their "record" off a rung (DependencyMasterActivityId)
  // rather than a normal table row with a matching id — work-allocation-
  // engineer's is a per-engineer confirmation row (now dead, see its own
  // MODULE_CONFIG comment) and civilworkdpr-approval's is the assignment
  // itself. Both reuse the same full-assignment detail (engineers, dates,
  // materials, checkpoints) RungAssignmentModal.tsx shows, keyed off RungId
  // instead of the generic cfg.apiEndpoint/RecordId fetch below.
  const usesRungDetail = item.Module === "work-allocation-engineer" || item.Module === "civilworkdpr-approval";

  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);

  // work-allocation-engineer's "record" is a per-engineer confirmation row
  // (dae.Id), not the assignment itself — the generic cfg.apiEndpoint/
  // RecordId fetch above can't return anything useful for it. This fetches
  // the same full assignment detail (engineers, days, materials,
  // checkpoints) RungAssignmentModal.tsx shows, keyed off RungId instead.
  const [rungDetail, setRungDetail] = useState<RungAssignmentDetail | null>(null);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [loadingRungDetail, setLoadingRungDetail] = useState(false);

  const [chain, setChain] = useState<ChainData | null>(null);
  const [loadingChain, setLoadingChain] = useState(false);

  // Locks page scroll while the panel is open — matches standard drawer behaviour.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDetail(null);
    setDetailFailed(false);
    if (cfg?.apiEndpoint && !usesRungDetail) {
      setLoadingDetail(true);
      fetchWithAuth(`${cfg.apiEndpoint}/${item.RecordId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data) => {
          if (!cancelled) setDetail(data && typeof data === "object" ? data : null);
        })
        .catch(() => {
          if (!cancelled) setDetailFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoadingDetail(false);
        });
    }

    setRungDetail(null);
    if (usesRungDetail && item.RungId != null) {
      setLoadingRungDetail(true);
      Promise.all([getRungAssignment(item.RungId), getEngineers()])
        .then(([rd, eng]) => {
          if (cancelled) return;
          setRungDetail(rd);
          setEngineers(eng);
        })
        .catch(() => {
          if (!cancelled) setDetailFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoadingRungDetail(false);
        });
    }

    setChain(null);
    if (approvalTable) {
      setLoadingChain(true);
      fetchWithAuth(`/api/approval-workflows/trail?module=${approvalTable}&id=${item.RecordId}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data) => {
          if (!cancelled) setChain(data);
        })
        .catch(() => {
          /* chain section just stays hidden */
        })
        .finally(() => {
          if (!cancelled) setLoadingChain(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [open, item.Module, item.RecordId, item.RungId, usesRungDetail, cfg?.apiEndpoint, approvalTable]);

  if (!open) return null;

  const effectiveAmount = getEffectiveAmount(item);
  const party = item.SupplierName || item.ContractorName || item.CreatedBy || "—";
  // A PO's inbox row carries no supplier/contractor, so "Party" fell back to
  // the creator's name — a duplicate of "Created By" that read as if the
  // creator were the counter-party. The real supplier is already in the
  // Details grid below, so the field is dropped for POs.
  const hidePartyField = item.Module === "purchase-orders";
  const lineItems = extractLineItems(detail);
  // A Material Request has no Rate/Amount at all yet — pricing only enters
  // the picture once a PO is raised against it — so the generic Item/Qty/
  // Rate/Amount table would just show ₹0.00 in both money columns for
  // every row. Name + Qty (+ UOM, if the detail response carries it) is all
  // that's meaningful here.
  const isMaterialRequest = item.Module === "material-requests";
  // Journal Voucher lines are ledger postings (LHeadName/DebitAmount/
  // CreditAmount), not PO-style Item/Qty/Rate rows — the generic table
  // below was showing "—"/0/₹0 for every JV line since it read fields
  // (ItemName/Quantity/Rate) that don't exist on a JV line at all.
  const isJournalVoucher = item.Module === "journal-voucher";
  const isInterCompanyTransfer = item.Module === "inter-company-transfer";
  // A BOQ's lines live under BoqItems / BoqActivities (not the generic Items list), and are shown as
  // two lists with their full details.
  const woActivities = item.Module === "work-orders" && Array.isArray(detail?.activities) ? (detail!.activities as WoActivity[]) : [];
  const boqItems = item.Module === "boq" && Array.isArray(detail?.BoqItems) ? (detail!.BoqItems as Record<string, unknown>[]) : [];
  const boqActivities = item.Module === "boq" && Array.isArray(detail?.BoqActivities) ? (detail!.BoqActivities as Record<string, unknown>[]) : [];

  // TDS — Payments/ExpenseBooking both snapshot TDSId/TDSNature/TDSName/
  // TDSPercentage/TDSAmount onto the record at booking/payment time (same
  // columns Payment.tsx's own form reads). stripDbPrefix's single-capital-
  // letter strip mangles "TDSAmount" (→ "DSAmount"), so these are matched
  // and hidden by their own raw key here rather than relying on
  // PREVIEW_HIDDEN_KEYS — they get a proper dedicated display below instead
  // of showing up mislabeled in the generic Details grid.
  const rawTdsAmount = detail ? Number((detail as Record<string, unknown>).TDSAmount) || 0 : 0;
  const tdsName = detail ? ((detail as Record<string, unknown>).TDSName as string | null) : null;
  const tdsNature = detail ? ((detail as Record<string, unknown>).TDSNature as string | null) : null;
  const tdsPercentage = detail ? (detail as Record<string, unknown>).TDSPercentage : null;
  const netPayableAfterTds = Math.max(0, (effectiveAmount ?? 0) - rawTdsAmount);

  const extraFields = detail
    ? Object.entries(detail).filter(
        ([k, v]) =>
          !PREVIEW_HIDDEN_KEYS.has(stripDbPrefix(k).toLowerCase()) &&
          !/^tds/i.test(k) &&
          !isIdField(k) &&
          !isJsonBlob(v) &&
          !(Array.isArray(v) && v.length === 0) &&
          typeof v !== "object",
      )
    : [];

  // NewPayment's PSupplierName/PSupplierContact columns are reused verbatim
  // for a CRM Refund payout's customer ledger head (see ensureCrmCustomerLedgerHead
  // in crmLedger.js) — labelizeKey's generic column-name split would show
  // "Supplier Name"/"Supplier Contact" for what is actually the customer
  // being refunded, which reads as a wrong-ledger red flag to a reviewer.
  // Relabel just those two keys when this record is a CRM Refund voucher.
  const isCrmRefundPayment = !!(detail as Record<string, unknown> | null)?.SourceCrmRefundId;
  const labelFor = (k: string): string => {
    if (isCrmRefundPayment) {
      const stripped = stripDbPrefix(k).toLowerCase();
      if (stripped === "suppliername") return "Customer Name";
      if (stripped === "suppliercontact") return "Customer Contact";
    }
    return labelizeKey(k);
  };

  const chainSection = (
    <>
      <p className="text-[0.625rem] font-semibold font-heading uppercase tracking-[0.12em] text-muted-foreground mb-3 flex items-center gap-1.5">
        <UserCheck size={11} /> Approval Chain
      </p>
      {!approvalTable ? (
        <div className="border border-dashed border-foreground/40 px-4 py-5 text-center">
          <div className="w-9 h-9 border border-foreground/30 flex items-center justify-center mx-auto mb-2">
            <UserCheck size={16} className="text-muted-foreground/50" />
          </div>
          <p className="text-xs font-medium text-muted-foreground">No tracked workflow</p>
          <p className="text-[0.6875rem] text-muted-foreground/60 mt-0.5">This module's approval chain is managed directly.</p>
        </div>
      ) : loadingChain ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-muted animate-pulse" />
          ))}
        </div>
      ) : !chain || chain.steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
      ) : (
        <div>
          {chain.steps.map((step, i) => (
            <ChainNode key={`${step.level}-${step.actionAt ?? i}`} step={step} isLast={i === chain.steps.length - 1} />
          ))}
        </div>
      )}
    </>
  );

  // Print / Generate PDF both render this same shape — see
  // masterPreviewPrint.ts's own comment on why that matters. Built from
  // exactly what's already on screen (Overview, line items, Details,
  // Approval Chain) so the exported doc can never show something the
  // reviewer didn't actually see here.
  const previewSections = (() => {
    const sections: PreviewSection[] = [];

    const overviewFields: { label: string; value?: string | number | boolean | null }[] = [
      { label: usesRungDetail ? "Start Date" : "Date", value: fmtDate(item.RecordDate) },
      ...(hidePartyField ? [] : [{ label: "Party", value: party }]),
      ...(item.ProjectName ? [{ label: "Project", value: item.ProjectName }] : []),
      { label: "Created By", value: item.CreatedBy || "—" },
      usesRungDetail
        ? { label: "End Date", value: fmtDate(rungDetail?.assignment?.endDate ?? null) }
        : { label: "Last Modified", value: fmtDate(item.LastModified) },
    ];
    if (item.Module === "goods-receipt" && item.SourceTransferDocNo) {
      overviewFields.push({ label: "Transfer Ref", value: item.SourceTransferDocNo });
    }
    if (item.FromGodownName) overviewFields.push({ label: "From Godown", value: item.FromGodownName });
    if (item.ToGodownName) overviewFields.push({ label: "To Godown", value: item.ToGodownName });
    overviewFields.push({ label: usesRungDetail ? "Total Days" : "Total Amount", value: usesRungDetail ? (rungDetail?.assignment?.days != null ? `${rungDetail.assignment.days} day${rungDetail.assignment.days === 1 ? "" : "s"}` : "—") : fmtAmount(effectiveAmount) });
    if (!usesRungDetail && rawTdsAmount > 0) {
      overviewFields.push({ label: `TDS Deducted${tdsPercentage != null ? ` (${tdsPercentage}%)` : ""}`, value: `- ${fmtAmount(rawTdsAmount)}` });
      overviewFields.push({ label: "Net Payable (After TDS)", value: fmtAmount(netPayableAfterTds) });
    }
    sections.push({ title: "Overview", fields: overviewFields });

    if (lineItems.length > 0) {
      const money = (n: number) => fmtAmount(n);
      if (isJournalVoucher) {
        const totalDr = lineItems.reduce((a, li) => a + (Number(li.DebitAmount) || 0), 0);
        const totalCr = lineItems.reduce((a, li) => a + (Number(li.CreditAmount) || 0), 0);
        sections.push({
          title: "Journal Entry",
          fields: [],
          table: {
            columns: [
              { header: "#", align: "center" },
              { header: "Ledger" },
              { header: "Debit", align: "right" },
              { header: "Credit", align: "right" },
            ],
            rows: lineItems.map((li, i) => {
              const debit = Number(li.DebitAmount) || 0;
              const credit = Number(li.CreditAmount) || 0;
              return [i + 1, (li.LHeadName as string) || "—", debit > 0 ? money(debit) : "", credit > 0 ? money(credit) : ""];
            }),
            footer: ["", "Total", money(totalDr), money(totalCr)],
          },
        });
      } else if (isMaterialRequest) {
        sections.push({
          title: `Items (${lineItems.length})`,
          fields: [],
          table: {
            columns: [
              { header: "#", align: "center" },
              { header: "Item" },
              { header: "Qty", align: "right" },
              { header: "UOM" },
            ],
            rows: lineItems.map((li, i) => [
              i + 1,
              (li.ItemName ?? li.itemName ?? "—") as string,
              Number(li.Quantity ?? li.quantity ?? 0).toLocaleString("en-IN"),
              (li.UOMName ?? li.UomName ?? li.UOMSymbol ?? li.UOMCode ?? li.uomCode ?? "") as string,
            ]),
          },
        });
      } else {
        sections.push({
          title: `Items (${lineItems.length})`,
          fields: [],
          table: {
            columns: [
              { header: "#", align: "center" },
              { header: "Item" },
              { header: "Qty", align: "right" },
              { header: "UOM" },
              { header: "Rate", align: "right" },
              { header: "Amount", align: "right" },
            ],
            rows: lineItems.map((li, i) => {
              const qty = Number(li.Quantity ?? li.quantity ?? 0);
              const rate = Number(li.Rate ?? li.rate ?? 0);
              const amount = Number(li.LineAmount ?? li.AmountInclGst ?? li.amount ?? qty * rate);
              return [
                i + 1,
                (li.ItemName ?? li.itemName ?? li.Description ?? li.itemDescription ?? "—") as string,
                qty.toLocaleString("en-IN"),
                (li.UOMName ?? li.UomName ?? li.uomName ?? li.UOMSymbol ?? li.Symbol ?? li.UOMCode ?? li.uomCode ?? li.Unit ?? li.unit ?? li.uom ?? "") as string,
                money(rate),
                money(amount),
              ];
            }),
          },
        });
      }
    }

    if (woActivities.length > 0) {
      const n = (v: unknown) => Number(v ?? 0) || 0;
      sections.push({
        title: `Activities (${woActivities.length})`,
        fields: [],
        table: {
          columns: [
            { header: "#", align: "center" }, { header: "Group" }, { header: "Activity" }, { header: "Area", align: "right" },
            { header: "Rate", align: "right" }, { header: "Labour", align: "right" }, { header: "Materials", align: "right" },
            { header: "GST" }, { header: "Total", align: "right" },
          ],
          rows: woActivities.map((a, i) => [
            i + 1,
            (a.ActivityGroupName as string) || "—",
            (a.ActivityName as string) || "—",
            `${n(a.Area).toLocaleString("en-IN")}${a.UOMName ? ` ${String(a.UOMName)}` : ""}`,
            fmtAmount(n(a.Rate)),
            fmtAmount(n(a.LabourAmount)),
            fmtAmount(n(a.MaterialAmount)),
            a.HsnGstRate != null ? `${n(a.HsnGstRate)}%` : "—",
            fmtAmount(n(a.GrandTotal)),
          ]),
        },
      });
      const matRows = woActivities.flatMap((a) =>
        (a.materials ?? []).map((m) => [
          (a.ActivityName as string) || "—",
          (m.ItemName as string) || "—",
          `${n(m.Quantity).toLocaleString("en-IN")}${m.UOMName ? ` ${String(m.UOMName)}` : ""}`,
          fmtAmount(n(m.Rate)),
          n(m.GSTRate) > 0 ? `${n(m.GSTRate)}%` : "—",
          fmtAmount(n(m.Quantity) * n(m.Rate)),
        ]),
      );
      if (matRows.length > 0) {
        sections.push({
          title: `Materials (${matRows.length})`,
          fields: [],
          table: {
            columns: [{ header: "Activity" }, { header: "Item" }, { header: "Qty", align: "right" }, { header: "Rate", align: "right" }, { header: "GST", align: "right" }, { header: "Amount", align: "right" }],
            rows: matRows,
          },
        });
      }
    }
    if (boqItems.length > 0) {
      sections.push({
        title: `Items (${boqItems.length})`,
        fields: [],
        table: {
          columns: [
            { header: "#", align: "center" }, { header: "Item" }, { header: "Activity" }, { header: "Qty", align: "right" },
            { header: "UOM" }, { header: "Rate", align: "right" }, { header: "Tax %", align: "right" }, { header: "Amount", align: "right" },
          ],
          rows: boqItems.map((li, i) => [
            i + 1,
            [li.ItemName, li.ItemCode ? `(${li.ItemCode})` : ""].filter(Boolean).join(" ") || "—",
            (li.ActivityName as string) || "—",
            Number(li.Quantity ?? 0).toLocaleString("en-IN"),
            (li.UomName as string) || "",
            fmtAmount(Number(li.Rate ?? 0)),
            String(Number(li.TaxPct ?? 0)),
            fmtAmount(Number(li.LineAmount ?? 0)),
          ]),
        },
      });
    }
    if (boqActivities.length > 0) {
      sections.push({
        title: `Activities (${boqActivities.length})`,
        fields: [],
        table: {
          columns: [
            { header: "#", align: "center" }, { header: "Activity" }, { header: "Group" }, { header: "Area", align: "right" },
            { header: "Qty", align: "right" }, { header: "UOM" }, { header: "Rate", align: "right" }, { header: "Amount", align: "right" },
          ],
          rows: boqActivities.map((li, i) => [
            i + 1,
            [li.ActivityName, li.ActivityCode ? `(${li.ActivityCode})` : ""].filter(Boolean).join(" ") || "—",
            (li.GroupName as string) || "—",
            li.Area != null ? Number(li.Area).toLocaleString("en-IN") : "—",
            Number(li.Quantity ?? 0).toLocaleString("en-IN"),
            (li.UomName as string) || "",
            fmtAmount(Number(li.Rate ?? 0)),
            fmtAmount(Number(li.LineAmount ?? 0)),
          ]),
        },
      });
    }

    if (!usesRungDetail && extraFields.length > 0) {
      sections.push({ title: "Details", fields: extraFields.map(([k, v]) => ({ label: labelFor(k), value: formatPreviewValue(v) })) });
    }

    if (item.RejectionNote) {
      sections.push({ title: "Rejection Note", fields: [{ label: "Note", value: item.RejectionNote }] });
    }

    if (chain && chain.steps.length > 0) {
      sections.push({
        title: "Approval Chain",
        fields: chain.steps.map((step) => ({
          label: step.label,
          value: `${step.status}${step.approverName || step.approverEmail ? ` — ${displayName(step.approverName, step.approverEmail)}` : ""}${step.actionAt ? ` (${fmtWhen(step.actionAt)})` : ""}`,
        })),
      });
    }

    return sections;
  })();

  const previewTitle = item.Reference || `#${item.RecordId}`;

  // Material Requests have their own letterhead-style document (same one the
  // Material Request page prints) instead of the generic label/value layout.
  // Needs the full record (company, items); until it has loaded, fall back to
  // the generic document below.
  const mrDocument = async () => {
    const rec = detail as Record<string, any>;
    const company = await loadMRCompany(rec.CompanyId, rec.CompanyName);
    return mrDocFromRecord(
      { ...rec, DocNo: rec.DocNo ?? item.Reference, CreatedBy: rec.CreatedByName ?? item.CreatedBy ?? rec.CreatedBy, Status: rec.Status ?? item.Status },
      company,
    );
  };
  const useMrDocument = item.Module === "material-requests" && !!detail;
  // Purchase Orders likewise use their own letterhead document once the full
  // record (with LineItems) has loaded.
  const usePoDocument = item.Module === "purchase-orders" && !!detail;
  const useGrnDocument = item.Module === "goods-receipt" && !!detail;
  const useVioDocument = item.Module === "vehicle-in-out" && !!detail;

  const docActions = (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={async () => {
          if (useMrDocument) {
            printMaterialRequest(await mrDocument());
            return;
          }
          if (useVioDocument) {
            await printVehicleInOut({ ...(detail as Record<string, any>), Status: (detail as any).Status ?? item.Status });
            return;
          }
          if (useGrnDocument) {
            await printGrn({ ...(detail as Record<string, any>), Status: (detail as any).Status ?? item.Status });
            return;
          }
          if (usePoDocument) {
            await printPurchaseOrder({ ...(detail as Record<string, any>), Status: (detail as any).Status ?? item.Status });
            return;
          }
          printMasterPreview({
            title: previewTitle,
            subtitle: item.ModuleLabel,
            code: item.Reference,
            status: item.Status,
            sections: previewSections,
          });
        }}
        title="Print"
        className="w-8 h-8 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
      >
        <Printer size={16} />
      </button>
      <button
        onClick={() => {
          const toastId = toast.loading("Generating PDF...");
          const filename = `${(item.Reference || item.RecordId || "document").replace(/[^\w-]+/g, "_")}.pdf`;
          if (useVioDocument) {
            downloadVehicleInOutPdf({ ...(detail as Record<string, any>), Status: (detail as any).Status ?? item.Status }, filename)
              .then(() => toast.success("PDF downloaded", { id: toastId }))
              .catch(() => toast.error("Could not generate PDF", { id: toastId }));
            return;
          }
          if (useGrnDocument) {
            downloadGrnPdf({ ...(detail as Record<string, any>), Status: (detail as any).Status ?? item.Status }, filename)
              .then(() => toast.success("PDF downloaded", { id: toastId }))
              .catch(() => toast.error("Could not generate PDF", { id: toastId }));
            return;
          }
          if (usePoDocument) {
            downloadPurchaseOrderPdf({ ...(detail as Record<string, any>), Status: (detail as any).Status ?? item.Status }, filename)
              .then(() => toast.success("PDF downloaded", { id: toastId }))
              .catch(() => toast.error("Could not generate PDF", { id: toastId }));
            return;
          }
          if (useMrDocument) {
            mrDocument()
              .then((doc) => downloadMaterialRequestPdf(doc, filename))
              .then(() => toast.success("PDF downloaded", { id: toastId }))
              .catch(() => toast.error("Could not generate PDF", { id: toastId }));
            return;
          }
          downloadMasterPreviewPdf({
            title: previewTitle,
            subtitle: item.ModuleLabel,
            code: item.Reference,
            status: item.Status,
            sections: previewSections,
            filename: `${(item.Reference || item.RecordId || "document").replace(/[^\w-]+/g, "_")}.pdf`,
          })
            .then(() => toast.success("PDF downloaded", { id: toastId }))
            .catch(() => toast.error("Could not generate PDF", { id: toastId }));
        }}
        title="Generate PDF"
        className="w-8 h-8 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
      >
        <FileDown size={16} />
      </button>
    </div>
  );

  return {
    item,
    open,
    onClose,
    onActionDone,
    navigate,
    cfg,
    Icon,
    approvalTable,
    usesRungDetail,
    detail,
    setDetail,
    loadingDetail,
    setLoadingDetail,
    detailFailed,
    setDetailFailed,
    rungDetail,
    setRungDetail,
    engineers,
    setEngineers,
    loadingRungDetail,
    setLoadingRungDetail,
    chain,
    setChain,
    loadingChain,
    setLoadingChain,
    effectiveAmount,
    party,
    hidePartyField,
    lineItems,
    isMaterialRequest,
    isJournalVoucher,
    isInterCompanyTransfer,
    woActivities,
    boqItems,
    boqActivities,
    rawTdsAmount,
    tdsName,
    tdsNature,
    tdsPercentage,
    netPayableAfterTds,
    extraFields,
    isCrmRefundPayment,
    labelFor,
    chainSection,
    previewSections,
    previewTitle,
    mrDocument,
    useMrDocument,
    usePoDocument,
    useGrnDocument,
    useVioDocument,
    docActions,
  };
}

export type ApprovalReviewState = ReturnType<typeof useApprovalReview>;
