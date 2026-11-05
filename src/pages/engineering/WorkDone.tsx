// Work Done. Parts under ./workDone:
//   config (types, helpers, sheet styles) · WorkDoneForm · WorkDoneDetail · printWorkDone
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, PenSquare, Plus, Printer, RefreshCw } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { printList } from "@/lib/printList";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { StatusBadge } from "@/components/StatusBadge";
import { useApprovalTrailsBulk } from "@/hooks/useApprovalTrailsBulk";
import { useFinYear } from "@/contexts/FinYearContext";
import { fetchCompanies, fetchProjects, fetchSuppliers } from "@/api/workOrderApi";
import { type WorkDoneEntry, type WorkOrderOption, CHIP, KEY_INK, KEY_LINE, RULE, canEditWorkDone, fmt, fmtDate } from "./workDone/config";
import { WorkDoneForm } from "./workDone/WorkDoneForm";
import { WorkDoneDetail } from "./workDone/WorkDoneDetail";
import { printWorkDone } from "./workDone/printWorkDone";

const STATUSES = ["all", "Draft", "Pending", "Approved", "Rejected"];

// What Export and Print put out: the list's own columns, as plain values.
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: (r) => (r.DocNo || `#${r.ID}`) as string },
  { header: "Date", accessor: (r) => fmtDate(r.DocDate as string) },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Work Order", accessor: "WorkOrderNo" },
  { header: "Contractor", accessor: (r) => (r.ContractorName || r.SupplierName || "") as string },
  { header: "Work", accessor: "DescriptionOfWork" },
  { header: "Certified", accessor: (r) => Number(r.CertifiedAmount ?? 0) },
  { header: "Status", accessor: (r) => (r.Status || "Draft") as string },
];

interface WorkDoneList {
  rows: WorkDoneEntry[];
  total: number;
  summary: { certified: number; pending: number; approved: number };
}

