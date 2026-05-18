import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  ArrowRight,
  Warehouse,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Package,
  Plus,
  Trash2,
  X,
  ClipboardList,
  Send,
  ArrowLeftRight,
  ChevronDown,
} from "lucide-react";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getInventoryMaster } from "@/api/inventoryMasterApi";
import {
  createStockTransfer,
  getStockTransfers,
  type StockTransfer,
} from "@/api/stockTransferApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const today = new Date().toISOString().slice(0, 10);

// ─── Transfer Item ────────────────────────────────────────────────────────────
interface TItem {
  itemId: string;
  itemName: string;
  qty: string;
  uom: string;
  availableQty: number;
  remarks: string;
}

// ─── Godown Badge ─────────────────────────────────────────────────────────────
function GodownBadge({
  godown,
  variant,
}: {
  godown: Godown;
  variant: "from" | "to";
}) {
  const isFrom = variant === "from";
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 ${
        isFrom
          ? "border-orange-400/40 bg-orange-500/5"
          : "border-emerald-400/40 bg-emerald-500/5"
      }`}
    >
      <Warehouse
        size={14}
        className={
          isFrom ? "text-orange-500 shrink-0" : "text-emerald-600 shrink-0"
        }
      />
      <div className="min-w-0">
        <p
          className={`text-sm font-semibold truncate ${isFrom ? "text-orange-700 dark:text-orange-400" : "text-emerald-700 dark:text-emerald-400"}`}
        >
          {godown.GodownName}
        </p>
        {godown.ShortDesc && (
          <p className="text-[10px] text-muted-foreground truncate">
            {godown.ShortDesc}
          </p>
        )}
      </div>
      {godown.IsMain && (
        <span className="text-[9px] bg-emerald-500/15 text-emerald-600 px-1.5 py-0.5 rounded-full font-bold shrink-0">
          MAIN
        </span>
      )}
    </div>
  );
}

// ─── Godown Picker ────────────────────────────────────────────────────────────
function GodownPicker({
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
        className={`text-xs font-semibold uppercase tracking-wider ${isFrom ? "text-orange-600" : "text-emerald-600"}`}
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
      {selected && <GodownBadge godown={selected} variant={variant} />}
    </div>
  );
}

// ─── Available Stock Table ────────────────────────────────────────────────────
function AvailableStockTable({
  godownId,
  godownName,
}: {
  godownId: number;
  godownName: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["inventory-master", today, godownId],
    queryFn: () => getInventoryMaster(today, godownId),
    staleTime: 60_000,
  });
  const rows = (data?.data ?? []).filter((r) => r.ClosingStock > 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Package size={13} className="text-orange-500" />
        <p className="text-xs font-semibold text-foreground">
          Available in <span className="text-orange-600">{godownName}</span>
        </p>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {today}
        </span>
      </div>
      <div className="overflow-auto max-h-48">
        {isLoading ? (
          <div className="px-4 py-6 flex items-center gap-2 text-xs text-muted-foreground justify-center">
            <RefreshCw size={12} className="animate-spin" /> Loading stock…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground text-center">
            No stock available in this godown.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Item
                </th>
                <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                  Available
                </th>
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  UOM
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.ItemID}
                  className="border-b border-border/50 hover:bg-muted/20"
                >
                  <td className="px-4 py-2 font-medium text-foreground">
                    {r.ItemName}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-emerald-600">
                    {fmtNum(r.ClosingStock)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.UOMName || r.UOMCode || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Item Row ─────────────────────────────────────────────────────────────────
function ItemRow({
  item,
  idx,
  onUpdate,
  onRemove,
  availableItems,
}: {
  item: TItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<TItem>) => void;
  onRemove: (idx: number) => void;
  availableItems: {
    itemId: string;
    itemName: string;
    uom: string;
    available: number;
  }[];
}) {
  const selected = availableItems.find((a) => a.itemId === item.itemId);
  const maxQty = selected?.available ?? 0;
  const qtyNum = parseFloat(item.qty) || 0;
  const overLimit = qtyNum > maxQty && maxQty > 0;

  return (
    <div
      className={`grid grid-cols-12 gap-2 items-start p-3 rounded-xl border transition-colors ${overLimit ? "border-red-400/40 bg-red-500/5" : "border-border bg-muted/20"}`}
    >
      <div className="col-span-1 flex items-center h-9 text-xs font-mono text-muted-foreground">
        {idx + 1}
      </div>

      {/* Item */}
      <div className="col-span-4">
        <select
          value={item.itemId}
          onChange={(e) => {
            const found = availableItems.find(
              (a) => a.itemId === e.target.value,
            );
            onUpdate(idx, {
              itemId: e.target.value,
              itemName: found?.itemName ?? "",
              uom: found?.uom ?? "",
              availableQty: found?.available ?? 0,
            });
          }}
          className="w-full px-2 py-2 rounded-lg border border-border bg-background text-xs text-foreground outline-none"
        >
          <option value="">Select item…</option>
          {availableItems.map((a) => (
            <option key={a.itemId} value={a.itemId}>
              {a.itemName} (avail: {fmtNum(a.available)})
            </option>
          ))}
        </select>
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
          className={`w-full px-2 py-2 rounded-lg border text-xs text-foreground bg-background outline-none ${overLimit ? "border-red-400" : "border-border"}`}
        />
        {overLimit && (
          <p className="text-[10px] text-red-500 mt-0.5">
            Max: {fmtNum(maxQty)}
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

      {/* Remarks */}
      <div className="col-span-2">
        <input
          value={item.remarks}
          onChange={(e) => onUpdate(idx, { remarks: e.target.value })}
          placeholder="Remarks"
          className="w-full px-2 py-2 rounded-lg border border-border bg-background text-xs text-foreground outline-none"
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

// ─── Main Transfer Page ───────────────────────────────────────────────────────
export default function StockTransfer() {
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"transfer" | "history">(
    "transfer",
  );

  const [fromGodownId, setFromGodownId] = useState<number | null>(null);
  const [toGodownId, setToGodownId] = useState<number | null>(null);
  const [items, setItems] = useState<TItem[]>([
    {
      itemId: "",
      itemName: "",
      qty: "",
      uom: "",
      availableQty: 0,
      remarks: "",
    },
  ]);
  const [remarks, setRemarks] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Load godowns
  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  });
  const godowns: Godown[] = godownsData?.data ?? [];

  const fromGodown = godowns.find((g) => g.GodownID === fromGodownId) || null;
  const toGodown = godowns.find((g) => g.GodownID === toGodownId) || null;

  // Available stock in FROM godown
  const { data: fromStockData } = useQuery({
    queryKey: ["inventory-master", today, fromGodownId],
    queryFn: () => getInventoryMaster(today, fromGodownId!),
    staleTime: 60_000,
    enabled: !!fromGodownId,
  });
  const availableItems = useMemo(
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

  // Transfer mutation
  const transferMut = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: (res) => {
      setSuccessMsg(`Transfer ${res.DocNo} completed successfully!`);
      setErrorMsg("");
      setFromGodownId(null);
      setToGodownId(null);
      setItems([
        {
          itemId: "",
          itemName: "",
          qty: "",
          uom: "",
          availableQty: 0,
          remarks: "",
        },
      ]);
      setRemarks("");
      qc.invalidateQueries({ queryKey: ["inventory-master"] });
      qc.invalidateQueries({ queryKey: ["stock-transfers"] });
      setTimeout(() => setSuccessMsg(""), 6000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  // Item helpers
  const updateItem = (idx: number, patch: Partial<TItem>) =>
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));
  const addItem = () =>
    setItems((prev) => [
      ...prev,
      {
        itemId: "",
        itemName: "",
        qty: "",
        uom: "",
        availableQty: 0,
        remarks: "",
      },
    ]);

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
    setItems([
      {
        itemId: "",
        itemName: "",
        qty: "",
        uom: "",
        availableQty: 0,
        remarks: "",
      },
    ]);
    setRemarks("");
    setErrorMsg("");
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Stock Transfer"]} />

      <div className="p-6 space-y-5">
        {/* Header + tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
              <ArrowLeftRight size={20} className="text-emerald-600" />
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
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "transfer" ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Send size={14} /> New Transfer
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "history" ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <ClipboardList size={14} /> History
            </button>
          </div>
        </div>

        {activeTab === "history" && <TransferHistory />}

        {activeTab === "transfer" && (
          <div className="space-y-4">
            {/* Banners */}
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

            {/* ── UPI-style transfer card ──────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Transfer Route
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                {/* FROM */}
                <GodownPicker
                  label="From"
                  value={fromGodownId}
                  onChange={(v) => {
                    setFromGodownId(v);
                    setItems([
                      {
                        itemId: "",
                        itemName: "",
                        qty: "",
                        uom: "",
                        availableQty: 0,
                        remarks: "",
                      },
                    ]);
                  }}
                  godowns={godowns}
                  exclude={toGodownId}
                  variant="from"
                  placeholder="Select source godown…"
                />

                {/* Arrow */}
                <div className="flex items-center justify-center sm:pb-[36px]">
                  <div className="w-9 h-9 rounded-full bg-emerald-600 flex items-center justify-center shadow-md shrink-0">
                    <ArrowRight size={16} className="text-white" />
                  </div>
                </div>

                {/* TO */}
                <GodownPicker
                  label="To"
                  value={toGodownId}
                  onChange={setToGodownId}
                  godowns={godowns}
                  exclude={fromGodownId}
                  variant="to"
                  placeholder="Select destination godown…"
                />
              </div>

              {fromGodownId && toGodownId && fromGodownId === toGodownId && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> Source and destination must be
                  different.
                </p>
              )}

              {/* Transfer summary badge when both selected */}
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

            {/* ── Available stock preview ───────────────────────────────────── */}
            {fromGodownId && fromGodown && (
              <AvailableStockTable
                godownId={fromGodownId}
                godownName={fromGodown.GodownName}
              />
            )}

            {/* ── Items table ───────────────────────────────────────────────── */}
            {fromGodownId && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <div>
                    <p className="text-sm font-heading font-semibold text-foreground">
                      Items to Transfer
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Only items with available stock in the source godown are
                      listed
                    </p>
                  </div>
                  <button
                    onClick={addItem}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
                  >
                    <Plus size={12} /> Add Item
                  </button>
                </div>
                <div className="p-4 space-y-2">
                  {/* Column headers */}
                  <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                    {["#", "Item", "Qty", "UOM", "Remarks", ""].map((h, i) => (
                      <span
                        key={i}
                        className={`text-[10px] font-semibold text-muted-foreground uppercase tracking-wider ${
                          i === 0
                            ? "col-span-1"
                            : i === 1
                              ? "col-span-4"
                              : i === 2
                                ? "col-span-2"
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
                    <ItemRow
                      key={idx}
                      item={it}
                      idx={idx}
                      onUpdate={updateItem}
                      onRemove={removeItem}
                      availableItems={availableItems}
                    />
                  ))}
                </div>

                {/* Remarks + actions */}
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

            {/* Empty state */}
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
                  You can transfer from Main to any branch, or between any two
                  godowns
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
