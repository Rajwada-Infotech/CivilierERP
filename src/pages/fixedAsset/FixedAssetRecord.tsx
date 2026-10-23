// Fixed Asset Depreciation Tag: the asset register. Parts under ./record:
//   config (types, helpers, sheet styles) · AssetForm · AssetDetail · DepreciationPosting · AssetDialogs
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, PenSquare, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getFixedAssets, type FixedAssetListItem } from "@/api/fixedAssetApi";
import { AssetForm } from "./record/AssetForm";
import { AssetDetail } from "./record/AssetDetail";
import { DeleteAssetDialog, ReverseAssetDialog } from "./record/AssetDialogs";
import {
  ASSET_STATUS_OPTIONS, FA_REGISTER_EXPORT_COLUMNS, INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT, ValueBar,
  assetTone, bookValue, ensureArray, fmt, fmtCur, fmtDate,
} from "./record/config";

type View = "list" | "form" | "detail";

export default function FixedAssetRecord() {
  const rights = usePageRights("fixed-asset-record");
  const { finYears } = useFinYear();
  const [view, setView] = useState<View>("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [reverseId, setReverseId] = useState<number | null>(null);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [finYear, setFinYear] = useState("");
  const [projectId, setProjectId] = useState("");

  const { data: assets = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["fixed-assets"], queryFn: () => getFixedAssets() });
  const live = useMemo(() => ensureArray<FixedAssetListItem>(assets).filter((a) => a.Status !== "Deleted"), [assets]);

  const categories = useMemo(() => Array.from(new Set(live.map((a) => a.AssetCategory).filter(Boolean))).sort(), [live]);
  const projects = useMemo(() => {
    const m = new Map<number, string>();
    live.forEach((a) => a.ProjectId && m.set(a.ProjectId, a.ProjectName || `Project ${a.ProjectId}`));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [live]);

  const filtered = useMemo(
    () =>
      live.filter(
        (a) =>
          (!category || a.AssetCategory === category) &&
          (!status || a.AssetStatus === status) &&
          (!finYear || a.FinYear === finYear) &&
          (!projectId || String(a.ProjectId) === projectId),
      ),
    [live, category, status, finYear, projectId],
  );
  const anyFilter = !!(category || status || finYear || projectId);

  const totals = useMemo(() => {
    const cost = filtered.reduce((s, a) => s + (a.PurchaseCost || 0), 0);
    const dep = filtered.reduce((s, a) => s + (a.Depreciated || 0), 0);
    return { cost, dep, value: filtered.reduce((s, a) => s + bookValue(a), 0) };
  }, [filtered]);

  const byCategory = useMemo(() => {
    const m = new Map<string, { cost: number; value: number }>();
    for (const a of filtered) {
      const c = m.get(a.AssetCategory) ?? { cost: 0, value: 0 };
      c.cost += a.PurchaseCost || 0;
      c.value += bookValue(a);
      m.set(a.AssetCategory, c);
    }
    return Array.from(m, ([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost).slice(0, 6);
  }, [filtered]);

  const openNew = () => { setEditingId(null); setView("form"); };
  const openEdit = (id: number) => { setEditingId(id); setView("form"); };
  const openDetail = (id: number) => { setOpenId(id); setView("detail"); };
  const toList = () => { setView("list"); setEditingId(null); setOpenId(null); };

  const COLUMNS: ColumnDef<FixedAssetListItem>[] = [
    {
      id: "AssetName",
      accessorFn: (a) => `${a.AssetName} ${a.AssetCode ?? ""} ${a.SerialNumber ?? ""}`,
      header: "Asset",
      cell: ({ row: { original: a } }) => (
        <div className="leading-tight min-w-0 max-w-[260px]">
          <p className="text-sm font-medium text-foreground truncate" title={a.AssetName}>{a.AssetName}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{a.AssetCode || "—"}{a.SerialNumber ? ` · SN ${a.SerialNumber}` : ""}</p>
        </div>
      ),
    },
    { id: "FAItemCode", accessorKey: "FAItemCode", header: "FA Item Code", cell: ({ getValue }) => <span className="font-heading tabular-nums text-xs">{(getValue() as string) || "—"}</span> },
    { id: "AssetCategory", accessorKey: "AssetCategory", header: "Category", cell: ({ getValue }) => <span className="text-xs">{getValue() as string}</span> },
    {
      id: "ProjectName",
      accessorFn: (a) => `${a.ProjectName ?? ""} ${a.CompanyName ?? ""}`,
      header: "Company / project",
      cell: ({ row: { original: a } }) => (
        <div className="text-xs leading-tight">
          <p className="text-foreground">{a.ProjectName || "—"}</p>
          <p className="text-muted-foreground">{a.CompanyName || ""}</p>
        </div>
      ),
    },
    { id: "PurchaseDate", accessorKey: "PurchaseDate", header: "Purchased", cell: ({ getValue }) => <span className="text-xs tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
    {
      id: "PurchaseCost",
      accessorKey: "PurchaseCost",
      header: () => <span className="block text-right">Cost</span>,
      cell: ({ getValue }) => <span className="block text-right text-xs tabular-nums">{fmtCur(getValue() as number)}</span>,
    },
    {
      id: "BookValue",
      accessorFn: (a) => bookValue(a),
      header: () => <span className="block text-right">Book value</span>,
      cell: ({ row: { original: a } }) => (
        <div className="min-w-[110px]">
          <span className="block text-right text-xs font-semibold tabular-nums text-foreground">{fmtCur(bookValue(a))}</span>
          {a.Depreciated > 0 && <span className="block mt-1"><ValueBar value={bookValue(a)} cost={a.PurchaseCost} /></span>}
        </div>
      ),
    },
    { id: "AssetStatus", accessorKey: "AssetStatus", header: "Status", cell: ({ getValue }) => <SheetMark text={getValue() as string} tone={assetTone(getValue() as string)} /> },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row: { original: a } }) => {
        const transferred = a.AssetStatus === "Transferred";
        return (
          <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => openDetail(a.AssetId)} title="Open" className="p-1.5 text-muted-foreground hover:text-foreground"><Eye size={13} /></button>
            {rights.canEdit && !transferred && (
              <button onClick={() => openEdit(a.AssetId)} title="Edit" className="p-1.5 text-muted-foreground hover:text-foreground"><PenSquare size={13} /></button>
            )}
            {rights.canDelete && !transferred && (
              <button onClick={() => setDeleteId(a.AssetId)} title="Delete" className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>
            )}
            {rights.canReverse && (
              <button onClick={() => setReverseId(a.AssetId)} title="Delete & reverse GRN" className="p-1.5 text-muted-foreground hover:text-destructive"><Undo2 size={13} /></button>
            )}
          </div>
        );
      },
    },
  ];

  const stats = [
    { label: "Assets", value: fmt(filtered.length), note: anyFilter ? `of ${fmt(live.length)} in the register` : "in the register" },
    { label: "Cost", value: fmtCur(totals.cost), note: "purchase cost" },
    { label: "Depreciation posted", value: fmtCur(totals.dep), note: "reversed entries left out" },
    { label: "Book value", value: fmtCur(totals.value), note: "cost less posted depreciation" },
  ];
  const maxCost = Math.max(1, ...byCategory.map((c) => c.cost));
  const select = `${INP} !h-9 text-xs w-full sm:w-44`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "Fixed Asset Depreciation Tag"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title={view === "form" ? (editingId != null ? "Edit fixed asset" : "New fixed asset") : "Fixed asset depreciation tag"}
        subtitle={
          view === "form"
            ? "Make a fixed asset from an FA Item Code generated in FA Inventory; its depreciation rate comes from the category."
            : "Every fixed asset made from an FA Item Code, what it cost, and what is left on the books after posted depreciation."
        }
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              <ExportMenu
                data={filtered as unknown as Record<string, unknown>[]}
                columns={FA_REGISTER_EXPORT_COLUMNS}
                title="Fixed Asset Register"
                filename="fixed-asset-register"
                disabled={!filtered.length || !rights.canExport}
              />
              {rights.canCreate && (
                <button onClick={openNew} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New asset</button>
              )}
            </div>
          ) : view === "form" ? (
            <button onClick={toList} className={`${KEY_LINE} h-9 px-3`}>Back to register</button>
          ) : undefined
        }
      >
        {view === "form" && <AssetForm key={editingId ?? "new"} editingId={editingId} onClose={toList} onSaved={openDetail} />}

        {view === "detail" && openId != null && (
          <AssetDetail assetId={openId} canEdit={rights.canEdit} onBack={toList} onEdit={() => openEdit(openId)} />
        )}

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

            {byCategory.length > 0 && (
              <div className="bg-card" style={{ border: RULE }}>
                <div className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-2" style={{ borderBottom: RULE }}>
                  <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Book value by category</span>
                  <span className="text-[0.6875rem] text-muted-foreground">Bar length is cost; the filled part is still on the books</span>
                </div>
                <div className="px-5 py-3 grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  {byCategory.map((c) => (
                    <div key={c.name} className="py-2.5" style={{ borderBottom: RULE_SOFT }}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`${LBL} !text-foreground truncate`} title={c.name}>{c.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                          <span className="font-semibold text-foreground">{fmtCur(c.value)}</span> of {fmtCur(c.cost)}
                        </span>
                      </div>
                      <span className="block mt-1.5" style={{ width: `${Math.max(2, (c.cost / maxCost) * 100)}%` }}>
                        <ValueBar value={c.value} cost={c.cost} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-card" style={{ border: RULE }}>
              <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
                {projects.length > 1 && (
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={select} aria-label="Project">
                    <option value="">All projects</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={select} aria-label="Category">
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={select} aria-label="Status">
                  <option value="">All statuses</option>
                  {[...ASSET_STATUS_OPTIONS, "Transferred"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={finYear} onChange={(e) => setFinYear(e.target.value)} className={select} aria-label="Financial year">
                  <option value="">All years</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
                {anyFilter && (
                  <button onClick={() => { setCategory(""); setStatus(""); setFinYear(""); setProjectId(""); }} className={`${KEY_LINE} h-9 px-3`}>Clear</button>
                )}
              </div>
              <DataTable
                data={filtered}
                columns={COLUMNS}
                loading={isLoading}
                searchable
                searchPlaceholder="Search name, code, serial…"
                paginated
                onRowClick={(row) => openDetail(row.original.AssetId)}
                getRowId={(a) => String(a.AssetId)}
                emptyMessage={anyFilter ? "No assets match these filters." : "No fixed assets yet. Make one from an FA Item Code with New asset."}
              />
            </div>
          </div>
        )}
      </SheetShell>

      {deleteId != null && <DeleteAssetDialog assetId={deleteId} onClose={() => setDeleteId(null)} />}
      {reverseId != null && <ReverseAssetDialog assetId={reverseId} onClose={() => setReverseId(null)} />}
    </>
  );
}
