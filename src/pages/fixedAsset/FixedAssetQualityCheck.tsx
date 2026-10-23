// Owner & Quality Checking: each check of a fixed asset's condition and when to look at it again. Parts under
// ./qualityCheck: QualityCheckForm · QualityCheckPanel (open one, delete, picture viewer). Sheet styles from ./record/config.
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CalendarPlus, CheckCircle2, Eye, PenSquare, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { getQualityChecks, setFollowUpStatus, type FollowUpStatus, type QualityCheckItem } from "@/api/fixedAssetQualityCheckApi";
import { INP, KEY_INK, KEY_LINE, RULE, ensureArray, fmt, fmtDate } from "./record/config";
import { todayLocal } from "./tagging/config";
import { QC_REFRESH, QualityCheckForm, type QCStart } from "./qualityCheck/QualityCheckForm";
import { DeleteQualityCheckDialog, PictureViewer, QualityCheckPanel, conditionTone, followUpTone } from "./qualityCheck/QualityCheckPanel";
import { UserMark } from "./assignment/pickers";

type Show = "all" | "Pending" | "Overdue" | "Completed" | "Cancelled";

export default function FixedAssetQualityCheck() {
  const rights = usePageRights("fixed-asset-quality-check");
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [start, setStart] = useState<QCStart>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [picture, setPicture] = useState<{ src: string; label: string } | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [projectId, setProjectId] = useState("");

  const { data: checks = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["fa-quality-checks"], queryFn: () => getQualityChecks() });
  const all = ensureArray<QualityCheckItem>(checks);
  const projects = useMemo(() => {
    const m = new Map<number, string>();
    all.forEach((c) => c.ProjectId && m.set(c.ProjectId, c.ProjectName || `Project ${c.ProjectId}`));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const rows = useMemo(
    () =>
      all.filter(
        (c) => (show === "all" || (show === "Overdue" ? c.IsOverdue === 1 : c.FollowUpStatus === show)) && (!projectId || String(c.ProjectId) === projectId),
      ),
    [all, show, projectId],
  );

  const today = todayLocal();
  const weekOut = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const pending = all.filter((c) => c.FollowUpStatus === "Pending");
  const stats = [
    { label: "Overdue", value: fmt(all.filter((c) => c.IsOverdue === 1).length), note: "follow-ups past their date" },
    { label: "Due this week", value: fmt(pending.filter((c) => c.NextFollowUpDate && c.NextFollowUpDate.slice(0, 10) >= today && c.NextFollowUpDate.slice(0, 10) <= weekOut).length), note: "the next seven days" },
    { label: "Not good", value: fmt(all.filter((c) => c.QualityStatus === "Defective" || c.QualityStatus === "Repairing").length), note: "checks found defective or in repair" },
    { label: "Checks", value: fmt(all.length), note: `${fmt(pending.length)} with a follow-up open` },
  ];

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: FollowUpStatus }) => setFollowUpStatus(id, status),
    onSuccess: (_r, v) => {
      toast.success(v.status === "Completed" ? "Follow-up done" : "Follow-up cancelled");
      QC_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openNew = (s: QCStart = null) => { setOpenId(null); setEditingId(null); setStart(s); setView("form"); };
  const openEdit = (id: number) => { setOpenId(null); setStart(null); setEditingId(id); setView("form"); };

  const COLUMNS: ColumnDef<QualityCheckItem>[] = [
    {
      id: "DocNo",
      accessorKey: "DocNo",
      size: 140,
      header: "Doc no",
      cell: ({ row: { original: c } }) => (
        <div className="leading-tight">
          <p className="font-heading tabular-nums text-xs">{c.DocNo || "—"}</p>
          <p className="text-[0.625rem] text-muted-foreground tabular-nums">{fmtDate(c.DocDate)}</p>
        </div>
      ),
    },
    {
      id: "Asset",
      accessorFn: (c) => `${c.ItemName ?? ""} ${c.FAItemCode ?? ""}`,
      size: 230,
      header: "Asset",
      cell: ({ row: { original: c } }) => (
        <div className="leading-tight max-w-[240px]">
          <p className="text-sm text-foreground truncate">{c.ItemName || "—"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{c.FAItemCode || "—"}</p>
        </div>
      ),
    },
    {
      id: "User",
      accessorFn: (c) => `${c.CurrentUserName ?? ""} ${c.ResponsibleUserName ?? ""}`,
      size: 200,
      header: "Has it / responsible",
      cell: ({ row: { original: c } }) => (
        <div className="flex items-center gap-2 min-w-0">
          <UserMark name={c.CurrentUserName || "?"} avatarUrl={c.CurrentUserAvatar} size={22} />
          <div className="leading-tight min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{c.CurrentUserName || "—"}</p>
            {c.ResponsibleUserName && <p className="text-[0.625rem] text-muted-foreground truncate">{c.ResponsibleUserName}</p>}
          </div>
        </div>
      ),
    },
    { id: "QualityStatus", accessorKey: "QualityStatus", size: 120, header: "Condition", cell: ({ getValue }) => <SheetMark text={getValue() as string} tone={conditionTone(getValue() as string)} /> },
    {
      id: "NextFollowUpDate",
      accessorKey: "NextFollowUpDate",
      size: 150,
      header: "Check again",
      cell: ({ row: { original: c } }) => (
        <div className="leading-tight">
          <p className={`text-xs tabular-nums ${c.IsOverdue ? "text-destructive font-semibold" : "text-foreground"}`}>{fmtDate(c.NextFollowUpDate)}</p>
          {c.FollowUpType && <p className="text-[0.625rem] text-muted-foreground">{c.FollowUpType}</p>}
        </div>
      ),
    },
    {
      id: "FollowUpStatus",
      accessorFn: (c) => (c.IsOverdue ? "Overdue" : c.FollowUpStatus),
      size: 120,
      header: "Follow-up",
      cell: ({ row: { original: c } }) => <SheetMark text={c.IsOverdue ? "Overdue" : c.FollowUpStatus} tone={followUpTone(c.FollowUpStatus, c.IsOverdue === 1)} />,
    },
    {
      id: "actions",
      size: 170,
      header: "",
      enableSorting: false,
      cell: ({ row: { original: c } }) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {rights.canEdit && c.FollowUpStatus === "Pending" && (
            <>
              <button onClick={() => statusMut.mutate({ id: c.QualityCheckId, status: "Completed" })} title="Mark the follow-up done" className="p-1.5 text-muted-foreground hover:text-foreground"><CheckCircle2 size={13} /></button>
              <button onClick={() => statusMut.mutate({ id: c.QualityCheckId, status: "Cancelled" })} title="Cancel the follow-up" className="p-1.5 text-muted-foreground hover:text-foreground"><Ban size={13} /></button>
            </>
          )}
          {rights.canCreate && <button onClick={() => openNew({ followUpOf: c })} title="Next check of this asset" className="p-1.5 text-muted-foreground hover:text-foreground"><CalendarPlus size={13} /></button>}
          <button onClick={() => setOpenId(c.QualityCheckId)} title="Open" className="p-1.5 text-muted-foreground hover:text-foreground"><Eye size={13} /></button>
          {rights.canEdit && <button onClick={() => openEdit(c.QualityCheckId)} title="Edit" className="p-1.5 text-muted-foreground hover:text-foreground"><PenSquare size={13} /></button>}
          {rights.canDelete && <button onClick={() => setDeleteId(c.QualityCheckId)} title="Delete" className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>}
        </div>
      ),
    },
  ];

  const SHOW: { k: Show; label: string }[] = [
    { k: "all", label: "All" },
    { k: "Overdue", label: "Overdue" },
    { k: "Pending", label: "Open" },
    { k: "Completed", label: "Done" },
    { k: "Cancelled", label: "Cancelled" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "Owner & Quality Checking"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title={view === "form" ? (editingId != null ? "Edit quality check" : start ? "Next check" : "New quality check") : "Owner & quality checking"}
        subtitle={
          view === "form"
            ? "Record who has the asset, its condition today with a photo, and when to look at it again."
            : "Who has each fixed asset, the condition it was found in, and the follow-ups still open."
        }
        action={
          view === "list" ? (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              {rights.canCreate && <button onClick={() => openNew()} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New check</button>}
            </div>
          ) : (
            <button onClick={() => setView("list")} className={`${KEY_LINE} h-9 px-3`}>Back to checks</button>
          )
        }
      >
        {view === "form" ? (
          <QualityCheckForm
            key={`${editingId ?? "new"}-${start?.followUpOf.QualityCheckId ?? ""}`}
            editingId={editingId}
            start={start}
            onClose={() => setView("list")}
            onView={(src, label) => setPicture({ src, label })}
          />
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
                <span className="inline-flex h-9 border border-foreground overflow-x-auto max-w-full" role="group" aria-label="Show">
                  {SHOW.map((s) => (
                    <button key={s.k} onClick={() => setShow(s.k)} aria-pressed={show === s.k}
                      className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] px-3 shrink-0 transition-colors ${show === s.k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
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
                onRowClick={(row) => setOpenId(row.original.QualityCheckId)}
                getRowId={(c) => String(c.QualityCheckId)}
                rowClassName={(row) => (row.original.IsOverdue ? "bg-destructive/[0.04]" : "")}
                emptyMessage={show !== "all" || projectId ? "No checks match these filters." : "No quality checks yet. Use New check to record an asset's condition."}
              />
            </div>
          </div>
        )}
      </SheetShell>

      {openId != null && (
        <QualityCheckPanel
          id={openId}
          canEdit={rights.canEdit}
          canCreate={rights.canCreate}
          onEdit={() => openEdit(openId)}
          onFollowUp={(c) => openNew({ followUpOf: c })}
          onStatus={(status) => { statusMut.mutate({ id: openId, status }); setOpenId(null); }}
          onView={(src, label) => setPicture({ src, label })}
          onClose={() => setOpenId(null)}
        />
      )}
      {deleteId != null && <DeleteQualityCheckDialog id={deleteId} onClose={() => setDeleteId(null)} />}
      {picture && <PictureViewer src={picture.src} label={picture.label} onClose={() => setPicture(null)} />}
    </>
  );
}
