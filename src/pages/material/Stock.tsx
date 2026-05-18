import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Warehouse,
  Building2,
  FolderKanban,
  RefreshCw,
  Package,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Layers,
  MapPin,
  Info,
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
          {godown.IsMain && (
            <span className="text-[9px] bg-emerald-500/15 text-emerald-600 px-2 py-0.5 rounded-full font-bold tracking-wide uppercase">
              Main Godown
            </span>
          )}
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
          color: "text-blue-600",
          bg: "bg-blue-500/10",
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
function StockDetailsTable({ godownId }: { godownId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["inventory-master", today, godownId],
    queryFn: () => getInventoryMaster(today, godownId),
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];
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
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-sm font-heading font-semibold text-foreground">
              Stock Details
            </p>
            <p className="text-xs text-muted-foreground">
              As of {today} · {rows.length} item{rows.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  #
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  Item Name
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  Group
                </th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">
                  UOM
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                  Opening
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                  In
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                  Out
                </th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">
                  Closing
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    No stock data found for this godown.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr
                    key={row.ItemID}
                    className="border-b border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground font-mono">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <Package size={11} className="text-emerald-600" />
                        </span>
                        <span className="font-medium text-foreground">
                          {row.ItemName || "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.ItemGroupName || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.UOMCode ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-400/20">
                          {row.UOMCode}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground font-mono">
                      {fmtNum(row.OpeningStock)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {row.StockIn > 0 ? (
                        <span className="text-emerald-600 font-medium">
                          +{fmtNum(row.StockIn)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
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
                  </tr>
                ))
              )}
            </tbody>
            {!isLoading && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/60">
                  <td
                    colSpan={4}
                    className="px-4 py-3 font-semibold text-foreground"
                  >
                    Total ({rows.length} items)
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
  );
}

// ─── Main Stock Page ──────────────────────────────────────────────────────────
export default function Stock() {
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedGodownId, setSelectedGodownId] = useState<number | null>(null);
  const autoSelected = React.useRef(false);

  // ── Load data ─────────────────────────────────────────────────────────────
  const { data: godownsData, isLoading: godownsLoading } = useQuery({
    queryKey: ["godowns"],
    queryFn: getGodowns,
    staleTime: 120_000,
  });
  const godowns: Godown[] = godownsData?.data ?? [];

  // Auto-select main godown on first load
  React.useEffect(() => {
    if (
      !autoSelected.current &&
      godowns.length > 0 &&
      selectedGodownId === null
    ) {
      const main = godowns.find((g) => g.IsMain) ?? godowns[0];
      setSelectedGodownId(main.GodownID);
      autoSelected.current = true;
    }
  }, [godowns]);

  const { data: companiesData } = useQuery({
    queryKey: ["enterprises-companies"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=C")
        .then((r) => r.json())
        .catch(() => []),
    staleTime: 300_000,
  });
  const companies = Array.isArray(companiesData) ? companiesData : [];

  const { data: projectsData } = useQuery({
    queryKey: ["enterprises-projects"],
    queryFn: () =>
      fetchWithAuth("/api/enterprises/options?business_type=P")
        .then((r) => r.json())
        .catch(() => []),
    staleTime: 300_000,
  });
  const projects = Array.isArray(projectsData) ? projectsData : [];

  // Filter godowns by both company AND project simultaneously (additive, not exclusive)
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

  // If current selected godown is no longer in filtered list, reset to main within filtered
  React.useEffect(() => {
    if (selectedGodownId !== null && filteredGodowns.length > 0) {
      const stillVisible = filteredGodowns.some(
        (g) => g.GodownID === selectedGodownId,
      );
      if (!stillVisible) {
        const main =
          filteredGodowns.find((g) => g.IsMain) ?? filteredGodowns[0];
        setSelectedGodownId(main?.GodownID ?? null);
      }
    }
  }, [filteredGodowns]);

  const selectedGodown = godowns.find((g) => g.GodownID === selectedGodownId);

  const handleCompanyChange = (v: number | null) => {
    setSelectedCompany(v);
    // Do NOT clear project — both filters are independent
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

      <div className="p-6 space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
            <Package size={20} className="text-emerald-600" />
            Stock
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            View stock details for a specific godown. Filter by company or
            project.
          </p>
        </div>

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
              options={projects.map((p: any) => ({
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
                badge: g.IsMain ? "Main" : undefined,
              }))}
              placeholder={godownsLoading ? "Loading…" : "Select Godown"}
              icon={Warehouse}
              disabled={godownsLoading}
            />
          </div>
        </div>

        {/* Godown details + stock */}
        {selectedGodown ? (
          <>
            <GodownInfoCard godown={selectedGodown} />
            <StockDetailsTable godownId={selectedGodown.GodownID} />
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 py-20 text-center">
            <Warehouse
              size={36}
              className="text-muted-foreground/30 mx-auto mb-3"
            />
            <p className="text-sm text-muted-foreground">
              Select a godown above to view its stock details
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Filter by company or project to narrow down the godown list
            </p>
          </div>
        )}
      </div>
    </>
  );
}
