// One work order opened: details, activities, linked documents, approval, print (printWorkOrder).
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, ChevronDown, ChevronRight, Building2, Calculator, IndianRupee, FileText, Calendar, User, Layers, Package, Hammer, Receipt, AlertCircle, PenSquare, ChevronUp, ClipboardList, ArrowLeft, BadgeCheck, Clock, ShoppingCart, Printer } from "lucide-react";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { getWorkOrder, deleteWorkOrder, getMaterialRequestPrefillFromWO, MaterialRequestExistsError } from "@/api/workOrderApi";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { getDocumentChain } from "@/api/materialChainApi";
import { printWorkOrder } from "./printWorkOrder";
import { useWOChainStatus, Activity, WorkOrderDetail, WorkOrderActivityDetail, fmt, getStatusConfig } from "./config";

// ─── VIEW: Work Order Detail Panel ────────────────────────────────────────────

// How a Material Request's status reads on the Work Order page.
export const MR_STATUS_LABEL: Record<string, string> = {
  Draft: "Draft",
  Pending: "Pending approval",
  Approved: "Approved",
  Rejected: "Rejected",
  "Partially Ordered": "Partly ordered",
  "Partially Fulfilled": "Partly received",
  Ordered: "Ordered",
  Completed: "Completed",
};
export const mrStatusLabel = (status: string | null | undefined) => (status ? (MR_STATUS_LABEL[status] ?? status) : "—");
export const mrStatusTone = (status: string | null | undefined) => {
  switch (status) {
    case "Approved":
    case "Ordered":
    case "Completed":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "Rejected":
      return "bg-destructive/10 text-destructive";
    case "Partially Ordered":
    case "Partially Fulfilled":
      return "bg-sky-500/10 text-sky-700 dark:text-sky-400";
    default:
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  }
};

