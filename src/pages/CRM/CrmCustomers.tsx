// CRM Customers: ultra-professional enterprise customer registry built on CrmGrid, server pagination/sorting,
// KYC completeness & billing views, saved views, column chooser, batch CSV export, and streamlined profile dialogs.
import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookUser, Download, ExternalLink, FilePlus2, MoreHorizontal, PenSquare,
  Plus, RefreshCw, Trash2, Upload, UserCheck, Users,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { useSheetAsk } from "@/components/sheet/SheetAsk";
import {
  CrmGrid, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_KEY, GRID_KEY_BRAND, GRID_MENU_GLASS,
  GridColumnChooser, GridSavedViews, GridSearch, GridTabs,
  exportGrid, gridListMeta, gridVisibleCols, useGridPrefs,
  type GridCol, type GridSavedView,
} from "@/components/crm/CrmDataTable";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { useSticky, type CrmSort } from "@/hooks/useCrmListState";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { Initials, asName } from "./payments/parts";
import { CrmCustomerImportDialog } from "./CrmCustomerImportDialog";
import {
  API, PAGE_SIZE, TONE_AMBER_PILL, TONE_EMERALD_PILL, TONE_ROSE_PILL,
  fetchCustomerCounts, fetchCustomersList, fetchLeadPool,
  type CustomerListFilters, type CustomerView,
} from "./customers/config";
import { NewCustomerDialog } from "./customers/NewCustomerDialog";
import { CustomerDialog } from "./customers/CustomerDialog";

