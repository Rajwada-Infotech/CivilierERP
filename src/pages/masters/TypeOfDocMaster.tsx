// src/pages/masters/TypeOfDocMaster.tsx
import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
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

// ── Column builder ────────────────────────────────────────────────────────────

function buildDocColumns(
  editingId: number | null,
  openEdit: (item: DocType) => void,
  handleDelete: (id: number) => void,
): ColumnDef<DocType, unknown>[] {
  return [
    {
      accessorKey: "EntryType",
      header: "Entry Type",
      cell: ({ getValue }) => (
        <span className="text-sm font-medium text-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "FullPrefix",
      header: "Full Prefix",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-semibold text-primary">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "Prefix",
      header: "Prefix",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{getValue() as string}</span>
      ),
    },
    {
      accessorKey: "Description",
      header: "Description",
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "CompanyName",
      header: "Company",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {(getValue() as string) || "All"}
        </span>
      ),
    },
    {
      accessorKey: "ProjectName",
      header: "Project",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {(getValue() as string) || "All"}
        </span>
      ),
    },
    {
      accessorKey: "IsActive",
      header: "Status",
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
          >
            {active ? "Active" : "Inactive"}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => openEdit(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <Edit size={13} />
          </button>
          <button
            onClick={() => handleDelete(row.original.TypeOfDocId)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];
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

  const columns = useMemo(
    () => buildDocColumns(editingId, openEdit, deleteMutation.mutate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteMutation.mutate],
  );

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
          <DataTable
            data={types}
            columns={columns}
            searchPlaceholder="Search document types…"
            paginated={true}
            defaultPageSize={20}
            emptyMessage="No document types yet."
            rowClassName={(row) =>
              row.original.TypeOfDocId === editingId
                ? "bg-primary/5 border-l-2 border-l-primary"
                : ""
            }
          />
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