export const WorkOrderDetailPanel: React.FC<{
  workOrderId: number;
  onBack: () => void;
  onDelete: (id: number) => void;
  onEdit: (id: number) => void;
}> = ({ workOrderId, onBack, onDelete, onEdit }) => {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedMaterials, setExpandedMaterials] = useState<
    Record<number, boolean>
  >({});
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingMR, setCreatingMR] = useState(false);
  const queryClient = useQueryClient();
  const rights = usePageRights("work-order");

  const { status: chainStatus } = useWOChainStatus(workOrderId ?? null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getWorkOrder(workOrderId);
        setDetail(data);
        // Expand all activity groups by default
        const exp: Record<string, boolean> = {};
        (data.activities || []).forEach(
          (_: WorkOrderActivityDetail, i: number) => {
            exp[i] = true;
          },
        );
        setExpandedGroups(exp);
      } catch (err) {
        setError("Failed to load work order details.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [workOrderId]);

  const toggleGroup = (idx: number) =>
    setExpandedGroups((p) => ({ ...p, [idx]: !p[idx] }));

  const toggleMaterials = (actId: number) =>
    setExpandedMaterials((p) => ({ ...p, [actId]: !p[actId] }));

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteWorkOrder(workOrderId);
      toast.success("Work order deleted successfully");
      onDelete(workOrderId);
    } catch {
      toast.error("Failed to delete work order");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // The Work Order's chain tells us whether a (live) Material Request already exists for it.
  const { data: woChain } = useQuery({
    queryKey: ["document-chain", "wo", workOrderId],
    queryFn: () => getDocumentChain("wo", workOrderId),
    enabled: !!workOrderId && detail?.Status === "Approved",
    staleTime: 30_000,
  });
  const existingMR = woChain?.downstream
    .filter((n) => n.docType === "mr" && n.status !== "Rejected" && n.status !== "Cancelled")
    .at(-1);

  // Where the work order's materials stand in procurement, from the same chain.
  const procurement = (() => {
    if (!woChain) return null;
    const nodes = woChain.downstream;
    const count = (type: string) => nodes.filter((n) => n.docType === type).length;
    return {
      mr: existingMR ?? null,
      quotations: count("qt"),
      purchaseOrders: count("po"),
      grns: count("grn"),
      invoices: count("expense"),
    };
  })();

  const openMaterialRequest = (mrId: number) =>
    navigate(`/material/material-request?view=${mrId}`);

  const handleCreateMaterialRequest = async () => {
    setCreatingMR(true);
    try {
      // Nothing is created here: the Material Request form opens pre-filled so it can be changed, then saved.
      const woPrefill = await getMaterialRequestPrefillFromWO(workOrderId);
      navigate("/material/material-request", { state: { woPrefill } });
    } catch (err: unknown) {
      if (err instanceof MaterialRequestExistsError) {
        toast.info(err.message);
        await queryClient.invalidateQueries({ queryKey: ["document-chain"] });
        openMaterialRequest(err.mrId);
      } else {
        toast.error(err instanceof Error ? err.message : "Could not create the Material Request.");
      }
    } finally {
      setCreatingMR(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="border border-foreground/30 bg-card p-5 animate-pulse"
          >
            <div className="h-4 bg-card w-1/3 mb-3" />
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((j) => (
                <div key={j} className="h-10 bg-card" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="border border-destructive dark:border-destructive bg-destructive/10 dark:bg-destructive/10 p-6 text-center">
        <AlertCircle size={24} className="text-destructive mx-auto mb-2" />
        <p className="text-sm text-destructive dark:text-destructive">
          {error || "Work order not found"}
        </p>
        <button
          onClick={onBack}
          className="mt-3 text-xs text-primary underline"
        >
          Go back
        </button>
      </div>
    );
  }

  const statusCfg = getStatusConfig(detail.Status);

  // Group activities by ActivityGroupName
  const grouped: Record<string, WorkOrderActivityDetail[]> = {};
  (detail.activities || []).forEach((act) => {
    const key = act.ActivityGroupName || "Ungrouped";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(act);
  });

  const grandLabour = (detail.activities || []).reduce(
    (s, a) => s + (a.LabourAmount || 0),
    0,
  );
  const grandMaterials = (detail.activities || []).reduce(
    (s, a) => s + (a.MaterialAmount || 0),
    0,
  );

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={15} />
          <span>All Work Orders</span>
        </button>
        <div className="flex items-center gap-2">
          {confirmDelete && rights.canDelete ? (
            <>
              <span className="text-xs text-destructive font-medium">
                Delete this work order?
              </span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive/10 text-white text-xs font-semibold hover:bg-destructive/10 transition-colors disabled:opacity-60"
              >
                {deleting ? (
                  <span className="w-3 h-3 border border-white/30 border-t-white animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                Confirm Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex items-center gap-1 px-3 py-1.5 border border-foreground/30 text-xs text-muted-foreground hover:bg-primary/5 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <ApprovalActions
                status={detail.Status}
                recordId={workOrderId}
                endpoint="/api/work-orders"
                submitOnly
                onSuccess={() => {
                  setDetail((prev) =>
                    prev ? { ...prev, Status: "Pending" } : prev,
                  );
                }}
              />
              {rights.canPrint && (
                <button
                  onClick={() => printWorkOrder(detail)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-foreground/30 text-muted-foreground text-xs font-medium hover:bg-primary/5 transition-colors"
                  title="Print this work order with its activities and material breakdown"
                >
                  <Printer size={12} />
                  Print
                </button>
              )}
              {rights.canEdit && (
                <button
                  onClick={() => onEdit(workOrderId)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/5 dark:hover:bg-primary/10 transition-colors"
                >
                  <PenSquare size={12} />
                  Edit
                </button>
              )}
              {detail.Status === "Approved" && (
                <button
                  onClick={() => (existingMR ? openMaterialRequest(existingMR.id) : void handleCreateMaterialRequest())}
                  disabled={creatingMR}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-foreground/40 text-foreground text-xs font-medium hover:bg-primary/5 transition-colors disabled:opacity-60"
                >
                  {creatingMR ? (
                    <span className="w-3 h-3 border border-foreground/40 border-t-emerald-500 animate-spin" />
                  ) : (
                    <ShoppingCart size={12} />
                  )}
                  {existingMR ? `View Material Request ${existingMR.docNo ?? ""}`.trim() : "Create Material Request"}
                </button>
              )}
              {rights.canDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-destructive dark:border-destructive text-destructive text-xs font-medium hover:bg-destructive/10 dark:hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Header card */}
      <div className="border border-foreground/30 bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-foreground/30 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground">
              Work Order Details
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold border ${statusCfg.cls}`}
            >
              {statusCfg.icon}
              {detail.Status || "Draft"}
            </span>
            <span className="font-heading text-xs text-muted-foreground bg-card px-2 py-1">
              {detail.DocumentNumber}
            </span>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">
            {[
              {
                label: "Company",
                icon: <Building2 size={11} />,
                value: detail.CompanyName,
              },
              {
                label: "Project",
                icon: <Layers size={11} />,
                value: detail.ProjectName,
              },
              {
                label: "Contractor",
                icon: <User size={11} />,
                value: detail.ContractorName,
              },
              {
                label: "Supplier",
                icon: <User size={11} />,
                value: detail.SupplierName,
              },
              {
                label: "Document Date",
                icon: <Calendar size={11} />,
                value: detail.DocumentDate
                  ? new Date(detail.DocumentDate).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—",
              },
              {
                label: "Created At",
                icon: <Clock size={11} />,
                value: detail.CreatedAt
                  ? new Date(detail.CreatedAt).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—",
              },
              {
                label: "Total Amount",
                icon: <IndianRupee size={11} />,
                value: fmt(detail.TotalAmount || 0),
                highlight: true,
              },
            ].map(({ label, icon, value, highlight }) => (
              <div key={label}>
                <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-1">
                  {icon}
                  {label}
                </p>
                <p
                  className={`text-sm font-semibold ${highlight ? "text-primary" : "text-foreground"}`}
                >
                  {value || "—"}
                </p>
              </div>
            ))}
            {detail.Remarks && (
              <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Remarks
                </p>
                <p className="text-sm text-foreground bg-card px-3 py-2">
                  {detail.Remarks}
                </p>
              </div>
            )}
            {detail.TermsAndConditions && (
              <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Terms & Conditions
                </p>
                <p className="text-sm text-foreground bg-card px-3 py-2 whitespace-pre-line">
                  {detail.TermsAndConditions}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Procurement progress of this work order's materials */}
      {detail.Status === "Approved" && procurement && (
        <div className="border border-foreground/30 bg-card px-4 sm:px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">Materials</span>
          {procurement.mr ? (
            <>
              <button
                type="button"
                onClick={() => openMaterialRequest(procurement.mr!.id)}
                className="text-sm font-medium text-primary hover:underline"
              >
                {procurement.mr.docNo ?? `MR #${procurement.mr.id}`}
              </button>
              <span className={`inline-flex px-2.5 py-0.5 text-xs font-medium ${mrStatusTone(procurement.mr.status)}`}>
                {mrStatusLabel(procurement.mr.status)}
              </span>
              <span className="text-xs text-muted-foreground">
                {procurement.quotations > 0 && `${procurement.quotations} quotation${procurement.quotations === 1 ? "" : "s"} · `}
                {procurement.purchaseOrders} PO{procurement.purchaseOrders === 1 ? "" : "s"} · {procurement.grns} GRN
                {procurement.grns === 1 ? "" : "s"} · {procurement.invoices} invoice{procurement.invoices === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No Material Request raised yet</span>
          )}
        </div>
      )}

      {/* Linked documents: Work Order → Material Request → Quotation → PO → GRN → Invoice */}
      <div className="border border-foreground/30 bg-card px-4 sm:px-5 pb-4 sm:pb-5">
        <DocumentChainPanel docType="wo" id={workOrderId} />
      </div>

      {/* Chain Status — Expense & Payment trail */}
      {chainStatus && (
        <div className="border border-foreground/30 bg-card overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-foreground/30 flex items-center gap-2">
            <BadgeCheck size={15} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground">
              Financial Progress
            </h2>
          </div>
          <div className="p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: "Contract Value",
                  value: fmt(detail.TotalAmount || 0),
                  cls: "text-foreground",
                },
                {
                  label: "Total Certified",
                  value: fmt(chainStatus.totalCertified ?? 0),
                  cls: "text-blue-600 dark:text-blue-400",
                },
                {
                  label: "Total Booked",
                  value: fmt(
                    chainStatus.totalBooked ??
                      chainStatus.latestExpenseAmount ??
                      0,
                  ),
                  cls: "text-amber-600 dark:text-amber-400",
                },
                {
                  label: "Total Paid",
                  value: fmt(chainStatus.totalPaid ?? 0),
                  cls: chainStatus.isPaid
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground",
                },
              ].map(({ label, value, cls }) => (
                <div
                  key={label}
                  className="bg-card px-3 py-2.5 border border-foreground/30"
                >
                  <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    {label}
                  </p>
                  <p className={`text-sm font-bold ${cls}`}>{value}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span
                className={`flex items-center gap-1.5 px-2.5 py-1 border font-medium ${
                  chainStatus.expenseCount > 0
                    ? "bg-card border-foreground/40 text-foreground"
                    : "bg-card border-foreground/30 text-muted-foreground"
                }`}
              >
                <BadgeCheck size={11} />
                {chainStatus.expenseCount > 0
                  ? `Expense Booked — ${chainStatus.latestExpenseDocNo} (${chainStatus.latestExpenseStatus})`
                  : "Not Booked"}
              </span>
              <span
                className={`flex items-center gap-1.5 px-2.5 py-1 border font-medium ${
                  chainStatus.isPaid
                    ? "bg-card border-foreground/40 text-foreground"
                    : "bg-card border-foreground/30 text-muted-foreground"
                }`}
              >
                <BadgeCheck size={11} />
                {chainStatus.isPaid
                  ? `Paid — ${fmt(chainStatus.totalPaid ?? 0)}`
                  : "Not Paid"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Activity Details */}
      <div className="border border-foreground/30 bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-foreground/30 flex items-center gap-2">
          <Calculator size={15} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">
            Activity Details
          </h2>
          <span className="text-xs text-muted-foreground bg-card px-2 py-0.5 ml-1">
            {detail.activities?.length || 0} activities
          </span>
        </div>

        <div className="p-3 space-y-3">
          {!detail.activities || detail.activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-12 h-12 bg-card flex items-center justify-center mb-3">
                <ClipboardList size={22} className="text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">
                No activities found
              </p>
            </div>
          ) : (
            Object.entries(grouped).map(([groupName, acts], groupIdx) => {
              const groupLabour = acts.reduce(
                (s, a) => s + (a.LabourAmount || 0),
                0,
              );
              const groupMats = acts.reduce(
                (s, a) => s + (a.MaterialAmount || 0),
                0,
              );
              // With tax: each activity's HSN / SAC GST on its labour + materials, as in the edit screen and the grand total.
              const groupGst = acts.reduce(
                (s, a) => s + ((a.LabourAmount || 0) + (a.MaterialAmount || 0)) * (Number(a.HsnGstRate) || 0) / 100,
                0,
              );
              const groupTotal = groupLabour + groupMats + groupGst;
              const isExpanded = expandedGroups[groupIdx] !== false;

              return (
                <div
                  key={groupName}
                  className="border border-foreground/30 bg-card overflow-hidden"
                >
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(groupIdx)}
                    className="w-full flex items-center gap-2 px-3 sm:px-4 py-3 bg-card border-b border-foreground/30 text-left hover:bg-primary/5 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown
                        size={14}
                        className="text-muted-foreground shrink-0"
                      />
                    ) : (
                      <ChevronRight
                        size={14}
                        className="text-muted-foreground shrink-0"
                      />
                    )}
                    <span className="text-xs font-heading font-bold text-primary bg-primary/10 px-2 py-0.5 shrink-0">
                      {groupIdx + 1}
                    </span>
                    <span className="flex-1 text-sm font-semibold text-foreground text-left">
                      {groupName}
                    </span>
                    <span className="text-xs text-muted-foreground mr-2 hidden sm:block">
                      {acts.length}{" "}
                      {acts.length === 1 ? "activity" : "activities"}
                    </span>
                    <span
                      className={`text-sm font-bold shrink-0 ${groupTotal > 0 ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {fmt(groupTotal)}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="p-3 space-y-2">
                      {/* Desktop header row */}
                      <div className="hidden sm:grid grid-cols-[32px_1fr_80px_110px_80px_110px_110px_110px] gap-2 px-3 pb-1">
                        {[
                          "#",
                          "Activity",
                          "Unit",
                          "Rate/Unit",
                          "Area",
                          "Labour",
                          "Materials",
                          "Total",
                        ].map((h) => (
                          <div
                            key={h}
                            className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {h}
                          </div>
                        ))}
                      </div>

                      {acts.map((act, actIdx) => {
                        const hasMaterials =
                          act.materials && act.materials.length > 0;
                        const matExpanded =
                          expandedMaterials[act.Id] !== false && hasMaterials;

                        return (
                          <div
                            key={act.Id}
                            className="border border-foreground/30 overflow-hidden"
                          >
                            {/* Mobile activity card */}
                            <div className="sm:hidden p-3 bg-card space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-heading text-primary font-bold shrink-0">
                                  {groupIdx + 1}.{actIdx + 1}
                                </span>
                                <span className="text-sm font-medium text-foreground flex-1">
                                  {act.ActivityName || "—"}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-muted-foreground">
                                    Unit:
                                  </span>{" "}
                                  <span className="font-medium">
                                    {act.UOMName || "—"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Area:
                                  </span>{" "}
                                  <span className="font-medium">
                                    {act.Area || "—"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Rate:
                                  </span>{" "}
                                  <span className="font-medium">
                                    {act.Rate ? fmt(act.Rate) : "—"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Labour:
                                  </span>{" "}
                                  <span className="font-medium text-foreground">
                                    {act.LabourAmount
                                      ? fmt(act.LabourAmount)
                                      : "—"}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-1 border-t border-foreground/30">
                                <span className="text-xs text-muted-foreground">
                                  Activity Total
                                </span>
                                <span className="text-sm font-bold text-foreground">
                                  {fmt(act.GrandTotal || 0)}
                                </span>
                              </div>
                            </div>

                            {/* Desktop activity row */}
                            <div className="hidden sm:grid grid-cols-[32px_1fr_80px_110px_80px_110px_110px_110px] gap-2 items-center px-3 py-2.5 bg-card">
                              <span className="text-xs font-heading text-primary font-semibold">
                                {groupIdx + 1}.{actIdx + 1}
                              </span>
                              <span
                                className="text-sm font-medium text-foreground truncate"
                                title={act.ActivityName}
                              >
                                {act.ActivityName || "—"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {act.UOMName || "—"}
                              </span>
                              <span className="text-xs font-medium">
                                {act.Rate ? fmt(act.Rate) : "—"}
                              </span>
                              <span className="text-xs font-medium">
                                {act.Area ?? "—"}
                              </span>
                              <span className="text-xs font-semibold text-foreground">
                                {act.LabourAmount ? fmt(act.LabourAmount) : "—"}
                              </span>
                              <span className="text-xs font-semibold text-foreground">
                                {act.MaterialAmount
                                  ? fmt(act.MaterialAmount)
                                  : "—"}
                              </span>
                              <span className="text-sm font-bold text-foreground">
                                {fmt(act.GrandTotal || 0)}
                              </span>
                            </div>

                            {/* Materials toggle */}
                            {hasMaterials && (
                              <>
                                <button
                                  onClick={() => toggleMaterials(act.Id)}
                                  className="w-full flex items-center gap-2 px-4 py-2 bg-card border-t border-foreground/30 text-xs text-muted-foreground hover:bg-primary/5 transition-colors"
                                >
                                  <Package
                                    size={11}
                                    className="text-foreground shrink-0"
                                  />
                                  <span className="font-medium">
                                    {act.materials.length} Material
                                    {act.materials.length !== 1 ? "s" : ""}
                                  </span>
                                  {detail.SupplierName && (
                                    <span className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary text-[0.625rem] font-semibold">
                                      {detail.SupplierName}
                                    </span>
                                  )}
                                  <span className="ml-auto font-semibold text-foreground">
                                    {fmt(act.MaterialAmount || 0)}
                                  </span>
                                  {matExpanded ? (
                                    <ChevronUp size={11} />
                                  ) : (
                                    <ChevronDown size={11} />
                                  )}
                                </button>

                                {matExpanded && (
                                  <div className="border-t border-foreground/30 bg-card dark:bg-primary/5">
                                    {/* Desktop material header */}
                                    <div className="hidden sm:grid grid-cols-[1fr_80px_80px_80px_120px] gap-2 px-6 py-1.5 border-b border-foreground/30 bg-card">
                                      {[
                                        "Item Name",
                                        "Ratio",
                                        "Unit",
                                        "Rate / Unit",
                                        "Amount",
                                      ].map((h) => (
                                        <div
                                          key={h}
                                          className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground"
                                        >
                                          {h}
                                        </div>
                                      ))}
                                    </div>
                                    {act.materials.map((mat, matIdx) => {
                                      // Quantity stored in DB = consumption ratio; Area from parent activity
                                      const lineTotal =
                                        (mat.Quantity || 0) *
                                        (act.Area || 0) *
                                        (mat.Rate || 0);
                                      return (
                                        <div key={mat.Id}>
                                          {/* Mobile material */}
                                          <div className="sm:hidden flex items-center justify-between px-4 py-2 border-b border-foreground/30 last:border-0">
                                            <div>
                                              <p className="text-xs font-medium text-foreground">
                                                {mat.ItemName || "—"}
                                              </p>
                                              <p className="text-[0.625rem] text-muted-foreground">
                                                {mat.Quantity} × {act.Area}{" "}
                                                {act.UOMName} × ₹{mat.Rate}
                                              </p>
                                            </div>
                                            <span className="text-xs font-semibold text-foreground">
                                              {lineTotal > 0
                                                ? fmt(lineTotal)
                                                : "—"}
                                            </span>
                                          </div>
                                          {/* Desktop material */}
                                          <div className="hidden sm:grid grid-cols-[1fr_80px_80px_80px_120px] gap-2 items-center px-6 py-2 border-b border-foreground/30 last:border-0">
                                            <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                                              <span className="w-4 h-4 flex items-center justify-center bg-primary/10 text-primary text-[0.625rem] font-bold shrink-0">
                                                {matIdx + 1}
                                              </span>
                                              {mat.ItemName || "—"}
                                            </span>
                                            <span className="text-xs text-muted-foreground font-heading">
                                              {mat.Quantity != null
                                                ? `${mat.Quantity} × ${act.Area}`
                                                : "—"}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                              {mat.UOMName || "—"}
                                            </span>
                                            <span className="text-xs text-muted-foreground font-heading">
                                              {mat.Rate ? `₹${mat.Rate}` : "—"}
                                            </span>
                                            <span className="text-xs font-semibold text-foreground">
                                              {lineTotal > 0
                                                ? fmt(lineTotal)
                                                : "—"}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {/* Material subtotal */}
                                    <div className="flex items-center justify-between px-6 py-2 bg-card border-t border-foreground/30">
                                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                        Materials Subtotal
                                      </span>
                                      <span className="text-sm font-bold text-foreground">
                                        {fmt(act.MaterialAmount || 0)}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}

                            {/* Remarks */}
                            {act.Remarks && (
                              <div className="px-4 py-2 border-t border-foreground/30 bg-card">
                                <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide font-semibold">
                                  Remarks:{" "}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {act.Remarks}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Grand total */}
        <div className="border-t border-foreground/30 bg-card">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-foreground/10">
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Package size={11} className="text-foreground" />
                Raw Materials
              </span>
              <span className="text-base font-bold text-foreground">
                {fmt(grandMaterials)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Hammer size={11} className="text-foreground" />
                Labour
              </span>
              <span className="text-base font-bold text-foreground">
                {fmt(grandLabour)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3 bg-card">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Receipt size={11} className="text-primary" />
                Grand Total
              </span>
              <span className="text-xl font-bold text-foreground">
                {fmt(detail.TotalAmount || 0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
