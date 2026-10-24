// CRM Customers: the identity record every application is built on (name, KYC, address, billing mode). Parts under
// ./customers: config (API, form, checks, styles) · CustomerFields · NewCustomerDialog · CustomerDialog.
// Opens a customer from ?customerId= (kept in the URL so a refresh or a shared link comes back to it) and a new
// customer from a lead from ?leadId= (CRM Leads' "Create customer").
import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookUser, Check, PenSquare, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { CrmCustomerImportDialog } from "./CrmCustomerImportDialog";
import { API, KEY_INK, KEY_LINE, PAGE_SIZE, RULE, fetchCustomersList, fetchLeadPool, type CustomerListFilters } from "./customers/config";
import { NewCustomerDialog } from "./customers/NewCustomerDialog";
import { CustomerDialog } from "./customers/CustomerDialog";

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default function CrmCustomers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canCreate, canEdit, canDelete } = usePageRights("crm-customers");
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [startEditing, setStartEditing] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Searches as you type (after a short pause); Enter searches at once.
  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });

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

  const filters: CustomerListFilters = useMemo(() => ({ search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }), [search, cpb]);
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-customers", filters, page, pageSize],
    queryFn: () => fetchCustomersList(filters, page, pageSize),
    staleTime: 30_000,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const anyFilter = !!(search || cpb.companyId || cpb.projectId || cpb.blockId);

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

  async function deleteCustomer(c: any) {
    setDeletingId(c.Id);
    try {
      const res = await fetchWithAuth(`${API}/${c.Id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not delete the customer.");
      toast.success(`${c.CustomerNo} deleted`);
      ["crm-customers", "crm-leads-pool"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  }

  const columns: ColumnDef<any, unknown>[] = [
    {
      accessorKey: "CustomerNo", header: "Customer", size: 220,
      cell: ({ row: { original: c } }) => (
        <div className="leading-tight min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{c.CustomerName}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{c.CustomerNo}{c.LeadUid ? ` · from ${c.LeadUid}` : ""}</p>
        </div>
      ),
    },
    {
      accessorKey: "Mobile", header: "Contact", size: 170,
      cell: ({ row: { original: c } }) => (
        <div className="leading-tight text-xs">
          <p className="text-foreground tabular-nums">{c.Mobile || "—"}</p>
          <p className="text-muted-foreground font-heading tabular-nums">{c.PanNo || "No PAN"}</p>
        </div>
      ),
    },
    {
      id: "location", header: "City", size: 140, enableSorting: false,
      cell: ({ row: { original: c } }) => <span className="text-xs">{[c.PermanentCity, c.PermanentState].filter(Boolean).join(", ") || "—"}</span>,
    },
    {
      id: "projects", header: "Projects", size: 200, enableSorting: false,
      cell: ({ row: { original: c } }) => {
        const names = String(c.ProjectNames || "").split("|").filter(Boolean);
        return names.length ? (
          <span className="text-xs block truncate max-w-[200px]" title={names.join(", ")}>
            {names.slice(0, 2).join(", ")}{names.length > 2 ? ` +${names.length - 2}` : ""}
          </span>
        ) : <span className="text-xs text-muted-foreground">None yet</span>;
      },
    },
    {
      accessorKey: "ApplicationCount", header: () => <span className="block text-right">Applications</span>, size: 110,
      cell: ({ getValue }) => <span className="block text-right text-sm font-heading tabular-nums">{Number(getValue() || 0)}</span>,
    },
    { accessorKey: "CreatedAt", header: "Registered", size: 110, cell: ({ getValue }) => <span className="text-xs tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
    {
      id: "actions", header: "", size: 110, enableSorting: false,
      cell: ({ row: { original: c } }) =>
        deleteConfirmId === c.Id ? (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="text-[0.6875rem] text-muted-foreground mr-1">Delete?</span>
            <button onClick={() => deleteCustomer(c)} disabled={deletingId === c.Id} className="p-1 text-destructive disabled:opacity-40" title="Delete for good"><Check size={14} /></button>
            <button onClick={() => setDeleteConfirmId(null)} className="p-1 text-muted-foreground hover:text-foreground" title="Keep"><X size={14} /></button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {canEdit && <button onClick={() => openCustomer(c.Id, true)} className="p-1.5 text-muted-foreground hover:text-foreground" title="Edit"><PenSquare size={13} /></button>}
            {canDelete && <button onClick={() => setDeleteConfirmId(c.Id)} className="p-1.5 text-muted-foreground hover:text-destructive" title="Delete"><Trash2 size={13} /></button>}
          </div>
        ),
    },
  ];

  const exportColumns: ExportColumn[] = [
    { header: "Customer No", accessor: "CustomerNo" },
    { header: "Name", accessor: "CustomerName" },
    { header: "Mobile", accessor: "Mobile" },
    { header: "PAN", accessor: "PanNo" },
    { header: "Address", accessor: (r) => [r.PermanentCity, r.PermanentState].filter(Boolean).join(", ") },
    { header: "Co-Applicant", accessor: "CoApplicantName" },
    { header: "Projects", accessor: (r) => String(r.ProjectNames || "").split("|").filter(Boolean).join(", ") },
    { header: "Applications", accessor: "ApplicationCount" },
    { header: "Registered", accessor: (r) => (r.CreatedAt ? String(r.CreatedAt).slice(0, 10) : "") },
  ];

  const stats = [
    { label: "Customers", value: total, note: anyFilter ? "matching the filters" : "registered" },
    { label: "Leads waiting", value: leadsWaiting, note: "converted leads with no customer yet", go: leadsWaiting ? () => navigate("/crm/leads") : undefined },
    { label: "On this page", value: rows.length, note: `of ${total}` },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Customers"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Customers"
        subtitle="The record every application is built on: name, KYC, address and billing mode. Each customer also keeps a ledger head in Finance."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            <ExportMenu
              data={rows as Record<string, unknown>[]}
              fetchData={async () => (await fetchCustomersList(filters, 1, Math.max(total, PAGE_SIZE))).rows as Record<string, unknown>[]}
              columns={exportColumns}
              title="CRM Customers"
              filename="crm-customers"
            />
            <button onClick={() => navigate("/masters/customers")} className={`${KEY_LINE} h-9 px-3`} title="Every CRM customer keeps a matching ledger head there for Finance">
              <BookUser size={13} /> <span className="hidden sm:inline">Ledger heads</span>
            </button>
            {canCreate && (
              <>
                <button onClick={() => setImportOpen(true)} className={`${KEY_LINE} h-9 px-3`}><Upload size={13} /> <span className="hidden sm:inline">Import</span></button>
                <button onClick={() => setNewOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New customer</button>
              </>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow" style={{ padding: "16px 16px 18px" }}>
              {stats.map((x) => (
                <div key={x.label}>
                  {x.go ? <button onClick={x.go} className="label link">{x.label}</button> : <p className="label">{x.label}</p>}
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
                placeholder="Search name, mobile, PAN, customer no…"
                className="h-9 w-full sm:w-72 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none"
              />
              <CrmCompanyProjectBlockFilter value={cpb} onChange={(v) => { setCpb(v); setPage(1); }} />
            </div>
            {isError ? (
              <p className="px-5 py-10 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : (
              <DataTable
                serverPagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
                data={rows}
                columns={columns}
                searchable={false}
                loading={isLoading}
                onRowClick={(row) => openCustomer(row.original.Id)}
                getRowId={(c: any) => String(c.Id)}
                emptyMessage={anyFilter ? "No customers match these filters." : "No customers yet. Register one with New customer, or from a lead on Leads."}
              />
            )}
          </div>
        </div>
      </SheetShell>

      {(newOpen || leadId) && canCreate && (
        <NewCustomerDialog key={leadId ?? "new"} leadId={leadId} onClose={closeNew} onOpenCustomer={(id) => openCustomer(id)} />
      )}
      {openId != null && opened && (
        <CustomerDialog key={`${opened.Id}-${startEditing}`} customer={opened} canEdit={canEdit} canDelete={canDelete} startEditing={startEditing} onClose={closeCustomer} />
      )}
      {importOpen && (
        <CrmCustomerImportDialog
          onClose={() => setImportOpen(false)}
          onImported={() => ["crm-customers", "crm-leads-pool"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))}
        />
      )}
    </>
  );
}
