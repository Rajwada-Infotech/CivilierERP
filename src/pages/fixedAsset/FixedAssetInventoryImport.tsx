// Inventory Import: fixed-asset stock brought into a godown without a GRN. Parts under ./inventoryImport:
//   ImportForm · ReverseImportDialog. Sheet styles come from ./record/config.
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Undo2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { getInventoryImports, type InventoryImportListItem } from "@/api/fixedAssetInventoryImportApi";
import { INP, KEY_INK, KEY_LINE, RULE, ensureArray, fmt, fmtCur, fmtDate } from "./record/config";
import { ImportForm } from "./inventoryImport/ImportForm";
import { ReverseImportDialog } from "./inventoryImport/ReverseImportDialog";

const value = (i: InventoryImportListItem) => (i.Rate != null ? (i.Quantity || 0) * i.Rate : null);

export default function FixedAssetInventoryImport() {
  const rights = usePageRights("fixed-asset-inventory-import");
  const [view, setView] = useState<"list" | "form">("list");
  const [status, setStatus] = useState<"" | "Active" | "Reversed">("");
  const [projectId, setProjectId] = useState("");
  const [reversing, setReversing] = useState<InventoryImportListItem | null>(null);

  const { data: imports = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["fixed-asset-inventory-imports"], queryFn: () => getInventoryImports() });
  const all = ensureArray<InventoryImportListItem>(imports);
  const projects = useMemo(() => {
    const m = new Map<number, string>();
    all.forEach((i) => i.ProjectId && m.set(i.ProjectId, i.ProjectName || `Project ${i.ProjectId}`));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const rows = useMemo(() => all.filter((i) => (!status || i.Status === status) && (!projectId || String(i.ProjectId) === projectId)), [all, status, projectId]);

  const active = all.filter((i) => i.Status === "Active");
  const stats = [
    { label: "Imports", value: fmt(active.length), note: `${fmt(all.length - active.length)} reversed` },
    { label: "Units brought in", value: fmt(active.reduce((s, i) => s + (i.Quantity || 0), 0)), note: "by imports still standing" },
    { label: "Value", value: fmtCur(active.reduce((s, i) => s + (value(i) ?? 0), 0)), note: "quantity × unit rate, where a rate was given" },
    { label: "Last import", value: active[0] ? fmtDate(active[0].DocDate) : "—", note: active[0]?.DocNo || "none yet" },
  ];

  const COLUMNS: ColumnDef<InventoryImportListItem>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      size: 150,
      header: "Doc no",
      cell: ({ row: { original: i } }) => (
        <div className="leading-tight">
          <p className="font-heading tabular-nums text-xs">{i.DocNo || "—"}</p>
          <p className="text-[0.625rem] text-muted-foreground">{i.CreatedBy || ""}</p>
        </div>
      ),
    },
    { id: "DocDate", accessorKey: "DocDate", size: 110, header: "Date", cell: ({ getValue }) => <span className="text-xs tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
    {
      id: "ItemName",
      accessorFn: (i) => `${i.ItemName ?? ""} ${i.AssetCategory ?? ""}`,
      size: 230,
      header: "Item",
      cell: ({ row: { original: i } }) => (
        <div className="leading-tight max-w-[240px]">
          <p className="text-sm text-foreground truncate">{i.ItemName || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground truncate">{i.AssetCategory || "—"}</p>
        </div>
      ),
    },
    {
      id: "ProjectName",
      accessorFn: (i) => `${i.ProjectName ?? ""} ${i.CompanyName ?? ""} ${i.GodownName ?? ""}`,
      size: 210,
      header: "Project / godown",
      cell: ({ row: { original: i } }) => (
        <div className="text-xs leading-tight">
          <p className="text-foreground">{i.ProjectName || "—"}</p>
          <p className="text-muted-foreground">{[i.CompanyName, i.GodownName].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    { id: "Quantity", accessorKey: "Quantity", size: 80, header: () => <span className="block text-right">Qty</span>, cell: ({ getValue }) => <span className="block text-right text-xs tabular-nums">{fmt(getValue() as number)}</span> },
    {
      id: "Value",
      accessorFn: (i) => value(i) ?? 0,
      size: 130,
      header: () => <span className="block text-right">Value</span>,
      cell: ({ row: { original: i } }) => (
        <div className="text-right leading-tight">
          <p className="text-xs font-semibold tabular-nums text-foreground">{value(i) != null ? fmtCur(value(i)) : "—"}</p>
          {i.Rate != null && <p className="text-[0.625rem] text-muted-foreground tabular-nums">@ {fmtCur(i.Rate)}</p>}
        </div>
      ),
    },
    {
      id: "Status",
      accessorKey: "Status",
      size: 130,
      header: "Status",
      cell: ({ row: { original: i } }) => (
        <div className="space-y-1">
          <SheetMark text={i.Status} tone={i.Status === "Reversed" ? "stopped" : "done"} />
          {i.Status === "Reversed" && i.ReversedAt && <p className="text-[0.625rem] text-muted-foreground">{fmtDate(i.ReversedAt)}{i.ReversedBy ? ` · ${i.ReversedBy}` : ""}</p>}
        </div>
      ),
    },
    {
      id: "Remarks",
      accessorKey: "Remarks",
      size: 170,
      header: "Remarks",
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground block max-w-[170px] truncate" title={getValue() as string}>{(getValue() as string) || "—"}</span>,
    },
    {
      id: "actions",
      size: 50,
      header: "",
      enableSorting: false,
      cell: ({ row: { original: i } }) =>
        rights.canDelete && i.Status === "Active" ? (
          <button onClick={() => setReversing(i)} title="Reverse this import" className="p-1.5 text-muted-foreground hover:text-destructive">
            <Undo2 size={13} />
          </button>
        ) : null,
    },
  ];

  const select = `${INP} !h-9 text-xs w-full sm:w-48`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "Inventory Import"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title={view === "form" ? "New inventory import" : "Inventory import"}
        subtitle={
          view === "form"
            ? "Bring a Fixed Asset item into a godown when there is no GRN to receive it through."
            : "Fixed-asset stock brought in without a GRN. Each import lands in FA Inventory and is tagged like a GRN receipt."
        }
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              {rights.canCreate && (
                <button onClick={() => setView("form")} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New import</button>
              )}
            </div>
          ) : (
            <button onClick={() => setView("list")} className={`${KEY_LINE} h-9 px-3`}>Back to imports</button>
          )
        }
      >
        {view === "form" ? (
          <ImportForm onClose={() => setView("list")} />
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
                <span className="inline-flex h-9 border border-foreground" role="group" aria-label="Status">
                  {(["", "Active", "Reversed"] as const).map((s) => (
                    <button key={s || "all"} onClick={() => setStatus(s)} aria-pressed={status === s}
                      className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-3 transition-colors ${status === s ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                      {s || "All"}
                    </button>
                  ))}
                </span>
                {projects.length > 1 && (
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={select} aria-label="Project">
                    <option value="">All projects</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>
              <DataTable
                data={rows}
                columns={COLUMNS}
                loading={isLoading}
                searchable
                searchPlaceholder="Search doc no, item, project…"
                paginated
                getRowId={(i) => String(i.ImportId)}
                rowClassName={(row) => (row.original.Status === "Reversed" ? "opacity-60" : "")}
                emptyMessage={status || projectId ? "No imports match these filters." : "No inventory imports yet. Use New import to bring in stock that has no GRN."}
              />
            </div>
          </div>
        )}
      </SheetShell>

      {reversing && <ReverseImportDialog importId={reversing.ImportId} docNo={reversing.DocNo} onClose={() => setReversing(null)} />}
    </>
  );
}
