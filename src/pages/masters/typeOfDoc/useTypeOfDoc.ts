import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
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
import { emptyForm, buildPreview, tierLabel, type FormState } from "./config";
import { buildDocColumns } from "./columns";

export function useTypeOfDoc() {
  const queryClient = useQueryClient();
  const rights = usePageRights("type-of-doc");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState<DocTypeRecord | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

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

  const closeDrawer = () => {
    setForm(emptyForm);
    setEditingId(null);
    setDrawerOpen(false);
  };

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
      setDeleteId(null);
      toast.success("Document type deactivated");
    },
    onError: () => toast.error("Failed to deactivate"),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

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
        openEdit,
        deleteId,
        setDeleteId,
        deleteMutation.mutate,
        setViewRecord,
        rights.canEdit,
        rights.canDelete,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteId, deleteMutation.mutate, rights.canEdit, rights.canDelete],
  );

  const isBusy = createMutation.isPending || updateMutation.isPending;
  const preview = buildPreview(form, selectedProjectCode);
  const tierName = tierLabel(form, selectedProjectCode);

  return {
    rights,
    form,
    setForm,
    editingId,
    drawerOpen,
    setDrawerOpen,
    viewRecord,
    setViewRecord,
    types,
    isLoading,
    entryTypes,
    companies,
    projects,
    selectedProjectCode,
    visibleProjects,
    closeDrawer,
    handleEntryTypeChange,
    handleSubmit,
    openEdit,
    toggleLink,
    columns,
    isBusy,
    preview,
    tierName,
  };
}

export type TypeOfDocState = ReturnType<typeof useTypeOfDoc>;
