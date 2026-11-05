// Depreciation Setup: the yearly depreciation rate and method for each asset category. Parts under
// ./depreciationSetup: SetupPanel (new / edit at the side, delete). Sheet styles from ./record/config.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, PenSquare, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { getDepreciationSetups, type DepreciationSetup } from "@/api/depreciationApi";
import { ASSET_CATEGORIES, CATEGORY_ICONS } from "./assetCategories";
import { KEY_INK, KEY_LINE, Mark, RULE, ensureArray, fmt, fmtDate } from "./record/config";
import { DeleteSetupDialog, SetupPanel } from "./depreciationSetup/SetupPanel";

type Show = "all" | "Active" | "Inactive";

export default function DepreciationSetupPage() {
  const rights = usePageRights("depreciation-setup");
  // undefined = closed, null = new, a record = editing it
  const [editing, setEditing] = useState<DepreciationSetup | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<DepreciationSetup | null>(null);
  const [show, setShow] = useState<Show>("all");

  const { data: records = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["depreciation-setups"], queryFn: () => getDepreciationSetups() });
  const all = ensureArray<DepreciationSetup>(records);
  const rows = useMemo(() => (show === "all" ? all : all.filter((r) => r.Status === show)), [all, show]);

  const active = all.filter((r) => r.Status === "Active");
  const covered = new Set(active.map((r) => r.AssetCategory)).size;
  const missing = ASSET_CATEGORIES.filter((c) => !active.some((r) => r.AssetCategory === c));
  const avg = active.length ? active.reduce((s, r) => s + (r.DepreciationRate || 0), 0) / active.length : 0;
  const stats = [
    { label: "Rates", value: fmt(all.length), note: `${fmt(all.length - active.length)} inactive` },
    { label: "Active", value: fmt(active.length), note: "what assets pick from" },
    { label: "Average rate", value: `${avg.toFixed(1)}%`, note: "across the active rates" },
    {
      label: "Categories covered",
      value: `${fmt(covered)}`,
      note: missing.length ? `no active rate: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` +${missing.length - 3}` : ""}` : "every usual category has a rate",
    },
  ];
  // Usual categories first, then any others already in use.
  const categories = useMemo(() => Array.from(new Set([...ASSET_CATEGORIES, ...all.map((r) => r.AssetCategory)])), [all]);

  const COLUMNS: ColumnDef<DepreciationSetup>[] = [
    {
      id: "AssetCategory",
      accessorKey: "AssetCategory",
      size: 240,
      header: "Asset category",
      cell: ({ row: { original: r } }) => {
        const Icon = CATEGORY_ICONS[r.AssetCategory] || Package;
        return (
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-7 w-7 items-center justify-center border border-foreground/40 shrink-0"><Icon size={13} /></span>
            <span className="text-sm font-medium text-foreground truncate">{r.AssetCategory}</span>
          </span>
        );
      },
    },
    {
      id: "DepreciationType",
      accessorKey: "DepreciationType",
      size: 200,
      header: "Method",
      cell: ({ row: { original: r } }) => (
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="font-heading font-semibold uppercase tracking-[0.06em] border border-foreground/40 px-1.5 py-0.5">{r.DepreciationType}</span>
          <span className="text-muted-foreground">{r.DepreciationType === "WDV" ? "Written down value" : r.DepreciationType === "SLM" ? "Straight line" : ""}</span>
        </span>
      ),
    },
    {
      id: "DepreciationRate",
      accessorKey: "DepreciationRate",
      size: 110,
      header: "Rate / year",
      cell: ({ row: { original: r } }) => <p className="text-right font-heading font-bold tabular-nums">{r.DepreciationRate}%</p>,
    },
    { id: "EffectiveFrom", accessorKey: "EffectiveFrom", size: 130, header: "Effective from", cell: ({ row: { original: r } }) => <span className="text-xs tabular-nums">{fmtDate(r.EffectiveFrom)}</span> },
    { id: "Status", accessorKey: "Status", size: 110, header: "Status", cell: ({ row: { original: r } }) => <Mark text={r.Status} tone={r.Status === "Active" ? "done" : "none"} /> },
    {
      id: "actions",
      size: 90,
      header: "",
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {rights.canEdit && <button onClick={() => setEditing(r)} title="Edit" className="p-1.5 text-muted-foreground hover:text-foreground"><PenSquare size={13} /></button>}
          {rights.canDelete && <button onClick={() => setDeleting(r)} title="Delete" className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>}
        </div>
      ),
    },
  ];

  const SHOW: { k: Show; label: string }[] = [
    { k: "all", label: "All" },
    { k: "Active", label: "Active" },
    { k: "Inactive", label: "Inactive" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "Depreciation Setup"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title="Depreciation setup"
        subtitle="The yearly rate and method for each asset category. A new asset takes the Active rate of its category."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </button>
            {rights.canCreate && <button onClick={() => setEditing(null)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New rate</button>}
          </div>
        }
      >
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
              <span className="inline-flex h-9 border border-foreground overflow-x-auto max-w-full" role="group" aria-label="Show">
                {SHOW.map((s) => (
                  <button key={s.k} onClick={() => setShow(s.k)} aria-pressed={show === s.k}
                    className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-3 shrink-0 transition-colors ${show === s.k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                    {s.label}
                  </button>
                ))}
              </span>
            </div>
            <DataTable
              data={rows}
              columns={COLUMNS}
              loading={isLoading}
              searchable
              searchPlaceholder="Search category or method…"
              paginated
              onRowClick={rights.canEdit ? (row) => setEditing(row.original) : undefined}
              getRowId={(r) => String(r.SetupId)}
              rowClassName={(row) => (row.original.Status === "Inactive" ? "opacity-60" : "")}
              emptyMessage={show !== "all" ? "No rates match this filter." : "No depreciation rates yet. Use New rate to set one for a category."}
            />
          </div>
        </div>
      </SheetShell>

      {editing !== undefined && (
        <SetupPanel key={editing?.SetupId ?? "new"} editing={editing} categories={categories} onClose={() => setEditing(undefined)} />
      )}
      {deleting && <DeleteSetupDialog setup={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
