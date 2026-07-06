import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  ArrowRight,
  Warehouse,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  X,
  ClipboardList,
  Send,
  ArrowLeftRight,
  Search,
  Building2,
  FolderKanban,
  Package,
  ChevronDown,
  FileText,
  Eye,
} from "lucide-react";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getInventoryMaster } from "@/api/inventoryMasterApi";
import {
  createStockTransfer,
  getStockTransfers,
  type StockTransfer,
} from "@/api/stockTransferApi";
import {
  createInterCompanyTransfer,
  getInterCompanyTransfers,
  getInterCompanyTransfer,
  type InterCompanyTransferSummary,
} from "@/api/interCompanyTransferApi";
import {
  createGRNFromTransfer,
  getGRNsByTransfer,
  type TransferGRNSummary,
} from "@/api/grnApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { MaterialShell } from "@/components/material/MaterialShell";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { usePageRights } from "@/hooks/usePageRights";

const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });


interface TItem {
  itemId: string;
  itemName: string;
  qty: string;
  uom: string;
  availableQty: number;
  remarks: string;
}

interface AvailableItem {
  itemId: string;
  itemName: string;
  uom: string;
  available: number;
}

const emptyItem = (): TItem => ({
  itemId: "",
  itemName: "",
  qty: "",
  uom: "",
  availableQty: 0,
  remarks: "",
});

