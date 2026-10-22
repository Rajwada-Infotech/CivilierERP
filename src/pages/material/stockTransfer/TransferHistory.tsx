import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, CheckCircle2, Trash2, X, FileText, Eye } from "lucide-react";
import { ServerPager } from "@/components/ServerPager";
import { getTransferHistory, type StockTransfer } from "@/api/stockTransferApi";
import { deleteInterCompanyTransfer, type InterCompanyTransferSummary } from "@/api/interCompanyTransferApi";
import { getGRNsByTransfer, type TransferGRNSummary } from "@/api/grnApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { StatusBadge } from "@/components/StatusBadge";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { usePageRights } from "@/hooks/usePageRights";
import { fmtNum, fmtDate } from "./config";
import { MakeGRNModal } from "./MakeGRNModal";
import { TransferPreviewModal } from "./TransferPreviewModal";
import { ICTPreviewModal } from "./ICTPreviewModal";

// ─── Transfer History ─────────────────────────────────────────────────────────
export function TransferHistory() {
  const rights = usePageRights("stock-transfers");
  // Server-paged: both kinds of transfer come back together, already in date order, one page per request.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["stock-transfers", "history", page, pageSize],
    queryFn: () => getTransferHistory({ page, limit: pageSize }),
    staleTime: 60_000,
    placeholderData: keepPreviousData, // keep the current rows on screen while the next page loads
  });
  const historyRows = useMemo(() => data?.data ?? [], [data]);
  const historyTotal = Number(data?.total ?? 0);
  // Any inter-company transfer at all (not just on this page) - shows the GST toggle and the Amount heading.
  const hasIct = Number(data?.ictTotal ?? 0) > 0;
  const transfers: StockTransfer[] = useMemo(
    () => historyRows.flatMap((r) => (r.kind === "plain" ? [r.data] : [])),
    [historyRows],
  );
  // A page past the end (rows removed since it was opened) comes back empty - go back to the first page.
  useEffect(() => {
    if (!isFetching && page > 1 && data && historyRows.length === 0) setPage(1);
  }, [isFetching, page, data, historyRows.length]);

  // One request for every visible row's approval trail instead of one per
  // row — see useApprovalTrailsBulk's own comment.
  const { trails: transferApprovalTrails, isLoading: transferApprovalTrailsLoading } = useApprovalTrailsBulk(
    "StockTransfers",
    transfers.map((t) => t.TransferID),
  );

  // Inter-company transfers (direct GL voucher between the two companies' Inter-Company A/c heads) live in their
  // own table; GET /history merges them into this list so a completed one is visible here too.
  const refetchIct = refetch;
  const isFetchingIct = false;

  const [grnModalTransfer, setGrnModalTransfer] =
    useState<StockTransfer | null>(null);
  const [previewTransfer, setPreviewTransfer] =
    useState<StockTransfer | null>(null);
  const [previewIctId, setPreviewIctId] = useState<number | null>(null);
  const [successGrnNo, setSuccessGrnNo] = useState<string | null>(null);
  // Inter-Company Transfer amounts include GST by default — the actual
  // money that moves between the two companies — with a toggle to switch
  // that single-figure column to the excl-GST base amount instead.
  const [ictGstMode, setIctGstMode] = useState<"incl" | "excl">("incl");
  const [ictDeleteError, setIctDeleteError] = useState("");

  const qc = useQueryClient();
  const deleteIctMut = useMutation({
    mutationFn: deleteInterCompanyTransfer,
    onSuccess: () => {
      setIctDeleteError("");
      qc.invalidateQueries({ queryKey: ["inter-company-transfer-list"] });
      qc.invalidateQueries({ queryKey: ["stock-transfers"] });
      qc.invalidateQueries({ queryKey: ["inventory-master"] });
    },
    onError: (e: Error) => setIctDeleteError(e.message),
  });
  // Track which transfers already have a GRN (transferId → GRN summary[])
  const [grnMap, setGrnMap] = useState<Record<number, TransferGRNSummary[]>>(
    {},
  );
  const grnFetchInFlightRef = useRef<Set<number>>(new Set());

  // After data loads, fetch GRN status for each transfer in background
  useEffect(() => {
    if (!transfers.length) return;
    transfers.forEach((t) => {
      if (grnFetchInFlightRef.current.has(t.TransferID)) return;
      if (grnMap[t.TransferID]) return;
      grnFetchInFlightRef.current.add(t.TransferID);
      getGRNsByTransfer(t.TransferID)
        .then((grns) => {
          if (grns.length) {
            setGrnMap((prev) => ({ ...prev, [t.TransferID]: grns }));
          }
        })
        .catch(() => {
          /* non-fatal */
        })
        .finally(() => {
          grnFetchInFlightRef.current.delete(t.TransferID);
        });
    });
  }, [transfers, grnMap]);

  const handleGRNSuccess = (grnNo: string) => {
    setSuccessGrnNo(grnNo);
    setGrnModalTransfer(null);
    refetch();
  };

  type UnifiedRow =
    | { kind: "plain"; date: string; data: StockTransfer }
    | { kind: "ict"; date: string; data: InterCompanyTransferSummary };

  // Already in the tab's order (transfer date, newest first) from the server.
  const unifiedRows: UnifiedRow[] = historyRows.map((r): UnifiedRow =>
    r.kind === "plain"
      ? { kind: "plain", date: r.data.TransferDate, data: r.data }
      : { kind: "ict", date: r.data.TransferDate, data: r.data },
  );

  return (
    <>
      {grnModalTransfer && (
        <MakeGRNModal
          transfer={grnModalTransfer}
          onClose={() => setGrnModalTransfer(null)}
          onSuccess={handleGRNSuccess}
        />
      )}

      {previewTransfer && (
        <TransferPreviewModal
          transfer={previewTransfer}
          linkedGRNs={grnMap[previewTransfer.TransferID] ?? []}
          onClose={() => setPreviewTransfer(null)}
        />
      )}

      {previewIctId != null && (
        <ICTPreviewModal ictId={previewIctId} onClose={() => setPreviewIctId(null)} />
      )}

      {ictDeleteError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <X size={15} />
          {ictDeleteError}
          <button
            onClick={() => setIctDeleteError("")}
            className="ml-auto p-0.5 hover:opacity-60 transition-opacity"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {successGrnNo && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={15} />
          GRN <strong>{successGrnNo}</strong> created successfully from
          transfer.
          <button
            onClick={() => setSuccessGrnNo(null)}
            className="ml-auto p-0.5 hover:opacity-60 transition-opacity"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-sm font-heading font-semibold text-foreground">
              Transfer History
            </p>
            <p className="text-xs text-muted-foreground">
              Recent godown-to-godown stock movements
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasIct && (
              <div className="flex items-center rounded-lg border border-border p-0.5 text-[0.625rem] font-medium">
                <button
                  onClick={() => setIctGstMode("excl")}
                  title="Show Inter-Company amounts excl. GST"
                  className={`px-2 py-1 rounded-md transition-colors ${
                    ictGstMode === "excl"
                      ? "btn-module text-white"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Excl. GST
                </button>
                <button
                  onClick={() => setIctGstMode("incl")}
                  title="Show Inter-Company amounts incl. GST"
                  className={`px-2 py-1 rounded-md transition-colors ${
                    ictGstMode === "incl"
                      ? "btn-module text-white"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Incl. GST
                </button>
              </div>
            )}
            <button
              onClick={() => {
                refetch();
                refetchIct();
              }}
              disabled={isFetching || isFetchingIct}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={isFetching || isFetchingIct ? "animate-spin" : ""} />{" "}
              Refresh
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                {[
                  { label: "Doc No", cls: "" },
                  { label: "Date", cls: "hidden sm:table-cell" },
                  { label: "Route", cls: "hidden sm:table-cell" },
                  {
                    label: hasIct ? `Items / Amount (${ictGstMode === "incl" ? "Incl." : "Excl."} GST)` : "Items",
                    cls: "hidden md:table-cell",
                  },
                  { label: "Status", cls: "" },
                  { label: "", cls: "" },
                ].map(({ label, cls }) => (
                  <th
                    key={label}
                    className={`px-3 py-2.5 text-left font-semibold text-muted-foreground ${cls}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-3 py-2.5">
                        <div className="h-3 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : unifiedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    No transfers yet.
                  </td>
                </tr>
              ) : (
                unifiedRows.map((row) => {
                  if (row.kind === "ict") {
                    const t = row.data;
                    return (
                      <tr
                        key={`ict-${t.ICTId}`}
                        className="border-b border-border hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-3 py-2.5 font-mono text-foreground font-semibold whitespace-nowrap">
                          <div>{t.DocNo}</div>
                          <div className="text-[0.625rem] text-muted-foreground font-sans font-normal sm:hidden">{fmtDate(t.TransferDate)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                          {fmtDate(t.TransferDate)}
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <div className="flex items-center gap-1 whitespace-nowrap">
                            <span className="text-orange-600 dark:text-orange-400">
                              {t.SenderProjectName}
                            </span>
                            <ArrowRight size={10} className="text-muted-foreground shrink-0" />
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {t.ReceiverProjectName}
                            </span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[0.5625rem] bg-muted text-muted-foreground border border-border ml-1">
                              Inter-Company
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden md:table-cell">
                          {fmtNum(
                            ictGstMode === "incl"
                              ? (t.TotalAmountInclGst ?? t.TotalAmount)
                              : t.TotalAmount,
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {t.Status === "Completed" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-medium bg-green-500/10 text-green-700 dark:text-green-400 border border-green-400/30">
                              <CheckCircle2 size={10} /> Completed (auto)
                            </span>
                          ) : t.Status === "Approved" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-medium bg-green-500/10 text-green-700 dark:text-green-400 border border-green-400/30">
                              <CheckCircle2 size={10} /> Approved
                            </span>
                          ) : t.Status === "Pending" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-medium bg-[#ffe2021a] text-amber-700 dark:text-amber-400 border border-amber-400/30">
                              Pending approval
                            </span>
                          ) : t.Status === "Rejected" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-medium bg-red-500/10 text-red-700 dark:text-red-400 border border-red-400/30">
                              Rejected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-medium bg-muted text-muted-foreground border border-border">
                              {t.Status}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button data-row-view
                              onClick={() => setPreviewIctId(t.ICTId)}
                              title="Preview"
                              className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                            >
                              <Eye size={12} />
                            </button>
                            {rights.canDelete && (
                              <button
                                onClick={() => {
                                  const msg =
                                    t.Status === "Completed"
                                      ? `Delete ${t.DocNo}? This reverses the stock movement (${t.SenderProjectName} → ${t.ReceiverProjectName}) and the two-sided GL voucher it posted. This cannot be undone.`
                                      : `Delete ${t.DocNo}? This request never moved stock or posted to GL, so nothing to reverse — it will just be removed.`;
                                  if (!window.confirm(msg)) return;
                                  deleteIctMut.mutate(t.ICTId);
                                }}
                                disabled={deleteIctMut.isPending}
                                title={t.Status === "Completed" ? "Delete — reverses stock & GL" : "Delete"}
                                className="p-1.5 rounded-lg border border-border hover:bg-red-500/10 hover:text-red-500 hover:border-red-400/40 transition-colors disabled:opacity-50"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const t = row.data;
                  const linkedGRNs = grnMap[t.TransferID] ?? [];
                  const hasGRN = linkedGRNs.length > 0;
                  return (
                    <tr
                      key={t.TransferID}
                      className="border-b border-border hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-mono text-foreground font-semibold whitespace-nowrap">
                        <div>{t.DocNo}</div>
                        <div className="text-[0.625rem] text-muted-foreground font-sans font-normal sm:hidden">{fmtDate(t.TransferDate)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                        {fmtDate(t.TransferDate)}
                      </td>
                      <td className="px-3 py-2.5 hidden sm:table-cell">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="text-orange-600 dark:text-orange-400">
                            {t.FromGodownName}
                          </span>
                          <ArrowRight size={10} className="text-muted-foreground shrink-0" />
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {t.ToGodownName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap hidden md:table-cell">
                        {t.TransferItems.length} item
                        {t.TransferItems.length !== 1 ? "s" : ""}
                      </td>
                      <td className="px-3 py-2.5">
                        <ApprovalStatusChain
                          table="StockTransfers"
                          recordId={t.TransferID}
                          fallback={<StatusBadge status={t.Status} />}
                          preloaded={transferApprovalTrails.get(String(t.TransferID)) ?? null}
                          preloadedLoading={transferApprovalTrailsLoading}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button data-row-view
                            onClick={() => setPreviewTransfer(t)}
                            title="Preview"
                            className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                          >
                            <Eye size={12} />
                          </button>
                          {hasGRN ? (
                            <span
                              title={linkedGRNs.map((g) => g.GRNNo || g.DocNo).join(", ")}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[0.625rem] bg-muted text-muted-foreground border border-border font-mono whitespace-nowrap"
                            >
                              <FileText size={9} /> {linkedGRNs.length > 1 ? `${linkedGRNs.length} GRNs` : linkedGRNs[0].GRNNo || linkedGRNs[0].DocNo}
                            </span>
                          ) : (
                            rights.canCreate && (
                            <button
                              onClick={() => setGrnModalTransfer(t)}
                              title="Make GRN"
                              className="p-1.5 rounded-lg border border-emerald-400/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/15 transition-colors"
                            >
                              <FileText size={12} />
                            </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <ServerPager page={page} pageSize={pageSize} total={historyTotal} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>
    </>
  );
}
