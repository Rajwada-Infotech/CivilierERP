import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { ServerPager } from "@/components/ServerPager";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
import { HR_HEAD, HR_NUM } from "@/components/hrpayroll/HrUi";
import { SheetBox, TH, TD, ICON_ACT, ICON_ACT_RED } from "@/components/maintenance/maintParts";
import {
  Warehouse,
  Search,
  ChevronDown,
  Plus,
  Trash2,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Send,
  IndianRupee,
  Eye,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { StatusBadge } from "@/components/StatusBadge";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { LedgerHeadPicker } from "@/pages/finance/journalVoucher/LedgerHeadPicker";
import { getJournalVoucherLedgerOptions } from "@/api/journalVoucherApi";
import { getItems as getItemMaster } from "@/api/itemMasterApi";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getInventoryMaster } from "@/api/inventoryMasterApi";
import {
  createSaleOrder,
  getSaleOrders,
  deleteSaleOrder,
  getSaleOrderPosting,
  type SaleOrder as SaleOrderDoc,
} from "@/api/saleOrdersApi";

const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const fmtAmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n ?? 0);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const today = new Date().toISOString().slice(0, 10);

interface SOItem {
  itemId: string;
  itemName: string;
  qty: string;
  uom: string;
  rate: string;
  availableQty: number;
  remarks: string;
  /** GST % on the line — defaults from the item's own GST in Item Master, can be changed. */
  gstRate: string;
}

interface AvailableItem {
  itemId: string;
  itemName: string;
  uom: string;
  available: number;
}

const emptyItem = (): SOItem => ({
  itemId: "",
  itemName: "",
  qty: "",
  uom: "",
  rate: "",
  availableQty: 0,
  remarks: "",
  gstRate: "",
});

/** One line's figures: basic (qty × rate), tax, total. */
const lineFigures = (it: { qty: string; rate: string; gstRate: string }) => {
  const basic = (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0);
  const tax = (basic * (parseFloat(it.gstRate) || 0)) / 100;
  return { basic, tax, total: basic + tax };
};

// ─── Sheet styles (docs/DESIGN.md) ────────────────────────────────────────────
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const INPUT =
  "w-full h-9 px-3 border border-foreground/30 bg-card text-sm text-foreground outline-none focus:border-foreground disabled:opacity-50 rounded-none";
const MUTED_BOX =
  "flex items-center gap-2 h-9 px-3 border border-dashed border-foreground/30 text-xs text-muted-foreground";
const CELL =
  "w-full h-9 px-2 border bg-card text-xs text-foreground outline-none focus:border-foreground disabled:opacity-50 rounded-none";

