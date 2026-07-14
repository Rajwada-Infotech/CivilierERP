import { useState } from "react";
import {
  ShoppingCart,
  Hammer,
  Package,
  Truck,
  FileText,
  Banknote,
  CalendarDays,
  X,
  Search,
  AlertCircle,
  Loader2,
  Clock,
  ChevronRight,
  Hash,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "./apiFetch";
import { EmptyState, PickerRow, InfoPill } from "./PickerPrimitives";
import { fmt, fmtQty, round3, derivePOGst } from "./helpers";
import type {
  DocSelectorProps,
  SourceKind,
  TodItem,
  GRNItemLine,
} from "./types";

export function DocSelectorPanel({
  poList,
  woPOList,
  workDoneList,
  todList,
  grnList,
  loadingPO,
  loadingWorkDone,
  loadingWOPO,
  loadingTOD,
  loadingGRN,
  companyOptions,
  projectOptions,
  suppliers,
  selected,
  finYear,
  filterCompanyId,
  filterProjectId,
  filterFinYear,
  filterSupplier,
  bookedPOIds,
  bookedWorkDoneIds,
  bookedWOPOIds,
  bookedGRNIds,
  onSelect,
  onClear,
  onTodSelected,
}: DocSelectorProps) {
  const [tab, setTab] = useState<SourceKind>("WORK_DONE");
  const [search, setSearch] = useState("");
  const [todFetching, setTodFetching] = useState(false);
  const [poGoodsBlocked, setPoGoodsBlocked] = useState<{ poId: number; docNo: string; goodsItems: string[] } | null>(null);

  const selectTod = async (tod: TodItem) => {
    setTodFetching(true);
    try {
      const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
      const data = await apiFetch(
        `/api/document-type/${tod.TypeOfDocId}/next-number${qs}`,
      );
      const docNo = data.nextDocNo ?? (tod.FullPrefix ?? tod.Prefix) + "/001";
      onTodSelected?.(tod);
      onSelect({
        kind: "TOD",
        docNo,
        sourceId: tod.TypeOfDocId,
        nameLabel: tod.Description,
      });
    } catch (err) {
      onTodSelected?.(null);
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setTodFetching(false);
    }
  };

  const q = search.toLowerCase();

  // FinYear labels are free text (e.g. "FY 2026-2027", "2026-2027", "26-27")
  // so exact-string comparisons routinely miss real matches. Extract the
  // 2-digit year tokens from both sides and compare those instead.
  const yearTokens = (str?: string): string[] =>
    (str?.match(/\d{2,4}/g) || []).map((s) => s.slice(-2));

  const inFinYear = (docNo?: string, recFinYear?: string) => {
    if (!filterFinYear) return true;
    const filterYears = yearTokens(filterFinYear);
    if (!filterYears.length) return true;
    if (recFinYear) {
      const recYears = yearTokens(recFinYear);
      return recYears.some((y) => filterYears.includes(y));
    }
    if (!docNo) return true;
    const docYears = yearTokens(docNo);
    return docYears.some((y) => filterYears.includes(y));
  };

  const filteredWorkDone = workDoneList.filter((wd) => {
    if (bookedWorkDoneIds?.has(wd.ID)) return false;
    if (
      filterCompanyId &&
      wd.CompanyId &&
      Number(wd.CompanyId) !== Number(filterCompanyId)
    )
      return false;
    if (
      filterProjectId &&
      wd.ProjectId &&
      Number(wd.ProjectId) !== Number(filterProjectId)
    )
      return false;
    if (!inFinYear(wd.DocNo, wd.FinYear)) return false;
    if (
      filterSupplier &&
      !(wd.ContractorName || "").trim().toLowerCase().includes(filterSupplier.trim().toLowerCase())
    )
      return false;
    return (
      (wd.DocNo || "").toLowerCase().includes(q) ||
      (wd.ContractorName || "").toLowerCase().includes(q) ||
      (wd.WorkOrderNo || "").toLowerCase().includes(q) ||
      (wd.DescriptionOfWork || "").toLowerCase().includes(q)
    );
  });
  const filteredWOPO = woPOList.filter((p) => {
    if (bookedWOPOIds?.has(p.PurchaseOrderID)) return false;
    // Only Approved WO-POs (or already-partially-received ones) can be used
    // for expense booking.
    if (p.Status !== "Approved" && p.Status !== "Received") return false;
    if (
      filterCompanyId &&
      p.CompanyId &&
      Number(p.CompanyId) !== Number(filterCompanyId)
    )
      return false;
    if (
      filterProjectId &&
      p.ProjectId &&
      Number(p.ProjectId) !== Number(filterProjectId)
    )
      return false;
    if (!inFinYear(p.DocNo || p.PurchaseOrderNo)) return false;
    if (
      filterSupplier &&
      !(p.SupplierName || "").trim().toLowerCase().includes(filterSupplier.trim().toLowerCase())
    )
      return false;
    return (
      (p.DocNo || p.PurchaseOrderNo).toLowerCase().includes(q) ||
      (p.SupplierName || "").toLowerCase().includes(q) ||
      (p.SourceWODocNo || "").toLowerCase().includes(q)
    );
  });
  const filteredTOD = todList.filter(
    (t) =>
      (t.FullPrefix ?? t.Prefix).toLowerCase().includes(q) ||
      t.Description.toLowerCase().includes(q),
  );
  const filteredGRN = grnList.filter((g) => {
    if (bookedGRNIds?.has(g.GRNID)) return false;
    // Only Approved GRNs can be used for expense booking — matches the
    // backend guard in expenseBooking.js (POST /).
    if (g.Status !== "Approved") return false;
    if (
      filterCompanyId &&
      g.CompanyId &&
      Number(g.CompanyId) !== Number(filterCompanyId)
    )
      return false;
    if (
      filterProjectId &&
      g.ProjectId &&
      Number(g.ProjectId) !== Number(filterProjectId)
    )
      return false;
    const grnDocNo = g.DocNo || g.GRNNo;
    if (!inFinYear(grnDocNo, (g as any).FinYear)) return false;
    if (
      filterSupplier &&
      !(g.SupplierName || "").trim().toLowerCase().includes(filterSupplier.trim().toLowerCase())
    )
      return false;
    return (
      (grnDocNo || "").toLowerCase().includes(q) ||
      (g.SupplierName || "").toLowerCase().includes(q) ||
      (g.PONumber || "").toLowerCase().includes(q)
    );
  });

  if (selected) {
    const isPO = selected.kind === "PO",
      isWorkDone = selected.kind === "WORK_DONE",
      isWOPO = selected.kind === "WO_PO",
      isGRN = selected.kind === "GRN";
    const Icon = isPO
      ? ShoppingCart
      : isWorkDone
        ? Hammer
        : isWOPO
          ? Package
          : isGRN
            ? Truck
            : FileText;
    const colors = isPO
      ? {
          ring: "border-emerald-500/30 bg-emerald-500/[0.05]",
          icon: "bg-emerald-500/10",
          text: "text-emerald-500",
          badge:
            "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        }
      : isWorkDone
        ? {
            ring: "border-violet-500/30 bg-violet-500/5",
            icon: "bg-violet-500/10",
            text: "text-violet-500",
            badge:
              "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
          }
        : isWOPO
          ? {
              ring: "border-amber-500/30 bg-amber-500/5",
              icon: "bg-amber-500/10",
              text: "text-amber-600",
              badge:
                "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
            }
          : isGRN
            ? {
                ring: "border-teal-500/30 bg-teal-500/5",
                icon: "bg-teal-500/10",
                text: "text-teal-500",
                badge:
                  "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
              }
            : {
                ring: "border-emerald-500/30 bg-emerald-500/5",
                icon: "bg-emerald-500/10",
                text: "text-emerald-500",
                badge:
                  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
              };
    return (
      <div className={`rounded-xl border p-4 ${colors.ring}`}>
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-lg ${colors.icon} flex items-center justify-center shrink-0`}
            >
              <Icon size={15} className={colors.text} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs font-heading font-semibold ${colors.text}`}
                >
                  {isPO
                    ? "Purchase Order"
                    : isWorkDone
                      ? "Work Done"
                      : isWOPO
                        ? "WO Material PO"
                        : isGRN
                          ? "Goods Receipt Note"
                          : "Document"}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${colors.badge}`}
                >
                  {selected.docNo}
                </span>
                {selected.status && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] border border-border bg-muted/50 text-muted-foreground">
                    {selected.status}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selected.vendorLabel && (
                  <InfoPill
                    icon={User}
                    label={
                      isPO
                        ? "Supplier"
                        : isWorkDone
                          ? "Contractor"
                          : isWOPO
                            ? "Supplier"
                            : isGRN
                              ? "Supplier"
                              : "Vendor"
                    }
                    value={selected.vendorLabel}
                  />
                )}
                {!isGRN && selected.amount != null && (
                  <InfoPill
                    icon={Banknote}
                    label="Order Value"
                    value={`₹${fmt(selected.amount)}`}
                  />
                )}
                {isGRN &&
                  Array.isArray(selected.grnItems) &&
                  selected.grnItems.length > 0 &&
                  (() => {
                    const totalReceived = round3(
                      selected.grnItems.reduce(
                        (s, i) => s + (Number(i.receivedQty) || 0),
                        0,
                      ),
                    );
                    const totalRemaining = round3(
                      selected.grnItems.reduce(
                        (s, i) => s + (Number(i.remainingQty) || 0),
                        0,
                      ),
                    );
                    return (
                      <>
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <Package
                            size={11}
                            className="text-emerald-600 dark:text-emerald-400 shrink-0"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            Received:
                          </span>
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {fmtQty(totalReceived)} units
                          </span>
                        </div>
                        {totalRemaining > 0 && (
                          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                            <Clock
                              size={11}
                              className="text-amber-600 dark:text-amber-400 shrink-0"
                            />
                            <span className="text-[10px] text-muted-foreground">
                              Pending:
                            </span>
                            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                              {fmtQty(totalRemaining)} units
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50">
                          <Truck
                            size={11}
                            className="text-muted-foreground shrink-0"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {selected.grnItems.length}{" "}
                            {selected.grnItems.length === 1 ? "item" : "items"}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                {selected.date && (
                  <InfoPill
                    icon={CalendarDays}
                    label="Date"
                    value={selected.date.slice(0, 10)}
                  />
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              onTodSelected?.(null);
              onClear();
            }}
            className="flex items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-destructive transition-colors shrink-0 px-2 py-1.5 sm:py-1 rounded-md hover:bg-destructive/5 border border-transparent hover:border-destructive/20 w-full sm:w-auto mt-2 sm:mt-0"
          >
            <X size={10} /> Change
          </button>
        </div>
      </div>
    );
  }

  const tabs: {
    id: SourceKind;
    label: string;
    icon: React.ElementType;
    count: number;
  }[] = [
    {
      id: "WORK_DONE",
      label: "Work Done",
      icon: Hammer,
      count: filteredWorkDone.length,
    },
    {
      id: "WO_PO",
      label: "WO Material POs",
      icon: Package,
      count: filteredWOPO.length,
    },
    { id: "GRN", label: "GRN", icon: Truck, count: filteredGRN.length },
    {
      id: "TOD",
      label: "Other Expenses",
      icon: FileText,
      count: todList.length,
    },
  ];
  const loading =
    tab === "WORK_DONE"
      ? loadingWorkDone
      : tab === "WO_PO"
        ? loadingWOPO
        : tab === "GRN"
          ? loadingGRN
          : loadingTOD;
  const placeholder =
    tab === "WORK_DONE"
      ? "Search by Work Done doc no, contractor, or WO ref…"
      : tab === "WO_PO"
        ? "Search by WO_PO number, supplier, or WO ref…"
        : tab === "GRN"
          ? "Search by GRN number, supplier, or PO…"
          : "Search document types…";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex border-b border-border bg-muted/20">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id as SourceKind);
              setSearch("");
            }}
            className={`flex flex-1 items-center justify-center gap-1.5 px-6 py-2.5 text-xs font-heading font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap ${tab === t.id ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-background" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <t.icon size={11} />
            {t.label}
            <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground font-normal">
              {t.count}
            </span>
          </button>
        ))}
      </div>
      <div className="p-3 border-b border-border/40 bg-background">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30 placeholder:text-muted-foreground"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Goods-type block warning */}
      {poGoodsBlocked && (
        <div className="mx-3 mb-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
              <AlertCircle size={12} /> Direct invoice not allowed — Goods items detected
            </p>
            <button onClick={() => setPoGoodsBlocked(null)} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{poGoodsBlocked.docNo}</span> contains Goods-type items.
            Direct invoices are only allowed for Service items. Use a GRN-linked invoice for goods, or split this PO into separate Service and Goods orders.
          </p>
          {poGoodsBlocked.goodsItems.length > 0 && (
            <p className="text-[10px] text-destructive/80">
              Goods items: {poGoodsBlocked.goodsItems.join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="sidebar-scroll max-h-60 overflow-y-auto bg-background">
        {loading || todFetching ? (
          <div className="flex items-center justify-center py-10 gap-2 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {todFetching ? "Fetching next document number…" : "Loading…"}
          </div>
        ) : tab === "WORK_DONE" ? (
          filteredWorkDone.length === 0 ? (
            <EmptyState label="No approved Work Done entries found" />
          ) : (
            filteredWorkDone.map((wd) => {
              return (
                <PickerRow
                  key={wd.ID}
                  icon={<Hammer size={12} className="text-violet-500" />}
                  iconBg="bg-violet-500/10"
                  primary={wd.DocNo || `WD-${wd.ID}`}
                  primaryColor="text-violet-600 dark:text-violet-400"
                  secondary={[
                    wd.ContractorName,
                    wd.WorkOrderNo ? `WO: ${wd.WorkOrderNo}` : null,
                    wd.DocDate?.slice(0, 10),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={wd.Status}
                  amount={wd.CertifiedAmount}
                  onClick={() =>
                    onSelect({
                      kind: "WORK_DONE",
                      docNo: wd.DocNo || `WD-${wd.ID}`,
                      sourceId: wd.ID,
                      nameLabel: wd.DescriptionOfWork,
                      vendorLabel: wd.ContractorName,
                      companyId: wd.CompanyId,
                      projectId: wd.ProjectId,
                      amount: wd.CertifiedAmount,
                      status: wd.Status,
                      date: wd.DocDate,
                      gst: wd.GST ?? null,
                    })
                  }
                />
              );
            })
          )
        ) : tab === "WO_PO" ? (
          filteredWOPO.length === 0 ? (
            <EmptyState label="No WO Material POs found" />
          ) : (
            filteredWOPO.map((po) => {
              const docNo = po.DocNo || po.PurchaseOrderNo;
              return (
                <PickerRow
                  key={po.PurchaseOrderID}
                  icon={<Package size={12} className="text-amber-600" />}
                  iconBg="bg-amber-500/10"
                  primary={docNo}
                  primaryColor="text-amber-600 dark:text-amber-400"
                  secondary={[
                    po.SupplierName,
                    po.SourceWODocNo ? `WO: ${po.SourceWODocNo}` : null,
                    po.SourceWDDocNo ? `WD: ${po.SourceWDDocNo}` : null,
                    po.PODate?.slice(0, 10),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={po.Status}
                  amount={po.TotalAmount}
                  onClick={() => {
                    const {
                      subtotal,
                      cgstRate: dCgst,
                      sgstRate: dSgst,
                    } = derivePOGst(po.POItems ?? []);
                    onSelect({
                      kind: "WO_PO",
                      docNo,
                      sourceId: po.PurchaseOrderID,
                      nameLabel: po.ItemDescription,
                      vendorLabel: po.SupplierName,
                      companyId: po.CompanyId,
                      projectId: po.ProjectId,
                      amount: po.TotalAmount,
                      subtotal: subtotal > 0 ? subtotal : undefined,
                      derivedCgstRate: dCgst,
                      derivedSgstRate: dSgst,
                      status: po.Status,
                      date: po.PODate,
                      gst: po.GST ?? null,
                    });
                  }}
                />
              );
            })
          )
        ) : tab === "GRN" ? (
          <>
            {loadingGRN ? (
              <div className="flex items-center justify-center py-10 gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Loading GRNs…
              </div>
            ) : filteredGRN.length === 0 ? (
              <EmptyState label="No GRNs found" />
            ) : (
              filteredGRN.map((g) => {
                const parsedItems: GRNItemLine[] = (() => {
                  try {
                    if (Array.isArray(g.GRNItems))
                      return g.GRNItems as GRNItemLine[];
                    if (typeof g.GRNItems === "string" && g.GRNItems.trim()) {
                      const parsed = JSON.parse(g.GRNItems);
                      return Array.isArray(parsed) ? parsed : [];
                    }
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Something went wrong",
                    );
                    /* ignore */
                  }
                  return [];
                })();
                const totalReceived = round3(
                  parsedItems.reduce(
                    (s, i) => s + (Number(i.receivedQty) || 0),
                    0,
                  ),
                );
                const totalRemaining = round3(
                  parsedItems.reduce(
                    (s, i) => s + (Number(i.remainingQty) || 0),
                    0,
                  ),
                );
                return (
                  <button
                    key={g.GRNID}
                    onClick={() =>
                      onSelect({
                        kind: "GRN",
                        docNo: g.DocNo || g.GRNNo || "",
                        sourceId: g.GRNID,
                        vendorLabel: g.SupplierName,
                        status: g.Status,
                        date: g.GRNDate,
                        nameLabel:
                          g.Remarks ||
                          g.SupplierName ||
                          g.DocNo ||
                          g.GRNNo ||
                          "GRN Expense",
                        grnItems: parsedItems,
                        projectId: g.ProjectId,
                        companyId: g.CompanyId,
                        gst:
                          typeof g.ParentGST === "string"
                            ? (() => {
                                try {
                                  return JSON.parse(g.ParentGST!);
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error
                                      ? err.message
                                      : "Something went wrong",
                                  );
                                  return null;
                                }
                              })()
                            : (g.ParentGST ?? null),
                      })
                    }
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border/30 last:border-0 text-left group"
                  >
                    <div className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Truck size={12} className="text-teal-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-teal-600 dark:text-teal-400">
                          {g.DocNo || g.GRNNo || "—"}
                        </span>
                        {g.Status && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
                            {g.Status}
                          </span>
                        )}
                        {g.PONumber && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            PO: {g.PONumber}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {[g.SupplierName, g.GRNDate?.slice(0, 10)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {parsedItems.length > 0 && (
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">
                            <Package size={9} />
                            {fmtQty(totalReceived)} received
                          </span>
                          {totalRemaining > 0 && (
                            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-md">
                              <Clock size={9} />
                              {fmtQty(totalRemaining)} pending
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {parsedItems.length}{" "}
                            {parsedItems.length === 1 ? "item" : "items"}
                          </span>
                        </div>
                      )}
                    </div>
                    <ChevronRight
                      size={12}
                      className="text-muted-foreground/30 shrink-0 mt-1"
                    />
                  </button>
                );
              })
            )}
          </>
        ) : filteredTOD.length === 0 ? (
          <EmptyState label="No other expense types found" />
        ) : (
          filteredTOD.map((tod) => (
            <PickerRow
              key={tod.TypeOfDocId}
              icon={<Hash size={12} className="text-emerald-500" />}
              iconBg="bg-emerald-500/10"
              primary={tod.FullPrefix ?? tod.Prefix}
              primaryColor="text-emerald-600 dark:text-emerald-400"
              secondary={tod.Description}
              badge={tod.EntryType}
              onClick={() => selectTod(tod)}
            />
          ))
        )}
      </div>
    </div>
  );
}
