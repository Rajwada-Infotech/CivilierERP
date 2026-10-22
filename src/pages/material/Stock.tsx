import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, Search, ExternalLink } from "lucide-react";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getInventoryMaster, getItemStockLedger, type ItemLedgerRow } from "@/api/inventoryMasterApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import { DateInput } from "@/components/ui/date-input";

// ─── RefType presentation (Stock drill-down) ──────────────────────────────────
const REF_TYPE_META: Record<string, { label: string; route?: string }> = {
  GRN: { label: "GRN", route: "/material/grn" },
  ISS: { label: "Material Issue", route: "/material/issues" },
  IRN: { label: "Issue Return", route: "/material/issue-return" },
  TRF: { label: "Stock Transfer" },
  STKUPD: { label: "Stock Update", route: "/material/stock-update" },
  ICT: { label: "Inter-Company Transfer" },
  SO: { label: "Sale Order" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

const today = new Date().toISOString().slice(0, 10);

// Sheet styles
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const FIELD = "w-full px-3 py-2 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground disabled:opacity-50 disabled:cursor-not-allowed";
const TAG = "inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";
const TH = "px-4 py-3 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

// ─── SelectDropdown ───────────────────────────────────────────────────────────
function SelectDropdown({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string | number | null;
  onChange: (v: string | number | null) => void;
  options: { value: string | number; label: string; badge?: string }[];
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className={`block ${LBL} mb-1.5`}>{label}</label>
      <div className="relative">
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value ? (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) : null)}
          disabled={disabled}
          className={`${FIELD} pr-8 appearance-none`}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.badge ? ` [${o.badge}]` : ""}
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
      </div>
    </div>
  );
}

