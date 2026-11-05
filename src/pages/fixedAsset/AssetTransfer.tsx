// User-Wise Asset Transfer: fixed assets moving from one person to another. Parts under ./transfer:
//   TransferForm · TransferPanel (open one, delete). People pickers come from ./assignment/pickers.
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Eye, PenSquare, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getAssetTransfers, type TransferListItem } from "@/api/assetTransferApi";
import { INP, KEY_INK, KEY_LINE, RULE, ensureArray, fmt, fmtDate } from "./record/config";
import { todayLocal } from "./tagging/config";
import { TransferForm } from "./transfer/TransferForm";
import { DeleteTransferDialog, TransferPanel } from "./transfer/TransferPanel";
import { UserMark } from "./assignment/pickers";

export default function AssetTransfer() {
  const rights = usePageRights("asset-transfer");
  const { finYears } = useFinYear();
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState("");
  const [finYear, setFinYear] = useState("");

  const { data: transfers = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["asset-transfers"], queryFn: () => getAssetTransfers() });
  const all = ensureArray<TransferListItem>(transfers);
  const projects = useMemo(() => {
    const m = new Map<number, string>();
    all.forEach((t) => t.ProjectId && m.set(t.ProjectId, t.ProjectName || `Project ${t.ProjectId}`));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const rows = useMemo(() => all.filter((t) => (!projectId || String(t.ProjectId) === projectId) && (!finYear || t.FinYear === finYear)), [all, projectId, finYear]);

  const monthStart = todayLocal().slice(0, 8) + "01";
  const stats = [
    { label: "Transfers", value: fmt(rows.length), note: projectId || finYear ? `of ${fmt(all.length)}` : "in all" },
    { label: "This month", value: fmt(all.filter((t) => (t.TransferDate || "").slice(0, 10) >= monthStart).length), note: "by transfer date" },
    { label: "Assets moved", value: fmt(new Set(rows.map((t) => t.AssetId)).size), note: "different assets" },
    { label: "Last", value: all[0] ? fmtDate(all[0].TransferDate) : "—", note: all[0] ? `${all[0].FromUserName || "?"} → ${all[0].ToUserName || "?"}` : "none yet" },
  ];

  const openNew = () => { setEditingId(null); setView("form"); };
  const openEdit = (id: number) => { setOpenId(null); setEditingId(id); setView("form"); };

  const COLUMNS: ColumnDef<TransferListItem>[] = [
    { id: "DocNo", accessorKey: "DocNo", size: 140, header: "Doc no", cell: ({ getValue }) => <span className="font-heading tabular-nums text-xs">{(getValue() as string) || "—"}</span> },
    { id: "TransferDate", accessorKey: "TransferDate", size: 110, header: "Moved on", cell: ({ getValue }) => <span className="text-xs tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
    {
      id: "Asset",
      accessorFn: (t) => `${t.AssetName ?? ""} ${t.FAItemCode ?? ""} ${t.AssetCode ?? ""}`,
      size: 230,
      header: "Asset",
      cell: ({ row: { original: t } }) => (
        <div className="leading-tight max-w-[240px]">
          <p className="text-sm text-foreground truncate">{t.AssetName || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{t.FAItemCode || "—"}</p>
        </div>
      ),
    },
    {
      id: "People",
      accessorFn: (t) => `${t.FromUserName ?? ""} ${t.ToUserName ?? ""}`,
      size: 260,
      header: "From → to",
      cell: ({ row: { original: t } }) => (
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <UserMark name={t.FromUserName || "?"} avatarUrl={t.FromUserAvatar} size={20} />
          <span className="truncate">{t.FromUserName || "—"}</span>
          <ArrowRight size={11} className="shrink-0 text-muted-foreground" />
          <UserMark name={t.ToUserName || "?"} avatarUrl={t.ToUserAvatar} size={20} />
          <span className="font-medium truncate">{t.ToUserName || "—"}</span>
        </div>
      ),
    },
    {
      id: "ProjectName",
      accessorFn: (t) => `${t.ProjectName ?? ""} ${t.CompanyName ?? ""} ${t.DepartmentName ?? ""}`,
      size: 190,
      header: "Project / department",
      cell: ({ row: { original: t } }) => (
        <div className="text-xs leading-tight">
          <p className="text-foreground">{t.ProjectName || "—"}</p>
          <p className="text-muted-foreground">{t.DepartmentName || t.CompanyName || ""}</p>
        </div>
      ),
    },
    { id: "Remarks", accessorKey: "Remarks", size: 180, header: "Why", cell: ({ getValue }) => <span className="text-xs text-muted-foreground block max-w-[180px] truncate" title={getValue() as string}>{(getValue() as string) || "—"}</span> },
    {
      id: "actions",
      size: 100,
      header: "",
      enableSorting: false,
      cell: ({ row: { original: t } }) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setOpenId(t.Id)} title="Open" className="p-1.5 text-muted-foreground hover:text-foreground"><Eye size={13} /></button>
          {rights.canEdit && <button onClick={() => openEdit(t.Id)} title="Edit" className="p-1.5 text-muted-foreground hover:text-foreground"><PenSquare size={13} /></button>}
          {rights.canDelete && <button onClick={() => setDeleteId(t.Id)} title="Delete" className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>}
        </div>
      ),
    },
  ];

  const select = `${INP} !h-9 text-xs w-full sm:w-48`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "User-Wise Asset Transfer"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title={view === "form" ? (editingId != null ? "Edit transfer" : "New transfer") : "User-wise asset transfer"}
        subtitle={
          view === "form"
            ? "Move a fixed asset from the person who has it to someone else; the new holder gets an assignment for it."
            : "Fixed assets moved from one person to another. Each transfer also records an assignment to the new holder."
        }
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              {rights.canCreate && <button onClick={openNew} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New transfer</button>}
            </div>
          ) : (
            <button onClick={() => setView("list")} className={`${KEY_LINE} h-9 px-3`}>Back to transfers</button>
          )
        }
      >
        {view === "form" ? (
          <TransferForm key={editingId ?? "new"} editingId={editingId} onClose={() => setView("list")} />
        ) : (
          <div className="space-y-5">
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                {stats.map((x) => (
                  <div key={x.label}>
                    <p className="label">{x.label}</p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="truncate">{x.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card" style={{ border: RULE }}>
              <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
                {projects.length > 1 && (
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={select} aria-label="Project">
                    <option value="">All projects</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <select value={finYear} onChange={(e) => setFinYear(e.target.value)} className={select} aria-label="Financial year">
                  <option value="">All years</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
                {(projectId || finYear) && <button onClick={() => { setProjectId(""); setFinYear(""); }} className={`${KEY_LINE} h-9 px-3`}>Clear</button>}
              </div>
              <DataTable
                data={rows}
                columns={COLUMNS}
                loading={isLoading}
                searchable
                searchPlaceholder="Search doc no, asset, person…"
                paginated
                onRowClick={(row) => setOpenId(row.original.Id)}
                getRowId={(t) => String(t.Id)}
                emptyMessage={projectId || finYear ? "No transfers match these filters." : "No transfers yet. Use New transfer to move an asset to someone else."}
              />
            </div>
          </div>
        )}
      </SheetShell>

      {openId != null && <TransferPanel id={openId} canEdit={rights.canEdit} onEdit={() => openEdit(openId)} onClose={() => setOpenId(null)} />}
      {deleteId != null && <DeleteTransferDialog id={deleteId} onClose={() => setDeleteId(null)} />}
    </>
  );
}
