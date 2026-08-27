import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SalesShell } from "@/components/sales/SalesShell";
import {
  ShoppingCart,
  ArrowLeftRight,
  Building2,
  FolderKanban,
  Warehouse,
  Package,
  Search,
  ChevronDown,
  Plus,
  Trash2,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Send,
  ClipboardList,
  IndianRupee,
  Eye,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getInventoryMaster } from "@/api/inventoryMasterApi";
import {
  createSaleOrder,
  getSaleOrders,
  deleteSaleOrder,
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
});

type Accent = "blue" | "violet";

const ACCENT: Record<
  Accent,
  { border: string; bg: string; icon: string; label: string; solidBg: string }
> = {
  blue: {
    border: "border-blue-400/40 focus:border-blue-500/60",
    bg: "bg-blue-500/5",
    icon: "text-blue-500",
    label: "text-blue-600 dark:text-blue-400",
    solidBg: "bg-blue-500/10 border-blue-400/20 text-blue-600",
  },
  violet: {
    border: "border-violet-400/40 focus:border-violet-500/60",
    bg: "bg-violet-500/5",
    icon: "text-violet-500",
    label: "text-violet-600 dark:text-violet-400",
    solidBg: "bg-violet-500/10 border-violet-400/20 text-violet-600",
  },
};