const fmtDate = (d: string | null) =>
  (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const VIEW_TABS: { key: CustomerView; label: string }[] = [
  { key: "all", label: "All Customers" },
  { key: "withApps", label: "Active Buyers" },
  { key: "missingKyc", label: "Missing KYC" },
  { key: "invoice", label: "Invoice Billing" },
  { key: "noApps", label: "No Apps Yet" },
];

export default function CrmCustomers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ask = useSheetAsk();
  const { canCreate, canEdit, canDelete } = usePageRights("crm-customers");
  const { canCreate: canCreateApp } = usePageRights("crm-applications");

  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setViewRaw] = useState<CustomerView>("all");
  const [focus, setFocusRaw] = useState<string>("");
  const [invoiceFilter, setInvoiceFilter] = useState<string>("All");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cpb, setCpbRaw] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [sort, setSort] = useState<CrmSort>({ key: "CreatedAt", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);

  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [startEditing, setStartEditing] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });

  const setView = (next: CustomerView) => {
    setViewRaw(next);
    setFocusRaw("");
    if (next === "invoice") setInvoiceFilter("All");
    setPage(1);
  };
  const setFocus = (next: string) => { setFocusRaw(next); setPage(1); };
  const setCpb = (next: CrmCompanyProjectBlockValue) => { setCpbRaw(next); setPage(1); };

  const openId = Number(searchParams.get("customerId")) || null;
  const leadId = searchParams.get("leadId");
  const openCustomer = (id: number, edit = false) => {
    setStartEditing(edit);
    setSearchParams((sp) => { sp.set("customerId", String(id)); return sp; }, { replace: true });
  };
  const closeCustomer = () => setSearchParams((sp) => { sp.delete("customerId"); return sp; }, { replace: true });
  const closeNew = () => {
    setNewOpen(false);
    if (leadId) setSearchParams((sp) => { sp.delete("leadId"); return sp; }, { replace: true });
  };

  const filters: CustomerListFilters = useMemo(() => ({
    search,
    companyId: cpb.companyId,
    projectId: cpb.projectId,
    blockId: cpb.blockId,
    view,
    invoiceMode: view === "invoice" ? "All" : invoiceFilter,
    focus: focus || undefined,
    sortKey: sort.key,
    sortDir: sort.dir,
  }), [search, cpb, view, invoiceFilter, focus, sort]);

  const listQ = useQuery({
    queryKey: ["crm-customers", filters, page, pageSize],
    queryFn: () => fetchCustomersList(filters, page, pageSize),
    staleTime: 30_000,
  });

  const countsQ = useQuery({
    queryKey: ["crm-customers-counts", search, cpb],
    queryFn: () => fetchCustomerCounts({ search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    staleTime: 30_000,
  });

  const { data: pool = [] } = useQuery({ queryKey: ["crm-leads-pool"], queryFn: fetchLeadPool, staleTime: 30_000 });
  const leadsWaiting = pool.filter((l) => !l.CustomerId).length;

  const { data: opened } = useQuery({
    queryKey: ["crm-customer-detail", openId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${openId}`);
      return r.ok ? r.json() : null;
    },
    enabled: openId != null,
  });

  const stickyList = useSticky(listQ.data);
  const stickyCounts = useSticky(countsQ.data);
  const rows = useMemo(() => stickyList?.rows ?? [], [stickyList?.rows]);
  const total = stickyList?.total ?? 0;

  const hasFilters = !!(search || cpb.companyId || cpb.projectId || cpb.blockId || (invoiceFilter !== "All" && view !== "invoice") || focus);
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setCpbRaw({ companyId: "", projectId: "", blockId: "" });
    setInvoiceFilter("All");
    setFocusRaw("");
    setPage(1);
  };

  const handleDeleteCustomer = (c: any) => {
    void ask.confirm(`Delete ${c.CustomerName} (${c.CustomerNo}) permanently? This cannot be undone.`, {
      title: "Delete customer",
      okLabel: "Delete",
      danger: true,
    }).then(async (yes) => {
      if (!yes) return;
      setDeletingId(c.Id);
      try {
        const res = await fetchWithAuth(`${API}/${c.Id}`, { method: "DELETE" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not delete the customer.");
        toast.success(`${c.CustomerNo} deleted`);
        ["crm-customers", "crm-customers-counts", "crm-leads-pool"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      } catch (e: any) {
        toast.error(translateError(e.message));
      } finally {
        setDeletingId(null);
      }
    });
  };

  const cols: GridCol<any>[] = useMemo(() => [
    {
      id: "customer",
      label: "Customer",
      sortKey: "CustomerName",
      locked: true,
      csv: (c) => `${c.CustomerName || ""} (${c.CustomerNo || ""})`,
      cell: (c) => (
        <div className="flex items-center gap-2.5 min-w-0 py-0.5 max-w-[260px]">
          <Initials name={c.CustomerName} />
          <div className="min-w-0">
            <div className="text-[0.8125rem] font-medium text-foreground truncate capitalize" title={c.CustomerName}>
              {asName(c.CustomerName)}
            </div>
            <div className="text-[0.6875rem] text-muted-foreground tabular-nums truncate">
              {c.CustomerNo}{c.LeadUid ? ` · from ${c.LeadUid}` : ""}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "contact",
      label: "Contact",
      sortKey: "Mobile",
      csv: (c) => [c.Mobile, c.Email].filter(Boolean).join(" / "),
      cell: (c) => (
        <div className="min-w-0 leading-tight max-w-[210px]">
          <div className="text-xs font-medium text-foreground tabular-nums truncate">
            {c.Mobile || <span className="text-muted-foreground">—</span>}
            {c.AltMobile && <span className="text-muted-foreground font-normal"> · {c.AltMobile}</span>}
          </div>
          <div className="text-[0.6875rem] text-muted-foreground truncate mt-0.5" title={c.Email || undefined}>
            {c.Email || "No email"}
          </div>
        </div>
      ),
    },
    {
      id: "kyc",
      label: "KYC",
      sortKey: "PanNo",
      csv: (c) => c.PanNo || "Missing PAN",
      cell: (c) => (
        <div className="min-w-0 leading-tight">
          {c.PanNo ? (
            <div className="text-xs font-mono font-medium text-foreground tabular-nums">{c.PanNo}</div>
          ) : (
            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_AMBER_PILL)}>
              Missing PAN
            </span>
          )}
          <div className="text-[0.6875rem] font-mono text-muted-foreground tabular-nums mt-0.5 truncate">
            {c.AadhaarNo ? `UID ${c.AadhaarNo}` : "No Aadhaar"}
          </div>
        </div>
      ),
    },
    {
      id: "location",
      label: "City / State",
      sortKey: "City",
      csv: (c) => [c.PermanentCity || c.CurrentCity, c.PermanentState || c.CurrentState, c.PermanentPincode || c.CurrentPincode].filter(Boolean).join(", "),
      cell: (c) => {
        const cityState = [c.CurrentCity || c.PermanentCity, c.CurrentState || c.PermanentState].filter(Boolean).join(", ");
        const pin = c.CurrentPincode || c.PermanentPincode;
        return (
          <div className="min-w-0 leading-tight max-w-[175px]">
            <div className="text-xs text-foreground truncate" title={cityState || undefined}>{cityState || <span className="text-muted-foreground">—</span>}</div>
            {pin && <div className="text-[0.6875rem] text-muted-foreground tabular-nums mt-0.5">{pin}</div>}
          </div>
        );
      },
    },
    {
      id: "projects",
      label: "Projects",
      csv: (c) => String(c.ProjectNames || "").split("|").filter(Boolean).join(", "),
      cell: (c) => {
        const names = String(c.ProjectNames || "").split("|").filter(Boolean);
        if (!names.length) return <span className="text-xs text-muted-foreground">None yet</span>;
        return (
          <div className="text-xs text-foreground truncate max-w-[195px]" title={names.join(", ")}>
            {names.slice(0, 2).join(", ")}{names.length > 2 ? <span className="text-muted-foreground"> +{names.length - 2}</span> : ""}
          </div>
        );
      },
    },
    {
      id: "billing",
      label: "Billing Mode",
      sortKey: "InvoiceMode",
      csv: (c) => c.InvoiceMode === "Invoice" ? "Invoice (GST)" : "Non-invoice",
      cell: (c) => c.InvoiceMode === "Invoice" ? (
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", TONE_EMERALD_PILL)}>
          Invoice
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
          Non-invoice
        </span>
      ),
    },
    {
      id: "apps",
      label: "Applications",
      sortKey: "ApplicationCount",
      align: "right",
      csv: (c) => Number(c.ApplicationCount || 0),
      cell: (c) => {
        const count = Number(c.ApplicationCount || 0);
        return (
          <span className={cn(
            "inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-xs font-semibold tabular-nums",
            count > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {count}
          </span>
        );
      },
    },
    {
      id: "registered",
      label: "Registered",
      sortKey: "CreatedAt",
      csv: (c) => c.CreatedAt ? String(c.CreatedAt).slice(0, 10) : "",
      cell: (c) => (
        <div className="min-w-0 leading-tight whitespace-nowrap">
          <div className="text-xs tabular-nums text-foreground">{fmtDate(c.CreatedAt)}</div>
          {c.CreatedByName && <div className="text-[0.6875rem] text-muted-foreground truncate mt-0.5 max-w-[130px]">{c.CreatedByName}</div>}
        </div>
      ),
    },
    {
      id: "actions",
      label: "",
      align: "right",
      locked: true,
      cell: (c) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(GRID_KEY, "h-7 w-7 !px-0")}
                title="Actions"
                aria-label={`Actions for ${c.CustomerName}`}
              >
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={cn("w-52", GRID_MENU_GLASS)}>
              <DropdownMenuItem onClick={() => openCustomer(c.Id, false)} className="gap-2">
                <UserCheck size={13} /> View profile
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem onClick={() => openCustomer(c.Id, true)} className="gap-2">
                  <PenSquare size={13} /> Edit details
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate(`/crm/customer-360?id=${c.Id}`)} className="gap-2">
                <ExternalLink size={13} /> Open Customer 360
              </DropdownMenuItem>
              {canCreateApp && (
                <DropdownMenuItem onClick={() => navigate(`/crm/applications?new=1&customerId=${c.Id}`)} className="gap-2">
                  <FilePlus2 size={13} /> New application
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={deletingId === c.Id}
                    onClick={() => handleDeleteCustomer(c)}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 size={13} /> Delete customer
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ], [canEdit, canDelete, canCreateApp, deletingId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const [prefs, setPrefs] = useGridPrefs("crm-customers-grid-v1", cols);
  const visibleCols = useMemo(() => gridVisibleCols(cols, prefs), [cols, prefs]);

  const currentViewSnapshot = (): Omit<GridSavedView, "name"> => ({
    status: view,
    search,
    cpb,
    sort,
    pageSize,
    extra: { invoiceFilter, focus },
  });

  const applySavedView = (v: GridSavedView) => {
    const nextView = (v.status as CustomerView) || "all";
    setViewRaw(VIEW_TABS.some((t) => t.key === nextView) ? nextView : "all");
    setSearchInput(v.search || "");
    setSearch(v.search || "");
    setCpbRaw(v.cpb || { companyId: "", projectId: "", blockId: "" });
    if (v.sort) setSort(v.sort);
    if (v.pageSize) setPageSize(v.pageSize);
    const ex = v.extra || {};
    setInvoiceFilter(typeof ex.invoiceFilter === "string" ? ex.invoiceFilter : "All");
    setFocusRaw(typeof ex.focus === "string" ? ex.focus : "");
    setPage(1);
  };

  const handleSort = (sortKey: string) => {
    setSort((prev) => (prev.key === sortKey ? { key: sortKey, dir: prev.dir === "asc" ? "desc" : "asc" } : { key: sortKey, dir: "asc" }));
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const BATCH = 200;
      const first = await fetchCustomersList(filters, 1, BATCH);
      const all = [...first.rows];
      const totalPages = Math.ceil(first.total / BATCH);
      for (let p = 2; p <= totalPages; p++) {
        const next = await fetchCustomersList(filters, p, BATCH);
        all.push(...next.rows);
      }
      exportGrid(all, visibleCols, "crm-customers.csv");
      toast.success(`Exported ${all.length} customer${all.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(translateError(e?.message || "Export failed"));
    } finally {
      setExporting(false);
    }
  };

  const tabs = useMemo(() => VIEW_TABS.map((t) => ({
    key: t.key,
    label: t.label,
    count: stickyCounts ? stickyCounts[t.key] : undefined,
  })), [stickyCounts]);

  const kycChips = useMemo(() => [
    { key: "missingPan", label: "Missing PAN", count: stickyCounts?.missingPan },
    { key: "missingEmail", label: "Missing Email", count: stickyCounts?.missingEmail },
    { key: "missingAddress", label: "Missing Address", count: stickyCounts?.missingAddress },
  ], [stickyCounts]);

  return (
    <>
      {ask.node}
      <div className="space-y-4">
        <Breadcrumbs items={["Dashboard", "CRM", "Customers"]} />

        {/* Page Masthead — crisp enterprise header aligned with Bookings / Applications */}
        <section className="rounded-xl border border-border bg-card px-5 py-4 shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users size={13} className="text-primary" />
                <span>CRM · Identity Registry</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-foreground mt-0.5">Customers</h1>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-[78ch]">
                Identity, KYC, addresses and billing profiles linked across applications, bookings and Finance ledger heads.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => { listQ.refetch(); countsQ.refetch(); }}
                disabled={listQ.isFetching}
                className={cn(GRID_KEY, "h-9 w-9 !px-0")}
                title="Refresh"
                aria-label="Refresh customers"
              >
                <RefreshCw size={14} className={listQ.isFetching ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || total === 0}
                className={GRID_BTN}
              >
                <Download size={13} />
                <span>{exporting ? "Exporting…" : "Export"}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/masters/customers")}
                className={GRID_BTN}
                title="Every CRM customer maintains a matching Finance ledger head"
              >
                <BookUser size={13} />
                <span className="hidden sm:inline">Ledger heads</span>
              </button>
              {canCreate && (
                <>
                  <button type="button" onClick={() => setImportOpen(true)} className={GRID_BTN}>
                    <Upload size={13} />
                    <span className="hidden sm:inline">Import</span>
                  </button>
                  <button type="button" onClick={() => setNewOpen(true)} className={GRID_BTN_BRAND}>
                    <Plus size={14} />
                    <span>New customer</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Main Grid Card */}
        <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
          <GridTabs
            tabs={tabs}
            active={view}
            onChange={(k) => setView(k)}
            label="Customer views"
            panelId="crm-customers-grid-panel"
            end={leadsWaiting > 0 ? (
              <button
                type="button"
                onClick={() => navigate("/crm/leads")}
                className={cn(
                  "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors",
                  TONE_AMBER_PILL,
                  "hover:opacity-85",
                )}
              >
                <span>{leadsWaiting} converted lead{leadsWaiting === 1 ? "" : "s"} waiting →</span>
              </button>
            ) : undefined}
          />

          {view === "missingKyc" && (
            <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground mr-1">Filter missing field:</span>
              {kycChips.map((chip) => {
                const on = focus === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFocus(on ? "" : chip.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors",
                      on
                        ? TONE_ROSE_PILL
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span>{chip.label}</span>
                    {chip.count != null && <span className="tabular-nums font-semibold">{chip.count.toLocaleString("en-IN")}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Unified Filter & View Controls Bar */}
          <div className="px-4 py-3 border-b border-border bg-card flex flex-wrap items-center gap-2.5">
            <GridSearch
              value={searchInput}
              onChange={setSearchInput}
              placeholder="Search name, mobile, email, PAN, code, city…"
            />

            {view !== "invoice" && (
              <Select value={invoiceFilter} onValueChange={(v) => { setInvoiceFilter(v); setPage(1); }}>
                <SelectTrigger className="h-9 w-[150px] text-xs bg-card border-border rounded-md">
                  <SelectValue placeholder="Billing mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All billing</SelectItem>
                  <SelectItem value="Invoice">Invoice (GST)</SelectItem>
                  <SelectItem value="NonInvoice">Non-invoice</SelectItem>
                </SelectContent>
              </Select>
            )}

            <CrmCompanyProjectBlockFilter value={cpb} onChange={setCpb} />

            {hasFilters && (
              <button type="button" onClick={clearFilters} className={GRID_BTN}>
                Clear filters
              </button>
            )}

            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground tabular-nums hidden xl:inline">
                {gridListMeta(total, cols, sort, hasFilters)}
              </span>
              <GridSavedViews
                storageKey="crm-customers-views-v1"
                current={currentViewSnapshot()}
                onApply={applySavedView}
              />
              <GridColumnChooser cols={cols} prefs={prefs} onChange={setPrefs} />
            </div>
          </div>

          <div id="crm-customers-grid-panel">
            <CrmGrid
              cols={cols}
              prefs={prefs}
              onPrefs={setPrefs}
              rows={rows}
              rowKey={(c) => c.Id}
              loading={listQ.isLoading}
              fetching={listQ.isFetching}
              error={listQ.isError ? translateError((listQ.error as Error)?.message || "Could not load customers.") : null}
              onRetry={() => listQ.refetch()}
              sort={sort}
              onSort={handleSort}
              page={page}
              pageSize={pageSize}
              total={total}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
              onRowClick={(c) => openCustomer(c.Id)}
              activeKey={openId}
              empty={
                hasFilters
                  ? "No customers match these filters."
                  : view === "missingKyc"
                    ? "All customers have complete KYC."
                    : "No customers yet. Register one with New customer, or from a converted lead."
              }
              mobileCardRenderer={(c) => (
                <div
                  onClick={() => openCustomer(c.Id)}
                  className="rounded-lg border border-border bg-card p-3.5 space-y-2.5 cursor-pointer hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Initials name={c.CustomerName} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate capitalize">{asName(c.CustomerName)}</div>
                        <div className="text-[0.6875rem] text-muted-foreground tabular-nums truncate">
                          {c.CustomerNo}{c.LeadUid ? ` · ${c.LeadUid}` : ""}
                        </div>
                      </div>
                    </div>
                    {c.InvoiceMode === "Invoice" ? (
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium shrink-0", TONE_EMERALD_PILL)}>
                        Invoice
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground shrink-0">
                        Non-invoice
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[0.6875rem]">Mobile</span>
                      <span className="font-medium tabular-nums">{c.Mobile || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[0.6875rem]">PAN</span>
                      <span className="font-mono font-medium">{c.PanNo || "Missing"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[0.6875rem]">City</span>
                      <span className="truncate block">{[c.CurrentCity || c.PermanentCity, c.CurrentState || c.PermanentState].filter(Boolean).join(", ") || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[0.6875rem]">Applications</span>
                      <span className="font-medium tabular-nums">{Number(c.ApplicationCount || 0)}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/70 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[0.6875rem] text-muted-foreground tabular-nums">Reg {fmtDate(c.CreatedAt)}</span>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => navigate(`/crm/customer-360?id=${c.Id}`)} className={cn(GRID_KEY, "h-7 px-2.5 text-foreground")}>
                        360
                      </button>
                      {canEdit && (
                        <button type="button" onClick={() => openCustomer(c.Id, true)} className={cn(GRID_KEY_BRAND, "h-7 px-2.5")}>
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      </div>

      {(newOpen || leadId) && canCreate && (
        <NewCustomerDialog key={leadId ?? "new"} leadId={leadId} onClose={closeNew} onOpenCustomer={(id) => openCustomer(id)} />
      )}
      {openId != null && opened && (
        <CustomerDialog
          key={`${opened.Id}-${startEditing}`}
          customer={opened}
          canEdit={canEdit}
          canDelete={canDelete}
          startEditing={startEditing}
          onClose={closeCustomer}
        />
      )}
      {importOpen && (
        <CrmCustomerImportDialog
          onClose={() => setImportOpen(false)}
          onImported={() => ["crm-customers", "crm-customers-counts", "crm-leads-pool"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))}
        />
      )}
    </>
  );
}