// ─── Filter Select ────────────────────────────────────────────────────────────
function FilterSelect({
  icon: Icon,
  label,
  value,
  onChange,
  options,
  placeholder,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  color: "emerald" | "violet";
}) {
  const c =
    color === "emerald"
      ? {
          border: "border-emerald-400/40 focus:border-emerald-500/60",
          bg: "bg-emerald-500/[0.05]",
          icon: "text-emerald-500",
          label: "text-emerald-600 dark:text-emerald-400",
        }
      : {
          border: "border-violet-400/40 focus:border-violet-500/60",
          bg: "bg-violet-500/5",
          icon: "text-violet-500",
          label: "text-violet-600 dark:text-violet-400",
        };

  return (
    <div className="flex-1 space-y-1.5">
      <p
        className={`text-xs font-semibold uppercase tracking-wider ${c.label}`}
      >
        {label}
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
          <Icon size={14} className={c.icon} />
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full pl-9 pr-8 py-2.5 rounded-xl border-2 text-sm text-foreground outline-none appearance-none transition-colors ${c.border} ${c.bg}`}
          style={{ colorScheme: "dark" }}
        >
          <option value="" className="bg-popover text-foreground">
            {placeholder}
          </option>
          {options.map((o) => (
            <option
              key={o.value}
              value={o.value}
              className="bg-popover text-foreground"
            >
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

// ─── Godown Select ────────────────────────────────────────────────────────────
function GodownSelect({
  label,
  value,
  onChange,
  godowns,
  exclude,
  variant,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  godowns: Godown[];
  exclude?: number | null;
  variant: "from" | "to";
  placeholder: string;
}) {
  const isFrom = variant === "from";
  const selected = godowns.find((g) => g.GodownID === value);

  return (
    <div className="flex-1 space-y-2">
      <p
        className={`text-xs font-semibold uppercase tracking-wider ${
          isFrom
            ? "text-orange-600 dark:text-orange-400"
            : "text-emerald-600 dark:text-emerald-400"
        }`}
      >
        {label}
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
          <Warehouse
            size={14}
            className={isFrom ? "text-orange-500" : "text-emerald-600"}
          />
        </span>
        <select
          value={value != null ? String(value) : ""}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
          className={`w-full pl-9 pr-8 py-2.5 rounded-xl border-2 text-sm text-foreground outline-none appearance-none transition-colors ${
            isFrom
              ? "border-orange-400/40 bg-orange-500/5 focus:border-orange-500/60"
              : "border-emerald-400/40 bg-emerald-500/5 focus:border-emerald-500/60"
          }`}
          style={{ colorScheme: "dark" }}
        >
          <option value="" className="bg-popover text-foreground">
            {placeholder}
          </option>
          {godowns
            .filter((g) => g.GodownID !== exclude)
            .map((g) => (
              <option
                key={g.GodownID}
                value={g.GodownID}
                className="bg-popover text-foreground"
              >
                {g.GodownName}
              </option>
            ))}
        </select>
        <ChevronDown
          size={13}
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
        />
      </div>
      {selected && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
            isFrom
              ? "border-orange-400/30 bg-orange-500/5"
              : "border-emerald-400/30 bg-emerald-500/5"
          }`}
        >
          <Warehouse
            size={12}
            className={
              isFrom ? "text-orange-500 shrink-0" : "text-emerald-600 shrink-0"
            }
          />
          <p
            className={`text-xs font-semibold truncate ${
              isFrom
                ? "text-orange-700 dark:text-orange-400"
                : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {selected.GodownName}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Item Search Row ──────────────────────────────────────────────────────────
function ItemSearchRow({
  item,
  idx,
  onUpdate,
  onRemove,
  availableItems,
  isLoadingStock,
}: {
  item: TItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<TItem>) => void;
  onRemove: (idx: number) => void;
  availableItems: AvailableItem[];
  isLoadingStock: boolean;
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
    });
    setSearch(a.itemName);
    setOpen(false);
  };

  const qtyNum = parseFloat(item.qty) || 0;
  const overLimit = qtyNum > item.availableQty && item.availableQty > 0;

  return (
    <div
      className={`grid grid-cols-12 gap-2 items-start p-3 rounded-xl border transition-colors ${
        overLimit
          ? "border-red-400/40 bg-red-500/5"
          : "border-border bg-muted/20"
      }`}
    >
      {/* # */}
      <div className="col-span-1 flex items-center h-9 text-xs font-mono text-muted-foreground">
        {idx + 1}
      </div>

      {/* Item search */}
      <div className="col-span-5 relative" ref={containerRef}>
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
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 disabled:opacity-60"
          />
        </div>

        {open && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                {search.trim()
                  ? `No items match "${search}"`
                  : "No items in stock"}
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
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/60 text-left transition-colors border-b border-border/40 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {a.itemName}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {a.uom}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ml-2 ${
                        a.available > 0
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-red-500/10 text-red-500"
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

      {/* Available badge */}
      <div className="col-span-1 flex items-center h-9">
        {item.itemId && (
          <span className="text-[10px] text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
            {fmtNum(item.availableQty)}
          </span>
        )}
      </div>

      {/* Qty */}
      <div className="col-span-2">
        <input
          type="number"
          min="0.01"
          step="any"
          value={item.qty}
          onChange={(e) => onUpdate(idx, { qty: e.target.value })}
          placeholder="Qty"
          disabled={!item.itemId}
          className={`w-full px-2 py-2 rounded-lg border text-xs text-foreground bg-background outline-none disabled:opacity-50 ${
            overLimit ? "border-red-400" : "border-border"
          }`}
        />
        {overLimit && (
          <p className="text-[10px] text-red-500 mt-0.5">
            Max: {fmtNum(item.availableQty)}
          </p>
        )}
      </div>

      {/* UOM */}
      <div className="col-span-2">
        <input
          value={item.uom}
          readOnly
          placeholder="UOM"
          className="w-full px-2 py-2 rounded-lg border border-border bg-muted text-xs text-muted-foreground outline-none"
        />
      </div>

      {/* Remove */}
      <div className="col-span-1 flex items-center justify-center h-9">
        <button
          onClick={() => onRemove(idx)}
          className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Make GRN from Transfer Modal ────────────────────────────────────────────
function MakeGRNModal({
  transfer,
  onClose,
  onSuccess,
}: {
  transfer: StockTransfer;
  onClose: () => void;
  onSuccess: (grnNo: string) => void;
}) {
  const [remarks, setRemarks] = useState(
    `Auto-generated from Stock Transfer ${transfer.DocNo}`,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await createGRNFromTransfer(transfer.TransferID, {
        remarks,
      });
      onSuccess(result.grnNo);
    } catch (err: any) {
      setError(err.message || "Failed to create GRN");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10">
              <FileText size={16} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Create GRN from Transfer
              </p>
              <p className="text-xs text-muted-foreground">
                Ref: {transfer.DocNo}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Route summary */}
        <div className="px-5 pt-4 flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 border border-orange-400/20">
            <Warehouse size={10} /> {transfer.FromGodownName}
          </span>
          <ArrowRight size={12} className="text-muted-foreground" />
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
            <Warehouse size={10} /> {transfer.ToGodownName}
          </span>
          <span className="ml-auto text-muted-foreground">
            {fmtDate(transfer.TransferDate)}
          </span>
        </div>

        {/* Items preview */}
        <div className="px-5 pt-3 pb-2">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Items ({transfer.TransferItems.length})
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Item
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    Qty
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    UOM
                  </th>
                </tr>
              </thead>
              <tbody>
                {transfer.TransferItems.map((item, i) => (
                  <tr
                    key={i}
                    className="border-b border-border last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-2 text-foreground">
                      {item.itemName || item.itemId}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtNum(item.qty)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {item.uom || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Remarks */}
        <div className="px-5 pb-4">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Remarks
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            className="w-full text-xs rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Info note */}
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg bg-emerald-500/[0.05] border border-emerald-400/20 px-3 py-2.5 text-xs text-emerald-700 dark:text-emerald-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>
            Stock will be credited to <strong>{transfer.ToGodownName}</strong>.
            The GRN is created in Draft/Pending status and follows the normal
            approval workflow.
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2.5 bg-muted/20">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={11} className="animate-spin" /> Creating…
              </>
            ) : (
              <>
                <FileText size={11} /> Create GRN
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function TransferPreviewModal({
  transfer,
  linkedGRNs,
  onClose,
}: {
  transfer: StockTransfer;
  linkedGRNs: TransferGRNSummary[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10">
              <Eye size={16} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {transfer.DocNo}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtDate(transfer.TransferDate)} · by{" "}
                {transfer.CreatedBy?.split("@")[0] || "—"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pt-4 flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 border border-orange-400/20">
            <Warehouse size={10} /> {transfer.FromGodownName}
          </span>
          <ArrowRight size={12} className="text-muted-foreground" />
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
            <Warehouse size={10} /> {transfer.ToGodownName}
          </span>
          <div className="ml-auto">
            <ApprovalStatusChain table="StockTransfers" recordId={transfer.TransferID} />
          </div>
        </div>

        <div className="px-5 pt-3 pb-2">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Items ({transfer.TransferItems.length})
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Qty</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">UOM</th>
                </tr>
              </thead>
              <tbody>
                {transfer.TransferItems.map((item, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 text-foreground">{item.itemName || item.itemId}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtNum(item.qty)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{item.uom || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {transfer.Remarks && (
          <div className="px-5 pb-2">
            <p className="text-xs font-semibold text-muted-foreground mb-1">Remarks</p>
            <p className="text-xs text-foreground bg-muted/30 rounded-lg px-3 py-2">
              {transfer.Remarks}
            </p>
          </div>
        )}

        {linkedGRNs.length > 0 && (
          <div className="px-5 pb-4">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Linked GRN</p>
            <div className="flex flex-wrap gap-1.5">
              {linkedGRNs.map((g) => (
                <span
                  key={g.GRNID}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-violet-500/10 text-violet-600 border border-violet-400/20 font-mono"
                >
                  <FileText size={9} /> {g.GRNNo || g.DocNo}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-border flex justify-end bg-muted/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ICTPreviewModal({
  ictId,
  onClose,
}: {
  ictId: number;
  onClose: () => void;
}) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ["inter-company-transfer", ictId],
    queryFn: () => getInterCompanyTransfer(ictId),
  });

  const DOC_LINKS = detail
    ? [
        { label: "Sale Order", id: detail.SaleOrderId },
        { label: "Sale Invoice", id: detail.SaleInvoiceId },
        { label: "Received Payment", id: detail.ReceivedPaymentId },
        { label: "Purchase Order", id: detail.PurchaseOrderId },
        { label: "GRN", id: detail.GRNId },
        { label: "Expense Booking", id: detail.ExpenseBookingId },
        { label: "Payment Made", id: detail.NewPaymentId },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-teal-500/10">
              <Building2 size={16} className="text-teal-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {detail?.DocNo || "Inter-Company Transfer"}
              </p>
              <p className="text-xs text-muted-foreground">
                {detail ? fmtDate(detail.TransferDate) : ""} · by{" "}
                {detail?.CreatedBy?.split("@")[0] || "—"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {isLoading || !detail ? (
          <div className="px-5 py-10 text-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : (
          <>
            <div className="px-5 pt-4 flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 border border-orange-400/20">
                <Building2 size={10} /> {detail.SenderProjectName} ({detail.SenderCompanyName})
              </span>
              <ArrowRight size={12} className="text-muted-foreground shrink-0" />
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
                <Building2 size={10} /> {detail.ReceiverProjectName} ({detail.ReceiverCompanyName})
              </span>
            </div>

            <div className="px-5 pt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-400/30">
                <CheckCircle2 size={11} />
                {detail.Status === "Completed"
                  ? `${detail.Status} — every step (Sale Invoice, GRN, Expense Booking, Payment) auto-generated via the Dummy Bank, no manual action required.`
                  : detail.Status === "Pending"
                    ? "Pending super_admin approval — the full document chain generates automatically the moment it's approved."
                    : detail.Status === "Rejected"
                      ? "Rejected — no documents were generated."
                      : detail.Status}
              </span>
            </div>

            <div className="px-5 pt-3 pb-2">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Items ({detail.items.length}) — priced at the sender's last purchase rate
              </p>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Qty</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Rate</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.ICTItemId} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-3 py-2 text-foreground">{item.ItemName || item.ItemId}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtNum(item.Quantity)}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtNum(item.Rate)}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtNum(item.Amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-5 pb-4">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                Auto-generated documents
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DOC_LINKS.filter((d) => d.id).map((d) => (
                  <span
                    key={d.label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-violet-500/10 text-violet-600 border border-violet-400/20"
                  >
                    <FileText size={9} /> {d.label} #{d.id}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="px-5 py-3 border-t border-border flex justify-end bg-muted/20">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Transfer History ─────────────────────────────────────────────────────────
function TransferHistory() {
  const rights = usePageRights("stock-transfers");
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["stock-transfers"],
    queryFn: () => getStockTransfers({ limit: 50, page: 1 }),
    staleTime: 60_000,
  });
  const transfers: StockTransfer[] = data?.data ?? [];

  // Inter-company transfers (routed via Dummy Bank) live in a separate
  // table with their own fully auto-generated document chain — merge them
  // into the same history view so a completed inter-company transfer is
  // actually visible here instead of only appearing in the plain
  // StockTransfers list (which never contained it), so completed transfers
  // don't look like nothing happened.
  const { data: ictData, isFetching: isFetchingIct, refetch: refetchIct } = useQuery({
    queryKey: ["inter-company-transfer-list"],
    queryFn: () => getInterCompanyTransfers({}),
    staleTime: 60_000,
  });
  const ictTransfers: InterCompanyTransferSummary[] = ictData?.data ?? [];

  const [grnModalTransfer, setGrnModalTransfer] =
    useState<StockTransfer | null>(null);
  const [previewTransfer, setPreviewTransfer] =
    useState<StockTransfer | null>(null);
  const [previewIctId, setPreviewIctId] = useState<number | null>(null);
  const [successGrnNo, setSuccessGrnNo] = useState<string | null>(null);
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

  const unifiedRows: UnifiedRow[] = [
    ...transfers.map((t): UnifiedRow => ({ kind: "plain", date: t.TransferDate, data: t })),
    ...ictTransfers.map((t): UnifiedRow => ({ kind: "ict", date: t.TransferDate, data: t })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                {["Doc No", "Date", "Route", "Items", "Status", ""].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-left font-semibold text-muted-foreground"
                    >
                      {h}
                    </th>
                  ),
                )}
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
                        className="border-b border-border hover:bg-muted/20 transition-colors bg-teal-500/[0.03]"
                      >
                        <td className="px-3 py-2.5 font-mono text-teal-600 dark:text-teal-400 font-semibold whitespace-nowrap">
                          {t.DocNo}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {fmtDate(t.TransferDate)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 whitespace-nowrap">
                            <span className="text-orange-600 dark:text-orange-400">
                              {t.SenderProjectName}
                            </span>
                            <ArrowRight size={10} className="text-muted-foreground shrink-0" />
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {t.ReceiverProjectName}
                            </span>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] bg-teal-500/10 text-teal-600 border border-teal-400/20 ml-1">
                              Inter-Company
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                          {fmtNum(t.TotalAmount)}
                        </td>
                        <td className="px-3 py-2.5">
                          {t.Status === "Completed" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-400/30">
                              <CheckCircle2 size={10} /> Completed (auto)
                            </span>
                          ) : t.Status === "Pending" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-400/30">
                              Pending approval
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-400/30">
                              {t.Status}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setPreviewIctId(t.ICTId)}
                              title="Preview"
                              className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                            >
                              <Eye size={12} />
                            </button>
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
                      <td className="px-3 py-2.5 font-mono text-emerald-600 dark:text-emerald-400 font-semibold whitespace-nowrap">
                        {t.DocNo}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {fmtDate(t.TransferDate)}
                      </td>
                      <td className="px-3 py-2.5">
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
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {t.TransferItems.length} item
                        {t.TransferItems.length !== 1 ? "s" : ""}
                      </td>
                      <td className="px-3 py-2.5">
                        <ApprovalStatusChain
                          table="StockTransfers"
                          recordId={t.TransferID}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setPreviewTransfer(t)}
                            title="Preview"
                            className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                          >
                            <Eye size={12} />
                          </button>
                          {hasGRN ? (
                            <span
                              title={linkedGRNs.map((g) => g.GRNNo || g.DocNo).join(", ")}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-violet-500/10 text-violet-600 border border-violet-400/20 font-mono whitespace-nowrap"
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
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function StockTransfer() {
  const rights = usePageRights("stock-transfers");
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [activeTab, setActiveTab] = useState<"transfer" | "history">(
    "transfer",
  );
  const [transferMode, setTransferMode] = useState<"intra" | "inter">("intra");
  const [viaBank, setViaBank] = useState(false);
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterProjectId, setFilterProjectId] = useState("");
  const [toCompanyId, setToCompanyId] = useState("");
  const [fromGodownId, setFromGodownId] = useState<number | null>(null);
  const [toGodownId, setToGodownId] = useState<number | null>(null);
  const [items, setItems] = useState<TItem[]>([emptyItem()]);
  const [remarks, setRemarks] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  });
  const allGodowns: Godown[] = godownsData?.data ?? [];

  const { data: enterprisesData } = useQuery({
    queryKey: ["enterprise-options", "C"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
    staleTime: 120_000,
  });

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

  const companyGodowns = useMemo(() => {
    return allGodowns.filter((g) => {
      if (filterCompanyId && String(g.EnterpriseID ?? "") !== filterCompanyId)
        return false;
      return true;
    });
  }, [allGodowns, filterCompanyId]);

  // The dedicated godown auto-created for the selected project (if any).
  const projectGodown = useMemo(() => {
    if (!filterProjectId) return null;
    return (
      companyGodowns.find(
        (g) => String(g.ProjectID ?? "") === filterProjectId,
      ) ?? null
    );
  }, [companyGodowns, filterProjectId]);

  const projectOptions = useMemo(() => {
    if (!filterCompanyId) return allProjects;
    return allProjects.filter(
      (p) => String(p.company_id ?? "") === filterCompanyId,
    );
  }, [allProjects, filterCompanyId]);

  // Auto-fill the source godown with the project's own godown once one is selected.
  useEffect(() => {
    if (projectGodown) {
      setFromGodownId(projectGodown.GodownID);
      setItems([emptyItem()]);
    }
  }, [projectGodown]);

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

  const transferMut = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: (res) => {
      setSuccessMsg(`Transfer ${res.DocNo} completed successfully!`);
      setErrorMsg("");
      setFromGodownId(null);
      setToGodownId(null);
      setItems([emptyItem()]);
      setRemarks("");
      qc.invalidateQueries({ queryKey: ["inventory-master"] });
      qc.invalidateQueries({ queryKey: ["stock-transfers"] });
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  // "Inter-Company" + "Route via Dummy Bank" together mean this transfer
  // crosses a real legal/GST boundary — instead of a plain StockLedger
  // move, generate the full commercial paper trail (Sale Order -> Sale
  // Invoice -> Received Payment on the sending side, Purchase Order -> GRN
  // -> Expense Booking -> Payment on the receiving side), priced at the
  // sender's own last purchase rate. See backend/routes/interCompanyTransfer.js.
  const interTransferMut = useMutation({
    mutationFn: createInterCompanyTransfer,
    onSuccess: (res) => {
      setSuccessMsg(
        `Inter-company transfer ${res.DocNo} submitted for super_admin approval — the full document chain will be generated automatically once approved.`,
      );
      setErrorMsg("");
      setFromGodownId(null);
      setToGodownId(null);
      setItems([emptyItem()]);
      setRemarks("");
      qc.invalidateQueries({ queryKey: ["inventory-master"] });
      qc.invalidateQueries({ queryKey: ["stock-transfers"] });
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const updateItem = (idx: number, patch: Partial<TItem>) =>
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const hasOverLimit = items.some(
    (it) =>
      it.itemId && it.availableQty > 0 && parseFloat(it.qty) > it.availableQty,
  );

  const canTransfer =
    !!fromGodownId &&
    !!toGodownId &&
    (transferMode === "inter" || fromGodownId !== toGodownId) &&
    items.some((it) => it.itemId && parseFloat(it.qty) > 0) &&
    !hasOverLimit &&
    !transferMut.isPending &&
    !interTransferMut.isPending;

  const handleTransfer = () => {
    setErrorMsg("");
    const validItems = items
      .filter((it) => it.itemId && parseFloat(it.qty) > 0)
      .map((it) => ({
        itemId: it.itemId,
        itemName: it.itemName,
        qty: parseFloat(it.qty),
        uom: it.uom,
        remarks: it.remarks,
      }));

    if (transferMode === "inter" && viaBank) {
      const senderProjectId = fromGodown?.ProjectID;
      const receiverProjectId = toGodown?.ProjectID;
      if (!senderProjectId || !receiverProjectId) {
        const missing: string[] = [];
        if (!senderProjectId) missing.push(`source godown "${fromGodown?.GodownName ?? "unknown"}"`);
        if (!receiverProjectId) missing.push(`destination godown "${toGodown?.GodownName ?? "unknown"}"`);
        setErrorMsg(
          `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not linked to a Project. Assign a Project to ${missing.length > 1 ? "them" : "it"} in Godown Admin before routing this transfer via the Dummy Bank.`,
        );
        return;
      }
      interTransferMut.mutate({
        SenderProjectId: senderProjectId,
        ReceiverProjectId: receiverProjectId,
        Remarks: remarks || undefined,
        Items: validItems.map((it) => ({
          itemId: it.itemId,
          itemName: it.itemName,
          uom: it.uom,
          qty: it.qty,
        })),
      });
      return;
    }

    transferMut.mutate({
      FromGodownID: fromGodownId!,
      ToGodownID: toGodownId!,
      TransferItems: validItems,
      Remarks: [
        remarks,
        transferMode === "inter" ? "[Inter-Company]" : "[Intra-Company]",
        viaBank ? "[Via Dummy Bank]" : "",
      ].filter(Boolean).join(" "),
    });
  };

  const handleReset = () => {
    setFromGodownId(null);
    setToGodownId(null);
    setItems([emptyItem()]);
    setRemarks("");
    setErrorMsg("");
  };

  const toCompanyGodowns = useMemo(() => {
    if (transferMode === "intra") return companyGodowns;
    if (!toCompanyId) return allGodowns.filter((g) => g.EnterpriseID != null && String(g.EnterpriseID) !== filterCompanyId);
    return allGodowns.filter((g) => String(g.EnterpriseID ?? "") === toCompanyId);
  }, [allGodowns, transferMode, toCompanyId, filterCompanyId, companyGodowns]);

  const fromGodown =
    companyGodowns.find((g) => g.GodownID === fromGodownId) || null;
  const toGodown =
    (transferMode === "intra" ? companyGodowns : toCompanyGodowns).find((g) => g.GodownID === toGodownId) || null;

  const companyOptions = (enterprisesData ?? []).map((e) => ({
    value: String(e.id),
    label: e.label,
  }));

  const projectSelectOptions = projectOptions.map((p) => ({
    value: String(p.id),
    label: p.label,
  }));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Stock Transfer"]} />

      <MaterialShell
        title="Stock Transfer"
        subtitle="Transfer stock between godowns"
        icon={ArrowLeftRight}
      >
        {/* Tab toggle */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-border w-fit">
          <button
            onClick={() => setActiveTab("transfer")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "transfer"
                ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Send size={14} /> New Transfer
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "history"
                ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <ClipboardList size={14} /> History
          </button>
        </div>

        {activeTab === "history" && <TransferHistory />}

        {activeTab === "transfer" && (
          <div className="space-y-4">
            {successMsg && (
              <div className="px-4 py-3 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-2 text-sm">
                <CheckCircle2 size={15} /> {successMsg}
                <button onClick={() => setSuccessMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}
            {errorMsg && (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-600 border border-red-500/20 flex items-center gap-2 text-sm">
                <AlertCircle size={15} /> {errorMsg}
                <button onClick={() => setErrorMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* ── Transfer Mode Toggle ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-muted border border-border w-fit">
                <button
                  onClick={() => {
                    setTransferMode("intra");
                    setToCompanyId("");
                    setToGodownId(null);
                    setViaBank(false);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    transferMode === "intra"
                      ? "bg-card shadow text-foreground border border-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Intra-Company
                </button>
                <button
                  onClick={() => {
                    setTransferMode("inter");
                    setToGodownId(null);
                    setViaBank(true);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    transferMode === "inter"
                      ? "bg-card shadow text-foreground border border-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Inter-Company
                </button>
              </div>
              {transferMode === "inter" && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    onClick={() => setViaBank((v) => !v)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${viaBank ? "bg-amber-500" : "bg-muted border border-border"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${viaBank ? "translate-x-4" : ""}`} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Route via Dummy Bank{viaBank && <span className="ml-1 text-amber-600 font-medium">(enabled)</span>}
                  </span>
                </label>
              )}
              <span className="text-xs text-muted-foreground/60 sm:ml-auto">
                {transferMode === "intra"
                  ? "Transfer between godowns within the same company"
                  : "Transfer stock between different companies"}
              </span>
            </div>

            {/* ── Filters + Transfer Route ──────────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Filters
                </p>
                <span className="text-[10px] text-muted-foreground/60">
                  — narrow godowns by company or project
                </span>
                {(filterCompanyId || filterProjectId) && (
                  <button
                    onClick={() => {
                      setFilterCompanyId("");
                      setFilterProjectId("");
                      setFromGodownId(null);
                      setToGodownId(null);
                      setItems([emptyItem()]);
                    }}
                    className="ml-auto text-[10px] text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors"
                  >
                    <X size={10} /> Clear filters
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FilterSelect
                  icon={Building2}
                  label="Company"
                  value={filterCompanyId}
                  onChange={(v) => {
                    setFilterCompanyId(v);
                    setFilterProjectId("");
                    setFromGodownId(null);
                    setToGodownId(null);
                    setItems([emptyItem()]);
                  }}
                  options={companyOptions}
                  placeholder="All companies"
                  color="emerald"
                />
                <FilterSelect
                  icon={FolderKanban}
                  label="Project"
                  value={filterProjectId}
                  onChange={(v) => {
                    setFilterProjectId(v);
                    setFromGodownId(null);
                    setToGodownId(null);
                    setItems([emptyItem()]);
                  }}
                  options={projectSelectOptions}
                  placeholder={
                    filterCompanyId ? "All projects in company" : "All projects"
                  }
                  color="violet"
                />
                <GodownSelect
                  label="From"
                  value={fromGodownId}
                  onChange={(v) => {
                    setFromGodownId(v);
                    setItems([emptyItem()]);
                  }}
                  godowns={companyGodowns}
                  exclude={toGodownId}
                  variant="from"
                  placeholder="Select source godown…"
                />
                {transferMode === "inter" && (
                  <FilterSelect
                    icon={Building2}
                    label="To Company"
                    value={toCompanyId}
                    onChange={(v) => { setToCompanyId(v); setToGodownId(null); }}
                    options={companyOptions.filter((o) => o.value !== filterCompanyId)}
                    placeholder="Select destination company"
                    color="emerald"
                  />
                )}
                <GodownSelect
                  label="To"
                  value={toGodownId}
                  onChange={setToGodownId}
                  godowns={toCompanyGodowns}
                  exclude={transferMode === "intra" ? fromGodownId : undefined}
                  variant="to"
                  placeholder="Select destination godown…"
                />
              </div>

              {(filterCompanyId || filterProjectId) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {filterCompanyId && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-emerald-500/10 text-emerald-600 border border-emerald-400/20 font-medium">
                      <Building2 size={10} />
                      {
                        companyOptions.find((o) => o.value === filterCompanyId)
                          ?.label
                      }
                      <button
                        onClick={() => {
                          setFilterCompanyId("");
                          setFilterProjectId("");
                          setFromGodownId(null);
                          setToGodownId(null);
                          setItems([emptyItem()]);
                        }}
                        className="ml-0.5 hover:opacity-70"
                      >
                        <X size={9} />
                      </button>
                    </span>
                  )}
                  {filterProjectId && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-violet-500/10 text-violet-600 border border-violet-400/20 font-medium">
                      <FolderKanban size={10} />
                      {
                        projectSelectOptions.find(
                          (o) => o.value === filterProjectId,
                        )?.label
                      }
                      <button
                        onClick={() => {
                          setFilterProjectId("");
                          setFromGodownId(null);
                          setToGodownId(null);
                          setItems([emptyItem()]);
                        }}
                        className="ml-0.5 hover:opacity-70"
                      >
                        <X size={9} />
                      </button>
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground self-center">
                    {companyGodowns.length} godown
                    {companyGodowns.length !== 1 ? "s" : ""} available
                  </span>
                </div>
              )}

              {fromGodownId && toGodownId && fromGodownId === toGodownId && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> Source and destination must be
                  different.
                </p>
              )}

              {fromGodown && toGodown && fromGodownId !== toGodownId && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
                  <span className="font-medium text-orange-600">
                    {fromGodown.GodownName}
                  </span>
                  <ArrowRight size={12} />
                  <span className="font-medium text-emerald-600">
                    {toGodown.GodownName}
                  </span>
                </div>
              )}
            </div>

            {/* ── Items Table ───────────────────────────────────────────────────── */}
            {fromGodownId && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <div>
                    <p className="text-sm font-heading font-semibold text-foreground">
                      Items to Transfer
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Search for items available in the source godown
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {isLoadingStock ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <RefreshCw size={11} className="animate-spin" />
                        Loading stock…
                      </span>
                    ) : fromStockData ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Package size={11} className="text-emerald-600" />
                        {availableItems.length} items in stock
                      </span>
                    ) : null}
                    {rights.canCreate && (
                    <button
                      onClick={addItem}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
                    >
                      <Plus size={12} /> Add Item
                    </button>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-2">
                  <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                    {["#", "Item", "Avail", "Qty", "UOM", ""].map((h, i) => (
                      <span
                        key={i}
                        className={`text-[10px] font-semibold text-muted-foreground uppercase tracking-wider ${
                          i === 0
                            ? "col-span-1"
                            : i === 1
                              ? "col-span-5"
                              : i === 2
                                ? "col-span-1"
                                : i === 3
                                  ? "col-span-2"
                                  : i === 4
                                    ? "col-span-2"
                                    : "col-span-1"
                        }`}
                      >
                        {h}
                      </span>
                    ))}
                  </div>

                  {items.map((it, idx) => (
                    <ItemSearchRow
                      key={idx}
                      item={it}
                      idx={idx}
                      onUpdate={updateItem}
                      onRemove={removeItem}
                      availableItems={availableItems}
                      isLoadingStock={isLoadingStock}
                    />
                  ))}
                </div>

                <div className="px-5 py-4 border-t border-border space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                      Transfer Remarks
                    </label>
                    <textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={2}
                      placeholder="Reason for transfer, project reference, etc."
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  {viaBank && transferMode === "inter" && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-400/30 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                      <AlertCircle size={13} className="mt-0.5 shrink-0" />
                      <span>
                        <strong>Dummy Bank routing enabled.</strong> This transfer will be recorded as two legs: a stock-out debit to a dummy bank account at the source company, and a stock-in credit from the same dummy bank at the destination company. Ensure the dummy bank GL account is configured before executing.
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="hidden sm:block text-xs text-muted-foreground">
                      Review items and godowns before executing.
                    </p>
                    <div className="flex gap-2 sm:ml-auto">
                      <button
                        onClick={handleReset}
                        className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
                      >
                        Reset
                      </button>
                      {rights.canCreate && (
                      <button
                        onClick={handleTransfer}
                        disabled={!canTransfer}
                        className="flex-1 sm:flex-none whitespace-nowrap flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                      >
                        {transferMut.isPending || interTransferMut.isPending ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />{" "}
                            Processing…
                          </>
                        ) : (
                          <>
                            <Send size={14} /> Execute Transfer
                          </>
                        )}
                      </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!fromGodownId && (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 py-20 text-center">
                <ArrowLeftRight
                  size={36}
                  className="text-muted-foreground/30 mx-auto mb-3"
                />
                <p className="text-sm text-muted-foreground">
                  Select a source godown to begin a transfer
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Use the filters above to narrow godowns by company or project
                </p>
              </div>
            )}
          </div>
        )}
      </MaterialShell>
    </>
  );
}