// ─── Generic Select ───────────────────────────────────────────────────────────
function SelectField({
  icon: Icon,
  label,
  value,
  onChange,
  options,
  placeholder,
  accent,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  accent: Accent;
  disabled?: boolean;
}) {
  const c = ACCENT[accent];
  return (
    <div className="flex-1 space-y-1.5 min-w-0">
      <p
        className={`text-[11px] font-semibold uppercase tracking-wider ${c.label}`}
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
          disabled={disabled}
          className={`w-full pl-9 pr-8 py-2.5 rounded-xl border-2 text-sm text-foreground outline-none appearance-none transition-colors disabled:opacity-50 ${c.border} ${c.bg}`}
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

// ─── Resolved Godown Panel ──────────────────────────────────────────────────
function GodownPanel({
  godowns,
  value,
  onChange,
  accent,
  placeholder,
}: {
  godowns: Godown[];
  value: number | null;
  onChange: (v: number | null) => void;
  accent: Accent;
  placeholder: string;
}) {
  const c = ACCENT[accent];

  if (godowns.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
        <AlertCircle size={13} className="shrink-0" />
        No godown linked to this project yet
      </div>
    );
  }

  if (godowns.length === 1) {
    const g = godowns[0];
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 ${c.border} ${c.bg}`}
      >
        <Warehouse size={14} className={`shrink-0 ${c.icon}`} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">
            {g.GodownName}
          </p>
          <p className="text-[10px] text-muted-foreground">{g.GodownCode}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
        <Warehouse size={14} className={c.icon} />
      </span>
      <select
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
        className={`w-full pl-9 pr-8 py-2.5 rounded-xl border-2 text-sm text-foreground outline-none appearance-none transition-colors ${c.border} ${c.bg}`}
        style={{ colorScheme: "dark" }}
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
  accent,
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
  accent: Accent;
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
  const c = ACCENT[accent];
  return (
    <div
      className={`flex-1 min-w-0 rounded-xl border border-border bg-card p-4 space-y-3 border-l-4 ${
        accent === "blue" ? "border-l-blue-500" : "border-l-violet-500"
      }`}
    >
      <p className={`text-xs font-bold uppercase tracking-wider ${c.label}`}>
        {title}
      </p>
      <SelectField
        icon={Building2}
        label="Company"
        value={companyId}
        onChange={onCompanyChange}
        options={companyOptions}
        placeholder="Select company…"
        accent={accent}
      />
      <SelectField
        icon={FolderKanban}
        label="Project"
        value={projectId}
        onChange={onProjectChange}
        options={projectOptions}
        placeholder={companyId ? "Select project…" : "Select company first"}
        accent={accent}
        disabled={!companyId}
      />
      <div className="space-y-1.5">
        <p
          className={`text-[11px] font-semibold uppercase tracking-wider ${c.label}`}
        >
          Godown
        </p>
        {projectId ? (
          <GodownPanel
            godowns={godowns}
            value={godownId}
            onChange={onGodownChange}
            accent={accent}
            placeholder="Select godown…"
          />
        ) : (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
            Select a project to resolve its godown
          </div>
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
}: {
  item: SOItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<SOItem>) => void;
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
  const rateNum = parseFloat(item.rate) || 0;
  const amount = qtyNum * rateNum;
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
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500/50 disabled:opacity-60"
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
      <div className="col-span-1">
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
          <p className="text-[10px] text-red-500 mt-0.5 whitespace-nowrap">
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
          className="w-full px-2 py-2 rounded-lg border border-border bg-muted text-xs text-muted-foreground outline-none"
        />
      </div>

      {/* Rate */}
      <div className="col-span-2 relative">
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
          className="w-full pl-6 pr-2 py-2 rounded-lg border border-border text-xs text-foreground bg-background outline-none disabled:opacity-50"
        />
      </div>

      {/* Amount */}
      <div className="col-span-2 flex items-center h-9">
        <span className="text-xs font-semibold text-foreground truncate">
          {item.itemId ? fmtAmt(amount) : "—"}
        </span>
      </div>

      {/* Remove */}
      <div className="col-span-1 flex items-center h-9 justify-end">
        <button
          onClick={() => onRemove(idx)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Sale Order History ──────────────────────────────────────────────────────
function SaleOrderHistory() {
  const rights = usePageRights("sale-order");
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sale-orders"],
    queryFn: () => getSaleOrders({ limit: 50, page: 1 }),
    staleTime: 60_000,
  });
  const orders: SaleOrderDoc[] = data?.data ?? [];
  const [viewingOrder, setViewingOrder] = useState<SaleOrderDoc | null>(null);

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
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div>
          <p className="text-sm font-heading font-semibold text-foreground">
            Sale Order History
          </p>
          <p className="text-xs text-muted-foreground">
            Recent inter-company / inter-project sale orders
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />{" "}
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {[
                "Doc No",
                "Date",
                "From",
                "To",
                "Items",
                "Amount",
                "Status",
                "By",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left font-semibold text-muted-foreground whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : orders.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No sale orders yet.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr
                  key={o.SaleOrderID}
                  className="border-b border-border hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-primary font-semibold whitespace-nowrap">
                    {o.DocNo}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {fmtDate(o.OrderDate)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex flex-col gap-0.5 px-2 py-1 rounded-lg text-[10px] bg-blue-500/10 text-blue-600 border border-blue-400/20">
                      <span className="font-semibold">{o.FromCompanyName}</span>
                      <span className="opacity-80">
                        {o.FromProjectName} · {o.FromGodownName}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex flex-col gap-0.5 px-2 py-1 rounded-lg text-[10px] bg-violet-500/10 text-violet-600 border border-violet-400/20">
                      <span className="font-semibold">{o.ToCompanyName}</span>
                      <span className="opacity-80">
                        {o.ToProjectName} · {o.ToGodownName}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {o.SaleItems.length} item
                    {o.SaleItems.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                    {fmtAmt(o.TotalAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <ApprovalStatusChain
                      table="SaleOrders"
                      recordId={o.SaleOrderID}
                      compact
                    />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground truncate max-w-[120px]">
                    {o.CreatedBy?.split("@")[0] || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setViewingOrder(o)}
                        className="text-muted-foreground hover:bg-muted p-2 rounded-lg transition-colors"
                        title="View"
                      >
                        <Eye size={15} />
                      </button>
                      {rights.canDelete && (
                        <button
                          onClick={() => handleDelete(o)}
                          disabled={deleteMutation.isPending}
                          className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500 p-2 rounded-lg transition-colors disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 size={15} />
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

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/*  VIEW / PRINT MODAL                                                */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {viewingOrder && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
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
          <div className="so-print-modal bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="font-heading font-bold text-base">
                  {viewingOrder.DocNo}
                </h2>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                  Sale Order
                </p>
              </div>
              <div className="flex items-center gap-2">
                {rights.canPrint && (
                  <button
                    onClick={() => window.print()}
                    title="Print Sale Order"
                    className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground print:hidden"
                  >
                    <Printer size={18} />
                  </button>
                )}
                <button
                  onClick={() => setViewingOrder(null)}
                  className="p-2 hover:bg-muted rounded-lg transition-colors print:hidden"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-6">
              {/* Meta grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: "Doc No", value: viewingOrder.DocNo, mono: true },
                  { label: "Date", value: fmtDate(viewingOrder.OrderDate) },
                  {
                    label: "Created By",
                    value: viewingOrder.CreatedBy?.split("@")[0] || "—",
                  },
                  {
                    label: "From",
                    value: `${viewingOrder.FromCompanyName} · ${viewingOrder.FromProjectName} · ${viewingOrder.FromGodownName}`,
                  },
                  {
                    label: "To",
                    value: `${viewingOrder.ToCompanyName} · ${viewingOrder.ToProjectName} · ${viewingOrder.ToGodownName}`,
                  },
                  {
                    label: "Stock Posted",
                    value: viewingOrder.PostedToStock ? "Yes" : "Not yet",
                  },
                ].map(({ label, value, mono }) => (
                  <div
                    key={label}
                    className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50"
                  >
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                      {label}
                    </p>
                    <p
                      className={`text-xs font-semibold ${mono ? "font-mono" : ""} text-foreground`}
                    >
                      {value}
                    </p>
                  </div>
                ))}
                <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                    Status
                  </p>
                  <ApprovalStatusChain
                    table="SaleOrders"
                    recordId={viewingOrder.SaleOrderID}
                    compact
                  />
                </div>
              </div>

              {/* Items */}
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3">
                  Items
                </p>
                <div className="overflow-x-auto rounded-xl border border-border/50">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        {[
                          "Item",
                          "Qty",
                          "UOM",
                          "Rate",
                          "Amount",
                          "Remarks",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {viewingOrder.SaleItems.map((it, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="px-3 py-2 font-medium">
                            {it.itemName || it.itemId}
                          </td>
                          <td className="px-3 py-2">{fmtNum(it.qty)}</td>
                          <td className="px-3 py-2">{it.uom || "—"}</td>
                          <td className="px-3 py-2">
                            {it.rate ? fmtAmt(it.rate) : "—"}
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {fmtAmt(it.amount ?? it.qty * it.rate)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {it.remarks || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Total + Remarks */}
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pt-2 border-t border-border">
                {viewingOrder.Remarks && (
                  <div className="text-xs">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                      Remarks
                    </p>
                    <p className="text-muted-foreground">
                      {viewingOrder.Remarks}
                    </p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">
                    Total Amount
                  </p>
                  <p className="text-lg font-bold text-foreground">
                    {fmtAmt(viewingOrder.TotalAmount)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SaleOrder() {
  const rights = usePageRights("sale-order");
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"create" | "history">("create");

  const [fromCompanyId, setFromCompanyId] = useState("");
  const [fromProjectId, setFromProjectId] = useState("");
  const [fromGodownId, setFromGodownId] = useState<number | null>(null);

  const [toCompanyId, setToCompanyId] = useState("");
  const [toProjectId, setToProjectId] = useState("");
  const [toGodownId, setToGodownId] = useState<number | null>(null);

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
  const toProjectOptions = useMemo(
    () =>
      allProjects
        .filter((p) => String(p.company_id ?? "") === toCompanyId)
        .map((p) => ({ value: String(p.id), label: p.label })),
    [allProjects, toCompanyId],
  );

  const fromProjectGodowns = useMemo(
    () => allGodowns.filter((g) => String(g.ProjectID ?? "") === fromProjectId),
    [allGodowns, fromProjectId],
  );
  const toProjectGodowns = useMemo(
    () => allGodowns.filter((g) => String(g.ProjectID ?? "") === toProjectId),
    [allGodowns, toProjectId],
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

  useEffect(() => {
    if (toProjectGodowns.length === 1) {
      setToGodownId(toProjectGodowns[0].GodownID);
    } else {
      setToGodownId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toProjectId]);

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
        `Sale order ${res.DocNo} created — ${fmtAmt(res.TotalAmount)} total.`,
      );
      setErrorMsg("");
      setFromCompanyId("");
      setFromProjectId("");
      setFromGodownId(null);
      setToCompanyId("");
      setToProjectId("");
      setToGodownId(null);
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

  const totalAmount = useMemo(
    () =>
      items.reduce((sum, it) => {
        const q = parseFloat(it.qty) || 0;
        const r = parseFloat(it.rate) || 0;
        return sum + q * r;
      }, 0),
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
    !!toGodownId &&
    fromGodownId !== toGodownId &&
    hasValidItem &&
    !hasOverLimit &&
    !createMut.isPending;

  const handleSwap = () => {
    const fc = fromCompanyId,
      fp = fromProjectId,
      fg = fromGodownId;
    setFromCompanyId(toCompanyId);
    setFromProjectId(toProjectId);
    setFromGodownId(toGodownId);
    setToCompanyId(fc);
    setToProjectId(fp);
    setToGodownId(fg);
    setItems([emptyItem()]);
  };

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
        remarks: it.remarks,
      }));
    createMut.mutate({
      FromCompanyID: parseInt(fromCompanyId),
      FromProjectID: parseInt(fromProjectId),
      FromGodownID: fromGodownId!,
      ToCompanyID: parseInt(toCompanyId),
      ToProjectID: parseInt(toProjectId),
      ToGodownID: toGodownId!,
      SaleItems: validItems,
      Remarks: remarks,
    });
  };

  const handleReset = () => {
    setFromCompanyId("");
    setFromProjectId("");
    setFromGodownId(null);
    setToCompanyId("");
    setToProjectId("");
    setToGodownId(null);
    setItems([emptyItem()]);
    setRemarks("");
    setErrorMsg("");
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Module", "Sale Order"]} />

      <SalesShell
        title="Sale Order"
        subtitle="Transfer items between company projects with a fixed sale rate"
        icon={ShoppingCart}
        action={
          <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-border">
            {rights.canCreate && (
              <button
                onClick={() => setActiveTab("create")}
                className={`inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg transition-colors ${
                  activeTab === "create"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Send size={13} /> New Sale Order
              </button>
            )}
            <button
              onClick={() => setActiveTab("history")}
              className={`inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg transition-colors ${
                activeTab === "history"
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ClipboardList size={13} /> History
            </button>
          </div>
        }
      >
        {activeTab === "history" && <SaleOrderHistory />}

        {activeTab === "create" && (
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

            {/* ── From / To panels ─────────────────────────────────────────────── */}
            <div className="flex flex-col lg:flex-row items-stretch gap-3">
              <SidePanel
                title="Source — From"
                accent="blue"
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

              <div className="hidden lg:flex items-center justify-center px-1">
                <button
                  onClick={handleSwap}
                  title="Swap source and destination"
                  className="p-2.5 rounded-full border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shadow-sm"
                >
                  <ArrowLeftRight size={16} />
                </button>
              </div>
              <div className="flex lg:hidden justify-center">
                <button
                  onClick={handleSwap}
                  title="Swap source and destination"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeftRight size={13} /> Swap
                </button>
              </div>

              <SidePanel
                title="Destination — To"
                accent="violet"
                companyOptions={companyOptions}
                companyId={toCompanyId}
                onCompanyChange={(v) => {
                  setToCompanyId(v);
                  setToProjectId("");
                  setToGodownId(null);
                }}
                projectOptions={toProjectOptions}
                projectId={toProjectId}
                onProjectChange={setToProjectId}
                godowns={toProjectGodowns}
                godownId={toGodownId}
                onGodownChange={setToGodownId}
              />
            </div>

            {fromGodownId && toGodownId && fromGodownId === toGodownId && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={11} /> Source and destination godown must be
                different.
              </p>
            )}

            {/* ── Items Table ───────────────────────────────────────────────────── */}
            {fromGodownId && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-heading font-semibold text-foreground">
                      Items &amp; Rate
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Search items available in the source godown, then set the
                      sale rate
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
                        <Package size={11} className="text-violet-600" />
                        {availableItems.length} items in stock
                      </span>
                    ) : null}
                    <button
                      onClick={addItem}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition-colors"
                    >
                      <Plus size={12} /> Add Item
                    </button>
                  </div>
                </div>

                <div className="p-4 space-y-2">
                  <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                    {[
                      "#",
                      "Item",
                      "Avail",
                      "Qty",
                      "UOM",
                      "Rate",
                      "Amount",
                      "",
                    ].map((h, i) => (
                      <span
                        key={i}
                        className={`text-[10px] font-semibold text-muted-foreground uppercase tracking-wider ${
                          i === 0
                            ? "col-span-1"
                            : i === 1
                              ? "col-span-3"
                              : i === 2
                                ? "col-span-1"
                                : i === 3
                                  ? "col-span-1"
                                  : i === 4
                                    ? "col-span-1"
                                    : i === 5
                                      ? "col-span-2"
                                      : i === 6
                                        ? "col-span-2"
                                        : "col-span-1"
                        }`}
                      >
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
                    />
                  ))}

                  {missingRate && (
                    <p className="text-[11px] text-amber-600 flex items-center gap-1 px-1">
                      <AlertCircle size={11} /> Set a rate greater than 0 for
                      every item before submitting.
                    </p>
                  )}
                </div>

                <div className="px-5 py-4 border-t border-border space-y-3">
                  <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">
                      Total Sale Value:
                    </span>
                    <span className="text-base font-bold text-foreground">
                      {fmtAmt(totalAmount)}
                    </span>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                      Remarks
                    </label>
                    <textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={2}
                      placeholder="Reason for sale, reference, etc."
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-2 focus:ring-violet-500/30"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={handleReset}
                      className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {createMut.isPending ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />{" "}
                          Processing…
                        </>
                      ) : (
                        <>
                          <Send size={14} /> Create Sale Order
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!fromGodownId && (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 py-20 text-center">
                <ShoppingCart
                  size={36}
                  className="text-muted-foreground/30 mx-auto mb-3"
                />
                <p className="text-sm text-muted-foreground">
                  Select a source company, project and godown to begin
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Then pick the destination side and add items with a rate
                </p>
              </div>
            )}
          </div>
        )}
      </SalesShell>
    </>
  );
}
