import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import {
  getInventoryMaster,
  type InventoryMasterRow,
} from "@/api/inventoryMasterApi";
import { getStockLedger } from "@/api/stockLedgerApi";

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

// ─── Sub-components ───────────────────────────────────────────────────────────
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

// ─── Stock Ledger Panel (per item drill-down) ─────────────────────────────────
function StockLedgerPanel({ itemId }: { itemId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["stock-ledger-item", itemId],
    queryFn: () => getStockLedger({ itemId, limit: 50, page: 1 }),
    staleTime: 60_000,
  });

  const entries = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="px-6 py-4 flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw size={12} className="animate-spin" /> Loading ledger…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="px-6 py-4 text-xs text-muted-foreground italic">
        No ledger entries found for this item.
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-muted/20">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Stock ID
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Item Name
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Type
              </th>
              <th className="px-4 py-2 text-right font-semibold text-muted-foreground">
                Qty
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                UOM
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Ref Type
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Doc No
              </th>
              <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                Date
              </th>
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
      {(data?.total ?? 0) > 50 && (
        <p className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border">
          Showing 50 of {data?.total} entries
        </p>
      )}
    </div>
  );
}

// ─── Export to CSV ────────────────────────────────────────────────────────────
function exportToCsv(rows: InventoryMasterRow[], date: string) {
  const headers = [
    "Date",
    "Item Name",
    "Item Group",
    "UOM",
    "UOM Symbol",
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
        `"${(r.ItemName || "").replace(/"/g, '""')}"`,
        `"${(r.ItemGroupName || "").replace(/"/g, '""')}"`,
        r.UOMCode || "",
        r.UOMSymbol || "",
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
  a.download = `inventory-master-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function InventoryMaster() {
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [search, setSearch] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["inventory-master", selectedDate],
    queryFn: () => getInventoryMaster(selectedDate),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows: InventoryMasterRow[] = data?.data ?? [];

  // ── Search filter ────────────────────────────────────────────────────────────
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

  // ── Summary totals ───────────────────────────────────────────────────────────
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

      <div className="p-6 space-y-5">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
              <Package size={20} className="text-emerald-600" />
              Inventory Master
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Daily stock positions: opening, received, issued, and closing
              balance
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
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
              onClick={() => exportToCsv(filtered, selectedDate)}
              disabled={filtered.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              <Download size={13} />
              Export CSV
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
              />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Error banner ─────────────────────────────────────────────────── */}
        {isError && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={15} />
            Failed to load inventory data
            {(error as Error)?.message ? `: ${(error as Error).message}` : ""}.
            Please refresh.
          </div>
        )}

        {/* ── Summary cards ─────────────────────────────────────────────────── */}
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

        {/* ── Table card ──────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Table header / search bar */}
          <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-heading font-semibold text-foreground">
                Stock Position
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedDate} · {filtered.length} item
                {filtered.length !== 1 ? "s" : ""}
                {search ? ` (filtered from ${rows.length})` : ""}
                {" · "}
                <span className="text-muted-foreground/70">
                  Click a row to view ledger entries
                </span>
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

          {/* Table */}
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
                        : "No inventory data found for the selected date."}
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
                          {/* Expand toggle */}
                          <td className="px-4 py-3 text-muted-foreground">
                            {isExpanded ? (
                              <ChevronDown size={13} />
                            ) : (
                              <ChevronRight size={13} />
                            )}
                          </td>

                          {/* # */}
                          <td className="px-4 py-3 text-muted-foreground font-mono">
                            {idx + 1}
                          </td>

                          {/* Item Name */}
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

                          {/* Item Group */}
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.ItemGroupName || "—"}
                          </td>

                          {/* UOM */}
                          <td className="px-4 py-3">
                            {row.UOMCode ? (
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-400/20"
                                title={row.UOMName || ""}
                              >
                                {row.UOMCode}
                                {row.UOMSymbol && row.UOMSymbol !== row.UOMCode
                                  ? ` (${row.UOMSymbol})`
                                  : ""}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>

                          {/* Opening Stock */}
                          <td className="px-4 py-3 text-right">
                            <StockBadge value={row.OpeningStock} />
                          </td>

                          {/* Stock In */}
                          <td className="px-4 py-3 text-right">
                            {row.StockIn > 0 ? (
                              <span className="text-emerald-600 font-medium">
                                +{fmtNum(row.StockIn)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>

                          {/* Stock Out */}
                          <td className="px-4 py-3 text-right">
                            {row.StockOut > 0 ? (
                              <span className="text-red-600 font-medium">
                                -{fmtNum(row.StockOut)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>

                          {/* Closing Stock */}
                          <td className="px-4 py-3 text-right">
                            <span
                              className={`font-heading font-bold ${
                                row.ClosingStock > 0
                                  ? "text-emerald-600"
                                  : row.ClosingStock < 0
                                    ? "text-red-600"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {fmtNum(row.ClosingStock)}
                            </span>
                          </td>
                        </tr>

                        {/* ── Ledger drill-down ── */}
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

              {/* Totals footer */}
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
      </div>
    </>
  );
}
