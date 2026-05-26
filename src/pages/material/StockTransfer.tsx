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
  ChevronDown,
  Search,
  Building2,
  FolderKanban,
  Package,
} from "lucide-react";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getInventoryMaster } from "@/api/inventoryMasterApi";
import {
  createStockTransfer,
  getStockTransfers,
  type StockTransfer,
} from "@/api/stockTransferApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";

const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const today = new Date().toISOString().slice(0, 10);

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
  color: "blue" | "violet";
}) {
  const c =
    color === "blue"
      ? {
          border: "border-blue-400/40 focus:border-blue-500/60",
          bg: "bg-blue-500/5",
          icon: "text-blue-500",
          label: "text-blue-600",
        }
      : {
          border: "border-violet-400/40 focus:border-violet-500/60",
          bg: "bg-violet-500/5",
          icon: "text-violet-500",
          label: "text-violet-600",
        };

  return (
    <div className="flex-1 space-y-1.5">
      <p
        className={`text-xs font-semibold uppercase tracking-wider ${c.label}`}
      >
        {label}
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <Icon size={14} className={c.icon} />
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full pl-9 pr-8 py-2.5 rounded-xl border-2 text-sm text-foreground outline-none appearance-none transition-colors ${c.border} ${c.bg}`}
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
          isFrom ? "text-orange-600" : "text-emerald-600"
        }`}
      >
        {label}
      </p>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <Warehouse
            size={14}
            className={isFrom ? "text-orange-500" : "text-emerald-600"}
          />
        </span>
        <select
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : null)
          }
          className={`w-full pl-9 pr-8 py-2.5 rounded-xl border-2 text-sm text-foreground outline-none appearance-none transition-colors ${
            isFrom
              ? "border-orange-400/40 bg-orange-500/5 focus:border-orange-500/60"
              : "border-emerald-400/40 bg-emerald-500/5 focus:border-emerald-500/60"
          }`}
        >
          <option value="">{placeholder}</option>
          {godowns
            .filter((g) => g.GodownID !== exclude)
            .map((g) => (
              <option key={g.GodownID} value={g.GodownID}>
                {g.GodownName}
                {g.IsMain ? " [Main]" : ""}
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
          {selected.IsMain && (
            <span className="text-[9px] bg-emerald-500/15 text-emerald-600 px-1.5 py-0.5 rounded-full font-bold shrink-0 ml-auto">
              MAIN
            </span>
          )}
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
    if (!search.trim()) return availableItems.slice(0, 10);
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

        {open && search.length >= 1 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No items match "{search}"
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

// ─── Transfer History ─────────────────────────────────────────────────────────
function TransferHistory() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["stock-transfers"],
    queryFn: () => getStockTransfers({ limit: 50, page: 1 }),
    staleTime: 60_000,
  });
  const transfers: StockTransfer[] = data?.data ?? [];

  return (
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
              {["Doc No", "Date", "From", "To", "Items", "Status", "By"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-semibold text-muted-foreground"
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
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : transfers.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No transfers yet.
                </td>
              </tr>
            ) : (
              transfers.map((t) => (
                <tr
                  key={t.TransferID}
                  className="border-b border-border hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-primary font-semibold">
                    {t.DocNo}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {fmtDate(t.TransferDate)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-orange-500/10 text-orange-600 border border-orange-400/20">
                      <Warehouse size={9} /> {t.FromGodownName}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
                      <Warehouse size={9} /> {t.ToGodownName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.TransferItems.length} item
                    {t.TransferItems.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-600 font-medium">
                      <CheckCircle2 size={9} /> {t.Status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground truncate max-w-[120px]">
                    {t.CreatedBy?.split("@")[0] || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function StockTransfer() {
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"transfer" | "history">(
    "transfer",
  );

  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterProjectId, setFilterProjectId] = useState("");

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
    belongs_to: string | null;
  }[] = projectsData ?? [];

  const filteredGodowns = useMemo(() => {
    return allGodowns.filter((g) => {
      if (
        filterCompanyId &&
        g.EnterpriseID != null &&
        String(g.EnterpriseID) !== filterCompanyId
      )
        return false;
      if (
        filterProjectId &&
        g.ProjectID != null &&
        String(g.ProjectID) !== filterProjectId
      )
        return false;
      return true;
    });
  }, [allGodowns, filterCompanyId, filterProjectId]);

  const projectOptions = useMemo(() => {
    if (!filterCompanyId) return allProjects;
    return allProjects.filter((p) => String(p.belongs_to) === filterCompanyId);
  }, [allProjects, filterCompanyId]);

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

  const updateItem = (idx: number, patch: Partial<TItem>) =>
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const canTransfer =
    !!fromGodownId &&
    !!toGodownId &&
    fromGodownId !== toGodownId &&
    items.some((it) => it.itemId && parseFloat(it.qty) > 0) &&
    !transferMut.isPending;

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
    transferMut.mutate({
      FromGodownID: fromGodownId!,
      ToGodownID: toGodownId!,
      TransferItems: validItems,
      Remarks: remarks,
    });
  };

  const handleReset = () => {
    setFromGodownId(null);
    setToGodownId(null);
    setItems([emptyItem()]);
    setRemarks("");
    setErrorMsg("");
  };

  const fromGodown =
    filteredGodowns.find((g) => g.GodownID === fromGodownId) || null;
  const toGodown =
    filteredGodowns.find((g) => g.GodownID === toGodownId) || null;

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

      <div className="p-6 space-y-5 mt-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Stock Transfer
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Move stock between godowns — main to branch or any godown to
              godown
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-border">
            <button
              onClick={() => setActiveTab("transfer")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === "transfer"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Send size={14} /> New Transfer
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === "history"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ClipboardList size={14} /> History
            </button>
          </div>
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

            {/* ── Filters + Transfer Route ────────────────────────────────── */}
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
                  color="blue"
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
                  godowns={filteredGodowns}
                  exclude={toGodownId}
                  variant="from"
                  placeholder="Select source godown…"
                />
                <GodownSelect
                  label="To"
                  value={toGodownId}
                  onChange={setToGodownId}
                  godowns={filteredGodowns}
                  exclude={fromGodownId}
                  variant="to"
                  placeholder="Select destination godown…"
                />
              </div>

              {(filterCompanyId || filterProjectId) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {filterCompanyId && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-blue-500/10 text-blue-600 border border-blue-400/20 font-medium">
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
                    {filteredGodowns.length} godown
                    {filteredGodowns.length !== 1 ? "s" : ""} available
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

            {/* ── Items Table ───────────────────────────────────────────────── */}
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
                    <button
                      onClick={addItem}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
                    >
                      <Plus size={12} /> Add Item
                    </button>
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
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={handleReset}
                      className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleTransfer}
                      disabled={!canTransfer}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {transferMut.isPending ? (
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
      </div>
    </>
  );
}