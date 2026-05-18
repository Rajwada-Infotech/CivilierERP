import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Calendar,
  Package,
  RefreshCw,
  Download,
  Search,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Layers,
  ChevronDown,
  ChevronRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Warehouse,
  Plus,
  X,
  Trash2,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
import {
  getInventoryMaster,
  type InventoryMasterRow,
} from "@/api/inventoryMasterApi";
import { getStockLedger } from "@/api/stockLedgerApi";
import {
  getGodowns,
  createGodown,
  deleteGodown,
  type Godown,
} from "@/api/godownsApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const today = () => new Date().toISOString().slice(0, 10);

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// ─── Summary Card ─────────────────────────────────────────────────────────────
function SummaryCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div
        className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}
      >
        <Icon size={18} className={color} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-heading font-bold text-foreground">
          {value}
        </p>
      </div>
    </div>
  );
}

// ─── Stock Badge ──────────────────────────────────────────────────────────────
function StockBadge({ value }: { value: number }) {
  if (value > 0)
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-400/20">
        <TrendingUp size={10} />
        {fmtNum(value)}
      </span>
    );
  if (value < 0)
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-600 border border-red-400/20">
        <TrendingDown size={10} />
        {fmtNum(Math.abs(value))}
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
      —
    </span>
  );
}

