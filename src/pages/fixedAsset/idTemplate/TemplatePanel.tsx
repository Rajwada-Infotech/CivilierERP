// New / edit ID template at the side of the list, the delete confirmation, and the sample codes an alias makes.
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { createIDTemplate, deleteIDTemplate, updateIDTemplate, type IDTemplate } from "@/api/idTemplateMasterApi";
import { Field, INP, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE } from "../record/config";

/** The list here, and what saving an alias can tag: stock that was waiting for this project's alias. */
const REFRESH = ["id-templates", "fixed-asset-taggings", "fixed-asset-pending-batches", "fixed-assets", "fa-unassigned-codes", "fixed-asset-dashboard"];

/** This financial year as it ends an FA Item Code (April to March), e.g. 26-27. */
export function fyShort(d = new Date()) {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** The two shapes of FA Item Code an alias produces: in stock, and once someone in a department has it. */
export function SampleCodes({ alias, compact }: { alias: string; compact?: boolean }) {
  const a = alias || "ALIAS";
  const fy = fyShort();
  const row = (label: string, code: React.ReactNode) => (
    <div className={`flex items-baseline gap-2 ${compact ? "" : "py-1"}`}>
      <span className={`${LBL} w-16 shrink-0`}>{label}</span>
      <span className="font-heading tabular-nums text-xs text-foreground break-all">{code}</span>
    </div>
  );
  return (
    <div>
      {row("In stock", `${a}/Laptop/0001/${fy}`)}
      {row("Assigned", <>{a}/<span className="underline decoration-dotted underline-offset-2">Legal</span>/Laptop/0001/{fy}</>)}
    </div>
  );
}

export function TemplatePanel({
  editing, projects, takenProjectIds, onClose,
}: {
  editing: IDTemplate | null;
  projects: { id: number; label: string }[];
  takenProjectIds: Set<number>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState(editing ? String(editing.projectId) : "");
  const [alias, setAlias] = useState(editing?.projectAlias ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { projectId: Number(projectId), projectAlias: alias.trim(), isActive };
      return editing ? updateIDTemplate(editing.id, payload) : createIDTemplate(payload);
    },
    onSuccess: (r) => {
      const tagged = r?.autoTagged ?? 0;
      toast.success(
        `${editing ? "ID template updated" : "ID template created"}${tagged ? ` — ${tagged} waiting asset${tagged === 1 ? "" : "s"} tagged with it` : ""}`,
      );
      REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!projectId) return toast.error("Project is required");
    if (!alias.trim()) return toast.error("Project Alias is required");
    if (alias.includes("/")) return toast.error("Project Alias can't contain \"/\" — it separates the parts of an FA Item Code");
    save.mutate();
  };

  // A project has one template: the others already configured are left out of the list.
  const options = projects.filter((p) => !takenProjectIds.has(p.id) || String(p.id) === projectId);

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="ID template" className="w-full max-w-sm bg-card flex flex-col" style={{ borderLeft: RULE }}>
        <div className="flex items-center justify-between gap-2 px-5 py-3" style={{ borderBottom: RULE }}>
          <div className="min-w-0">
            <p className={LBL}>ID template</p>
            <p className="font-heading text-base font-bold text-foreground truncate">{editing ? `Edit ${editing.projectName || "template"}` : "New ID template"}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <Field label="Project" required note={!editing && options.length === 0 ? "Every project you can see already has a template." : undefined}>
            <SearchableNativeSelect className={INP} value={projectId} onChange={(e) => setProjectId(e.target.value)} searchPlaceholder="Search project…">
              <option value="">Select project…</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </SearchableNativeSelect>
          </Field>
          <Field label="Project alias" required note="The first part of every FA Item Code of this project. Already generated codes keep the alias they were made with.">
            <input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={50} placeholder="e.g. RG" className={`${INP} font-heading tabular-nums`} />
          </Field>
          <div className="px-4 py-3" style={{ border: "1px solid hsl(var(--foreground) / 0.2)" }}>
            <p className={`${LBL} mb-1.5`}>Codes it makes</p>
            <SampleCodes alias={alias.trim()} />
            <p className="text-[0.6875rem] text-muted-foreground mt-1.5">Once assigned, the holder's department follows the alias, and moves with the asset when it is transferred.</p>
          </div>
          <Field label="Status" note="An inactive template stops new codes being generated for this project.">
            <span className="inline-flex h-10 border border-foreground w-full" role="group" aria-label="Status">
              {([true, false] as const).map((v) => (
                <button key={String(v)} type="button" onClick={() => setIsActive(v)} aria-pressed={isActive === v}
                  className={`flex-1 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${isActive === v ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                  {v ? "Active" : "Inactive"}
                </button>
              ))}
            </span>
          </Field>
        </div>

        <div className="px-5 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Cancel</button>
          <button onClick={handleSave} disabled={save.isPending} className={`${KEY_INK} h-10 px-3 flex-1`}>
            {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {save.isPending ? "Saving…" : editing ? "Update" : "Create"}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function DeleteTemplateDialog({ template, onClose }: { template: IDTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteIDTemplate(template.id),
    onSuccess: () => {
      toast.success("ID template deleted");
      qc.invalidateQueries({ queryKey: ["id-templates"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div role="alertdialog" aria-modal="true" className="relative bg-card max-w-sm w-full" style={{ border: "1.5px solid hsl(var(--foreground))", boxShadow: "6px 6px 0 hsl(var(--foreground) / 0.14)" }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>ID template</p>
          <p className="font-heading text-base font-bold text-foreground">Delete the alias {template.projectAlias}?</p>
        </div>
        <p className="px-5 py-4 text-sm text-muted-foreground">
          {template.projectName || "This project"} loses its template, so no new FA Item Codes can be generated for it until one is added again.
          Codes already generated stay exactly as they are. To pause it instead, set it Inactive.
        </p>
        <div className="px-5 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Keep</button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className={`${KEY_RED} h-10 px-3 flex-1`}>
            {del.isPending ? "Deleting…" : "Delete template"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
