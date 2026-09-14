// src/pages/masters/TypeOfDocMaster.tsx
import { useState, useMemo } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  FileText,
  Loader2,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Info,
  Eye,
  XCircle,
} from "lucide-react";
import {
  getDocumentTypes,
  getEntryTypes,
  getCompanies,
  getProjects,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  type DocTypeRecord,
  type EntryTypeOption,
  type CompanyOption,
  type ProjectOption,
  type DocTypePayload,
} from "@/api/documentTypeApi";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Canonical module codes.
 * Values must match MODULE_LINKS keys in backend/routes/document-type.js.
 */
const MODULE_CODE_OPTIONS = [
  { value: "WO", label: "WO — Work Order" },
  { value: "WO_PO", label: "WO_PO — Work Order for Materials" },
  { value: "PO", label: "PO — Purchase Order" },
  { value: "GRN", label: "GRN — Goods Received Note" },
  { value: "BOQ", label: "BOQ — Bill of Quantities" },
  { value: "ExB", label: "ExB — Expense Booking" },
  { value: "MIS", label: "MIS — Material Issue" },
  { value: "PAY", label: "PAY — Payment (Outgoing)" },
  { value: "RECP", label: "RECP — Received Payment" },
  { value: "DN", label: "DN — Debit Note" },
];

/**
 * Links-to toggle options.
 * Values must match the tag strings used in MODULE_LINKS in document-type.js.
 */
const LINK_OPTIONS = [
  { value: "Work Order", label: "Work Order" },
  { value: "Work Order PO", label: "Work Order for Materials" },
  { value: "Purchase Order", label: "Purchase Order" },
  { value: "GRN", label: "GRN" },
  { value: "BOQ", label: "BOQ" },
  { value: "Expense Booking", label: "Expense Booking" },
  { value: "Material Request", label: "Material Request" },
  { value: "Material Issue", label: "Material Issue" },
  { value: "Payment", label: "Payment (Outgoing)" },
  { value: "Received Payment", label: "Received Payment" },
  { value: "Debit Note", label: "Debit Note" },
  { value: "Task", label: "Task" },
];

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  Prefix: string;
  Description: string;
  CompanyId: string | number;
  ProjectId: string | number;
  EntryTypeId: string;
  StartingDocNo: string;
  links_to: string[];
  ModuleCode: string;
  DocNoPrefix: string;
  FinYearReset: boolean;
}

const emptyForm: FormState = {
  Prefix: "",
  Description: "",
  CompanyId: "",
  ProjectId: "",
  EntryTypeId: "",
  StartingDocNo: "1",
  links_to: [],
  ModuleCode: "",
  DocNoPrefix: "",
  FinYearReset: true,
};

// ── Preview builder ───────────────────────────────────────────────────────────

/**
 * Build the live doc-number preview string shown in the drawer.
 *
 * Tier 1 (project-scoped): "GC-WO/0001/26-27"
 *   → requires projectCode + moduleCode
 * Tier 2 (dash):           "WO-2026-00001"
 *   → requires docNoPrefix, no projectCode
 * Tier 3 (legacy slash):   "CI/WO/000001"
 *   → fallback when only Prefix is set
 */
function buildPreview(form: FormState, projectCode: string | null): string {
  const serial = String(parseInt(form.StartingDocNo) || 1).padStart(4, "0");

  // Tier 1: project-scoped new convention
  if (projectCode && form.ModuleCode) {
    const now = new Date();
    const yr = now.getFullYear();
    const month = now.getMonth() + 1;
    const startYear = month >= 4 ? yr : yr - 1;
    const finYear = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
    return `${projectCode}-${form.ModuleCode}/${serial}/${finYear}`;
  }

  // Tier 2: dash format — DocNoPrefix set, no project scope
  if (form.DocNoPrefix) {
    const paddedSerial = String(parseInt(form.StartingDocNo) || 1).padStart(
      5,
      "0",
    );
    return `${form.DocNoPrefix}-${new Date().getFullYear()}-${paddedSerial}`;
  }

  // Tier 3: legacy slash
  if (form.Prefix) {
    const paddedSerial = String(parseInt(form.StartingDocNo) || 1).padStart(
      6,
      "0",
    );
    return `${form.Prefix}/${paddedSerial}`;
  }

  return "";
}

