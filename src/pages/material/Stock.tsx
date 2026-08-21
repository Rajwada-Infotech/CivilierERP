import React from "react";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { MaterialShell } from "@/components/material/MaterialShell";
import {
  Warehouse,
  Building2,
  FolderKanban,
  Package,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Layers,
  MapPin,
  Info,
  Search,
} from "lucide-react";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getInventoryMaster } from "@/api/inventoryMasterApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const today = new Date().toISOString().slice(0, 10);

// ─── SelectDropdown ───────────────────────────────────────────────────────────
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

// ─── Godown Info Card ─────────────────────────────────────────────────────────
function GodownInfoCard({ godown }: { godown: Godown }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-wrap gap-4 items-start">
      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
        <Warehouse size={18} className="text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-heading font-bold text-foreground">
            {godown.GodownName}
          </p>
          {godown.GodownCode && (
            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-mono">
              {godown.GodownCode}
            </span>
          )}
          {!godown.IsActive && (
            <span className="text-[9px] bg-red-500/10 text-red-600 px-2 py-0.5 rounded-full font-bold">
              INACTIVE
            </span>
          )}
        </div>
        {godown.ShortDesc && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {godown.ShortDesc}
          </p>
        )}
        {godown.Description && (
          <p className="text-xs text-muted-foreground/70 mt-0.5 italic">
            {godown.Description}
          </p>
        )}
        <div className="flex flex-wrap gap-3 mt-2">
          {godown.EnterpriseName && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Building2 size={10} /> {godown.EnterpriseName}
            </span>
          )}
          {godown.ProjectName && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <FolderKanban size={10} /> {godown.ProjectName}
            </span>
          )}
          {godown.Location && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin size={10} /> {godown.Location}
            </span>
          )}
          {godown.Remarks && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground italic">
              <Info size={10} /> {godown.Remarks}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────
function SummaryRow({
  opening,
  stockIn,
  stockOut,
  closing,
}: {
  opening: number;
  stockIn: number;
  stockOut: number;
  closing: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        {
          label: "Opening Stock",
          value: opening,
          icon: Layers,
          color: "text-emerald-600",
          bg: "bg-emerald-500/10",
        },
        {
          label: "Stock In",
          value: stockIn,
          icon: TrendingUp,
          color: "text-emerald-600",
          bg: "bg-emerald-500/10",
        },
        {
          label: "Stock Out",
          value: stockOut,
          icon: TrendingDown,
          color: "text-red-600",
          bg: "bg-red-500/10",
        },
        {
          label: "Closing Stock",
          value: closing,
          icon: Package,
          color: "text-purple-600",
          bg: "bg-purple-500/10",
        },
      ].map(({ label, value, icon: Icon, color, bg }) => (
        <div
          key={label}
          className="rounded-xl border border-border bg-card p-4 flex items-center gap-3"
        >
          <div
            className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center shrink-0`}
          >
            <Icon size={16} className={color} />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="text-sm font-heading font-bold text-foreground">
              {fmtNum(value)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Stock Details Table ──────────────────────────────────────────────────────
function StockDetailsTable({ godownId, dateFrom, dateTo, projectName }: {
  godownId: number;
  dateFrom?: string;
  dateTo?: string;
  projectName?: string;
}) {
  const queryDate = dateTo || today;
  const { data, isLoading } = useQuery({
    queryKey: ["inventory-master", queryDate, godownId, dateFrom, dateTo],
    queryFn: () => getInventoryMaster(queryDate, godownId, dateFrom, dateTo),
    staleTime: 60_000,
  });

  const [itemSearch, setItemSearch] = useState("");
  const [appliedItemSearch, setAppliedItemSearch] = useState("");

  const allRows = data?.data ?? [];
  const q = appliedItemSearch.trim().toLowerCase();
  const rows = q
    ? allRows.filter(
        (r) =>
          r.ItemName?.toLowerCase().includes(q) ||
          r.ItemGroupName?.toLowerCase().includes(q) ||
          String(r.ItemID ?? "").includes(q),
      )
    : allRows;
  const totals = rows.reduce(
    (acc, r) => ({
      opening: acc.opening + r.OpeningStock,
      in: acc.in + r.StockIn,
      out: acc.out + r.StockOut,
      closing: acc.closing + r.ClosingStock,
    }),
    { opening: 0, in: 0, out: 0, closing: 0 },
  );

  return (
    <div className="space-y-4">
      {/* Summary */}
      {!isLoading && (
        <SummaryRow
          opening={totals.opening}
          stockIn={totals.in}
          stockOut={totals.out}
          closing={totals.closing}
        />
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-heading font-semibold text-foreground">
              Stock Details{projectName ? ` — ${projectName}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {dateFrom ? `${dateFrom} to ` : "As of "}{queryDate} · {rows.length} item{rows.length !== 1 ? "s" : ""}
              {appliedItemSearch && ` matching "${appliedItemSearch}"`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setAppliedItemSearch(itemSearch);
              }}
              placeholder="Search item name, group, or ID…"
              className="w-56 px-3 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
            <button
              type="button"
              onClick={() => setAppliedItemSearch(itemSearch)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors"
            >
              <Search size={12} /> Search
            </button>
            {appliedItemSearch && (
              <button
                type="button"
                onClick={() => {
                  setItemSearch("");
                  setAppliedItemSearch("");
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground hidden sm:table-cell">
                  #
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  Item Name
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground hidden sm:table-cell">
                  Group
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground hidden sm:table-cell">
                  UOM
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground hidden md:table-cell">
                  Opening
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground hidden sm:table-cell">
                  In
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground hidden sm:table-cell">
                  Out
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                  Closing
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground hidden md:table-cell">
                  Customer Rate
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground hidden sm:table-cell">
                  Stock Value
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    {appliedItemSearch
                      ? `No items match "${appliedItemSearch}".`
                      : "No stock data found for this godown."}
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr
                    key={row.ItemID}
                    className="border-b border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground font-mono hidden sm:table-cell">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <Package size={11} className="text-emerald-600" />
                        </span>
                        <div className="min-w-0">
                          <span className="font-medium text-foreground">
                            {row.ItemName || "—"}
                          </span>
                          <div className="text-[10px] text-muted-foreground sm:hidden">
                            {row.UOMSymbol || row.UOMName || ""}
                            {row.ItemGroupName ? ` · ${row.ItemGroupName}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                      {row.ItemGroupName || "—"}
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      {row.UOMSymbol || row.UOMName ? (
                        <span
                          title={row.UOMName ?? undefined}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-400/20"
                        >
                          {row.UOMSymbol || row.UOMName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground font-mono hidden md:table-cell">
                      {fmtNum(row.OpeningStock)}
                    </td>
                    <td className="px-4 py-2.5 text-right hidden sm:table-cell">
                      {row.StockIn > 0 ? (
                        <span className="text-emerald-600 font-medium">
                          +{fmtNum(row.StockIn)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right hidden sm:table-cell">
                      {row.StockOut > 0 ? (
                        <span className="text-red-600 font-medium">
                          -{fmtNum(row.StockOut)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
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
                    <td className="px-4 py-2.5 text-right text-muted-foreground hidden md:table-cell">
                      {row.CustomerRate != null ? `₹${fmtNum(row.CustomerRate)}` : "—"}
                    </td>
                    <td className={`px-4 py-2.5 text-right hidden sm:table-cell ${row.CustomerRate != null && row.ClosingStock < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                      {row.CustomerRate != null && row.ClosingStock !== 0
                        ? `₹${fmtNum(row.ClosingStock * row.CustomerRate)}`
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!isLoading && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/60">
                  <td className="px-4 py-3 hidden sm:table-cell" />
                  <td className="px-4 py-3 font-semibold text-foreground">
                    Total ({rows.length})
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell" />
                  <td className="px-4 py-3 hidden sm:table-cell" />
                  <td className="px-4 py-3 text-right font-bold text-foreground hidden md:table-cell">
                    {fmtNum(totals.opening)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600 hidden sm:table-cell">
                    +{fmtNum(totals.in)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-red-600 hidden sm:table-cell">
                    -{fmtNum(totals.out)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-foreground">
                    {fmtNum(totals.closing)}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell" />
                  <td className="px-4 py-3 text-right font-bold text-foreground hidden sm:table-cell">
                    ₹{fmtNum(rows.reduce((s, r) => s + (r.CustomerRate != null ? r.ClosingStock * r.CustomerRate : 0), 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main Stock Page ──────────────────────────────────────────────────────────
export default function Stock() {
  const rights = usePageRights("stock-ledger");
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedGodownId, setSelectedGodownId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>(today);

  // ── Load data ─────────────────────────────────────────────────────────────
  const { data: godownsData, isLoading: godownsLoading } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  });
  const godowns: Godown[] = godownsData?.data ?? [];

  const { data: companiesData } = useQuery({
    queryKey: ["enterprises-companies"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=C")
        .then((r) => r.json().catch(() => ({})))
        .catch(() => []),
    staleTime: 300_000,
  });
  const companies = Array.isArray(companiesData) ? companiesData : [];

  const { data: projectsData } = useQuery({
    queryKey: ["enterprises-projects"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=P")
        .then((r) => r.json().catch(() => ({})))
        .catch(() => []),
    staleTime: 300_000,
  });
  const projects = Array.isArray(projectsData) ? projectsData : [];

  // Hierarchical Company → Project: only projects belonging to the
  // selected company show up at all (mirrors Quotation.tsx's own
  // company_id/enterprise_id fallback for legacy rows with no company
  // link). "All Companies" (no selection) shows every project, same as
  // before.
  const filteredProjects = useMemo(() => {
    if (!selectedCompany) return projects;
    return projects.filter(
      (p: any) =>
        String(p.company_id ?? p.enterprise_id) === String(selectedCompany) ||
        !(p.company_id ?? p.enterprise_id),
    );
  }, [projects, selectedCompany]);

  // Filter godowns: exclude Main Godown, then apply company/project filters
  const filteredGodowns = useMemo(() => {
    return godowns.filter((g) => {
      const companyMatch = selectedCompany
        ? g.EnterpriseID === selectedCompany
        : true;
      const projectMatch = selectedProject
        ? g.ProjectID === selectedProject
        : true;
      return companyMatch && projectMatch;
    });
  }, [godowns, selectedCompany, selectedProject]);

  // If current selected godown is no longer in filtered list, reset to first project godown within filtered
  React.useEffect(() => {
    if (selectedGodownId !== null && filteredGodowns.length > 0) {
      const stillVisible = filteredGodowns.some(
        (g) => g.GodownID === selectedGodownId,
      );
      if (!stillVisible) {
        setSelectedGodownId(filteredGodowns[0]?.GodownID ?? null);
      }
    }
  }, [filteredGodowns, selectedGodownId]);

  const selectedGodown = godowns.find((g) => g.GodownID === selectedGodownId);

  const handleCompanyChange = (v: number | null) => {
    setSelectedCompany(v);
    // Hierarchical now — a project that doesn't belong to the newly
    // selected company can't stay selected (it wouldn't appear in the
    // now-scoped Project dropdown options anyway).
    if (v && selectedProject) {
      const stillValid = projects.some(
        (p: any) =>
          p.id === selectedProject &&
          (String(p.company_id ?? p.enterprise_id) === String(v) || !(p.company_id ?? p.enterprise_id)),
      );
      if (!stillValid) setSelectedProject(null);
    }
  };

  const handleProjectChange = (v: number | null) => {
    setSelectedProject(v);
    // Do NOT clear company — both filters are independent
  };

  const handleGodownChange = (v: number | null) => {
    setSelectedGodownId(v);
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Stock"]} />

      <MaterialShell
        title="Stock Overview"
        subtitle="Current stock levels by godown"
        icon={Package}
      >
        {/* Filter panel */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Select Godown
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SelectDropdown
              label="Company"
              value={selectedCompany}
              onChange={(v) => handleCompanyChange(v as number | null)}
              options={companies.map((c: any) => ({
                value: c.id,
                label: c.label,
              }))}
              placeholder="All Companies"
              icon={Building2}
            />
            <SelectDropdown
              label="Project"
              value={selectedProject}
              onChange={(v) => handleProjectChange(v as number | null)}
              options={filteredProjects.map((p: any) => ({
                value: p.id,
                label: p.label,
              }))}
              placeholder="All Projects"
              icon={FolderKanban}
            />
            <SelectDropdown
              label="Godown / Warehouse"
              value={selectedGodownId}
              onChange={(v) => handleGodownChange(v as number | null)}
              options={filteredGodowns.map((g) => ({
                value: g.GodownID,
                label: g.GodownName,
                badge: g.ProjectName ?? undefined,
              }))}
              placeholder={
                godownsLoading ? "Loading…" : "Select Project Godown"
              }
              icon={Warehouse}
              disabled={godownsLoading}
            />
          </div>
          {/* Date range filter */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground block">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-emerald-500/30 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground block">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:ring-2 focus:ring-emerald-500/30 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert"
              />
            </div>
          </div>
        </div>

        {/* Godown details + stock */}
        {selectedGodown ? (
          <>
            <GodownInfoCard godown={selectedGodown} />
            <StockDetailsTable godownId={selectedGodown.GodownID} dateFrom={dateFrom} dateTo={dateTo} projectName={selectedGodown.ProjectName ?? undefined} />
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 py-20 text-center">
            <Warehouse
              size={36}
              className="text-muted-foreground/30 mx-auto mb-3"
            />
            <p className="text-sm text-muted-foreground">
              Select a project godown above to view its stock details
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Filter by company or project to find the right godown
            </p>
          </div>
        )}
      </MaterialShell>
    </>
  );
}
