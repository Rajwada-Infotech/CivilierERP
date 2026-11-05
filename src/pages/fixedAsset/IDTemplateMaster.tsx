// ID Template Master: the project alias that starts every FA Item Code of a project. Parts under
// ./idTemplate: TemplatePanel (new / edit at the side, delete, sample codes). Sheet styles from ./record/config.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PenSquare, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getIDTemplates, updateIDTemplate, type IDTemplate } from "@/api/idTemplateMasterApi";
import { KEY_INK, KEY_LINE, Mark, RULE, ensureArray, fmt } from "./record/config";
import { DeleteTemplateDialog, SampleCodes, TemplatePanel } from "./idTemplate/TemplatePanel";

type Show = "all" | "active" | "inactive";

export default function IDTemplateMaster() {
  const rights = usePageRights("id-template-master");
  const qc = useQueryClient();
  // undefined = closed, null = new, a template = editing it
  const [editing, setEditing] = useState<IDTemplate | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<IDTemplate | null>(null);
  const [show, setShow] = useState<Show>("all");

  const { data: templates = [], isLoading, isFetching, refetch } = useQuery({ queryKey: ["id-templates"], queryFn: getIDTemplates });
  const { data: projectOpts = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const all = ensureArray<IDTemplate>(templates);
  const projects = ensureArray<{ id: number; label: string }>(projectOpts);
  const rows = useMemo(() => (show === "all" ? all : all.filter((t) => t.isActive === (show === "active"))), [all, show]);

  const taken = useMemo(() => new Set(all.map((t) => t.projectId)), [all]);
  const without = projects.filter((p) => !taken.has(p.id));
  const activeCount = all.filter((t) => t.isActive).length;
  const stats = [
    { label: "Templates", value: fmt(all.length), note: "one per project" },
    { label: "Active", value: fmt(activeCount), note: "projects that can generate codes" },
    { label: "Inactive", value: fmt(all.length - activeCount), note: "new codes are blocked" },
    {
      label: "Projects without one",
      value: fmt(without.length),
      note: without.length ? `${without.slice(0, 2).map((p) => p.label).join(", ")}${without.length > 2 ? ` +${without.length - 2}` : ""}` : "every project is set up",
    },
  ];

  const reactivate = useMutation({
    mutationFn: (t: IDTemplate) => updateIDTemplate(t.id, { projectId: t.projectId, projectAlias: t.projectAlias, isActive: true }),
    onSuccess: (r) => {
      const tagged = r?.autoTagged ?? 0;
      toast.success(`ID template reactivated${tagged ? ` — ${tagged} waiting asset${tagged === 1 ? "" : "s"} tagged with it` : ""}`);
      ["id-templates", "fixed-asset-taggings", "fixed-asset-pending-batches", "fixed-assets", "fixed-asset-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const COLUMNS: ColumnDef<IDTemplate>[] = [
    {
      id: "projectName",
      accessorFn: (t) => t.projectName ?? "",
      size: 240,
      header: "Project",
      cell: ({ row: { original: t } }) => <p className="text-sm font-medium text-foreground truncate max-w-[260px]">{t.projectName || "—"}</p>,
    },
    {
      id: "projectAlias",
      accessorKey: "projectAlias",
      size: 120,
      header: "Alias",
      cell: ({ row: { original: t } }) => <span className="font-heading font-bold tabular-nums border border-foreground px-2 py-0.5 text-xs">{t.projectAlias}</span>,
    },
    { id: "sample", size: 320, header: "FA Item Codes it makes", enableSorting: false, cell: ({ row: { original: t } }) => <SampleCodes alias={t.projectAlias} compact /> },
    {
      id: "status",
      accessorFn: (t) => (t.isActive ? "Active" : "Inactive"),
      size: 110,
      header: "Status",
      cell: ({ row: { original: t } }) => <Mark text={t.isActive ? "Active" : "Inactive"} tone={t.isActive ? "done" : "none"} />,
    },
    {
      id: "actions",
      size: 100,
      header: "",
      enableSorting: false,
      cell: ({ row: { original: t } }) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {rights.canEdit && !t.isActive && (
            <button onClick={() => reactivate.mutate(t)} disabled={reactivate.isPending} title="Reactivate" className="p-1.5 text-muted-foreground hover:text-foreground"><RotateCcw size={13} /></button>
          )}
          {rights.canEdit && <button onClick={() => setEditing(t)} title="Edit" className="p-1.5 text-muted-foreground hover:text-foreground"><PenSquare size={13} /></button>}
          {rights.canDelete && <button onClick={() => setDeleting(t)} title="Delete" className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>}
        </div>
      ),
    },
  ];

  const SHOW: { k: Show; label: string }[] = [
    { k: "all", label: "All" },
    { k: "active", label: "Active" },
    { k: "inactive", label: "Inactive" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "ID Template Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Fixed Asset"
        title="ID templates"
        subtitle="The alias each project's FA Item Codes start with. A project needs an active template before its assets can be given codes."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </button>
            {rights.canCreate && <button onClick={() => setEditing(null)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New template</button>}
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
              searchPlaceholder="Search project or alias…"
              paginated
              onRowClick={rights.canEdit ? (row) => setEditing(row.original) : undefined}
              getRowId={(t) => String(t.id)}
              rowClassName={(row) => (row.original.isActive ? "" : "opacity-60")}
              emptyMessage={show !== "all" ? "No templates match this filter." : "No ID templates yet. Add one per project so its assets can be given FA Item Codes."}
            />
          </div>
        </div>
      </SheetShell>

      {editing !== undefined && (
        <TemplatePanel key={editing?.id ?? "new"} editing={editing} projects={projects} takenProjectIds={taken} onClose={() => setEditing(undefined)} />
      )}
      {deleting && <DeleteTemplateDialog template={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