/** Return a short label describing which numbering tier will apply. */
function tierLabel(form: FormState, projectCode: string | null): string {
  if (projectCode && form.ModuleCode) return "New · project-scoped";
  if (form.DocNoPrefix) return "New · global dash format";
  return "Legacy · slash format";
}

// ── Table columns ─────────────────────────────────────────────────────────────

function buildDocColumns(
  _editingId: number | null,
  openEdit: (item: DocTypeRecord) => void,
  handleDelete: (id: number) => void,
  onView: (item: DocTypeRecord) => void,
  canEdit: boolean,
  canDelete: boolean,
): ColumnDef<DocTypeRecord, unknown>[] {
  return [
    {
      accessorKey: "EntryType",
      header: "Entry Type",
      cell: ({ getValue }) => (
        <span className="text-sm font-medium text-foreground">
          {(getValue() as string) ?? "—"}
        </span>
      ),
    },
    {
      id: "effectivePrefix",
      header: "Doc Number Prefix",
      cell: ({ row }) => {
        const r = row.original;
        // Show the prefix that will actually appear in generated doc numbers
        let label = "";
        if (r.ProjectCode && r.ModuleCode) {
          label = `${r.ProjectCode}-${r.ModuleCode}`;
        } else if (r.DocNoPrefix) {
          label = r.DocNoPrefix;
        } else {
          label = r.FullPrefix ?? r.Prefix;
        }
        return (
          <span className="font-mono text-xs font-semibold text-primary">
            {label}
          </span>
        );
      },
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
      accessorKey: "ProjectName",
      header: "Project",
      cell: ({ row }) => {
        const r = row.original;
        if (!r.ProjectId)
          return <span className="text-xs text-muted-foreground/50">All</span>;
        return (
          <span className="text-xs text-muted-foreground">
            {r.ProjectCode ? (
              <>
                <span className="font-mono font-semibold">{r.ProjectCode}</span>{" "}
                · {r.ProjectName}
              </>
            ) : (
              r.ProjectName
            )}
          </span>
        );
      },
    },
    {
      accessorKey: "links_to",
      header: "Links To",
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        if (!v)
          return <span className="text-muted-foreground/40 text-xs">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {v.split(",").map((l) => (
              <span
                key={l}
                className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium"
              >
                {l.trim()}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      id: "tier",
      header: "Format",
      cell: ({ row }) => {
        const r = row.original;
        let label = "Legacy";
        let cls = "bg-muted text-muted-foreground";
        if (r.ProjectCode && r.ModuleCode) {
          label = "New · Project";
          cls = "bg-emerald-500/10 text-emerald-600";
        } else if (r.DocNoPrefix) {
          label = "New · Global";
          cls = "bg-blue-500/10 text-blue-600";
        }
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}
          >
            {label}
          </span>
        );
      },
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
            onClick={() => onView(row.original)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10"
            title="View details"
          >
            <Eye size={13} />
          </button>
          {canEdit && (
            <button
              onClick={() => openEdit(row.original)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
            >
              <Edit size={13} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => handleDelete(row.original.TypeOfDocId)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

const TypeOfDocMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("type-of-doc");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState<DocTypeRecord | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: types = [], isLoading } = useQuery<DocTypeRecord[]>({
    queryKey: ["documentTypes"],
    queryFn: getDocumentTypes,
  });

  const { data: entryTypes = [] } = useQuery<EntryTypeOption[]>({
    queryKey: ["docType-entryTypes"],
    queryFn: getEntryTypes,
  });

  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["docType-companies"],
    queryFn: getCompanies,
  });

  const { data: projects = [] } = useQuery<ProjectOption[]>({
    queryKey: ["docType-projects"],
    queryFn: getProjects,
  });

  // ── Derived: selected project's short_name for live preview ──────────────
  const selectedProject = projects.find(
    (p) => String(p.ProjectId) === String(form.ProjectId),
  );
  const selectedProjectCode = selectedProject?.ProjectCode ?? null;

  // Once a Company is picked, only its own Projects are selectable.
  const visibleProjects = form.CompanyId
    ? projects.filter((p) => String(p.CompanyId) === String(form.CompanyId))
    : projects;

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
    mutationFn: ({ id, data }: { id: number; data: DocTypePayload }) =>
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

  /** Auto-fill Prefix from EntryType's Eprefix when entry type changes */
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

    const payload: DocTypePayload = {
      Prefix: form.Prefix.toUpperCase().trim(),
      Description: form.Description.trim(),
      EntryTypeId: form.EntryTypeId,
      CompanyId: form.CompanyId !== "" ? Number(form.CompanyId) : null,
      ProjectId: form.ProjectId !== "" ? Number(form.ProjectId) : null,
      StartingDocNo: parseInt(form.StartingDocNo) || 1,
      links_to: form.links_to.length > 0 ? form.links_to.join(", ") : null,
      ModuleCode: form.ModuleCode || null,
      DocNoPrefix: form.DocNoPrefix || null,
      FinYearReset: form.FinYearReset,
    };

    if (editingId !== null)
      updateMutation.mutate({ id: editingId, data: payload });
    else createMutation.mutate(payload);
  };

  const openEdit = (item: DocTypeRecord) => {
    setForm({
      Prefix: item.Prefix ?? "",
      Description: item.Description ?? "",
      CompanyId: item.CompanyId ?? "",
      ProjectId: item.ProjectId ?? "",
      EntryTypeId: item.EntryTypeId ?? "",
      StartingDocNo: String(item.StartingDocNo ?? 1),
      links_to: item.links_to
        ? item.links_to
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      ModuleCode: item.ModuleCode ?? "",
      DocNoPrefix: item.DocNoPrefix ?? "",
      FinYearReset: item.FinYearReset ?? true,
    });
    setEditingId(item.TypeOfDocId);
    setDrawerOpen(true);
  };

  const toggleLink = (value: string) => {
    setForm((prev) => ({
      ...prev,
      links_to: prev.links_to.includes(value)
        ? prev.links_to.filter((v) => v !== value)
        : [...prev.links_to, value],
    }));
  };

  const columns = useMemo(
    () =>
      buildDocColumns(
        editingId,
        openEdit,
        deleteMutation.mutate,
        setViewRecord,
        rights.canEdit,
        rights.canDelete,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteMutation.mutate, rights.canEdit, rights.canDelete],
  );

  const isBusy = createMutation.isPending || updateMutation.isPending;
  const preview = buildPreview(form, selectedProjectCode);
  const tierName = tierLabel(form, selectedProjectCode);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Admin", "Type of Document"]} />

      <AdminShell
        title="Type of Document Master"
        subtitle="Define document number formats tied to entry types, modules, companies and projects"
        icon={FileText}
        action={
          rights.canCreate ? (
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-heading hover:bg-primary/90 transition"
            >
              <Plus size={16} /> Add New Type
            </button>
          ) : undefined
        }
      >

      {/* ── Table ── */}
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
            defaultPageSize={10}
            emptyMessage="No document types yet."
            rowClassName={(row) =>
              row.original.TypeOfDocId === editingId
                ? "bg-primary/5 border-l-2 border-l-primary"
                : ""
            }
          />
        )}
      </div>

      {/* ── Drawer ── */}
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
              {/* ── Scope section ── */}
              <div className="space-y-4">
                <p className="text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-widest">
                  Scope
                </p>

                {/* Company */}
                <div>
                  <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Company
                  </label>
                  <select
                    value={form.CompanyId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        CompanyId: e.target.value,
                        // Selected Project may not belong to the new Company.
                        ProjectId:
                          e.target.value &&
                          projects.some(
                            (p) =>
                              String(p.ProjectId) === String(form.ProjectId) &&
                              String(p.CompanyId) !== String(e.target.value),
                          )
                            ? ""
                            : form.ProjectId,
                      })
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
                    <option value="">
                      {form.CompanyId ? "All Projects in Company" : "All Projects"}
                    </option>
                    {visibleProjects.map((p) => (
                      <option key={p.ProjectId} value={p.ProjectId}>
                        {p.ProjectCode ? `${p.ProjectCode} – ` : ""}
                        {p.ProjectName}
                      </option>
                    ))}
                  </select>
                  {selectedProjectCode && (
                    <p className="mt-1 text-[11px] text-muted-foreground font-heading">
                      Project code:{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {selectedProjectCode}
                      </span>{" "}
                      — used as the project initials in the doc number
                    </p>
                  )}
                </div>
              </div>

              <hr className="border-border" />

              {/* ── Identity section ── */}
              <div className="space-y-4">
                <p className="text-[10px] font-heading font-semibold text-muted-foreground uppercase tracking-widest">
                  Identity
                </p>

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

                {/* Module Code */}
                <div>
                  <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Module Code
                  </label>
                  <select
                    value={form.ModuleCode}
                    onChange={(e) =>
                      setForm({ ...form, ModuleCode: e.target.value })
                    }
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Select module code…</option>
                    {MODULE_CODE_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground font-heading">
                    Appears as the entry-type segment in the doc number (e.g.{" "}
                    <span className="font-mono">WO</span> →{" "}
                    <span className="font-mono">GC-WO/0001/26-27</span>)
                  </p>
                </div>

                {/* Doc No Prefix (dash format) */}
                <div>
                  <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Doc No Prefix
                    <span className="ml-1 text-muted-foreground/50 normal-case tracking-normal font-normal">
                      (dash format)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={form.DocNoPrefix}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        DocNoPrefix: e.target.value.toUpperCase(),
                      })
                    }
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-mono bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="e.g. ExB-PO-GRN"
                    maxLength={50}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground font-heading">
                    For global (non-project) doc types. Produces{" "}
                    <span className="font-mono">ExB-PO-GRN-2026-00001</span>
                  </p>
                </div>

                {/* Legacy Prefix */}
                <div>
                  <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Legacy Prefix <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.Prefix}
                    onChange={(e) =>
                      setForm({ ...form, Prefix: e.target.value.toUpperCase() })
                    }
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-mono bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="e.g. WO"
                    maxLength={30}
                    required
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground font-heading">
                    Auto-filled from entry type's Eprefix — also used as
                    fallback in legacy slash format
                  </p>
                </div>

                {/* Starting Doc No */}
                <div>
                  <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Starting Number <span className="text-destructive">*</span>
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

                {/* Fin Year Reset toggle */}
                <div className="flex items-start gap-3">
                  <input
                    id="finYearReset"
                    type="checkbox"
                    checked={form.FinYearReset}
                    onChange={(e) =>
                      setForm({ ...form, FinYearReset: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                  />
                  <div>
                    <label
                      htmlFor="finYearReset"
                      className="text-xs font-heading font-medium text-foreground cursor-pointer"
                    >
                      Reset counter each financial year
                    </label>
                    <p className="text-[11px] text-muted-foreground font-heading mt-0.5">
                      On = sequence restarts from 1 each April (new convention).
                      Off = global ever-incrementing counter (legacy).
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Live preview box ── */}
              {preview && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wide">
                      Document number preview
                    </p>
                    <span className="text-[10px] font-heading px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      {tierName}
                    </span>
                  </div>
                  <p className="font-mono font-bold text-primary text-lg tracking-wider">
                    {preview}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-heading">
                    Actual number is assigned when the document is saved
                  </p>
                </div>
              )}

              <hr className="border-border" />

              {/* ── Description ── */}
              <div>
                <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Description <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={form.Description}
                  onChange={(e) =>
                    setForm({ ...form, Description: e.target.value })
                  }
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary h-20 resize-none"
                  placeholder="Brief description for this document type"
                  required
                />
              </div>

              {/* ── Links Allowed To ── */}
              <div>
                <label className="block text-xs font-heading font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Links Allowed To
                </label>
                <div className="flex flex-wrap gap-2">
                  {LINK_OPTIONS.map((opt) => {
                    const checked = form.links_to.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleLink(opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-heading font-medium border transition-colors ${
                          checked
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:border-primary hover:text-primary"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {form.links_to.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                    <Info size={10} />
                    Controls which module dropdowns this doc type appears in
                  </p>
                )}
              </div>

              {/* ── Actions ── */}
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
      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRecord(null)}
          />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText size={15} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Document Type Details
                </h3>
              </div>
              <button
                onClick={() => setViewRecord(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Entry Type
                </p>
                <p className="text-sm font-medium text-foreground">
                  {viewRecord.EntryType ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Description
                </p>
                <p className="text-sm text-foreground">
                  {viewRecord.Description || (
                    <span className="text-muted-foreground italic">
                      No description
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Doc Number Prefix
                </p>
                <p className="font-mono text-sm font-semibold text-primary">
                  {viewRecord.ProjectCode && viewRecord.ModuleCode
                    ? `${viewRecord.ProjectCode}-${viewRecord.ModuleCode}`
                    : viewRecord.DocNoPrefix ||
                      viewRecord.FullPrefix ||
                      viewRecord.Prefix ||
                      "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Format
                </p>
                {(() => {
                  let label = "Legacy · slash format";
                  let cls = "bg-muted text-muted-foreground";
                  if (viewRecord.ProjectCode && viewRecord.ModuleCode) {
                    label = "New · Project-scoped";
                    cls = "bg-emerald-500/10 text-emerald-600";
                  } else if (viewRecord.DocNoPrefix) {
                    label = "New · Global dash format";
                    cls = "bg-blue-500/10 text-blue-600";
                  }
                  return (
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
                    >
                      {label}
                    </span>
                  );
                })()}
              </div>
              {viewRecord.ProjectName && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                    Project
                  </p>
                  <p className="text-sm text-foreground">
                    {viewRecord.ProjectCode && (
                      <span className="font-mono font-semibold mr-1">
                        {viewRecord.ProjectCode}
                      </span>
                    )}
                    {viewRecord.ProjectName}
                  </p>
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Module Code
                </p>
                <p className="font-mono text-sm text-foreground">
                  {viewRecord.ModuleCode || (
                    <span className="text-muted-foreground italic">
                      Not set
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Starting Number
                </p>
                <p className="font-mono text-sm text-foreground">
                  {viewRecord.StartingDocNo ?? 1}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Fin Year Reset
                </p>
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${viewRecord.FinYearReset ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                >
                  {viewRecord.FinYearReset
                    ? "Yes — resets each April"
                    : "No — global counter"}
                </span>
              </div>
              {viewRecord.links_to && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                    Links To
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {viewRecord.links_to.split(",").map((l) => (
                      <span
                        key={l}
                        className="px-2 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium"
                      >
                        {l.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Status
                </p>
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${viewRecord.IsActive ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                >
                  {viewRecord.IsActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border">
              <button
                onClick={() => {
                  openEdit(viewRecord);
                  setViewRecord(null);
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-heading font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Edit size={13} /> Edit Document Type
              </button>
            </div>
          </div>
        </div>
      )}
      </AdminShell>
    </>
  );
};

export default TypeOfDocMaster;