// ─── Stock Ledger Panel ───────────────────────────────────────────────────────
function StockLedgerPanel({ itemId }: { itemId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["stock-ledger-item", itemId],
    queryFn: () => getStockLedger({ itemId, limit: 50, page: 1 }),
    staleTime: 60_000,
  });
  const entries = data?.data ?? [];

  if (isLoading)
    return (
      <div className="px-6 py-4 flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw size={12} className="animate-spin" /> Loading ledger…
      </div>
    );
  if (entries.length === 0)
    return (
      <div className="px-6 py-4 text-xs text-muted-foreground italic">
        No ledger entries found.
      </div>
    );

  return (
    <div className="border-t border-border bg-muted/20">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {[
                "Stock ID",
                "Item Name",
                "Type",
                "Qty",
                "UOM",
                "Ref Type",
                "Doc No",
                "Date",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left font-semibold text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.StockID}
                className="border-b border-border/50 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-2 font-mono text-muted-foreground">
                  {e.StockID}
                </td>
                <td className="px-4 py-2 font-medium text-foreground">
                  {e.ItemName || "—"}
                </td>
                <td className="px-4 py-2">
                  {e.Type === "IN" ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600">
                      <ArrowDownToLine size={9} /> IN
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-600">
                      <ArrowUpFromLine size={9} /> OUT
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold">
                  {fmtNum(e.Qty)}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {e.UOMName || e.UOM || "—"}
                </td>
                <td className="px-4 py-2">
                  <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                    {e.RefType || "—"}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-primary">
                  {(e as any).DocNo || e.GRNNo || "—"}
                </td>
                <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                  {fmtDate(e.LedgerDate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Create Godown Modal ──────────────────────────────────────────────────────
function CreateGodownModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    GodownCode: "",
    GodownName: "",
    ShortDesc: "",
    Description: "",
    Remarks: "",
  });
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: createGodown,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      onCreated?.(res.GodownID);
      onClose();
      setForm({
        GodownCode: "",
        GodownName: "",
        ShortDesc: "",
        Description: "",
        Remarks: "",
      });
      setErr("");
    },
    onError: (e: Error) => setErr(e.message),
  });

  if (!open) return null;

  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-heading font-bold text-foreground flex items-center gap-2">
            <Warehouse size={16} className="text-emerald-600" /> Create New
            Godown
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        {err && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-xs flex items-center gap-2">
            <AlertCircle size={13} /> {err}
          </div>
        )}

        <div className="space-y-3">
          {[
            {
              label: "Godown Name *",
              key: "GodownName",
              placeholder: "e.g. Site A Warehouse",
            },
            {
              label: "Godown Code",
              key: "GodownCode",
              placeholder: "e.g. SITE-A",
            },
            {
              label: "Short Description",
              key: "ShortDesc",
              placeholder: "Shown in badges",
            },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {label}
              </label>
              <input
                value={(form as any)[key]}
                onChange={set(key)}
                placeholder={placeholder}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
              />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Description
            </label>
            <textarea
              value={form.Description}
              onChange={set("Description")}
              rows={2}
              placeholder="Detailed description of this godown"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Remarks
            </label>
            <textarea
              value={form.Remarks}
              onChange={set("Remarks")}
              rows={2}
              placeholder="Any additional remarks"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setErr("");
              mut.mutate(form);
            }}
            disabled={!form.GodownName.trim() || mut.isPending}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {mut.isPending ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Create Godown
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Godown Selector Dropdown ─────────────────────────────────────────────────
function GodownSelector({
  godowns,
  selectedId,
  onSelect,
  onCreateNew,
  onDeleted,
}: {
  godowns: Godown[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreateNew: () => void;
  onDeleted?: (id: number) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const selected = godowns.find((g) => g.GodownID === selectedId);

  const deleteMut = useMutation({
    mutationFn: deleteGodown,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      setConfirmDeleteId(null);
      onDeleted?.(id);
    },
  });

  return (
    <>
      {/* Delete confirm dialog */}
      {confirmDeleteId !== null &&
        (() => {
          const g = godowns.find((x) => x.GodownID === confirmDeleteId);
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
                <h2 className="text-base font-heading font-bold text-foreground">
                  Delete Godown?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Are you sure you want to delete{" "}
                  <span className="font-semibold text-foreground">
                    {g?.GodownName}
                  </span>
                  ? This cannot be undone.
                </p>
                {deleteMut.error && (
                  <p className="text-xs text-red-600">
                    {(deleteMut.error as Error).message}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setConfirmDeleteId(null);
                      deleteMut.reset();
                    }}
                    className="flex-1 px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteMut.mutate(confirmDeleteId!)}
                    disabled={deleteMut.isPending}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {deleteMut.isPending ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm hover:bg-muted transition-colors min-w-[180px]"
        >
          <Warehouse size={14} className="text-emerald-600 shrink-0" />
          <span className="text-foreground font-medium truncate">
            {selected ? (
              <>
                {selected.GodownName}
                {selected.IsMain && (
                  <span className="ml-1 text-[10px] bg-emerald-500/15 text-emerald-600 px-1.5 py-0.5 rounded-full font-semibold">
                    Main
                  </span>
                )}
              </>
            ) : (
              "Select Godown"
            )}
          </span>
          <ChevronDownIcon
            size={13}
            className={`text-muted-foreground ml-auto transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setOpen(false)}
            />
            <div className="absolute top-full mt-1 left-0 z-20 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[240px] max-h-72 overflow-y-auto">
              {godowns.map((g) => (
                <div
                  key={g.GodownID}
                  className={`flex items-center gap-1 pr-1 hover:bg-muted transition-colors ${g.GodownID === selectedId ? "bg-emerald-500/10" : ""}`}
                >
                  <button
                    onClick={() => {
                      onSelect(g.GodownID);
                      setOpen(false);
                    }}
                    className={`flex-1 px-3 py-2 text-left text-sm flex items-center gap-2 ${g.GodownID === selectedId ? "text-emerald-600" : "text-foreground"}`}
                  >
                    <Warehouse
                      size={13}
                      className={
                        g.GodownID === selectedId
                          ? "text-emerald-600"
                          : "text-muted-foreground"
                      }
                    />
                    <span className="flex-1 truncate">{g.GodownName}</span>
                    {g.IsMain && (
                      <span className="text-[9px] bg-emerald-500/15 text-emerald-600 px-1.5 py-0.5 rounded-full font-bold">
                        MAIN
                      </span>
                    )}
                  </button>
                  {!g.IsMain && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(false);
                        setConfirmDeleteId(g.GodownID);
                      }}
                      className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                      title="Delete godown"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
              {/* Create new godown — secondary option at the bottom */}
              <div className="border-t border-border mt-1 pt-1">
                <button
                  onClick={() => {
                    setOpen(false);
                    onCreateNew();
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center gap-2"
                >
                  <Plus size={12} /> Add new godown…
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportToCsv(
  rows: InventoryMasterRow[],
  date: string,
  godownName: string,
) {
  const headers = [
    "Date",
    "Godown",
    "Item Name",
    "Item Group",
    "UOM",
    "Opening Stock",
    "Stock In",
    "Stock Out",
    "Closing Stock",
  ];
  const csvRows = [
    headers.join(","),
    ...rows.map((r) =>
      [
        date,
        `"${godownName}"`,
        `"${(r.ItemName || "").replace(/"/g, '""')}"`,
        `"${(r.ItemGroupName || "").replace(/"/g, '""')}"`,
        r.UOMCode || "",
        r.OpeningStock,
        r.StockIn,
        r.StockOut,
        r.ClosingStock,
      ].join(","),
    ),
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory-${godownName.replace(/\s+/g, "-")}-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function InventoryMaster() {
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [selectedGodownId, setSelectedGodownId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [showCreateGodown, setShowCreateGodown] = useState(false);

  // ── Load godowns ─────────────────────────────────────────────────────────────
  const { data: godownsData } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  } as any);

  const godowns: Godown[] = godownsData?.data ?? [];

  // No auto-selection — user must pick a godown explicitly

  const selectedGodown = godowns.find((g) => g.GodownID === selectedGodownId);

  // ── Load inventory data ───────────────────────────────────────────────────────
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["inventory-master", selectedDate, selectedGodownId],
    queryFn: () => getInventoryMaster(selectedDate, selectedGodownId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !!selectedGodownId,
  });

  const rows: InventoryMasterRow[] = data?.data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.ItemName?.toLowerCase().includes(q) ||
        r.ItemGroupName?.toLowerCase().includes(q) ||
        r.UOMName?.toLowerCase().includes(q) ||
        r.UOMCode?.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => ({
          opening: acc.opening + r.OpeningStock,
          in: acc.in + r.StockIn,
          out: acc.out + r.StockOut,
          closing: acc.closing + r.ClosingStock,
        }),
        { opening: 0, in: 0, out: 0, closing: 0 },
      ),
    [filtered],
  );

  const toggleExpand = (itemId: string) =>
    setExpandedItemId((prev) => (prev === itemId ? null : itemId));

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Material Module", "Inventory Master"]}
      />
      <CreateGodownModal
        open={showCreateGodown}
        onClose={() => setShowCreateGodown(false)}
        onCreated={(id) => setSelectedGodownId(id)}
      />

      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
              <Package size={20} className="text-emerald-600" />
              Inventory Master
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Daily stock positions: opening, received, issued, and closing
              balance
            </p>
            {selectedGodown?.Description && (
              <p className="text-xs text-muted-foreground/70 mt-0.5 italic max-w-md truncate">
                {selectedGodown.Description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Godown Selector — create new is inside the dropdown as a subtle option */}
            <GodownSelector
              godowns={godowns}
              selectedId={selectedGodownId}
              onSelect={setSelectedGodownId}
              onCreateNew={() => setShowCreateGodown(true)}
              onDeleted={(id) => {
                if (selectedGodownId === id) {
                  const main = godowns.find(
                    (g) => g.IsMain && g.GodownID !== id,
                  );
                  setSelectedGodownId(main?.GodownID ?? null);
                }
              }}
            />

            {/* Date picker */}
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm cursor-pointer hover:bg-muted transition-colors">
              <Calendar size={14} className="text-muted-foreground" />
              <input
                type="date"
                value={selectedDate}
                max={today()}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent outline-none text-foreground text-xs font-medium"
              />
            </label>

            {/* Export */}
            <button
              onClick={() =>
                exportToCsv(
                  filtered,
                  selectedDate,
                  selectedGodown?.GodownName ?? "All",
                )
              }
              disabled={filtered.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              <Download size={13} /> Export CSV
            </button>

            {/* Refresh */}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />{" "}
              Refresh
            </button>
          </div>
        </div>

        {/* Godown info banner */}
        {selectedGodown && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-card">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              <Warehouse size={15} className="text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                {selectedGodown.GodownName}
                {selectedGodown.IsMain && (
                  <span className="text-[9px] bg-emerald-500/15 text-emerald-600 px-1.5 py-0.5 rounded-full font-bold tracking-wide">
                    MAIN GODOWN
                  </span>
                )}
              </p>
              {selectedGodown.ShortDesc && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {selectedGodown.ShortDesc}
                </p>
              )}
            </div>
            {selectedGodown.Remarks && (
              <p className="text-[11px] text-muted-foreground/70 italic hidden sm:block max-w-xs truncate">
                {selectedGodown.Remarks}
              </p>
            )}
          </div>
        )}

        {/* No godown selected state */}
        {!selectedGodownId && godowns.length > 0 && (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 py-14 text-center">
            <Warehouse
              size={32}
              className="text-muted-foreground/40 mx-auto mb-3"
            />
            <p className="text-sm text-muted-foreground">
              Select a godown to view its inventory
            </p>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={15} />
            Failed to load inventory data
            {(error as Error)?.message ? `: ${(error as Error).message}` : ""}
          </div>
        )}

        {/* Summary Cards */}
        {selectedGodownId && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              label="Opening Stock (Total)"
              value={fmtNum(totals.opening)}
              icon={Layers}
              color="text-blue-600"
              bg="bg-blue-500/10"
            />
            <SummaryCard
              label="Stock In (Today)"
              value={fmtNum(totals.in)}
              icon={TrendingUp}
              color="text-emerald-600"
              bg="bg-emerald-500/10"
            />
            <SummaryCard
              label="Stock Out (Today)"
              value={fmtNum(totals.out)}
              icon={TrendingDown}
              color="text-red-600"
              bg="bg-red-500/10"
            />
            <SummaryCard
              label="Closing Stock (Total)"
              value={fmtNum(totals.closing)}
              icon={Package}
              color="text-purple-600"
              bg="bg-purple-500/10"
            />
          </div>
        )}

        {/* Table */}
        {selectedGodownId && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-heading font-semibold text-foreground">
                  Stock Position
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedDate} · {filtered.length} item
                  {filtered.length !== 1 ? "s" : ""}
                  {search ? ` (filtered from ${rows.length})` : ""} · Click a
                  row to view ledger
                </p>
              </div>
              <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background text-xs">
                <Search size={13} className="text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search items, group, UOM…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-transparent outline-none text-foreground placeholder:text-muted-foreground w-44"
                />
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-3 w-8"></th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                      #
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                      Item Name
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                      Item Group
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                      UOM
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                      Opening Stock
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                      Stock In
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                      Stock Out
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                      Closing Stock
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: 9 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-3 bg-muted rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-12 text-center text-muted-foreground"
                      >
                        {search
                          ? "No items match your search."
                          : "No inventory data found for the selected date and godown."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row, idx) => {
                      const isExpanded = expandedItemId === row.ItemID;
                      return (
                        <React.Fragment key={row.ItemID}>
                          <tr
                            className={`border-b border-border hover:bg-muted/30 transition-colors cursor-pointer ${isExpanded ? "bg-muted/20" : ""}`}
                            onClick={() => toggleExpand(row.ItemID)}
                          >
                            <td className="px-4 py-3 text-muted-foreground">
                              {isExpanded ? (
                                <ChevronDown size={13} />
                              ) : (
                                <ChevronRight size={13} />
                              )}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground font-mono">
                              {idx + 1}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                                  <Package
                                    size={13}
                                    className="text-emerald-600"
                                  />
                                </span>
                                <span className="font-medium text-foreground">
                                  {row.ItemName || "—"}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {row.ItemGroupName || "—"}
                            </td>
                            <td className="px-4 py-3">
                              {row.UOMCode ? (
                                <span
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-400/20"
                                  title={row.UOMName || ""}
                                >
                                  {row.UOMCode}
                                  {row.UOMSymbol &&
                                  row.UOMSymbol !== row.UOMCode
                                    ? ` (${row.UOMSymbol})`
                                    : ""}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <StockBadge value={row.OpeningStock} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              {row.StockIn > 0 ? (
                                <span className="text-emerald-600 font-medium">
                                  +{fmtNum(row.StockIn)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {row.StockOut > 0 ? (
                                <span className="text-red-600 font-medium">
                                  -{fmtNum(row.StockOut)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span
                                className={`font-heading font-bold ${row.ClosingStock > 0 ? "text-emerald-600" : row.ClosingStock < 0 ? "text-red-600" : "text-muted-foreground"}`}
                              >
                                {fmtNum(row.ClosingStock)}
                              </span>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="border-b border-border">
                              <td colSpan={9} className="p-0">
                                <StockLedgerPanel itemId={row.ItemID} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
                {!isLoading && filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/60">
                      <td
                        colSpan={5}
                        className="px-4 py-3 font-semibold text-foreground"
                      >
                        Total ({filtered.length} items)
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-foreground">
                        {fmtNum(totals.opening)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600">
                        +{fmtNum(totals.in)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">
                        -{fmtNum(totals.out)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-foreground">
                        {fmtNum(totals.closing)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
