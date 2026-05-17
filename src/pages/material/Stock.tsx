import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  ArrowLeftRight,
  Warehouse,
  Building2,
  FolderKanban,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Package,
  Send,
  ClipboardList,
  X,
} from "lucide-react";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getInventoryMaster } from "@/api/inventoryMasterApi";
import {
  createStockTransfer,
  getStockTransfers,
  type StockTransfer,
} from "@/api/stockTransferApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

// ─── Shared Dropdown ──────────────────────────────────────────────────────────
function SelectDropdown({
  label,
  value,
  onChange,
  options,
  placeholder,
  icon: Icon,
  disabled = false,
}: {
  label: string;
  value: string | number | null;
  onChange: (v: string | number | null) => void;
  options: { value: string | number; label: string; badge?: string }[];
  placeholder: string;
  icon?: React.ElementType;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground block">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Icon size={13} className="text-muted-foreground" />
          </span>
        )}
        <select
          value={value ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value
                ? isNaN(Number(e.target.value))
                  ? e.target.value
                  : Number(e.target.value)
                : null,
            )
          }
          disabled={disabled}
          className={`w-full ${Icon ? "pl-8" : "pl-3"} pr-8 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 appearance-none disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.badge ? ` [${o.badge}]` : ""}
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

// ─── Tab button ───────────────────────────────────────────────────────────────
function Tab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-emerald-600 text-white shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

// ─── Transfer Item Row ────────────────────────────────────────────────────────
interface TItem {
  itemId: string;
  itemName: string;
  qty: string;
  uom: string;
  availableQty: number;
  remarks: string;
}

function TransferItemRow({
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

      {/* Item select */}
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

// ─── Stock Position Panel ─────────────────────────────────────────────────────
function StockPositionPanel({
  godownId,
  godownName,
}: {
  godownId: number;
  godownName: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading } = useQuery({
    queryKey: ["inventory-master", today, godownId],
    queryFn: () => getInventoryMaster(today, godownId),
    staleTime: 60_000,
  });

  const rows = (data?.data ?? []).filter((r) => r.ClosingStock > 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Package size={14} className="text-emerald-600" />
        <p className="text-sm font-semibold text-foreground">
          Stock in <span className="text-emerald-600">{godownName}</span>
        </p>
        <span className="ml-auto text-xs text-muted-foreground">{today}</span>
      </div>
      <div className="overflow-auto max-h-64">
        {isLoading ? (
          <div className="px-4 py-6 flex items-center gap-2 text-xs text-muted-foreground justify-center">
            <RefreshCw size={12} className="animate-spin" /> Loading…
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
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Group
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
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.ItemGroupName || "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-emerald-600">
                    {fmtNum(r.ClosingStock)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.UOMCode || "—"}
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

// ─── Transfer History ─────────────────────────────────────────────────────────
function TransferHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ["stock-transfers"],
    queryFn: () => getStockTransfers({ limit: 50, page: 1 }),
    staleTime: 60_000,
  });
  const transfers: StockTransfer[] = data?.data ?? [];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <p className="text-sm font-heading font-semibold text-foreground">
          Transfer History
        </p>
        <p className="text-xs text-muted-foreground">
          Recent stock movements between godowns
        </p>
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
                  className="px-4 py-10 text-center text-muted-foreground"
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
                      <Warehouse size={9} />
                      {t.FromGodownName}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
                      <Warehouse size={9} />
                      {t.ToGodownName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.TransferItems.length} item
                    {t.TransferItems.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-600 font-medium">
                      <CheckCircle2 size={9} />
                      {t.Status}
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

// ─── Main Stock Page ──────────────────────────────────────────────────────────
export default function Stock() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "position" | "transfer" | "history"
  >("position");

  // Filter state for stock position tab
  const [posCompany, setPosCompany] = useState<number | null>(null);
  const [posProject, setPosProject] = useState<number | null>(null);
  const [posGodown, setPosGodown] = useState<number | null>(null);

  // Transfer state
  const [fromGodownId, setFromGodownId] = useState<number | null>(null);
  const [toGodownId, setToGodownId] = useState<number | null>(null);
  const [transferItems, setTransferItems] = useState<TItem[]>([
    {
      itemId: "",
      itemName: "",
      qty: "",
      uom: "",
      availableQty: 0,
      remarks: "",
    },
  ]);
  const [transferRemarks, setTransferRemarks] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // ── Data fetches ──────────────────────────────────────────────────────────
  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 0,
  });
  const godowns: Godown[] = godownsData?.data ?? [];

  // Companies (business_type = C)
  const { data: companiesData } = useQuery({
    queryKey: ["enterprises-companies"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=C")
        .then((r) => r.json())
        .catch(() => []),
    staleTime: 300_000,
  });
  const companies = Array.isArray(companiesData) ? companiesData : [];

  // Projects (business_type = P)
  const { data: projectsData } = useQuery({
    queryKey: ["enterprises-projects"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=P")
        .then((r) => r.json())
        .catch(() => []),
    staleTime: 300_000,
  });
  const projects = Array.isArray(projectsData) ? projectsData : [];

  // Filter godowns by selected company/project
  const filteredGodowns = useMemo(() => {
    if (posCompany)
      return godowns.filter((g) => g.EnterpriseID === posCompany || g.IsMain);
    if (posProject)
      return godowns.filter((g) => g.ProjectID === posProject || g.IsMain);
    return godowns;
  }, [godowns, posCompany, posProject]);

  // Available stock in the selected FROM godown for transfer
  const today = new Date().toISOString().slice(0, 10);
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
          itemName: r.ItemName,
          uom: r.UOMCode || "",
          available: r.ClosingStock,
        })),
    [fromStockData],
  );

  // ── Transfer mutation ─────────────────────────────────────────────────────
  const transferMut = useMutation({
    mutationFn: createStockTransfer,
    onSuccess: (res) => {
      setSuccessMsg(`Transfer ${res.DocNo} completed successfully!`);
      setErrorMsg("");
      setFromGodownId(null);
      setToGodownId(null);
      setTransferItems([
        {
          itemId: "",
          itemName: "",
          qty: "",
          uom: "",
          availableQty: 0,
          remarks: "",
        },
      ]);
      setTransferRemarks("");
      qc.invalidateQueries({ queryKey: ["inventory-master"] });
      qc.invalidateQueries({ queryKey: ["stock-transfers"] });
      setTimeout(() => setSuccessMsg(""), 5000);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  // ── Transfer item helpers ─────────────────────────────────────────────────
  const updateItem = (idx: number, patch: Partial<TItem>) =>
    setTransferItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const removeItem = (idx: number) =>
    setTransferItems((prev) => prev.filter((_, i) => i !== idx));
  const addItem = () =>
    setTransferItems((prev) => [
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
    transferItems.some((it) => it.itemId && parseFloat(it.qty) > 0) &&
    !transferMut.isPending;

  const handleTransfer = () => {
    setErrorMsg("");
    const items = transferItems
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
      TransferItems: items,
      Remarks: transferRemarks,
    });
  };

  const godownOptions = godowns.map((g) => ({
    value: g.GodownID,
    label: g.GodownName,
    badge: g.IsMain ? "Main" : undefined,
  }));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Stock"]} />

      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
              <ArrowLeftRight size={20} className="text-emerald-600" />
              Stock Management
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              View stock positions and transfer inventory between godowns
            </p>
          </div>
          {/* Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-muted border border-border">
            <Tab
              active={activeTab === "position"}
              onClick={() => setActiveTab("position")}
              icon={Package}
              label="Stock Position"
            />
            <Tab
              active={activeTab === "transfer"}
              onClick={() => setActiveTab("transfer")}
              icon={ArrowLeftRight}
              label="Transfer"
            />
            <Tab
              active={activeTab === "history"}
              onClick={() => setActiveTab("history")}
              icon={ClipboardList}
              label="History"
            />
          </div>
        </div>

        {/* ── Stock Position Tab ──────────────────────────────────────────────── */}
        {activeTab === "position" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Filter by
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SelectDropdown
                  label="Company"
                  value={posCompany}
                  onChange={(v) => {
                    setPosCompany(v as number | null);
                    setPosGodown(null);
                  }}
                  options={companies.map((c: any) => ({
                    value: c.id,
                    label: c.label,
                  }))}
                  placeholder="All Companies"
                  icon={Building2}
                />
                <SelectDropdown
                  label="Project"
                  value={posProject}
                  onChange={(v) => {
                    setPosProject(v as number | null);
                    setPosGodown(null);
                  }}
                  options={projects.map((p: any) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                  placeholder="All Projects"
                  icon={FolderKanban}
                />
                <SelectDropdown
                  label="Godown / Warehouse"
                  value={posGodown}
                  onChange={(v) => setPosGodown(v as number | null)}
                  options={filteredGodowns.map((g) => ({
                    value: g.GodownID,
                    label: g.GodownName,
                    badge: g.IsMain ? "Main" : undefined,
                  }))}
                  placeholder="Select Godown"
                  icon={Warehouse}
                />
              </div>
            </div>

            {/* Stock display */}
            {posGodown ? (
              <StockPositionPanel
                godownId={posGodown}
                godownName={
                  godowns.find((g) => g.GodownID === posGodown)?.GodownName ??
                  ""
                }
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 py-16 text-center">
                <Warehouse
                  size={32}
                  className="text-muted-foreground/40 mx-auto mb-3"
                />
                <p className="text-sm text-muted-foreground">
                  Select a godown above to view its stock position
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Filter by company or project to narrow down godowns
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Transfer Tab ────────────────────────────────────────────────────── */}
        {activeTab === "transfer" && (
          <div className="space-y-4">
            {/* Success / Error banners */}
            {successMsg && (
              <div className="px-4 py-3 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center gap-2 text-sm">
                <CheckCircle2 size={15} />
                {successMsg}
                <button onClick={() => setSuccessMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}
            {errorMsg && (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-600 border border-red-500/20 flex items-center gap-2 text-sm">
                <AlertCircle size={15} />
                {errorMsg}
                <button onClick={() => setErrorMsg("")} className="ml-auto">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* From / To — UPI-style transfer card */}
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Transfer Route
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-4 items-end">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Transfer From
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2">
                      <Warehouse size={13} className="text-orange-500" />
                    </span>
                    <select
                      value={fromGodownId ?? ""}
                      onChange={(e) => {
                        setFromGodownId(
                          e.target.value ? Number(e.target.value) : null,
                        );
                        setTransferItems([
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
                      className="w-full pl-8 pr-8 py-2.5 rounded-xl border-2 border-orange-400/40 bg-orange-500/5 text-sm text-foreground outline-none focus:border-orange-500/60 appearance-none"
                    >
                      <option value="">Select source godown…</option>
                      {godownOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                          {o.badge ? ` [${o.badge}]` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
                    />
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex items-center justify-center pb-1">
                  <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center shadow-md">
                    <ArrowLeftRight size={16} className="text-white" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Transfer To
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2">
                      <Warehouse size={13} className="text-emerald-600" />
                    </span>
                    <select
                      value={toGodownId ?? ""}
                      onChange={(e) =>
                        setToGodownId(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="w-full pl-8 pr-8 py-2.5 rounded-xl border-2 border-emerald-400/40 bg-emerald-500/5 text-sm text-foreground outline-none focus:border-emerald-500/60 appearance-none"
                    >
                      <option value="">Select destination godown…</option>
                      {godownOptions
                        .filter((o) => o.value !== fromGodownId)
                        .map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                            {o.badge ? ` [${o.badge}]` : ""}
                          </option>
                        ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
                    />
                  </div>
                </div>
              </div>

              {fromGodownId === toGodownId && fromGodownId && (
                <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                  <AlertCircle size={11} /> Source and destination must be
                  different godowns.
                </p>
              )}
            </div>

            {/* Stock preview for FROM godown */}
            {fromGodownId && (
              <StockPositionPanel
                godownId={fromGodownId}
                godownName={
                  godowns.find((g) => g.GodownID === fromGodownId)
                    ?.GodownName ?? "Source"
                }
              />
            )}

            {/* Items table */}
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
                  {/* Header row */}
                  <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                    {["#", "Item", "Qty", "UOM", "Remarks", ""].map((h, i) => (
                      <span
                        key={i}
                        className={`text-[10px] font-semibold text-muted-foreground uppercase tracking-wider ${i === 0 ? "col-span-1" : i === 1 ? "col-span-4" : i === 2 ? "col-span-2" : i === 3 ? "col-span-2" : i === 4 ? "col-span-2" : "col-span-1"}`}
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                  {transferItems.map((it, idx) => (
                    <TransferItemRow
                      key={idx}
                      item={it}
                      idx={idx}
                      onUpdate={updateItem}
                      onRemove={removeItem}
                      availableItems={availableItems}
                    />
                  ))}
                </div>

                {/* Remarks + Submit */}
                <div className="px-5 py-4 border-t border-border space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                      Transfer Remarks
                    </label>
                    <textarea
                      value={transferRemarks}
                      onChange={(e) => setTransferRemarks(e.target.value)}
                      rows={2}
                      placeholder="Reason for transfer, project reference, etc."
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => {
                        setFromGodownId(null);
                        setToGodownId(null);
                        setTransferRemarks("");
                        setTransferItems([
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
                      className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleTransfer}
                      disabled={!canTransfer}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
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
              <div className="rounded-xl border border-dashed border-border bg-muted/20 py-16 text-center">
                <ArrowLeftRight
                  size={32}
                  className="text-muted-foreground/40 mx-auto mb-3"
                />
                <p className="text-sm text-muted-foreground">
                  Select source and destination godowns to begin a transfer
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── History Tab ─────────────────────────────────────────────────────── */}
        {activeTab === "history" && <TransferHistory />}
      </div>
    </>
  );
}
