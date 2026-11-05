// BOQ (bill of quantities). Parts under ./boq: config (types, helpers, form state) · LineEditor · FormModal · DetailModal
import { useCallback, useEffect, useRef, useState } from "react";
import { projectCompanyIds } from "@/lib/projectBelongsTo";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml, raw } from "@/utils/escapeHtml";
import { printStatusLabel } from "@/utils/printStatus";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { type DbItem } from "@/api/itemMasterApi";
import { type DbActivity } from "@/api/engineeringActivityMasterApi";
import { ApprovalActions } from "@/components/ApprovalActions";
import { FileText, FileSpreadsheet, Search, Eye, Plus, RefreshCw, Edit3, Printer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { printList } from "@/lib/printList";
import { fetchAllPages } from "@/lib/fetchAllPages";
import { useFinYear } from "@/contexts/FinYearContext";
import { usePageRights } from "@/hooks/usePageRights";
import { BoqExcelImportModal } from "./BoqExcelImportModal";
import { BoqRecord, Company, Project, DocType, UomOption, ItemOption, ActivityOption, ActivityGroupOption, apiFetch, fmt, fmtDate, canEditBoq } from "./boq/config";
import { FormModal } from "./boq/FormModal";
import { DetailModal } from "./boq/DetailModal";

// ─────────────────────────────────────────────────────────────────────────────
// Main BOQ Page
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "BoqNo",
    header: "BOQ No",
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold text-primary text-sm">
        {row.original.BoqNo || row.original.DocNo || "—"}
      </span>
    ),
  },
  {
    accessorKey: "BoqDate",
    header: "Date",
    cell: ({ getValue }) => (
      <span className="text-sm text-muted-foreground">
        {fmtDate(getValue() as string)}
      </span>
    ),
  },
  {
    accessorKey: "CompanyName",
    header: "Company",
    cell: ({ getValue }) => (
      <span className="text-sm">{String(getValue() || "—")}</span>
    ),
  },
  {
    accessorKey: "ProjectName",
    header: "Project",
    cell: ({ getValue }) => (
      <span className="text-sm text-muted-foreground">
        {String(getValue() || "—")}
      </span>
    ),
  },
  {
    accessorKey: "TotalAmount",
    header: "Total Amount",
    cell: ({ getValue }) => (
      <span className="text-sm font-semibold tabular-nums">
        {fmt(getValue() as number)}
      </span>
    ),
  },
  {
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }) => (
      <SheetMark text={(getValue() as string) || "Draft"} tone={statusTone((getValue() as string) || "Draft")} />
    ),
  },
];

// What Export and Print put out: the list's own columns, as plain values.
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "BOQ No", accessor: (r) => (r.BoqNo || r.DocNo || "") as string },
  { header: "Date", accessor: (r) => fmtDate(r.BoqDate as string) },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Total Amount", accessor: (r) => Number(r.TotalAmount ?? 0) },
  { header: "Status", accessor: (r) => (r.Status || "Draft") as string },
];