// ─── Generic Select ───────────────────────────────────────────────────────────
function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex-1 space-y-1.5 min-w-0">
      <p className={LBL}>{label}</p>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${INPUT} pr-8 appearance-none`}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
        />
      </div>
    </div>
  );
}

// ─── Resolved Godown Panel ──────────────────────────────────────────────────
function GodownPanel({
  godowns,
  value,
  onChange,
  placeholder,
}: {
  godowns: Godown[];
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
}) {
  if (godowns.length === 0) {
    return (
      <div className={MUTED_BOX}>
        <AlertCircle size={13} className="shrink-0" />
        No godown linked to this project yet
      </div>
    );
  }

  if (godowns.length === 1) {
    const g = godowns[0];
    return (
      <div className="flex items-center gap-2 min-h-9 px-3 py-1.5 border border-foreground/30 bg-foreground/5">
        <Warehouse size={13} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{g.GodownName}</p>
          <p className="text-[0.625rem] text-muted-foreground">{g.GodownCode}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className={`${INPUT} pr-8 appearance-none`}
      >
        <option value="">{placeholder}</option>
        {godowns.map((g) => (
          <option key={g.GodownID} value={g.GodownID}>
            {g.GodownName}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
      />
    </div>
  );
}

// ─── Company + Project + Godown side panel ──────────────────────────────────
function SidePanel({
  title,
  companyOptions,
  companyId,
  onCompanyChange,
  projectOptions,
  projectId,
  onProjectChange,
  godowns,
  godownId,
  onGodownChange,
}: {
  title: string;
  companyOptions: { value: string; label: string }[];
  companyId: string;
  onCompanyChange: (v: string) => void;
  projectOptions: { value: string; label: string }[];
  projectId: string;
  onProjectChange: (v: string) => void;
  godowns: Godown[];
  godownId: number | null;
  onGodownChange: (v: number | null) => void;
}) {
  return (
    <div className="flex-1 min-w-0 bg-card border border-foreground p-4 space-y-3">
      <p className={HR_HEAD}>{title}</p>
      <SelectField
        label="Company"
        value={companyId}
        onChange={onCompanyChange}
        options={companyOptions}
        placeholder="Select company…"
      />
      <SelectField
        label="Project"
        value={projectId}
        onChange={onProjectChange}
        options={projectOptions}
        placeholder={companyId ? "Select project…" : "Select company first"}
        disabled={!companyId}
      />
      <div className="space-y-1.5">
        <p className={LBL}>Godown</p>
        {projectId ? (
          <GodownPanel godowns={godowns} value={godownId} onChange={onGodownChange} placeholder="Select godown…" />
        ) : (
          <div className={MUTED_BOX}>Select a project to resolve its godown</div>
        )}
      </div>
    </div>
  );
}

// ─── Item Search Row ──────────────────────────────────────────────────────────
function SOItemRow({
  item,
  idx,
  onUpdate,
  onRemove,
  availableItems,
  isLoadingStock,
  gstOf,
}: {
  item: SOItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<SOItem>) => void;
  onRemove: (idx: number) => void;
  availableItems: AvailableItem[];
  isLoadingStock: boolean;
  gstOf: (itemId: string) => number;
}) {
  const [search, setSearch] = useState(item.itemName || "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return availableItems;
    const q = search.toLowerCase();
    return availableItems
      .filter((a) => a.itemName.toLowerCase().includes(q))
      .slice(0, 12);
  }, [search, availableItems]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectItem = (a: AvailableItem) => {
    onUpdate(idx, {
      itemId: a.itemId,
      itemName: a.itemName,
      uom: a.uom,
      availableQty: a.available,
      gstRate: String(gstOf(a.itemId)),
    });
    setSearch(a.itemName);
    setOpen(false);
  };

  const qtyNum = parseFloat(item.qty) || 0;
  const { total: amount } = lineFigures(item);
  const overLimit = qtyNum > item.availableQty && item.availableQty > 0;

  return (
    <div
      className={`p-3 border space-y-2 transition-colors ${
        overLimit ? "border-destructive bg-destructive/5" : "border-foreground/20"
      }`}
    >
      <div className="grid grid-cols-12 gap-2 items-start">
        {/* # */}
        <div className={`col-span-1 flex items-center h-9 text-xs text-muted-foreground ${HR_NUM}`}>
          {idx + 1}
        </div>

        {/* Item search */}
        <div className="col-span-3 relative" ref={containerRef}>
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
                if (!e.target.value) {
                  onUpdate(idx, {
                    itemId: "",
                    itemName: "",
                    uom: "",
                    availableQty: 0,
                  });
                }
              }}
              onFocus={() => setOpen(true)}
              placeholder={isLoadingStock ? "Loading items…" : "Search item…"}
              disabled={isLoadingStock}
              className={`${CELL} pl-8 border-foreground/30`}
            />
          </div>

          {open && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 border border-foreground bg-card overflow-hidden">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                  {search.trim() ? `No items match "${search}"` : "No items in stock"}
                </div>
              ) : (
                <div className="max-h-52 overflow-y-auto">
                  {filtered.map((a) => (
                    <button
                      key={a.itemId}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectItem(a);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-primary/10 text-left transition-colors border-b border-foreground/10 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{a.itemName}</p>
                        <p className="text-[0.625rem] text-muted-foreground mt-0.5">{a.uom}</p>
                      </div>
                      <span
                        className={`text-[0.625rem] font-semibold shrink-0 ml-2 ${HR_NUM} ${
                          a.available > 0 ? "text-primary" : "text-destructive"
                        }`}
                      >
                        {fmtNum(a.available)} {a.uom}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Available */}
        <div className="col-span-1 flex items-center h-9">
          {item.itemId && (
            <span className={`text-xs font-semibold text-primary whitespace-nowrap ${HR_NUM}`}>
              {fmtNum(item.availableQty)}
            </span>
          )}
        </div>

        {/* Qty */}
        <div className="col-span-1">
          <input
            type="number"
            min="0.01"
            step="any"
            value={item.qty}
            onChange={(e) => onUpdate(idx, { qty: e.target.value })}
            placeholder="Qty"
            disabled={!item.itemId}
            className={`${CELL} ${HR_NUM} ${overLimit ? "border-destructive" : "border-foreground/30"}`}
          />
          {overLimit && (
            <p className={`text-[0.625rem] text-destructive mt-0.5 whitespace-nowrap ${HR_NUM}`}>
              Max: {fmtNum(item.availableQty)}
            </p>
          )}
        </div>

        {/* UOM */}
        <div className="col-span-1">
          <input
            value={item.uom}
            readOnly
            placeholder="UOM"
            className={`${CELL} border-foreground/20 bg-foreground/5 text-muted-foreground`}
          />
        </div>

        {/* Rate */}
        <div className="col-span-1 relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            <IndianRupee size={11} />
          </span>
          <input
            type="number"
            min="0"
            step="any"
            value={item.rate}
            onChange={(e) => onUpdate(idx, { rate: e.target.value })}
            placeholder="Rate"
            disabled={!item.itemId}
            className={`${CELL} pl-6 border-foreground/30 ${HR_NUM}`}
          />
        </div>

        {/* GST % */}
        <div className="col-span-1">
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            value={item.gstRate}
            onChange={(e) => onUpdate(idx, { gstRate: e.target.value })}
            placeholder="GST %"
            disabled={!item.itemId}
            className={`${CELL} border-foreground/30 ${HR_NUM}`}
          />
        </div>

        {/* Amount (incl. GST) */}
        <div className="col-span-2 flex items-center h-9">
          <span className={`text-xs font-semibold text-foreground truncate ${HR_NUM}`}>
            {item.itemId ? fmtAmt(amount) : "—"}
          </span>
        </div>

        {/* Remove */}
        <div className="col-span-1 flex items-center h-9 justify-end">
          <button onClick={() => onRemove(idx)} className={ICON_ACT_RED} title="Remove item">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

    </div>
  );
}

// ─── Posting: the ledger entry for a sale ────────────────────────────────────
function SaleOrderPostingPanel({ id }: { id: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sale-order-posting", id],
    queryFn: () => getSaleOrderPosting(id),
    staleTime: 30_000,
  });
  const note =
    data?.state === "posted"
      ? `Posted on approval${data.voucherDate ? ` · ${fmtDate(data.voucherDate)}` : ""}`
      : data?.state === "preview"
        ? "Not posted yet — this is what final approval will post"
        : data?.state === "rejected"
          ? "Rejected — nothing was posted"
          : null;
  const debit = (data?.rows ?? []).filter((r) => r.side === "debit").reduce((s, r) => s + r.amount, 0);
  const credit = (data?.rows ?? []).filter((r) => r.side === "credit").reduce((s, r) => s + r.amount, 0);
  const GRID = "grid grid-cols-[minmax(0,2.5fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] gap-2 px-4";

  return (
    <div className="p-5 sm:p-6 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className={HR_HEAD}>Journal entry{data?.voucherNo ? ` · ${data.voucherNo}` : ""}</p>
        {note && <span className="text-[0.6875rem] text-muted-foreground">{note}</span>}
      </div>
      {isLoading ? (
        <div className="border border-dashed border-foreground/40 py-10 text-center text-xs text-muted-foreground">Loading posting…</div>
      ) : error ? (
        <div className="border border-destructive/40 py-6 text-center text-xs text-destructive">{(error as Error).message}</div>
      ) : data?.state === "none" ? (
        <div className="border border-dashed border-foreground/40 py-10 text-center text-xs text-muted-foreground">{data.reason}</div>
      ) : (
        <div className={`bg-card border border-foreground ${data?.state === "posted" ? "" : "opacity-80"}`}>
          <div className={`${GRID} py-2.5 border-b border-foreground ${LBL}`}>
            <span>Account</span>
            <span className="text-right">Debit (₹)</span>
            <span className="text-right">Credit (₹)</span>
          </div>
          {(data?.rows ?? []).map((r, i) => (
            <div key={i} className={`${GRID} py-3 border-b border-foreground/15 last:border-0 items-center`}>
              <span className="text-xs text-foreground truncate">{r.label}</span>
              <span className={`text-xs text-right text-foreground ${HR_NUM}`}>{r.side === "debit" ? fmtAmt(r.amount) : ""}</span>
              <span className={`text-xs text-right text-foreground ${HR_NUM}`}>{r.side === "credit" ? fmtAmt(r.amount) : ""}</span>
            </div>
          ))}
          <div className={`${GRID} py-3 border-t-2 border-foreground text-xs font-bold`}>
            <span className={LBL}>Total</span>
            <span className={`text-right ${HR_NUM}`}>{fmtAmt(debit)}</span>
            <span className={`text-right ${HR_NUM}`}>{fmtAmt(credit)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sale Order History ──────────────────────────────────────────────────────
function SaleOrderHistory() {
  const rights = usePageRights("sale-order");
  const queryClient = useQueryClient();
  // Server-paged: one page of orders per request (newest first), however many exist.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sale-orders", "history", page, pageSize],
    queryFn: () => getSaleOrders({ page, limit: pageSize }),
    staleTime: 60_000,
    placeholderData: keepPreviousData, // keep the current rows on screen while the next page loads
  });
  const orders: SaleOrderDoc[] = data?.data ?? [];
  const total = Number(data?.total ?? 0);
  // A page past the end (rows removed since it was opened, e.g. the last one on it deleted) comes back empty.
  useEffect(() => {
    if (!isFetching && page > 1 && data && orders.length === 0) setPage(1);
  }, [isFetching, page, data, orders.length]);
  const [viewingOrder, setViewingOrderRaw] = useState<SaleOrderDoc | null>(null);
  const [viewTab, setViewTab] = useState<"details" | "posting">("details");
  const setViewingOrder = (o: SaleOrderDoc | null) => {
    setViewTab("details");
    setViewingOrderRaw(o);
  };

  // One request for every visible row's approval trail instead of one per
  // row — see useApprovalTrailsBulk's own comment.
  const { trails: soApprovalTrails, isLoading: soApprovalTrailsLoading } = useApprovalTrailsBulk(
    "SaleOrders",
    orders.map((o) => o.SaleOrderID),
  );

  const deleteMutation = useMutation({
    mutationFn: deleteSaleOrder,
    onSuccess: () => {
      toast.success("Sale order deleted");
      queryClient.invalidateQueries({ queryKey: ["sale-orders"] });
    },
    onError: (err: any) =>
      toast.error(err?.message || "Failed to delete sale order"),
  });

  const handleDelete = (order: SaleOrderDoc) => {
    if (confirm(`Delete sale order ${order.DocNo}? This cannot be undone.`))
      deleteMutation.mutate(order.SaleOrderID);
  };

  return (
    <SheetBox
      title="Sale orders"
      note={total ? `${fmtNum(total)} orders` : undefined}
      flush
      action={
        <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-8 px-3`}>
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      }
    >
      <p className="px-4 pt-3 text-xs text-muted-foreground">Materials sold from our godowns to buyers</p>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {["Doc No", "Date", "From", "Buyer", "Items", "Amount", "Status", "By", ""].map((h) => (
                <th key={h} className={`${TH} ${h === "Amount" ? "text-right" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className={TD}>
                      <div className="h-3 bg-foreground/10 animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  No sale orders yet.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.SaleOrderID} className="hover:bg-primary/5 transition-colors">
                  <td className={`${TD} ${HR_NUM} font-semibold text-foreground whitespace-nowrap`}>{o.DocNo}</td>
                  <td className={`${TD} ${HR_NUM} text-muted-foreground whitespace-nowrap`}>{fmtDate(o.OrderDate)}</td>
                  <td className={TD}>
                    <span className="block text-xs font-semibold text-foreground">{o.FromCompanyName}</span>
                    <span className="block text-[0.625rem] text-muted-foreground">
                      {o.FromProjectName} · {o.FromGodownName}
                    </span>
                  </td>
                  <td className={TD}>
                    {o.BuyerName ? (
                      <span className="block text-xs font-semibold text-foreground">{o.BuyerName}</span>
                    ) : (
                      // An older transfer order: it went to another of our projects.
                      <>
                        <span className="block text-xs font-semibold text-foreground">{o.ToCompanyName || "—"}</span>
                        <span className="block text-[0.625rem] text-muted-foreground">
                          Transfer · {o.ToProjectName} · {o.ToGodownName}
                        </span>
                      </>
                    )}
                  </td>
                  <td className={`${TD} ${HR_NUM} text-muted-foreground whitespace-nowrap`}>
                    {o.SaleItems.length} item{o.SaleItems.length !== 1 ? "s" : ""}
                  </td>
                  <td className={`${TD} ${HR_NUM} font-semibold text-foreground whitespace-nowrap text-right`}>
                    {fmtAmt(o.TotalAmount)}
                  </td>
                  <td className={TD}>
                    <ApprovalStatusChain
                      table="SaleOrders"
                      recordId={o.SaleOrderID}
                      compact
                      fallback={<StatusBadge status={o.Status} />}
                      preloaded={soApprovalTrails.get(String(o.SaleOrderID)) ?? null}
                      preloadedLoading={soApprovalTrailsLoading}
                    />
                  </td>
                  <td className={`${TD} text-muted-foreground truncate max-w-[120px]`}>
                    {o.CreatedBy?.split("@")[0] || "—"}
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-1">
                      <button data-row-view onClick={() => setViewingOrder(o)} className={ICON_ACT} title="View">
                        <Eye size={14} />
                      </button>
                      {rights.canDelete && (
                        <button
                          onClick={() => handleDelete(o)}
                          disabled={deleteMutation.isPending}
                          className={ICON_ACT_RED}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ServerPager page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/*  VIEW / PRINT MODAL                                                */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {viewingOrder && createPortal(
        <div className="fixed inset-0 z-[70] flex items-stretch sm:items-center justify-center bg-foreground/40 p-0 sm:p-4">
          <style>{`
            @media print {
              body * { visibility: hidden; }
              .so-print-modal, .so-print-modal * { visibility: visible; }
              .so-print-modal {
                position: absolute !important;
                inset: 0 !important;
                margin: 0 !important;
                width: 100% !important;
                max-width: none !important;
                max-height: none !important;
                overflow: visible !important;
                box-shadow: none !important;
                border: none !important;
                border-radius: 0 !important;
                background: white !important;
              }
              .so-print-modal .sticky { position: static !important; }
            }
          `}</style>
          <div
            role="dialog"
            className="so-print-modal bg-card border border-foreground w-full max-w-3xl h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[88vh] overflow-y-auto"
          >
            {/* Modal header */}
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-foreground">
              <div>
                <p className={LBL}>Sale Order</p>
                <h2 className={`font-heading font-bold text-lg tracking-tight mt-0.5 ${HR_NUM}`}>{viewingOrder.DocNo}</h2>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                {rights.canPrint && (
                  <button onClick={() => window.print()} title="Print Sale Order" className={`${KEY_LINE} h-8 px-3`}>
                    <Printer size={12} /> Print
                  </button>
                )}
                <button onClick={() => setViewingOrder(null)} className={ICON_ACT} title="Close">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Details | Posting */}
            <div className="flex border-b border-foreground print:hidden">
              {(["details", "posting"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setViewTab(t)}
                  aria-pressed={viewTab === t}
                  className={`h-9 px-5 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] border-r border-foreground/20 ${
                    viewTab === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "details" ? "Details" : "Posting"}
                </button>
              ))}
            </div>

            {viewTab === "posting" ? (
              <SaleOrderPostingPanel id={viewingOrder.SaleOrderID} />
            ) : (
            <div className="p-5 sm:p-6 space-y-6">
              {/* Meta grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 border-t border-l border-foreground/20">
                {[
                  { label: "Doc No", value: viewingOrder.DocNo, num: true },
                  { label: "Date", value: fmtDate(viewingOrder.OrderDate), num: true },
                  { label: "Created By", value: viewingOrder.CreatedBy?.split("@")[0] || "—" },
                  {
                    label: "From",
                    value: `${viewingOrder.FromCompanyName} · ${viewingOrder.FromProjectName} · ${viewingOrder.FromGodownName}`,
                  },
                  viewingOrder.BuyerName
                    ? { label: "Buyer", value: viewingOrder.BuyerName }
                    : {
                        label: "To (transfer)",
                        value: `${viewingOrder.ToCompanyName} · ${viewingOrder.ToProjectName} · ${viewingOrder.ToGodownName}`,
                      },
                  { label: "Stock taken out", value: viewingOrder.PostedToStock ? "Yes" : "Not yet" },
                  ...(viewingOrder.BuyerName ? [{ label: "Posted to ledger", value: viewingOrder.GLPosted ? "Yes" : "Not yet" }] : []),
                ].map(({ label, value, num }) => (
                  <div key={label} className="px-3 py-2.5 border-r border-b border-foreground/20 min-w-0">
                    <p className={`${LBL} mb-0.5`}>{label}</p>
                    <p className={`text-xs font-semibold text-foreground break-words ${num ? HR_NUM : ""}`}>{value}</p>
                  </div>
                ))}
                <div className="px-3 py-2.5 border-r border-b border-foreground/20">
                  <p className={`${LBL} mb-0.5`}>Status</p>
                  <ApprovalStatusChain
                    table="SaleOrders"
                    recordId={viewingOrder.SaleOrderID}
                    compact
                    fallback={<StatusBadge status={viewingOrder.Status} />}
                  />
                </div>
              </div>

              {/* Items */}
              <div>
                <p className={`${HR_HEAD} mb-3`}>Items</p>
                <div className="overflow-x-auto border border-foreground/20">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        {["Item", "Qty", "UOM", "Rate", "GST %", "Amount"].map((h) => (
                          <th key={h} className={`${TH} ${["Qty", "Rate", "GST %", "Amount"].includes(h) ? "text-right" : ""}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {viewingOrder.SaleItems.map((it, i) => (
                        <tr key={i}>
                          <td className={`${TD} font-medium`}>{it.itemName || it.itemId}</td>
                          <td className={`${TD} ${HR_NUM} text-right`}>{fmtNum(it.qty)}</td>
                          <td className={TD}>{it.uom || "—"}</td>
                          <td className={`${TD} ${HR_NUM} text-right`}>{it.rate ? fmtAmt(it.rate) : "—"}</td>
                          <td className={`${TD} ${HR_NUM} text-right`}>{it.gstRate != null ? `${fmtNum(it.gstRate)}%` : "—"}</td>
                          <td className={`${TD} ${HR_NUM} text-right font-semibold`}>
                            {fmtAmt(it.total ?? it.amount ?? it.qty * it.rate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Total + Remarks */}
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pt-3 border-t border-foreground">
                {viewingOrder.Remarks && (
                  <div className="text-xs">
                    <p className={`${LBL} mb-0.5`}>Remarks</p>
                    <p className="text-muted-foreground">{viewingOrder.Remarks}</p>
                  </div>
                )}
                <div className="text-right sm:ml-auto space-y-1">
                  {viewingOrder.BasicAmount != null && (
                    <>
                      <p className={`text-xs text-muted-foreground ${HR_NUM}`}>Basic {fmtAmt(viewingOrder.BasicAmount)}</p>
                      <p className={`text-xs text-muted-foreground ${HR_NUM}`}>GST {fmtAmt(viewingOrder.TaxAmount ?? 0)}</p>
                    </>
                  )}
                  <p className={`${LBL} mb-0.5`}>Total Amount</p>
                  <p className={`text-xl font-bold text-foreground ${HR_NUM}`}>{fmtAmt(viewingOrder.TotalAmount)}</p>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </SheetBox>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SaleOrder() {
  const rights = usePageRights("sale-order");
  const qc = useQueryClient();


  const [fromCompanyId, setFromCompanyId] = useState("");
  const [fromProjectId, setFromProjectId] = useState("");
  const [fromGodownId, setFromGodownId] = useState<number | null>(null);

  const [buyerId, setBuyerId] = useState<number | null>(null);

  const [items, setItems] = useState<SOItem[]>([emptyItem()]);
  const [remarks, setRemarks] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  });
  const allGodowns: Godown[] = godownsData?.data ?? [];

  const { data: companiesData } = useQuery({
    queryKey: ["enterprise-options", "C"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
    staleTime: 120_000,
  });
  const companyOptions = (companiesData ?? []).map((e) => ({
    value: String(e.id),
    label: e.label,
  }));

  const { data: projectsData } = useQuery({
    queryKey: ["enterprise-options", "P"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 120_000,
  });
  const allProjects: {
    id: number;
    label: string;
    company_id: number | null;
  }[] = projectsData ?? [];

  const fromProjectOptions = useMemo(
    () =>
      allProjects
        .filter((p) => String(p.company_id ?? "") === fromCompanyId)
        .map((p) => ({ value: String(p.id), label: p.label })),
    [allProjects, fromCompanyId],
  );

  // The buyer: any ledger — the Journal Voucher's list.
  const { data: ledgerOptions = [] } = useQuery({
    queryKey: ["jv-ledger-options"],
    queryFn: getJournalVoucherLedgerOptions,
    staleTime: 120_000,
  });

  // Each item's GST % from Item Master, the default for a new line.
  const { data: itemMaster = [] } = useQuery({ queryKey: ["item-master-all"], queryFn: getItemMaster, staleTime: 300_000 });
  const gstOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of itemMaster as any[]) {
      const igst = Number(i.M_IGST) || 0;
      m.set(String(i.M_Id).toLowerCase(), igst || (Number(i.M_CGST) || 0) + (Number(i.M_SGST) || 0));
    }
    return (itemId: string) => m.get(String(itemId).toLowerCase()) ?? 0;
  }, [itemMaster]);

  const fromProjectGodowns = useMemo(
    () => allGodowns.filter((g) => String(g.ProjectID ?? "") === fromProjectId),
    [allGodowns, fromProjectId],
  );

  // Auto-resolve the godown once a project has exactly one linked godown.
  useEffect(() => {
    if (fromProjectGodowns.length === 1) {
      setFromGodownId(fromProjectGodowns[0].GodownID);
    } else {
      setFromGodownId(null);
    }
    setItems([emptyItem()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromProjectId]);


  const { data: fromStockData, isLoading: isLoadingStock } = useQuery({
    queryKey: ["inventory-master", today, fromGodownId],
    queryFn: () => getInventoryMaster(today, fromGodownId!),
    staleTime: 60_000,
    enabled: !!fromGodownId,
  });

  const availableItems: AvailableItem[] = useMemo(
    () =>
      (fromStockData?.data ?? [])
        .filter((r) => r.ClosingStock > 0)
        .map((r) => ({
          itemId: r.ItemID,
          itemName: r.ItemName || "",
          uom: r.UOMName || r.UOMCode || "",
          available: r.ClosingStock,
        })),
    [fromStockData],
  );

  const createMut = useMutation({
    mutationFn: createSaleOrder,
    onSuccess: (res) => {
      setSuccessMsg(
        `Sale order ${res.DocNo} created — ${fmtAmt(res.TotalAmount)} total, sent for approval.`,
      );
      setErrorMsg("");
      setFromCompanyId("");
      setFromProjectId("");
      setFromGodownId(null);
      setBuyerId(null);
      setItems([emptyItem()]);
      setRemarks("");
      qc.invalidateQueries({ queryKey: ["inventory-master"] });
      qc.invalidateQueries({ queryKey: ["sale-orders"] });
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const updateItem = (idx: number, patch: Partial<SOItem>) =>
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const totals = useMemo(
    () =>
      items
        .filter((it) => it.itemId)
        .reduce(
          (t, it) => {
            const f = lineFigures(it);
            return { basic: t.basic + f.basic, tax: t.tax + f.tax, total: t.total + f.total };
          },
          { basic: 0, tax: 0, total: 0 },
        ),
    [items],
  );

  const hasOverLimit = items.some(
    (it) =>
      it.itemId && it.availableQty > 0 && parseFloat(it.qty) > it.availableQty,
  );
  const hasValidItem = items.some(
    (it) => it.itemId && parseFloat(it.qty) > 0 && parseFloat(it.rate) > 0,
  );
  const missingRate = items.some(
    (it) => it.itemId && parseFloat(it.qty) > 0 && !(parseFloat(it.rate) > 0),
  );

  const canSubmit =
    !!fromGodownId &&
    !!buyerId &&
    hasValidItem &&
    !hasOverLimit &&
    !createMut.isPending;

  const handleSubmit = () => {
    setErrorMsg("");
    const validItems = items
      .filter((it) => it.itemId && parseFloat(it.qty) > 0)
      .map((it) => ({
        itemId: it.itemId,
        itemName: it.itemName,
        qty: parseFloat(it.qty),
        uom: it.uom,
        rate: parseFloat(it.rate) || 0,
        gstRate: parseFloat(it.gstRate) || 0,
        remarks: it.remarks,
      }));
    createMut.mutate({
      FromCompanyID: parseInt(fromCompanyId),
      FromProjectID: parseInt(fromProjectId),
      FromGodownID: fromGodownId!,
      BuyerLHeadId: buyerId!,
      SaleItems: validItems,
      Remarks: remarks,
    });
  };

  const handleReset = () => {
    setFromCompanyId("");
    setFromProjectId("");
    setFromGodownId(null);
    setBuyerId(null);
    setItems([emptyItem()]);
    setRemarks("");
    setErrorMsg("");
  };


  // Columns of the items grid header (same spans as SOItemRow).
  const ITEM_HEAD: [string, string][] = [
    ["#", "col-span-1"],
    ["Item", "col-span-3"],
    ["Avail", "col-span-1"],
    ["Qty", "col-span-1"],
    ["UOM", "col-span-1"],
    ["Rate", "col-span-1"],
    ["GST %", "col-span-1"],
    ["Amount", "col-span-2"],
    ["", "col-span-1"],
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Module", "Sale Order"]} />

      <SheetShell
        eyebrow="CivilierERP · Sales"
        title="Sale Order"
        subtitle="Sell our materials from a project godown to a buyer"
      >
        {/* The new-order form on top (for those who may create), the order list below it. */}
        {rights.canCreate && (
          <div className="space-y-4">
            {successMsg && (
              <div className="px-4 py-3 bg-primary/10 text-primary border border-primary/30 flex items-center gap-2 text-sm">
                <CheckCircle2 size={15} /> {successMsg}
                <button onClick={() => setSuccessMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}
            {errorMsg && (
              <div className="px-4 py-3 bg-destructive/10 text-destructive border border-destructive/30 flex items-center gap-2 text-sm">
                <AlertCircle size={15} /> {errorMsg}
                <button onClick={() => setErrorMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* ── From / To panels ─────────────────────────────────────────────── */}
            <div className="flex flex-col lg:flex-row items-stretch gap-3">
              <SidePanel
                title="Sold from"
                companyOptions={companyOptions}
                companyId={fromCompanyId}
                onCompanyChange={(v) => {
                  setFromCompanyId(v);
                  setFromProjectId("");
                  setFromGodownId(null);
                  setItems([emptyItem()]);
                }}
                projectOptions={fromProjectOptions}
                projectId={fromProjectId}
                onProjectChange={setFromProjectId}
                godowns={fromProjectGodowns}
                godownId={fromGodownId}
                onGodownChange={setFromGodownId}
              />

              <div className="flex-1 min-w-0 bg-card border border-foreground p-4 space-y-3">
                <p className={HR_HEAD}>Buyer</p>
                <div className="space-y-1.5">
                  <p className={LBL}>Sold to</p>
                  <LedgerHeadPicker value={buyerId} options={ledgerOptions} onChange={setBuyerId} />
                </div>
                <p className="text-[0.6875rem] text-muted-foreground">
                  Any ledger — a customer, a supplier, a project or a person. On approval the stock goes out of the godown and the
                  sale is posted: the buyer is debited, and the selling company's own sales ledger and GST Output are credited.
                </p>
              </div>
            </div>

            {/* ── Items Table ───────────────────────────────────────────────────── */}
            {fromGodownId && (
              <SheetBox
                title="Items & Rate"
                note={
                  isLoadingStock ? (
                    <span className="inline-flex items-center gap-1">
                      <RefreshCw size={11} className="animate-spin" /> Loading stock…
                    </span>
                  ) : fromStockData ? (
                    `${availableItems.length} items in stock`
                  ) : undefined
                }
                flush
                action={
                  <button onClick={addItem} className={`${KEY_INK} h-8 px-3`}>
                    <Plus size={12} /> Add Item
                  </button>
                }
              >
                <div className="p-4 space-y-2">
                  <p className="text-xs text-muted-foreground mb-2">
                    Search items in stock in this godown, then set the rate and GST %
                  </p>
                  <div className="grid grid-cols-12 gap-2 px-3 mb-1">
                    {ITEM_HEAD.map(([h, span], i) => (
                      <span key={i} className={`${LBL} ${span}`}>
                        {h}
                      </span>
                    ))}
                  </div>

                  {items.map((it, idx) => (
                    <SOItemRow
                      key={idx}
                      item={it}
                      idx={idx}
                      onUpdate={updateItem}
                      onRemove={removeItem}
                      availableItems={availableItems}
                      isLoadingStock={isLoadingStock}
                      gstOf={gstOf}
                    />
                  ))}

                  {missingRate && (
                    <p className="text-[0.6875rem] text-destructive flex items-center gap-1 px-1">
                      <AlertCircle size={11} /> Set a rate greater than 0 for every item before submitting.
                    </p>
                  )}
                </div>

                <div className="px-4 py-4 border-t border-foreground space-y-3">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-baseline gap-3">
                      <span className={LBL}>Basic</span>
                      <span className={`text-sm text-foreground ${HR_NUM}`}>{fmtAmt(totals.basic)}</span>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <span className={LBL}>GST</span>
                      <span className={`text-sm text-foreground ${HR_NUM}`}>{fmtAmt(totals.tax)}</span>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <span className={LBL}>Total amount</span>
                      <span className={`text-lg font-bold text-foreground ${HR_NUM}`}>{fmtAmt(totals.total)}</span>
                    </div>
                  </div>
                  <div>
                    <label className={`${LBL} block mb-1.5`}>Remarks</label>
                    <textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={2}
                      placeholder="Reason for sale, reference, etc."
                      className="w-full px-3 py-2 border border-foreground/30 bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:border-foreground rounded-none"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={handleReset} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>
                      Reset
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}
                    >
                      {createMut.isPending ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" /> Processing…
                        </>
                      ) : (
                        <>
                          <Send size={13} /> Create Sale Order
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </SheetBox>
            )}

            {!fromGodownId && (
              <div className="border border-dashed border-foreground/30 py-16 text-center">
                <p className="text-sm text-foreground">Select the company, project and godown you are selling from</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Then pick the buyer and add items with a rate and GST %
                </p>
              </div>
            )}
          </div>
        )}

        <div className={rights.canCreate ? "mt-6" : ""}>
          <SaleOrderHistory />
        </div>
      </SheetShell>
    </>
  );
}