export default function WorkDone() {
  const rights = usePageRights("work-done");
  const { finYears } = useFinYear();
  const [view, setView] = useState<"list" | "form" | "detail">("list");
  const [editRecord, setEditRecord] = useState<WorkDoneEntry | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [filterCompanyId, setFilterCompanyId] = useState<number | null>(null);

  const activeFinYear = finYears.find((fy) => fy.status === "Active")?.year ?? "";
  const finYearOptions = finYears.filter((fy) => fy.status === "Active" && !fy.locked).map((fy) => ({ id: String(fy.id), year: fy.year }));

  const { data: companies = [], isLoading: loadingCompanies } = useQuery({ queryKey: ["companies-wd"], queryFn: fetchCompanies, staleTime: 5 * 60 * 1000 });
  const { data: projects = [], isLoading: loadingProjects } = useQuery({ queryKey: ["projects-wd"], queryFn: fetchProjects, staleTime: 5 * 60 * 1000 });
  const { data: suppliers = [], isLoading: loadingSuppliers } = useQuery({ queryKey: ["suppliers-wd"], queryFn: fetchSuppliers, staleTime: 5 * 60 * 1000 });
  const { data: workOrders = [], isLoading: loadingWorkOrders } = useQuery<WorkOrderOption[]>({
    queryKey: ["work-orders-wd-list"],
    queryFn: () =>
      fetchWithAuth("/api/engineering/work-orders-with-activities").then(async (r) => {
        const json = await r.json().catch(() => ({}));
        return (Array.isArray(json) ? json : []).map((w: any) => ({
          id: w.Id,
          name: `${w.DocNo || "WO"} — ${w.ContractorName || "No contractor"} (${w.ActivityCount} activities)`,
          companyId: w.CompanyId ?? null,
          projectId: w.ProjectId ?? null,
        }));
      }),
    staleTime: 5 * 60 * 1000,
  });
  const loadingDropdowns = loadingCompanies || loadingProjects || loadingSuppliers || loadingWorkOrders;

  // Every entry (up to 500) for the company picked, or for every company; the table pages and searches them.
  const { data, isLoading, refetch, isFetching } = useQuery<WorkDoneList>({
    queryKey: ["engineering-work-done", filterCompanyId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "500" });
      if (filterCompanyId) params.set("companyId", String(filterCompanyId));
      const r = await fetchWithAuth(`/api/engineering/work-done?${params}`);
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error || "Could not load work done entries.");
      const rows: WorkDoneEntry[] = Array.isArray(json) ? json : (json.data ?? []);
      return { rows, total: json.total ?? rows.length, summary: json.summary ?? { certified: 0, pending: 0, approved: 0 } };
    },
    staleTime: 30_000,
  });
  const entries = data?.rows ?? [];
  const filtered = statusFilter === "all" ? entries : entries.filter((e) => (e.Status || "Draft") === statusFilter);
  const opened = openId != null ? entries.find((e) => e.ID === openId) ?? null : null;

  const { trails: approvalTrails, isLoading: approvalTrailsLoading } = useApprovalTrailsBulk("WorkDone", view === "list" ? filtered.map((e) => e.ID) : []);

  const openNew = () => {
    setEditRecord(null);
    setView("form");
  };
  const openEdit = (r: WorkDoneEntry) => {
    setEditRecord(r);
    setView("form");
  };
  const openDetail = (r: WorkDoneEntry) => {
    setOpenId(r.ID);
    setView("detail");
  };
  const toList = () => {
    setView("list");
    setEditRecord(null);
    setOpenId(null);
  };

  const COLUMNS: ColumnDef<WorkDoneEntry>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      header: "Doc no",
      cell: ({ row }) => (
        <button onClick={() => openDetail(row.original)} className="font-heading tabular-nums text-xs font-semibold text-foreground hover:underline underline-offset-2">
          {row.original.DocNo || `#${row.original.ID}`}
        </button>
      ),
    },
    { id: "DocDate", accessorKey: "DocDate", header: "Date", cell: ({ getValue }) => <span className="text-xs tabular-nums">{fmtDate(getValue() as string)}</span> },
    {
      id: "ProjectName",
      accessorKey: "ProjectName",
      header: "Company / project",
      cell: ({ row }) => (
        <div className="text-xs leading-tight">
          <p className="text-foreground">{row.original.ProjectName || "—"}</p>
          <p className="text-muted-foreground">{row.original.CompanyName || ""}</p>
        </div>
      ),
    },
    {
      id: "WorkOrderNo",
      accessorKey: "WorkOrderNo",
      header: "Work order / contractor",
      cell: ({ row }) => (
        <div className="text-xs leading-tight">
          <p className="font-heading tabular-nums text-foreground">{row.original.WorkOrderNo || "—"}</p>
          <p className="text-muted-foreground">{row.original.ContractorName || row.original.SupplierName || ""}</p>
        </div>
      ),
    },
    {
      id: "DescriptionOfWork",
      accessorKey: "DescriptionOfWork",
      header: "Work",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return <span className="text-xs text-muted-foreground max-w-[180px] truncate block" title={v}>{v || "—"}</span>;
      },
    },
    {
      id: "CertifiedAmount",
      accessorKey: "CertifiedAmount",
      header: () => <span className="block text-right">Certified</span>,
      cell: ({ getValue }) => <span className="block text-right text-xs font-semibold tabular-nums text-foreground">{fmt(getValue() as number)}</span>,
    },
    {
      id: "Status",
      accessorKey: "Status",
      header: "Status",
      cell: ({ getValue, row }) => (
        <ApprovalStatusChain
          table="WorkDone"
          recordId={row.original.ID}
          fallback={<StatusBadge status={(getValue() as string) || "Draft"} />}
          preloaded={approvalTrails.get(String(row.original.ID)) ?? null}
          preloadedLoading={approvalTrailsLoading}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center gap-1 justify-end">
            <button onClick={() => openDetail(r)} title="Open" className="p-1.5 text-muted-foreground hover:text-foreground">
              <Eye size={13} />
            </button>
            {rights.canPrint && (
              <button onClick={() => printWorkDone(r)} title="Print" className="p-1.5 text-muted-foreground hover:text-foreground">
                <Printer size={13} />
              </button>
            )}
            {rights.canEdit && canEditWorkDone(r.Status) && (
              <button onClick={() => openEdit(r)} title="Edit" className="p-1.5 text-muted-foreground hover:text-foreground">
                <PenSquare size={13} />
              </button>
            )}
            <ApprovalActions status={r.Status} recordId={r.ID} endpoint="/api/engineering/work-done" onSuccess={() => refetch()} submitOnly />
          </div>
        );
      },
    },
  ];

  // Export and Print cover what the list shows: the company and status picked.
  const filterNote = [
    filterCompanyId ? `Company: ${companies.find((c) => c.id === filterCompanyId)?.name ?? filterCompanyId}` : "",
    statusFilter !== "all" ? `Status: ${statusFilter}` : "",
  ].filter(Boolean).join(" · ");
  const listRows = filtered as unknown as Record<string, unknown>[];

  const sum = data?.summary;
  const stats = [
    { label: "Entries", value: String(data?.total ?? 0), note: filterCompanyId ? "for this company" : "every company" },
    { label: "Certified", value: fmt(sum?.certified ?? 0), note: "rejected ones left out" },
    { label: "Awaiting approval", value: String(sum?.pending ?? 0), note: "sent for approval" },
    { label: "Approved", value: String(sum?.approved ?? 0), note: "ready to book" },
  ];

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Engineering", path: "/engineering" },
          { label: "Transaction", path: "/engineering/transaction" },
          { label: "Work Done" },
        ]}
      />
      <SheetShell
        eyebrow="CivilierERP · Engineering"
        title={view === "form" ? (editRecord ? `Edit ${editRecord.DocNo || "work done"}` : "New work done") : "Work done"}
        subtitle={
          view === "form"
            ? "Certify work a contractor completed against an approved work order; it goes for approval when saved."
            : "Contractor work certified against approved work orders; approved entries are what invoices are booked against."
        }
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              <ExportMenu
                data={listRows}
                columns={EXPORT_COLUMNS}
                title="Work Done"
                filename="work-done"
                subtitle={filterNote || undefined}
                disabled={isLoading || filtered.length === 0 || !rights.canExport}
              />
              {rights.canPrint && (
                <button
                  onClick={() => printList({ title: "Work Done", subtitle: filterNote || undefined, columns: EXPORT_COLUMNS, rows: listRows, numeric: ["Certified"] })}
                  disabled={isLoading || filtered.length === 0}
                  className={`${KEY_LINE} h-9 px-3`}
                  title="Print the list"
                >
                  <Printer size={13} /> Print
                </button>
              )}
              {rights.canCreate && (
                <button onClick={openNew} className={`${KEY_INK} h-9 px-4`}>
                  <Plus size={13} /> New work done
                </button>
              )}
            </div>
          ) : view === "form" ? (
            <button onClick={toList} className={`${KEY_LINE} h-9 px-3`}>
              Back to list
            </button>
          ) : undefined
        }
      >
        {view === "form" && (
          <WorkDoneForm
            record={editRecord}
            onClose={toList}
            companies={companies}
            projects={projects}
            suppliers={suppliers}
            workOrders={workOrders}
            finYearOptions={finYearOptions}
            loadingDropdowns={loadingDropdowns}
            activeFinYear={activeFinYear}
          />
        )}

        {view === "detail" &&
          (opened ? (
            <WorkDoneDetail
              record={opened}
              canEdit={rights.canEdit}
              canPrint={rights.canPrint}
              onBack={toList}
              onEdit={() => openEdit(opened)}
              onPrint={() => printWorkDone(opened)}
              onRefresh={() => refetch()}
            />
          ) : (
            <p className="p-10 text-center text-sm text-muted-foreground">{isLoading ? "Loading…" : "This entry is no longer in the list."}</p>
          ))}

        {view === "list" && (
          <div className="space-y-5">
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                {stats.map((x) => (
                  <div key={x.label}>
                    <p className="label">{x.label}</p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card" style={{ border: RULE }}>
              <div className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3" style={{ borderBottom: RULE }}>
                <select
                  value={filterCompanyId ?? ""}
                  onChange={(e) => setFilterCompanyId(e.target.value ? Number(e.target.value) : null)}
                  className="h-9 w-full md:w-60 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none"
                >
                  <option value="">All companies</option>
                  {(companies as { id: number; name: string }[]).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <div className="flex gap-2 flex-wrap">
                  {STATUSES.map((s) => (
                    <button key={s} onClick={() => setStatusFilter(s)} className={CHIP(statusFilter === s)}>
                      {s === "all" ? "All" : s}
                    </button>
                  ))}
                </div>
              </div>
              <DataTable
                data={filtered}
                columns={COLUMNS}
                loading={isLoading}
                searchable
                paginated
                emptyMessage="No work done entries. Adjust the filters or record a new one."
                getRowId={(r: any) => String(r.ID)}
              />
            </div>
          </div>
        )}
      </SheetShell>
    </>
  );
}
