import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Warehouse, X, Check, AlertCircle, RefreshCw } from "lucide-react";
import { createGodown, updateGodown, type Godown, type CreateGodownPayload } from "@/api/godownsApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { BodyPortal } from "@/components/ui/body-portal";
import { Field, inputCls } from "./config";

// ─── Create / Edit Drawer ─────────────────────────────────────────────────────
export function GodownDrawer({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: Godown | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateGodownPayload>({
    GodownName: "",
    GodownCode: "",
    ShortDesc: "",
    Description: "",
    Remarks: "",
    Location: "",
    EnterpriseID: null,
    ProjectID: null,
  });
  const [err, setErr] = useState("");

  const { data: companiesData } = useQuery({
    queryKey: ["enterprise-options", "C"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
    staleTime: 300_000,
  });
  const companies = (companiesData ?? []) as { id: number; label: string }[];

  const { data: projectsData } = useQuery({
    queryKey: ["enterprise-options", "P"],
    queryFn: () => getEnterpriseOptions(undefined, "P"),
    staleTime: 300_000,
  });
  const allProjects = (projectsData ?? []) as {
    id: number;
    label: string;
    belongs_to: string | null;
  }[];
  // A project shows under every company it is tagged to, not only the one it belongs to.
  const filteredProjects = form.EnterpriseID
    ? allProjects.filter((p) => projectBelongsToCompany(p, form.EnterpriseID as number))
    : allProjects;

  React.useEffect(() => {
    if (editing) {
      setForm({
        GodownName: editing.GodownName || "",
        GodownCode: editing.GodownCode || "",
        ShortDesc: editing.ShortDesc || "",
        Description: editing.Description || "",
        Remarks: editing.Remarks || "",
        Location: editing.Location || "",
        EnterpriseID: editing.EnterpriseID ?? null,
        ProjectID: editing.ProjectID ?? null,
      });
    } else {
      setForm({
        GodownName: "",
        GodownCode: "",
        ShortDesc: "",
        Description: "",
        Remarks: "",
        Location: "",
        EnterpriseID: null,
        ProjectID: null,
      });
    }
    setErr("");
  }, [editing, open]);

  const createMut = useMutation({
    mutationFn: createGodown,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<CreateGodownPayload>;
    }) => updateGodown(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["godowns"] });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const isPending = createMut.isPending || updateMut.isPending;

  const handleSubmit = () => {
    setErr("");
    if (!form.GodownName?.trim()) {
      setErr("Godown name is required.");
      return;
    }
    if (editing) {
      updateMut.mutate({ id: editing.GodownID, payload: form });
    } else {
      createMut.mutate(form);
    }
  };

  if (!open) return null;

  return (
    <BodyPortal><div className="fixed inset-0 z-[60] flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-md bg-card flex flex-col h-full" style={{ borderLeft: "1px solid hsl(var(--foreground))" }} role="dialog" aria-modal="true">
        {/* Header */}
        <div className="px-6 py-5 border-b border-foreground/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-heading font-bold text-foreground">
                {editing ? "Edit Godown" : "New Godown"}
              </p>
              <p className="text-[0.6875rem] text-muted-foreground">
                {editing
                  ? `Editing ${editing.GodownName}`
                  : "Add a warehouse or storage location"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-primary/5 transition-colors"
          >
            <X size={15} className="text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {err && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-destructive/10 border border-destructive text-destructive text-xs">
              <AlertCircle size={13} /> {err}
            </div>
          )}

          <Field label="Godown Name" required>
            <input
              value={form.GodownName}
              onChange={(e) =>
                setForm((f) => ({ ...f, GodownName: e.target.value }))
              }
              placeholder="e.g. Site A Main Warehouse"
              className={inputCls}
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Godown Code">
              <input
                value={form.GodownCode || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, GodownCode: e.target.value }))
                }
                placeholder="e.g. SITE-A"
                className={`${inputCls} font-heading`}
              />
            </Field>
            <Field label="Short Label">
              <input
                value={form.ShortDesc || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ShortDesc: e.target.value }))
                }
                placeholder="Shown in badges"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Company">
              <select
                value={
                  form.EnterpriseID != null ? String(form.EnterpriseID) : ""
                }
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  setForm((f) => ({ ...f, EnterpriseID: v, ProjectID: null }));
                }}
                className={inputCls}
              >
                <option value="">— None —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project">
              <select
                value={form.ProjectID != null ? String(form.ProjectID) : ""}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  setForm((f) => ({ ...f, ProjectID: v }));
                }}
                className={inputCls}
              >
                <option value="">— None —</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Location">
            <input
              type="text"
              value={form.Location || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, Location: e.target.value }))
              }
              placeholder="Physical location of this godown"
              className={inputCls}
            />
          </Field>

          <Field label="Description">
            <textarea
              value={form.Description || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, Description: e.target.value }))
              }
              rows={3}
              placeholder="What is stored here? Location details, purpose…"
              className={`${inputCls} resize-none`}
            />
          </Field>

          <Field label="Remarks">
            <textarea
              value={form.Remarks || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, Remarks: e.target.value }))
              }
              rows={2}
              placeholder="Any additional notes"
              className={`${inputCls} resize-none`}
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-foreground/30 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <p className="hidden sm:block text-xs text-muted-foreground">
            {editing ? "Update godown details" : "Fill required fields to create"}
          </p>
          <div className="flex gap-2 sm:ml-auto">
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 border border-foreground/30 text-sm hover:bg-primary/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isPending || !form.GodownName?.trim()}
              className="flex-1 sm:flex-none whitespace-nowrap px-4 py-2 bg-foreground text-card text-sm font-semibold disabled:opacity-50 transition-colors flex items-center justify-center gap-2 border border-foreground"
            >
              {isPending ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              {editing ? "Save Changes" : "Create Godown"}
            </button>
          </div>
        </div>
      </div>
    </div></BodyPortal>
  );
}