// ─── Godown Info ──────────────────────────────────────────────────────────────
function GodownInfoCard({ godown }: { godown: Godown }) {
  const facts = [
    ["Company", godown.EnterpriseName],
    ["Project", godown.ProjectName],
    ["Location", godown.Location],
    ["Remarks", godown.Remarks],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-5 py-4">
        <p className={LBL}>Godown</p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <p className="font-heading text-base font-bold tracking-tight text-foreground">{godown.GodownName}</p>
          {godown.GodownCode && <span className={`${TAG} border-foreground/40 text-muted-foreground`}>{godown.GodownCode}</span>}
          {!godown.IsActive && <span className={`${TAG} border-destructive text-destructive`}>Inactive</span>}
        </div>
        {godown.ShortDesc && <p className="text-xs text-muted-foreground mt-1">{godown.ShortDesc}</p>}
        {godown.Description && <p className="text-xs text-muted-foreground mt-0.5">{godown.Description}</p>}
      </div>
      {facts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4" style={{ borderTop: RULE }}>
          {facts.map(([label, v], i) => (
            <div key={label} className={`px-5 py-2.5 min-w-0 border-foreground ${i % 2 ? "border-l" : ""} ${i > 0 ? "sm:border-l" : ""} ${i >= 2 ? "border-t sm:border-t-0" : ""}`}>
              <p className={LBL}>{label}</p>
              <p className="text-xs text-foreground truncate mt-0.5" title={v}>{v}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function SummaryRow({ opening, stockIn, stockOut, closing }: { opening: number; stockIn: number; stockOut: number; closing: number }) {
  const cells: [string, string][] = [
    ["Opening stock", fmtNum(opening)],
    ["Stock in", `+${fmtNum(stockIn)}`],
    ["Stock out", `−${fmtNum(stockOut)}`],
    ["Closing stock", fmtNum(closing)],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 bg-card" style={{ border: RULE }}>
      {cells.map(([label, value], i) => (
        <div key={label} className={`px-4 py-3 border-foreground ${i % 2 ? "border-l" : ""} ${i > 0 ? "sm:border-l" : ""} ${i >= 2 ? "border-t sm:border-t-0" : ""}`}>
          <p className={LBL}>{label}</p>
          <p className={`font-heading text-xl font-bold tabular-nums mt-1 ${label === "Closing stock" && closing < 0 ? "text-destructive" : "text-foreground"}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Item Ledger Drill-down ───────────────────────────────────────────────────
function ItemLedgerModal({
  item,
  godownId,
  dateFrom,
  dateTo,
  onClose,
}: {
  item: { ItemID: string; ItemName: string | null } | null;
  godownId: number;
  dateFrom?: string;
  dateTo?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["item-stock-ledger", item?.ItemID, godownId, dateFrom, dateTo],
    queryFn: () => getItemStockLedger(item!.ItemID, godownId, dateFrom, dateTo),
    enabled: !!item,
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];

  const openDoc = (row: ItemLedgerRow) => {
    const meta = REF_TYPE_META[row.RefType];
    if (!meta?.route) return;
    onClose();
    navigate(`${meta.route}?view=${row.RefID}`);
  };

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sheet-frame max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0" style={{ margin: 0 }}>
        <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: RULE }}>
          <p className={LBL}>Stock movements</p>
          <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">{item?.ItemName || "Item"}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Every GRN, issue, return and other movement behind this item's in / out figures for the godown and period.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 bg-primary/5 animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No stock movements for this item in the selected period.</div>
        ) : (
          <div className="divide-y divide-foreground/10">
            {rows.map((row) => {
              const meta = REF_TYPE_META[row.RefType] ?? { label: row.RefType };
              const clickable = !!meta.route;
              const isIn = row.Type === "IN";
              return (
                <button
                  key={row.StockID}
                  type="button"
                  disabled={!clickable}
                  onClick={() => openDoc(row)}
                  className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${clickable ? "hover:bg-primary/5 cursor-pointer" : "cursor-default"}`}
                >
                  <span className={`${TAG} w-9 justify-center ${isIn ? "border-foreground text-foreground" : "border-foreground/40 text-muted-foreground"}`}>{isIn ? "In" : "Out"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-heading text-sm font-semibold text-foreground">{row.DocNo || `#${row.RefID}`}</span>
                      <span className={LBL}>{meta.label}</span>
                    </div>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">
                      {row.MovementDate ? new Date(row.MovementDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-heading font-bold text-sm tabular-nums">
                      {isIn ? "+" : "−"}
                      {fmtNum(row.Qty)}
                    </span>
                    {row.UOM && <p className="text-[0.625rem] text-muted-foreground">{row.UOM}</p>}
                  </div>
                  {clickable && <ExternalLink size={12} className="text-muted-foreground shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Stock Details Table ──────────────────────────────────────────────────────
function StockDetailsTable({ godownId, dateFrom, dateTo, projectName }: { godownId: number; dateFrom?: string; dateTo?: string; projectName?: string }) {
  const queryDate = dateTo || today;
  const { data, isLoading } = useQuery({
    queryKey: ["inventory-master", queryDate, godownId, dateFrom, dateTo],
    queryFn: () => getInventoryMaster(queryDate, godownId, dateFrom, dateTo),
    staleTime: 60_000,
  });

  const [itemSearch, setItemSearch] = useState("");
  const [appliedItemSearch, setAppliedItemSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<{ ItemID: string; ItemName: string | null } | null>(null);

  const allRows = data?.data ?? [];
  const q = appliedItemSearch.trim().toLowerCase();
  const rows = q
    ? allRows.filter((r) => r.ItemName?.toLowerCase().includes(q) || r.ItemGroupName?.toLowerCase().includes(q) || String(r.ItemID ?? "").includes(q))
    : allRows;
  const totals = rows.reduce(
    (acc, r) => ({ opening: acc.opening + r.OpeningStock, in: acc.in + r.StockIn, out: acc.out + r.StockOut, closing: acc.closing + r.ClosingStock }),
    { opening: 0, in: 0, out: 0, closing: 0 },
  );

  return (
    <div className="space-y-5">
      {!isLoading && <SummaryRow opening={totals.opening} stockIn={totals.in} stockOut={totals.out} closing={totals.closing} />}

      <div className="bg-card" style={{ border: RULE }}>
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: RULE }}>
          <div>
            <h3 className={HEAD}>Stock details{projectName ? ` · ${projectName}` : ""}</h3>
            <p className={`${LBL} mt-1 tabular-nums`}>
              {dateFrom ? `${dateFrom} to ` : "As of "}
              {queryDate} · {rows.length} item{rows.length !== 1 ? "s" : ""}
              {appliedItemSearch && ` matching "${appliedItemSearch}"`}
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setAppliedItemSearch(itemSearch);
              }}
              placeholder="Search item name, group, or ID…"
              className={`${FIELD} sm:w-60`}
            />
            <button type="button" onClick={() => setAppliedItemSearch(itemSearch)} className={`${KEY_INK} h-9 px-3 shrink-0`}>
              <Search size={12} /> Search
            </button>
            {appliedItemSearch && (
              <button
                type="button"
                onClick={() => {
                  setItemSearch("");
                  setAppliedItemSearch("");
                }}
                className={`${KEY} h-9 px-2 text-muted-foreground hover:text-foreground`}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: RULE }}>
                <th className={`${TH} text-left hidden sm:table-cell`}>#</th>
                <th className={`${TH} text-left`}>Item</th>
                <th className={`${TH} text-left hidden sm:table-cell`}>Group</th>
                <th className={`${TH} text-left hidden sm:table-cell`}>UOM</th>
                <th className={`${TH} text-right hidden md:table-cell`}>Opening</th>
                <th className={`${TH} text-right hidden sm:table-cell`}>In</th>
                <th className={`${TH} text-right hidden sm:table-cell`}>Out</th>
                <th className={`${TH} text-right`}>Closing</th>
                <th className={`${TH} text-right hidden md:table-cell`}>Customer rate</th>
                <th className={`${TH} text-right hidden sm:table-cell`}>Stock value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/10">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-primary/5 animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                    {appliedItemSearch ? `No items match "${appliedItemSearch}".` : "No stock data found for this godown."}
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr
                    key={`${row.ItemID}|${row.UOMCode ?? ""}`}
                    onClick={() => setSelectedItem({ ItemID: row.ItemID, ItemName: row.ItemName })}
                    title="See the GRNs, issues and returns behind this stock"
                    className="hover:bg-primary/5 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums hidden sm:table-cell">{idx + 1}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-foreground hover:underline">{row.ItemName || "—"}</span>
                      <div className="text-[0.625rem] text-muted-foreground sm:hidden">
                        {row.UOMSymbol || row.UOMName || ""}
                        {row.ItemGroupName ? ` · ${row.ItemGroupName}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{row.ItemGroupName || "—"}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      {row.UOMSymbol || row.UOMName ? (
                        <span title={row.UOMName ?? undefined} className={`${TAG} border-foreground/40 text-muted-foreground`}>
                          {row.UOMSymbol || row.UOMName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums hidden md:table-cell">{fmtNum(row.OpeningStock)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums hidden sm:table-cell">{row.StockIn > 0 ? `+${fmtNum(row.StockIn)}` : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums hidden sm:table-cell">{row.StockOut > 0 ? `−${fmtNum(row.StockOut)}` : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-heading font-bold tabular-nums ${row.ClosingStock < 0 ? "text-destructive" : row.ClosingStock === 0 ? "text-muted-foreground" : "text-foreground"}`}>
                        {fmtNum(row.ClosingStock)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums hidden md:table-cell">{row.CustomerRate != null ? `₹${fmtNum(row.CustomerRate)}` : "—"}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums hidden sm:table-cell ${row.CustomerRate != null && row.ClosingStock < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {row.CustomerRate != null && row.ClosingStock !== 0 ? `₹${fmtNum(row.ClosingStock * row.CustomerRate)}` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!isLoading && rows.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: RULE }}>
                  <td className="px-4 py-3 hidden sm:table-cell" />
                  <td className={`${TH} text-left`}>Total ({rows.length})</td>
                  <td className="px-4 py-3 hidden sm:table-cell" />
                  <td className="px-4 py-3 hidden sm:table-cell" />
                  <td className="px-4 py-3 text-right font-heading font-bold tabular-nums hidden md:table-cell">{fmtNum(totals.opening)}</td>
                  <td className="px-4 py-3 text-right font-heading font-bold tabular-nums hidden sm:table-cell">+{fmtNum(totals.in)}</td>
                  <td className="px-4 py-3 text-right font-heading font-bold tabular-nums hidden sm:table-cell">−{fmtNum(totals.out)}</td>
                  <td className="px-4 py-3 text-right font-heading font-bold tabular-nums">{fmtNum(totals.closing)}</td>
                  <td className="px-4 py-3 hidden md:table-cell" />
                  <td className="px-4 py-3 text-right font-heading font-bold tabular-nums hidden sm:table-cell">
                    ₹{fmtNum(rows.reduce((s, r) => s + (r.CustomerRate != null ? r.ClosingStock * r.CustomerRate : 0), 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <ItemLedgerModal item={selectedItem} godownId={godownId} dateFrom={dateFrom} dateTo={dateTo || queryDate} onClose={() => setSelectedItem(null)} />
    </div>
  );
}

// ─── Main Stock Page ──────────────────────────────────────────────────────────
export default function Stock() {
  const [selectedCompany, setSelectedCompany] = useState<number | null>(null);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedGodownId, setSelectedGodownId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>(today);

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

  // Company → Project: a project shows under every company it belongs to (its own and any it is
  // shared with); a project with no company link shows under all. No company = every project.
  const inCompany = (p: any, companyId: number) => !(p.company_id ?? p.enterprise_id) || projectBelongsToCompany(p, companyId);
  const filteredProjects = useMemo(() => (selectedCompany ? projects.filter((p: any) => inCompany(p, selectedCompany)) : projects), [projects, selectedCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredGodowns = useMemo(
    () =>
      godowns.filter(
        (g) => (selectedCompany ? g.EnterpriseID === selectedCompany : true) && (selectedProject ? g.ProjectID === selectedProject : true),
      ),
    [godowns, selectedCompany, selectedProject],
  );

  // If the selected godown drops out of the filtered list, move to the first one still in it.
  useEffect(() => {
    if (selectedGodownId !== null && filteredGodowns.length > 0 && !filteredGodowns.some((g) => g.GodownID === selectedGodownId)) {
      setSelectedGodownId(filteredGodowns[0]?.GodownID ?? null);
    }
  }, [filteredGodowns, selectedGodownId]);

  const selectedGodown = godowns.find((g) => g.GodownID === selectedGodownId);
  const badRange = !!dateFrom && !!dateTo && dateFrom > dateTo;

  const handleCompanyChange = (v: number | null) => {
    setSelectedCompany(v);
    // A project that doesn't belong to the newly selected company can't stay selected.
    if (v && selectedProject && !projects.some((p: any) => p.id === selectedProject && inCompany(p, v))) setSelectedProject(null);
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "Stock"]} />
      <SheetShell eyebrow="CivilierERP · Material" title="Stock" subtitle="What each godown holds: opening, in, out and closing for the period, with every movement behind an item.">
        <div className="space-y-5">
          {/* Filters */}
          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-3" style={{ borderBottom: RULE }}>
              <h3 className={HEAD}>Godown and period</h3>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SelectDropdown
                  label="Company"
                  value={selectedCompany}
                  onChange={(v) => handleCompanyChange(v as number | null)}
                  options={companies.map((c: any) => ({ value: c.id, label: c.label }))}
                  placeholder="All companies"
                />
                <SelectDropdown
                  label="Project"
                  value={selectedProject}
                  onChange={(v) => setSelectedProject(v as number | null)}
                  options={filteredProjects.map((p: any) => ({ value: p.id, label: p.label }))}
                  placeholder="All projects"
                />
                <SelectDropdown
                  label="Godown"
                  value={selectedGodownId}
                  onChange={(v) => setSelectedGodownId(v as number | null)}
                  options={filteredGodowns.map((g) => ({ value: g.GodownID, label: g.GodownName, badge: g.ProjectName ?? undefined }))}
                  placeholder={godownsLoading ? "Loading…" : "Select a godown"}
                  disabled={godownsLoading}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block ${LBL} mb-1.5`}>From date</label>
                  <DateInput value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={`block ${LBL} mb-1.5`}>To date</label>
                  <DateInput value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={FIELD} />
                </div>
              </div>
              {badRange && <p className="text-xs text-destructive">From date is after To date; set them the right way round to see stock for the period.</p>}
            </div>
          </div>

          {selectedGodown ? (
            <>
              <GodownInfoCard godown={selectedGodown} />
              {!badRange && <StockDetailsTable godownId={selectedGodown.GodownID} dateFrom={dateFrom} dateTo={dateTo} projectName={selectedGodown.ProjectName ?? undefined} />}
            </>
          ) : (
            <div className="bg-card py-20 text-center" style={{ border: RULE }}>
              <p className="text-sm text-foreground">Select a godown above to see its stock.</p>
              <p className="text-xs text-muted-foreground mt-1">Filter by company or project to find the right one.</p>
            </div>
          )}
        </div>
      </SheetShell>
    </>
  );
}
