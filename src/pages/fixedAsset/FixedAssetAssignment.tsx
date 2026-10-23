// Assignment: who each fixed asset was handed to. Parts under ./assignment:
//   pickers (person, FA Item Code) · AssignmentForm · AssignmentPanel (open one, delete). Sheet styles from ./record/config.
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Eye, PenSquare, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { getAssignableAssets, getAssignments, type AssignmentListItem } from "@/api/fixedAssetAssignmentApi";
import { INP, KEY_INK, KEY_LINE, RULE, ensureArray, fmt, fmtDate } from "./record/config";
import { AssignmentForm } from "./assignment/AssignmentForm";
import { AssignmentPanel, DeleteAssignmentDialog } from "./assignment/AssignmentPanel";
import { UserMark } from "./assignment/pickers";

export default function FixedAssetAssignment() {
  const rights = usePageRights("fixed-asset-assignment");
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [show, setShow] = useState<"all" | "current" | "earlier">("all");
  const [projectId, setProjectId] = useState("");

  const { data: assignments = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["fixed-asset-assignments"], queryFn: () => getAssignments() });
  // Codes never assigned: the same list New assignment offers.
  const { data: assignable = [] } = useQuery({ queryKey: ["fixed-asset-assignable-assets"], queryFn: getAssignableAssets });
  const all = ensureArray<AssignmentListItem>(assignments);
  const projects = useMemo(() => {
    const m = new Map<number, string>();
    all.forEach((a) => a.ProjectId && m.set(a.ProjectId, a.ProjectName || `Project ${a.ProjectId}`));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const rows = useMemo(
    () => all.filter((a) => (show === "all" || (show === "current") === !!a.IsCurrent) && (!projectId || String(a.ProjectId) === projectId)),
    [all, show, projectId],
  );

  const current = all.filter((a) => a.IsCurrent);
  const stats = [
    { label: "Assets with someone", value: fmt(new Set(current.map((a) => a.AssetId)).size), note: `held by ${fmt(new Set(current.map((a) => a.UserId)).size)} people` },
    { label: "Waiting for a user", value: fmt(ensureArray(assignable).length), note: "codes never assigned" },
    { label: "Assignments", value: fmt(all.length), note: `${fmt(all.filter((a) => a.SourceTransferId).length)} made by transfers` },
    { label: "Last", value: all[0] ? fmtDate(all[0].DocDate) : "—", note: all[0] ? `${all[0].DocNo || ""} · ${all[0].UserName || ""}` : "none yet" },
  ];

  const openNew = () => { setEditingId(null); setView("form"); };
  const openEdit = (id: number) => { setOpenId(null); setEditingId(id); setView("form"); };

  const COLUMNS: ColumnDef<AssignmentListItem>[] = [
    {
      id: "DocNo",
      accessorFn: (a) => `${a.DocNo ?? ""} ${a.SourceTransferDocNo ?? ""}`,
      size: 150,
      header: "Doc no",
      cell: ({ row: { original: a } }) => (
        <div className="leading-tight">
          <p className="font-heading tabular-nums text-xs">{a.DocNo || "—"}</p>
          {a.SourceTransferId && (
            <p className="text-[0.625rem] text-muted-foreground inline-flex items-center gap-1" title="Made by a User-Wise Asset Transfer">
              <ArrowLeftRight size={10} /> {a.SourceTransferDocNo || "Transfer"}
            </p>
          )}
        </div>
      ),
    },
    { id: "DocDate", accessorKey: "DocDate", size: 110, header: "Date", cell: ({ getValue }) => <span className="text-xs tabular-nums whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
    {
      id: "Asset",
      accessorFn: (a) => `${a.AssetName ?? ""} ${a.FAItemCode ?? ""} ${a.AssetCode ?? ""}`,
      size: 240,
      header: "Asset",
      cell: ({ row: { original: a } }) => (
        <div className="leading-tight max-w-[250px]">
          <p className="text-sm text-foreground truncate">{a.AssetName || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{a.FAItemCode || "—"}</p>
        </div>
      ),
    },
    {
      id: "User",
      accessorFn: (a) => `${a.UserName ?? ""} ${a.ResponsibleUserName ?? ""}`,
      size: 200,
      header: "Assigned to",
      cell: ({ row: { original: a } }) => (
        <div className="flex items-center gap-2 min-w-0">
          <UserMark name={a.UserName || "?"} avatarUrl={a.UserAvatar} size={24} />
          <div className="leading-tight min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{a.UserName || "—"}</p>
            {a.ResponsibleUserName && <p className="text-[0.625rem] text-muted-foreground truncate">Responsible: {a.ResponsibleUserName}</p>}
          </div>
        </div>
      ),
    },
    {
      id: "ProjectName",
      accessorFn: (a) => `${a.ProjectName ?? ""} ${a.CompanyName ?? ""}`,
      size: 190,
      header: "Company / project",
      cell: ({ row: { original: a } }) => (
        <div className="text-xs leading-tight">
          <p className="text-foreground">{a.ProjectName || "—"}</p>
          <p className="text-muted-foreground">{a.CompanyName || ""}</p>
        </div>
      ),
    },
    { id: "IsCurrent", accessorFn: (a) => (a.IsCurrent ? 1 : 0), size: 120, header: "Now", cell: ({ row: { original: a } }) => <SheetMark text={a.IsCurrent ? "Has it" : "Earlier"} tone={a.IsCurrent ? "done" : "waiting"} /> },
    {
      id: "actions",
      size: 100,
      header: "",
      enableSorting: false,
      cell: ({ row: { original: a } }) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setOpenId(a.AssignmentId)} title="Open" className="p-1.5 text-muted-foreground hover:text-foreground"><Eye size={13} /></button>
          {rights.canEdit && <button onClick={() => openEdit(a.AssignmentId)} title="Edit" className="p-1.5 text-muted-foreground hover:text-foreground"><PenSquare size={13} /></button>}
          {rights.canDelete && !a.SourceTransferId && (
            <button onClick={() => setDeleteId(a.AssignmentId)} title="Delete" className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>
          )}
        </div>
      ),
    },
  ];

  const SHOW = [
    { k: "all" as const, label: "All" },
    { k: "current" as const, label: "Has it now" },
    { k: "earlier" as const, label: "Earlier" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "Assignment"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title={view === "form" ? (editingId != null ? "Edit assignment" : "New assignment") : "Assignment"}
        subtitle={
          view === "form"
            ? "Hand a fixed asset to the person who will use it, and name who answers for it."
            : "Who each fixed asset was handed to. A code is assigned once; after that it moves between people through User-Wise Asset Transfer."
        }
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              {rights.canCreate && <button onClick={openNew} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New assignment</button>}
            </div>
          ) : (
            <button onClick={() => setView("list")} className={`${KEY_LINE} h-9 px-3`}>Back to assignments</button>
          )
        }
      >
        {view === "form" ? (
          <AssignmentForm key={editingId ?? "new"} editingId={editingId} onClose={() => setView("list")} />
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
                <span className="inline-flex h-9 border border-foreground" role="group" aria-label="Show">
                  {SHOW.map((s) => (
                    <button key={s.k} onClick={() => setShow(s.k)} aria-pressed={show === s.k}
                      className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-3 transition-colors ${show === s.k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                      {s.label}
                    </button>
                  ))}
                </span>
                {projects.length > 1 && (
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${INP} !h-9 text-xs w-full sm:w-48`} aria-label="Project">
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
                searchPlaceholder="Search doc no, asset, FA code, person…"
                paginated
                onRowClick={(row) => setOpenId(row.original.AssignmentId)}
                getRowId={(a) => String(a.AssignmentId)}
                emptyMessage={show !== "all" || projectId ? "No assignments match these filters." : "No assignments yet. Use New assignment to hand an asset to someone."}
              />
            </div>
          </div>
        )}
      </SheetShell>

      {openId != null && <AssignmentPanel id={openId} canEdit={rights.canEdit} onEdit={() => openEdit(openId)} onClose={() => setOpenId(null)} />}
      {deleteId != null && <DeleteAssignmentDialog id={deleteId} onClose={() => setDeleteId(null)} />}
    </>
  );
}