const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const CHIP = (on: boolean) =>
  `${KEY} h-8 px-3 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

export default function BOQ() {
  const { finYears } = useFinYear();
  const rights = usePageRights("boq");
  const [page, setPage] = useState(1);
  const PAGE_LIMIT = 10;
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const searchRef = useRef<ReturnType<typeof setTimeout>>();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [activityGroups, setActivityGroups] = useState<ActivityGroupOption[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editRecord, setEditRecord] = useState<BoqRecord | null>(null);
  const [viewRecord, setViewRecord] = useState<BoqRecord | null>(null);

  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;

  const {
    data: listData,
    isLoading: loading,
    refetch: loadList,
  } = useQuery({
    queryKey: ["boqs", page, search, filterStatus],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_LIMIT),
        ...(search ? { search } : {}),
        ...(filterStatus && filterStatus !== "All"
          ? { status: filterStatus }
          : {}),
      });
      return apiFetch(`/boq?${params}`);
    },
    staleTime: 30_000,
  });

  const rows: BoqRecord[] = listData?.data ?? [];

  // Every BOQ the search and status filter match, all pages (the server sends at most 100 at a time).
  const fetchAllBoqs = () =>
    fetchAllPages<Record<string, unknown>>((p, limit) =>
      apiFetch(`/boq?${new URLSearchParams({
        page: String(p),
        limit: String(limit),
        ...(search ? { search } : {}),
        ...(filterStatus && filterStatus !== "All" ? { status: filterStatus } : {}),
      })}`),
    );
  const filterNote = [filterStatus !== "All" ? `Status: ${filterStatus}` : "", search ? `Search: ${search}` : ""].filter(Boolean).join(" · ");
  const [printing, setPrinting] = useState(false);
  const handlePrintList = async () => {
    setPrinting(true);
    try {
      printList({ title: "Bills of Quantities", subtitle: filterNote || undefined, columns: EXPORT_COLUMNS, rows: await fetchAllBoqs(), numeric: ["Total Amount"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load the BOQs to print");
    } finally {
      setPrinting(false);
    }
  };
  const totalPages = listData?.totalPages ?? 1;
  const total = listData?.total ?? 0;

  // Over every BOQ the filters match (server totals), not just the rows on this page.
  const totalValue: number = listData?.summary?.totalValue ?? 0;
  const countApproved: number = listData?.summary?.approved ?? 0;
  const countPending: number = listData?.summary?.pending ?? 0;

  const loadMasterData = useCallback(async () => {
    try {
      const [
        cosResult,
        prosResult,
        dtsResult,
        uomResult,
        itemResult,
        activityResult,
      ] = await Promise.allSettled([
        apiFetch("/enterprises/options?business_type=C"),
        apiFetch("/enterprises/options?business_type=P"),
        apiFetch("/document-type?module=BOQ"),
        apiFetch("/uom-master"),
        apiFetch("/item-master"),
        apiFetch("/engineering-activity-master"),
      ]);

      const cos = cosResult.status === "fulfilled" ? cosResult.value : [];
      const pros = prosResult.status === "fulfilled" ? prosResult.value : [];
      let dts = dtsResult.status === "fulfilled" ? dtsResult.value : [];
      const uomRes = uomResult.status === "fulfilled" ? uomResult.value : [];
      const itemRes = itemResult.status === "fulfilled" ? itemResult.value : [];
      const activityRes =
        activityResult.status === "fulfilled" ? activityResult.value : [];

      const filteredDocData = Array.isArray(dts?.data)
        ? dts.data
        : Array.isArray(dts)
          ? dts
          : [];
      if (filteredDocData.length === 0) {
        dts = await apiFetch("/document-type").catch(() => []);
      }

      const companyData = Array.isArray(cos?.data)
        ? cos.data
        : Array.isArray(cos)
          ? cos
          : [];
      setCompanies(
        companyData.map((item: any, idx: number) => ({
          id: Number(item.id ?? item.Id ?? item.EId ?? idx + 1),
          label:
            item.label ??
            item.name ??
            item.CompanyName ??
            item.EName ??
            "Unknown",
        })),
      );

      const projectData = Array.isArray(pros?.data)
        ? pros.data
        : Array.isArray(pros)
          ? pros
          : [];
      setProjects(
        projectData.map((item: any, idx: number) => ({
          id: Number(item.id ?? item.Id ?? item.EId ?? idx + 1),
          label:
            item.label ??
            item.name ??
            item.ProjectName ??
            item.EName ??
            "Unknown",
          // belongs_to or company_id links a project to its parent company
          companyId:
            item.company_id != null
              ? Number(item.company_id)
              : item.belongs_to != null
                ? Number(item.belongs_to)
                : null,
          companyIds: projectCompanyIds(item),
        })),
      );

      const docData = Array.isArray(dts?.data)
        ? dts.data
        : Array.isArray(dts)
          ? dts
          : [];
      setDocTypes(
        docData
          .filter((item: any) => {
            // Only keep doc types whose prefix/code actually starts with "BOQ"
            // This excludes cross-linked types like "Received Payment" that
            // happen to have BOQ in their links_to field.
            const prefix = String(
              item.code ??
                item.Prefix ??
                item.FullPrefix ??
                item.DocNoPrefix ??
                "",
            ).toUpperCase();
            return prefix.startsWith("BOQ");
          })
          .map((item: any, idx: number) => ({
            id: Number(item.id ?? item.TypeOfDocId ?? idx + 1),
            // Use Prefix/FullPrefix as the code shown left of the dash
            code: String(
              item.DocNoPrefix ??
                item.FullPrefix ??
                item.Prefix ??
                item.code ??
                "",
            ),
            // Description is the meaningful doc-type label (e.g. "Bill of Quantities")
            // EntryType is the accounting entry category — don't show it as the name
            name: String(item.Description ?? item.description ?? ""),
            description: String(item.Description ?? item.description ?? ""),
          })),
      );

      const uomData = Array.isArray(uomRes?.data)
        ? uomRes.data
        : Array.isArray(uomRes)
          ? uomRes
          : [];
      setUoms(
        uomData.map((item: any, idx: number) => ({
          Id: Number(item.Id ?? item.id ?? idx + 1),
          UOMName: item.UOMName ?? item.name ?? "",
          UOMCode: item.UOMCode ?? "",
        })),
      );

      const itemData: DbItem[] = Array.isArray(itemRes)
        ? itemRes
        : (itemRes?.data ?? []);
      setItemOptions(
        itemData.map((it) => ({
          id: String(it.M_Id),
          name: it.M_Name ?? "",
          code: it.M_code ?? "",
          uomCode: it.M_UOM ?? "",
        })),
      );

      const activityData: DbActivity[] = Array.isArray(activityRes)
        ? activityRes
        : (activityRes?.data ?? []);
      setActivityOptions(
        activityData
          .filter((a) => a.activity_type === 1 && a.is_active !== false)
          .map((a) => ({
            id: String(a.id),
            name: a.activity_name ?? "",
            code: String(a.id),
            groupId: a.group_id != null ? String(a.group_id) : "",
          })),
      );
      setActivityGroups(
        activityData
          .filter((a) => a.activity_type === 0 && a.is_active !== false)
          .map((a) => ({ id: String(a.id), name: a.activity_name ?? "" })),
      );
    } catch (err) {
      toast.error("Failed to load dropdown data");
    }
  }, []);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  const onSearchChange = (val: string) => {
    setSearch(val);
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setPage(1), 350);
  };

  const openDetail = async (r: BoqRecord) => {
    try {
      const full = await apiFetch(`/boq/${r.BoqID}`);
      setViewRecord({
        ...full,
        BoqItems: Array.isArray(full.BoqItems) ? full.BoqItems : [],
        BoqActivities: Array.isArray(full.BoqActivities)
          ? full.BoqActivities
          : [],
      });
    } catch {
      setViewRecord({
        ...r,
        BoqItems: r.BoqItems ?? [],
        BoqActivities: r.BoqActivities ?? [],
      });
    }
  };

  const openEdit = (r: BoqRecord) => {
    if (!canEditBoq(r.Status)) {
      toast.error("Only Draft or Rejected BOQs can be edited.");
      return;
    }
    setViewRecord(null);
    setEditRecord(r);
    setShowForm(true);
  };

  const statuses = ["All", "Draft", "Pending", "Approved", "Rejected"];

  const handlePrint = (record: BoqRecord) => {
    const items = Array.isArray(record.BoqItems) ? record.BoqItems : [];
    const activities = Array.isArray(record.BoqActivities)
      ? record.BoqActivities
      : [];
    const itemTotal = items.reduce(
      (sum, row: any) =>
        sum + (Number(row.amount ?? row.LineAmount ?? row.Amount) || 0),
      0,
    );
    const activityTotal = activities.reduce(
      (sum, row: any) =>
        sum + (Number(row.amount ?? row.LineAmount ?? row.Amount) || 0),
      0,
    );
    const renderRows = (rows: any[], type: "item" | "activity") =>
      rows
        .map((row, idx) => {
          const name =
            type === "item"
              ? (row.itemName ?? row.ItemName)
              : (row.activityName ?? row.ActivityName);
          const code =
            type === "item"
              ? (row.itemCode ?? row.ItemCode)
              : (row.activityCode ?? row.ActivityCode);
          const qty = row.quantity ?? row.Quantity ?? "";
          const uom = row.uomName ?? row.UomName ?? "";
          const rate = Number(row.rate ?? row.Rate ?? 0);
          const amount = Number(
            row.amount ?? row.LineAmount ?? row.Amount ?? 0,
          );
          return safeHtml`<tr>
            <td>${idx + 1}</td>
            <td>${name || ""}</td>
            <td>${code || ""}</td>
            <td>${row.description ?? row.Description ?? ""}</td>
            <td class="num">${qty}</td>
            <td>${uom}</td>
            <td class="num">${fmt(rate)}</td>
            <td class="num">${fmt(amount)}</td>
          </tr>`;
        })
        .join("");

    const win = window.open("", "_blank", "width=980,height=720");
    if (!win) return;
    win.document.write(safeHtml`<!doctype html>
      <html>
        <head>
          <title>BOQ ${record.BoqNo || record.DocNo || record.BoqID}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111827; margin: 32px; }
            .head { display:flex; justify-content:space-between; gap:24px; border-bottom:2px solid #111827; padding-bottom:16px; margin-bottom:20px; }
            h1 { margin:0; font-size:22px; }
            .muted { color:#6b7280; font-size:12px; }
            .badge { display:inline-block; border:1px solid #d1d5db; border-radius:999px; padding:4px 10px; font-size:12px; font-weight:700; }
            .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px 18px; margin-bottom:18px; }
            .label { font-size:10px; text-transform:uppercase; color:#6b7280; letter-spacing:.06em; }
            .value { font-size:13px; font-weight:600; margin-top:3px; }
            table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12px; }
            th, td { border:1px solid #d1d5db; padding:7px; vertical-align:top; }
            th { background:#f3f4f6; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.06em; }
            .num { text-align:right; white-space:nowrap; }
            .section { margin-top:18px; }
            .total { display:flex; justify-content:flex-end; gap:28px; margin-top:16px; font-weight:700; }
            @media print { body { margin: 18mm; } }
          </style>
        </head>
        <body>
          <div class="head">
            <div>
              <h1>Bill of Quantities</h1>
              <div class="muted">${record.BoqNo || record.DocNo || `#${record.BoqID}`}</div>
            </div>
            <div><span class="badge">${printStatusLabel(record.Status) || "Draft"}</span></div>
          </div>
          <div class="grid">
            <div><div class="label">Company</div><div class="value">${record.CompanyName || ""}</div></div>
            <div><div class="label">Project</div><div class="value">${record.ProjectName || ""}</div></div>
            <div><div class="label">Date</div><div class="value">${fmtDate(record.BoqDate)}</div></div>
            <div><div class="label">Created By</div><div class="value">${record.CreatedBy || ""}</div></div>
            <div><div class="label">Document No</div><div class="value">${record.DocNo || record.BoqNo || ""}</div></div>
            <div><div class="label">Total</div><div class="value">${fmt(record.TotalAmount || itemTotal + activityTotal)}</div></div>
          </div>
          ${record.Description ? raw(safeHtml`<p>${record.Description}</p>`) : ""}
          <div class="section">
            <h3>Items</h3>
            <table><thead><tr><th>#</th><th>Item</th><th>Code</th><th>Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${raw(renderRows(items, "item") || '<tr><td colspan="8">No items</td></tr>')}</tbody></table>
          </div>
          <div class="section">
            <h3>Activities</h3>
            <table><thead><tr><th>#</th><th>Activity</th><th>Code</th><th>Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${raw(renderRows(activities, "activity") || '<tr><td colspan="8">No activities</td></tr>')}</tbody></table>
          </div>
          <div class="total">
            <span>Items: ${fmt(itemTotal)}</span>
            <span>Activities: ${fmt(activityTotal)}</span>
            <span>Grand Total: ${fmt(record.TotalAmount || itemTotal + activityTotal)}</span>
          </div>
        </body>
      </html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  };

  const enrichedColumns = [
    ...COLUMNS,
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }: any) => (
        <div className="flex items-center gap-1">
          <Button data-row-view
            variant="ghost"
            size="sm"
            onClick={() => openDetail(row.original)}
            className="h-8 w-8 p-0"
          >
            <Eye size={14} />
          </Button>
          {rights.canPrint && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-foreground"
              onClick={async () => {
                const full = await apiFetch(`/boq/${row.original.BoqID}`).catch(
                  () => row.original,
                );
                handlePrint({
                  ...full,
                  BoqItems: full.BoqItems ?? [],
                  BoqActivities: full.BoqActivities ?? [],
                });
              }}
            >
              <Printer size={14} />
            </Button>
          )}
          {rights.canEdit && canEditBoq(row.original.Status) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-primary"
              onClick={async () => {
                const full = await apiFetch(`/boq/${row.original.BoqID}`).catch(
                  () => row.original,
                );
                openEdit({
                  ...full,
                  BoqItems: full.BoqItems ?? [],
                  BoqActivities: full.BoqActivities ?? [],
                });
              }}
            >
              <Edit3 size={14} />
            </Button>
          )}
          <ApprovalActions
            status={row.original.Status}
            recordId={row.original.BoqID}
            endpoint="/api/boq"
            onSuccess={() => loadList()}
            submitOnly
          />
        </div>
      ),
    },
  ];

  // Summary figures: server totals over every BOQ the filters match
  const stats = [
    { label: "BOQs", value: fmtNum(total), note: "matching the filters" },
    { label: "Value", value: fmt(totalValue), note: "rejected ones left out" },
    { label: "Awaiting approval", value: fmtNum(countPending), note: "sent for approval" },
    { label: "Approved", value: fmtNum(countApproved), note: "ready for work orders" },
  ];
  const listView = !showForm && !viewRecord;

  return (
    <>
      <Breadcrumbs items={["Engineering", "Transaction", "BOQ"]} />

      {showImport && (
        <BoqExcelImportModal
          masters={{
            companies,
            projects,
            docTypes,
            finYears: finYears.map((f) => ({ year: f.year })),
            uoms,
            items: itemOptions,
            activities: activityOptions,
            groups: activityGroups,
          }}
          onClose={() => setShowImport(false)}
          onImported={() => loadList()}
        />
      )}

      {/* One sheet frame for all three views: the list, the form (new / edit) and one BOQ opened. */}
      <SheetShell
        eyebrow="CivilierERP · Engineering"
        title="Bills of quantities"
        subtitle="Material items and work activities priced out for a project; an approved BOQ is what work orders are raised against."
        action={
          listView ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => loadList()} disabled={loading} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              </button>
              <ExportMenu
                data={rows as unknown as Record<string, unknown>[]}
                fetchData={fetchAllBoqs}
                columns={EXPORT_COLUMNS}
                title="Bills of Quantities"
                filename="boq"
                subtitle={filterNote || undefined}
                disabled={loading || total === 0 || !rights.canExport}
              />
              {rights.canPrint && (
                <button onClick={handlePrintList} disabled={loading || printing || total === 0} className={`${KEY_LINE} h-9 px-3`} title="Print the list">
                  <Printer size={13} /> {printing ? "Preparing…" : "Print"}
                </button>
              )}
              {rights.canCreate && (
                <button onClick={() => setShowImport(true)} className={`${KEY_LINE} h-9 px-3`}>
                  <FileSpreadsheet size={13} /> Excel import
                </button>
              )}
              {rights.canCreate && (
                <button
                  onClick={() => {
                    setEditRecord(null);
                    setShowForm(true);
                  }}
                  className={`${KEY_INK} h-9 px-4`}
                >
                  <Plus size={13} /> New BOQ
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {showForm && (
          <FormModal
            record={editRecord}
            companies={companies}
            projects={projects}
            docTypes={docTypes}
            uoms={uoms}
            itemOptions={itemOptions}
            activityOptions={activityOptions}
            activityGroups={activityGroups}
            finYears={finYears}
            activeFinYear={activeFinYear}
            onClose={() => {
              setShowForm(false);
              setEditRecord(null);
            }}
            onSaved={() => loadList()}
          />
        )}

        {!showForm && viewRecord && (
          <DetailModal
            record={viewRecord}
            uoms={uoms}
            onClose={() => setViewRecord(null)}
            onEdit={() => openEdit(viewRecord)}
            onPrint={() => handlePrint(viewRecord)}
            onRefresh={() => {
              setViewRecord(null);
              loadList();
            }}
            canDelete={rights.canDelete}
            canPrint={rights.canPrint}
            canEdit={rights.canEdit}
          />
        )}

        {listView && (
          <div className="space-y-5">
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                {stats.map((x) => (
                  <div key={x.label}>
                    <p className="label">{x.label}</p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{loading ? "…" : x.value}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card" style={{ border: RULE }}>
              <div className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3" style={{ borderBottom: RULE }}>
                <div className="relative flex-1 max-w-sm">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    value={search}
                    placeholder="Search BOQ no, company, project…"
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 text-sm bg-card border border-foreground/40 focus:outline-none focus:border-foreground"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {statuses.map((s) => (
                    <button
                      key={s}
                      className={CHIP(filterStatus === s)}
                      onClick={() => {
                        setFilterStatus(s);
                        setPage(1);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center p-12 text-muted-foreground text-sm gap-2">
                  <RefreshCw size={15} className="animate-spin" /> Loading BOQs…
                </div>
              ) : (
                <>
                  <DataTable
                    data={rows}
                    columns={enrichedColumns}
                    searchable={false}
                    paginated={false}
                    emptyMessage="No BOQs found. Adjust your filters or create a new one."
                    getRowId={(r: any) => String(r.BoqID)}
                  />
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: RULE }}>
                      <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                        Page {page} of {totalPages} · {total} records
                      </span>
                      <div className="flex gap-2">
                        <button className={`${KEY_LINE} h-8 px-3`} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                          Previous
                        </button>
                        <button className={`${KEY_LINE} h-8 px-3`} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </SheetShell>
    </>
  );
}
