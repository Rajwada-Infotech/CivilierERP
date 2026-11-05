// FA Inventory: received fixed-asset stock and the FA Item Codes generated for it. Parts under ./tagging:
//   config (types, helpers, export) · TaggingForm · InventoryImport · TaggingDialogs
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Hash, PenSquare, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { DateInput } from "@/components/ui/date-input";
import { usePageRights } from "@/hooks/usePageRights";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { getFixedAssetTaggings, getPendingBatches, type PendingBatch, type TaggingListItem } from "@/api/fixedAssetTaggingApi";
import { INP, KEY_INK, KEY_LINE, RULE } from "./record/config";
import { type InventoryRow, type TaggingPrefill, ensureArray, exportInventory, fmt, fmtDate } from "./tagging/config";
import { TaggingForm } from "./tagging/TaggingForm";
import { InventoryImport } from "./tagging/InventoryImport";
import { DeletePendingDialog, DeleteTaggingDialog, EditTaggingDialog } from "./tagging/TaggingDialogs";

const inRange = (d: string | null, from: string, to: string) => (!from || (!!d && d.slice(0, 10) >= from)) && (!to || (!!d && d.slice(0, 10) <= to));

export default function FixedAssetTagging() {
  const rights = usePageRights("fixed-asset-tagging");
  const [view, setView] = useState<"list" | "form">("list");
  const [prefill, setPrefill] = useState<TaggingPrefill | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [show, setShow] = useState<"all" | "untagged" | "waiting">("all");
  const [editTag, setEditTag] = useState<TaggingListItem | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deletePendingId, setDeletePendingId] = useState<number | null>(null);

  const { data: taggings = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["fixed-asset-taggings"], queryFn: () => getFixedAssetTaggings() });
  // Received stock not tagged yet. Auto-tagging skips a project with no ID Template, so this keeps that stock in sight.
  const { data: pendingBatches = [], refetch: refetchPending } = useQuery({ queryKey: ["fixed-asset-pending-batches"], queryFn: getPendingBatches });
  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: allProjects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const { data: godownsData } = useQuery({ queryKey: ["godowns"], queryFn: getGodowns });

  const companyList = ensureArray<{ id: number; label: string }>(companies);
  const projectList = ensureArray<ProjectCompanyLike & { id: number; label: string }>(allProjects);
  const filterProjects = useMemo(() => (companyId ? projectList.filter((p) => projectBelongsToCompany(p, companyId)) : []), [projectList, companyId]);

  const tags = ensureArray<TaggingListItem>(taggings);
  const pending = ensureArray<PendingBatch>(pendingBatches);
  const matches = (c: number | null, p: number | null, d: string | null) =>
    (!companyId || String(c) === companyId) && (!projectId || String(p) === projectId) && inRange(d, fromDate, toDate);

  // Untagged stock first, then the tagging entries.
  const rows = useMemo<InventoryRow[]>(() => {
    const p = show === "waiting" ? [] : pending.filter((b) => matches(b.CompanyId, b.ProjectId, b.DocDate)).map((b) => ({ kind: "pending" as const, key: `p${b.AssetId}`, b }));
    const t = show === "untagged" ? [] : tags
      .filter((x) => matches(x.CompanyId, x.ProjectId, x.DocDate) && (show !== "waiting" || x.RecordStatus === "Pending"))
      .map((x) => ({ kind: "tag" as const, key: `t${x.TagId}`, t: x }));
    return [...p, ...t];
  }, [tags, pending, companyId, projectId, fromDate, toDate, show]); // eslint-disable-line react-hooks/exhaustive-deps
  const anyFilter = !!(companyId || projectId || fromDate || toDate);

  const stats = [
    { label: "Untagged stock", value: fmt(pending.reduce((s, b) => s + (Number(b.Quantity) || 0), 0)), note: `in ${fmt(pending.length)} received batch${pending.length === 1 ? "" : "es"}` },
    { label: "No ID template", value: fmt(pending.filter((b) => b.Reason === "NO_TEMPLATE").length), note: "batches that can't be tagged yet" },
    { label: "FA codes tagged", value: fmt(tags.filter((t) => t.Status === "Tagged").reduce((s, t) => s + (t.TaggedQty || 0), 0)), note: `${fmt(tags.length)} tagging entries` },
    { label: "Waiting for a record", value: fmt(tags.filter((t) => t.RecordStatus === "Pending").length), note: "codes not yet a fixed asset" },
  ];

  const openNew = (p: TaggingPrefill | null = null) => { setPrefill(p); setView("form"); };
  const tagBatch = (b: PendingBatch) =>
    openNew({ companyId: String(b.CompanyId ?? ""), projectId: String(b.ProjectId ?? ""), godownId: String(b.GodownId ?? ""), itemId: b.SourceItemId ?? "", numberOfItems: String(b.Quantity ?? "") });

  const handleExport = async () => {
    const n = await exportInventory(pending, tags);
    if (n) toast.success(`Exported ${n} row${n === 1 ? "" : "s"}`);
    else toast.error("Nothing to export.");
  };

  const COLUMNS: ColumnDef<InventoryRow>[] = [
    {
      id: "doc",
      accessorFn: (r) => (r.kind === "pending" ? r.b.SourceDocNo : r.t.DocNo) ?? "",
      header: "Doc no",
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight">
          <p className="font-heading tabular-nums text-xs">{(r.kind === "pending" ? r.b.SourceDocNo : r.t.DocNo) || "—"}</p>
          <p className="text-[0.625rem] text-muted-foreground">
            {r.kind === "pending" ? (r.b.SourceType === "GRN" ? "Received by GRN" : "Imported, no GRN") : r.t.StockSource === "IMPORT" ? "Imported, no GRN" : r.t.StockSource || ""}
          </p>
        </div>
      ),
    },
    { id: "date", accessorFn: (r) => (r.kind === "pending" ? r.b.DocDate : r.t.DocDate) ?? "", header: "Date", cell: ({ getValue }) => <span className="text-xs tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
    {
      id: "item",
      accessorFn: (r) => (r.kind === "pending" ? r.b.AssetName : `${r.t.AssetName ?? ""} ${r.t.AssetCode ?? ""}`),
      header: "Item",
      cell: ({ row: { original: r } }) => (
        <div className="leading-tight max-w-[220px]">
          <p className="text-sm text-foreground truncate">{(r.kind === "pending" ? r.b.AssetName : r.t.AssetName) || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground truncate">
            {r.kind === "pending" ? `Qty ${fmt(r.b.Quantity)}${r.b.GodownName ? ` · ${r.b.GodownName}` : ""}` : [r.t.AssetCategory, r.t.GodownName].filter(Boolean).join(" · ")}
          </p>
        </div>
      ),
    },
    {
      id: "code",
      accessorFn: (r) => (r.kind === "tag" ? `${r.t.FAItemCode ?? ""} ${r.t.TransferredToCode ?? ""} ${r.t.TransferredFromCode ?? ""}` : ""),
      header: "FA Item Code",
      cell: ({ row: { original: r } }) =>
        r.kind === "pending" ? <span className="text-xs text-muted-foreground">—</span> : (
          <div className="font-heading tabular-nums text-xs leading-tight">
            <p className={r.t.Status === "Transferred" ? "text-muted-foreground line-through" : "text-foreground"}>{r.t.FAItemCode || "—"}</p>
            {r.t.TransferredToCode && <p className="text-[0.625rem] text-muted-foreground">→ {r.t.TransferredToCode}</p>}
            {r.t.TransferredFromCode && <p className="text-[0.625rem] text-muted-foreground">← {r.t.TransferredFromCode}</p>}
          </div>
        ),
    },
    {
      id: "project",
      accessorFn: (r) => (r.kind === "pending" ? `${r.b.ProjectName ?? ""} ${r.b.CompanyName ?? ""}` : `${r.t.ProjectName ?? ""} ${r.t.CompanyName ?? ""}`),
      header: "Company / project",
      cell: ({ row: { original: r } }) => {
        const x = r.kind === "pending" ? r.b : r.t;
        return (
          <div className="text-xs leading-tight">
            <p className="text-foreground">{x.ProjectName || "—"}</p>
            <p className="text-muted-foreground">{x.CompanyName || ""}</p>
          </div>
        );
      },
    },
    {
      id: "status",
      accessorFn: (r) => (r.kind === "pending" ? "Untagged" : r.t.Status),
      header: "Status",
      cell: ({ row: { original: r } }) => {
        if (r.kind === "pending") {
          return (
            <div className="space-y-1 max-w-[240px]">
              <SheetMark text="Untagged" tone={r.b.Reason === "NO_TEMPLATE" ? "stopped" : "waiting"} />
              <p className="text-[0.6875rem] text-muted-foreground whitespace-normal">
                {r.b.Reason === "NO_TEMPLATE" ? `${r.b.ProjectName || "This project"} has no ID template: add one in ID Template Master and these units tag themselves.` : "Ready to tag."}
              </p>
            </div>
          );
        }
        const t = r.t;
        return (
          <div className="space-y-1">
            <SheetMark text={t.Status === "Transferred" ? "Transferred" : t.Status} tone={t.Status === "Tagged" ? "done" : t.Status === "Transferred" ? "waiting" : "stopped"} />
            {t.RecordStatus && <p className="text-[0.6875rem] text-muted-foreground">{t.RecordStatus === "Done" ? "Fixed asset made" : "No fixed asset yet"}</p>}
          </div>
        );
      },
    },
    {
      id: "remarks",
      accessorFn: (r) => (r.kind === "tag" ? r.t.Remarks ?? "" : ""),
      header: "Remarks",
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground block max-w-[180px] truncate" title={getValue() as string}>{(getValue() as string) || "—"}</span>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row: { original: r } }) => {
        if (r.kind === "pending") {
          const b = r.b;
          return (
            <div className="flex items-center gap-1 justify-end">
              {rights.canCreate && b.Reason === "READY" && (
                <button onClick={() => tagBatch(b)} title="Tag this stock" className={`${KEY_LINE} h-7 px-2`}><Hash size={12} /> Tag</button>
              )}
              {rights.canDelete && (
                <button onClick={() => setDeletePendingId(b.AssetId)} title="Remove from FA Inventory" className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>
              )}
            </div>
          );
        }
        const t = r.t;
        const locked = t.Status === "Transferred" || !!t.SourceICTId;
        return (
          <div className="flex items-center gap-1 justify-end">
            {rights.canEdit && (
              <button onClick={() => setEditTag(t)} title="Edit date and remarks" className="p-1.5 text-muted-foreground hover:text-foreground"><PenSquare size={13} /></button>
            )}
            {rights.canDelete && (
              <button
                onClick={() => setDeleteId(t.TagId)}
                disabled={t.RecordStatus === "Done" || locked}
                title={locked ? "Moved by an Inter-Company Transfer: delete the transfer to undo it" : t.RecordStatus === "Done" ? "It has a fixed asset record: delete that first" : "Delete"}
                className="p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const select = `${INP} !h-9 text-xs w-full sm:w-48`;
  const SHOW = [
    { k: "all" as const, label: "All" },
    { k: "untagged" as const, label: "Untagged" },
    { k: "waiting" as const, label: "No record yet" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "FA Inventory"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title={view === "form" ? "New tagging" : "FA inventory"}
        subtitle={
          view === "form"
            ? "Pick received fixed-asset stock at a godown and generate one FA Item Code per unit."
            : "Fixed-asset stock received by GRN or import, and the FA Item Codes generated for it. Each code becomes a fixed asset on Fixed Asset Depreciation Tag."
        }
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => { refetch(); refetchPending(); }} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              {rights.canExport && (
                <button onClick={handleExport} className={`${KEY_LINE} h-9 px-3`} title="Every FA Inventory line, whatever the filters show">
                  <FileSpreadsheet size={13} /> <span className="hidden sm:inline">Export</span>
                </button>
              )}
              {rights.canCreate && (
                <>
                  <InventoryImport companies={companyList} allProjects={projectList} godowns={ensureArray<Godown>(godownsData?.data)} />
                  <button onClick={() => openNew()} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New tagging</button>
                </>
              )}
            </div>
          ) : (
            <button onClick={() => setView("list")} className={`${KEY_LINE} h-9 px-3`}>Back to inventory</button>
          )
        }
      >
        {view === "form" ? (
          <TaggingForm key={JSON.stringify(prefill)} prefill={prefill} onClose={() => setView("list")} />
        ) : (
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
              <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
                <span className="inline-flex h-9 border border-foreground" role="group" aria-label="Show">
                  {SHOW.map((s) => (
                    <button key={s.k} onClick={() => setShow(s.k)} aria-pressed={show === s.k}
                      className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-3 transition-colors ${show === s.k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                      {s.label}
                    </button>
                  ))}
                </span>
                <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); }} className={select} aria-label="Company">
                  <option value="">All companies</option>
                  {companyList.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={select} disabled={!companyId} aria-label="Project">
                  <option value="">All projects</option>
                  {filterProjects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <DateInput value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${INP} !h-9 text-xs sm:w-36`} aria-label="From date" />
                  <span className="text-xs text-muted-foreground">to</span>
                  <DateInput value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${INP} !h-9 text-xs sm:w-36`} aria-label="To date" />
                </div>
                {anyFilter && (
                  <button onClick={() => { setCompanyId(""); setProjectId(""); setFromDate(""); setToDate(""); }} className={`${KEY_LINE} h-9 px-3`}>Clear</button>
                )}
              </div>
              <DataTable
                data={rows}
                columns={COLUMNS}
                loading={isLoading}
                searchable
                searchPlaceholder="Search doc no, item, FA code…"
                paginated
                getRowId={(r) => r.key}
                rowClassName={(row) => (row.original.kind === "pending" ? "bg-primary/[0.04]" : "")}
                emptyMessage={anyFilter || show !== "all" ? "Nothing matches these filters." : "No FA inventory yet. Receive fixed-asset stock by GRN or Import, then tag it here."}
              />
            </div>
          </div>
        )}
      </SheetShell>

      {editTag && <EditTaggingDialog tag={editTag} onClose={() => setEditTag(null)} />}
      {deleteId != null && <DeleteTaggingDialog tagId={deleteId} onClose={() => setDeleteId(null)} />}
      {deletePendingId != null && <DeletePendingDialog assetId={deletePendingId} onClose={() => setDeletePendingId(null)} />}
    </>
  );
}
