// src/pages/masters/TypeOfDocMaster.tsx
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FileText, Loader2, Plus, Edit, Trash2, Save, X } from "lucide-react";
import {
  getDocumentTypes,
  getEntryTypes,
  getCompanies,
  getProjects,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
} from "@/api/documentTypeApi";

// ── Types ────────────────────────────────────────────────────────────────────

interface EntryType {
  EntryTypeId: string;
  EntryType: string;
  Eprefix: string | null;
  EDOC_N: number | null;
}

interface Company {
  CompanyId: number;
  CompanyName: string;
}

interface Project {
  ProjectId: number;
  ProjectName: string;
  ProjectCode: string | null;
}

interface DocType {
  TypeOfDocId: number;
  Prefix: string;
  Description: string;
  CompanyId: number | null;
  ProjectId: number | null;
  EntryTypeId: string;
  IsActive: boolean;
  StartingDocNo: number;
  EntryType: string;
  Eprefix: string | null;
  FullPrefix: string;
  CompanyName: string;
  ProjectName: string;
}

const emptyForm = {
  Prefix: "",
  Description: "",
  CompanyId: "" as string | number,
  ProjectId: "" as string | number,
  EntryTypeId: "",
  StartingDocNo: "1",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pad number to 4 digits: 1 → "0001" */
function padDocNo(n: string | number): string {
  return String(parseInt(String(n)) || 1).padStart(6, "0");
}

/** Build live prefix preview: e.g. PR/REC/0001 */
function buildPreview(prefix: string, startingDocNo: string): string {
  if (!prefix) return "";
  return `${prefix}/${padDocNo(startingDocNo)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

const TypeOfDocMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: types = [], isLoading } = useQuery<DocType[]>({
    queryKey: ["documentTypes"],
    queryFn: getDocumentTypes,
  });

  const { data: entryTypes = [] } = useQuery<EntryType[]>({
    queryKey: ["docType-entryTypes"],
    queryFn: getEntryTypes,
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["docType-companies"],
    queryFn: getCompanies,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["docType-projects"],
    queryFn: getProjects,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["documentTypes"] });

  const createMutation = useMutation({
    mutationFn: createDocumentType,
    onSuccess: () => {
      invalidate();
      toast.success("Document type created");
      closeDrawer();
    },
    onError: (err: any) => toast.error(err.message || "Failed to create"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      updateDocumentType(id, data),
    onSuccess: () => {
      invalidate();
      toast.success("Document type updated");
      closeDrawer();
    },
    onError: (err: any) => toast.error(err.message || "Failed to update"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDocumentType,
    onSuccess: () => {
      invalidate();
      toast.success("Document type deactivated");
    },
    onError: () => toast.error("Failed to deactivate"),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const closeDrawer = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDrawerOpen(false);
  };

  /** When entry type changes, auto-fill Prefix from Eprefix */
  const handleEntryTypeChange = (entryTypeId: string) => {
    const selected = entryTypes.find((et) => et.EntryTypeId === entryTypeId);
    const autoPrefix = selected?.Eprefix?.toUpperCase().trim() ?? "";
    setForm((prev) => ({
      ...prev,
      EntryTypeId: entryTypeId,
      Prefix: prev.Prefix === "" ? autoPrefix : prev.Prefix,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.Prefix || !form.Description || !form.EntryTypeId) {
      toast.error("Entry Type, Prefix and Description are required");
      return;
    }
    const payload = {
      Prefix: form.Prefix.toUpperCase().trim(),
      Description: form.Description.trim(),
      EntryTypeId: form.EntryTypeId,
      CompanyId: form.CompanyId !== "" ? Number(form.CompanyId) : null,
      ProjectId: form.ProjectId !== "" ? Number(form.ProjectId) : null,
      StartingDocNo: parseInt(form.StartingDocNo) || 1,
    };
    if (editingId !== null)
      updateMutation.mutate({ id: editingId, data: payload });
    else createMutation.mutate(payload);
  };

  const openEdit = (item: DocType) => {
    setForm({
      Prefix: item.Prefix ?? "",
      Description: item.Description ?? "",
      CompanyId: item.CompanyId ?? "",
      ProjectId: item.ProjectId ?? "",
      EntryTypeId: item.EntryTypeId ?? "",
      StartingDocNo: String(item.StartingDocNo ?? 1),
    });
    setEditingId(item.TypeOfDocId);
    setDrawerOpen(true);
  };

  const isBusy = createMutation.isPending || updateMutation.isPending;
  const preview = buildPreview(form.Prefix, form.StartingDocNo);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Admin", "Type of Document"]} />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-heading font-bold text-foreground">
              Type of Document Master
            </h1>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-heading hover:bg-primary/90 transition"
          >
            <Plus size={16} /> Add New Type
          </button>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-9">
          Define document prefixes tied to entry types, companies and projects
        </p>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-heading">Loading…</span>
          </div>
        ) : types.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground font-heading">
            No document types found. Add one to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted border-b">
              <tr>
                <th className="px-5 py-3 text-left font-heading text-xs text-muted-foreground uppercase tracking-wide">
                  Document Number Preview
                </th>
                <th className="px-5 py-3 text-left font-heading text-xs text-muted-foreground uppercase tracking-wide">
                  Description
                </th>
                <th className="px-5 py-3 text-left font-heading text-xs text-muted-foreground uppercase tracking-wide">
                  Entry Type
                </th>
                <th className="px-5 py-3 text-left font-heading text-xs text-muted-foreground uppercase tracking-wide">
                  Company
                </th>
                <th className="px-5 py-3 text-left font-heading text-xs text-muted-foreground uppercase tracking-wide">
                  Project
                </th>
                <th className="px-5 py-3 text-center font-heading text-xs text-muted-foreground uppercase tracking-wide">
                  Status
                </th>
                <th className="px-5 py-3 text-right font-heading text-xs text-muted-foreground uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {types.map((t) => (
                <tr
                  key={t.TypeOfDocId}
                  className="hover:bg-muted/40 transition-colors"
                >
                  <td className="px-5 py-3">
                    <span className="inline-block font-mono font-bold text-primary text-sm tracking-wider">
                      {t.FullPrefix}
                    </span>
                    <p className="text-[11px] text-muted-foreground font-heading mt-0.5">
                      prefix: {t.Prefix}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-foreground">{t.Description}</td>
                  <td className="px-5 py-3 text-foreground">{t.EntryType}</td>
                  <td className="px-5 py-3 text-muted-foreground text-xs">
                    {t.CompanyName}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground text-xs">
                    {t.ProjectName}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-heading border ${
                        t.IsActive
                          ? "bg-primary/10 text-primary border-primary/20"
                          : "bg-destructive/10 text-destructive border-destructive/20"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${t.IsActive ? "bg-primary" : "bg-destructive"}`}
                      />
                      {t.IsActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => openEdit(t)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition"
                        title="Edit"
                      >
                        <Edit size={15} />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(t.TypeOfDocId)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition"
                        title="Deactivate"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex justify-end">
          <div className="w-full max-w-md h-full bg-card flex flex-col shadow-2xl">
            {/* Drawer header */}
            <div className="px-6 py-4 border-b flex items-center justify-between bg-card sticky top-0 z-10">
              <h2 className="text-base font-heading font-semibold">
                {editingId ? "Edit Document Type" : "New Document Type"}
              </h2>
              <button
                onClick={closeDrawer}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Drawer body */}
            <form
              onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto p-6 space-y-5"
            >
              {/* Company */}
              <div>
                <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Company
                </label>
                <select
                  value={form.CompanyId}
                  onChange={(e) =>
                    setForm({ ...form, CompanyId: e.target.value })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">All Companies</option>
                  {companies.map((c) => (
                    <option key={c.CompanyId} value={c.CompanyId}>
                      {c.CompanyName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Project */}
              <div>
                <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Project
                </label>
                <select
                  value={form.ProjectId}
                  onChange={(e) =>
                    setForm({ ...form, ProjectId: e.target.value })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">All Projects</option>
                  {projects.map((p) => (
                    <option key={p.ProjectId} value={p.ProjectId}>
                      {p.ProjectCode ? `${p.ProjectCode} – ` : ""}
                      {p.ProjectName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Entry Type */}
              <div>
                <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Entry Type <span className="text-destructive">*</span>
                </label>
                <select
                  value={form.EntryTypeId}
                  onChange={(e) => handleEntryTypeChange(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  required
                >
                  <option value="">Select entry type…</option>
                  {entryTypes.map((et) => (
                    <option key={et.EntryTypeId} value={et.EntryTypeId}>
                      {et.EntryType}
                      {et.Eprefix ? ` — ${et.Eprefix}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Prefix */}
              <div>
                <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Document Prefix <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.Prefix}
                  onChange={(e) =>
                    setForm({ ...form, Prefix: e.target.value.toUpperCase() })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-mono bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="e.g. PR/REC"
                  maxLength={30}
                  required
                />
                <p className="mt-1 text-[11px] text-muted-foreground font-heading">
                  Auto-filled from entry type's Eprefix — edit if needed
                </p>
              </div>

              {/* Starting Doc No */}
              <div>
                <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Starting Document Number{" "}
                  <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.StartingDocNo}
                  onChange={(e) =>
                    setForm({ ...form, StartingDocNo: e.target.value })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-mono bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="1"
                  required
                />
              </div>

              {/* Live preview */}
              {preview && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                  <p className="text-[11px] text-muted-foreground font-heading mb-1 uppercase tracking-wide">
                    Document number preview
                  </p>
                  <p className="font-mono font-bold text-primary text-lg tracking-wider">
                    {preview}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-heading mt-1">
                    Format: prefix / starting number (6 digits)
                  </p>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Description <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={form.Description}
                  onChange={(e) =>
                    setForm({ ...form, Description: e.target.value })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary h-24 resize-none"
                  placeholder="Brief description for this document type"
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="flex-1 border border-border py-2.5 rounded-lg text-sm font-heading hover:bg-muted transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex-1 bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-heading hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2 transition"
                >
                  {isBusy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  {isBusy ? "Saving…" : editingId ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default TypeOfDocMaster;
