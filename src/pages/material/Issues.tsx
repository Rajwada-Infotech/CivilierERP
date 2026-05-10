import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import * as issuesApi from "@/api/issuesApi";
import {
  CalendarDays,
  FileText,
  Save,
  Search,
  Eye,
  Trash2,
  Plus,
  RefreshCw,
  X,
  PackageMinus,
  Edit3,
  Building2,
  FolderOpen,
  Box,
  Ruler,
  Hash,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";

// ─── Types ────────────────────────────────────────────────────────────────────
interface IssueForm {
  issueNo: string;
  companyId: string;
  projectId: string;
  date: string;
  itemId: string;
  uomCode: string;
  qty: string;
  remarks: string;
  reason: string;
}

const defaultForm: IssueForm = {
  issueNo: "",
  companyId: "",
  projectId: "",
  date: new Date().toISOString().slice(0, 10),
  itemId: "",
  uomCode: "",
  qty: "",
  remarks: "",
  reason: "",
};

// ─── Field wrapper ─────────────────────────────────────────────────────────
const Field = ({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) => (
  <div>
    <label className="block text-xs uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">
      {label}
      {required && <span className="text-destructive ml-1">*</span>}
    </label>
    {children}
  </div>
);

// ─── Detail row for view mode ──────────────────────────────────────────────
const DetailRow = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div>
    <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
    <p className="font-medium text-foreground">{value || "—"}</p>
  </div>
);

// ─── Main Component ────────────────────────────────────────────────────────
export default function Issues() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"list" | "form" | "view">("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingRecord, setViewingRecord] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 10;
  const [form, setForm] = useState<IssueForm>(defaultForm);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: companies, isLoading: loadingCompanies } = useQuery({
    queryKey: ["issues", "companies"],
    queryFn: issuesApi.getCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });

  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryKey: ["issues", "projects"],
    queryFn: issuesApi.getProjectOptions,
    staleTime: 5 * 60 * 1000,
  });

  const { data: items, isLoading: loadingItems } = useQuery({
    queryKey: ["issues", "items"],
    queryFn: issuesApi.getItemOptions,
    staleTime: 5 * 60 * 1000,
  });

  const { data: uoms, isLoading: loadingUoms } = useQuery({
    queryKey: ["issues", "uoms"],
    queryFn: issuesApi.getUomOptions,
    staleTime: 5 * 60 * 1000,
  });

  const { data: issuesData, isLoading: loadingIssues } = useQuery({
    queryKey: ["issues", "list", page, search],
    queryFn: () => issuesApi.getIssues({ page, limit, search }),
  });

  const { data: issueNumberPreview, isFetching: loadingIssuePreview } = useQuery({
    queryKey: ["issues", "next-number"],
    queryFn: () => issuesApi.previewNextIssueNumber(false),
    enabled: viewMode === "form" && !editingId,
    staleTime: 15_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: issuesApi.createIssue,
    onSuccess: (record: any) => {
      const issueNo = record?.IssueNo || record?.DocNo;
      toast.success(
        issueNo
          ? `Material issue ${issueNo} created successfully`
          : "Material issue created successfully",
      );
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      goToList();
    },
    onError: (err: any) => toast.error(err.message || "Failed to create issue"),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: any) => issuesApi.updateIssue(editingId!, payload),
    onSuccess: () => {
      toast.success("Material issue updated successfully");
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      goToList();
    },
    onError: (err: any) => toast.error(err.message || "Failed to update issue"),
  });

  const deleteMutation = useMutation({
    mutationFn: issuesApi.deleteIssue,
    onSuccess: () => {
      toast.success("Issue deleted");
      queryClient.invalidateQueries({ queryKey: ["issues"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete issue"),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const goToList = () => {
    setViewMode("list");
    setEditingId(null);
    setViewingRecord(null);
    setForm(defaultForm);
  };

  const handleEdit = (record: any) => {
    setForm({
      issueNo: record.IssueNo ?? record.DocNo ?? "",
      companyId: String(record.CompanyId ?? ""),
      projectId: String(record.ProjectId ?? ""),
      date: record.Date ? String(record.Date).slice(0, 10) : defaultForm.date,
      itemId: String(record.ItemId ?? ""),
      uomCode: String(record.UOMId ?? ""),
      qty: String(record.Quantity ?? ""),
      remarks: record.Remarks ?? "",
      reason: record.Reason ?? "",
    });
    setEditingId(record.IssueId);
    setViewMode("form");
  };

  const handleView = (record: any) => {
    setViewingRecord(record);
    setViewMode("view");
  };

  const setField = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSave = useMemo(
    () =>
      Boolean(
        form.companyId &&
          form.projectId &&
          form.date &&
          form.itemId &&
          form.uomCode &&
          form.qty &&
          Number(form.qty) > 0 &&
          form.reason.trim()
      ),
    [form]
  );

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const onSave = () => {
    if (!canSave) {
      toast.error("Please fill all required fields");
      return;
    }
    const payload = {
      CompanyId: Number(form.companyId),
      ProjectId: Number(form.projectId),
      Date: form.date,
      ItemId: form.itemId,
      UOMId: form.uomCode,
      Quantity: Number(form.qty),
      Remarks: form.remarks || null,
      Reason: form.reason,
    };
    editingId ? updateMutation.mutate(payload) : createMutation.mutate(payload);
  };

  // ── Column definitions ────────────────────────────────────────────────────
  const columns: ColumnDef<any, unknown>[] = [
    {
      accessorKey: "DocNo",
      header: "Doc No",
      cell: ({ row, getValue }) => (
        <span className="font-mono font-semibold text-primary text-sm">
          {String(getValue() || row.original.IssueNo || "—")}
        </span>
      ),
    },
    {
      accessorKey: "IssueNo",
      header: "Issue No",
      cell: ({ getValue }) => (
        <span className="font-semibold text-primary text-sm">
          {String(getValue() || "—")}
        </span>
      ),
    },
    {
      accessorKey: "CompanyName",
      header: "Company",
      cell: ({ getValue }) => (
        <span className="text-sm text-foreground">{String(getValue() || "—")}</span>
      ),
    },
    {
      accessorKey: "ProjectName",
      header: "Project",
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">{String(getValue() || "—")}</span>
      ),
    },
    {
      accessorKey: "ItemName",
      header: "Item",
      cell: ({ getValue }) => (
        <span className="text-sm font-medium">{String(getValue() || "—")}</span>
      ),
    },
    {
      accessorKey: "Quantity",
      header: "Qty",
      cell: ({ row }) => (
        <span className="font-semibold text-sm">
          {row.original.Quantity}{" "}
          <span className="text-xs text-muted-foreground font-normal">
            {row.original.UOMId}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "Date",
      header: "Date",
      cell: ({ getValue }) => {
        const val = getValue() as string;
        return (
          <span className="text-sm text-muted-foreground">
            {val ? new Date(val).toLocaleDateString("en-IN") : "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "Status",
      header: "Status",
      cell: ({ getValue }) => (
        <StatusBadge status={(getValue() as string) || "Draft"} />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleView(row.original)}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="View"
          >
            <Eye size={15} />
          </button>
          <button
            type="button"
            onClick={() => handleEdit(row.original)}
            className="p-1.5 rounded hover:bg-primary/10 text-primary transition-colors"
            title="Edit"
          >
            <Edit3 size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("Delete this issue permanently?")) {
                deleteMutation.mutate(row.original.IssueId);
              }
            }}
            className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  // ── List view ─────────────────────────────────────────────────────────────
  const IssueList = () => {
    const totalPages = issuesData?.totalPages || 1;
    const listData: any[] = issuesData?.data || [];
    const totalCount: number = issuesData?.total || 0;

    return (
      <Card className="border-border shadow-sm">
        <CardHeader className="pb-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">Issue Register</CardTitle>
            {!loadingIssues && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {totalCount} record{totalCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="relative w-full sm:w-64">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by issue no, company, item…"
              className="pl-9 h-9 text-sm"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loadingIssues ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <RefreshCw size={16} className="animate-spin" /> Loading issues…
            </div>
          ) : (
            <>
              <DataTable
                data={listData}
                columns={columns}
                searchable={false}
                paginated={false}
                emptyMessage="No material issues found. Click 'New Issue' to create one."
              />
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-6 py-3 text-sm">
                  <span className="text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(p - 1, 1))}
                      disabled={page <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                      disabled={page >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  // ── Form view ─────────────────────────────────────────────────────────────
  const IssueForm = () => (
    <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
      <CardHeader className="pb-4 border-b border-border bg-muted/30 flex items-center justify-between">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {editingId ? (
            <Edit3 size={16} className="text-primary" />
          ) : (
            <FileText size={16} className="text-primary" />
          )}
          {editingId ? "Edit Material Issue" : "New Material Issue"}
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={goToList} className="h-8 w-8">
          <X size={16} />
        </Button>
      </CardHeader>

      <CardContent className="p-6">
        <div className="mb-5">
          <Field label="Issue Number">
            <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2.5">
              <FileText size={14} className="text-muted-foreground shrink-0" />
              {editingId && form.issueNo ? (
                <span className="font-mono text-sm font-semibold text-primary tracking-wide">
                  {form.issueNo}
                </span>
              ) : issueNumberPreview?.nextDocNo ? (
                <span className="font-mono text-sm font-semibold text-primary tracking-wide">
                  {issueNumberPreview.nextDocNo}
                </span>
              ) : loadingIssuePreview ? (
                <span className="text-sm text-muted-foreground/70">
                  Loading preview...
                </span>
              ) : (
                <span className="text-sm text-muted-foreground/50 italic">
                  Auto-generated on save
                </span>
              )}
            </div>
          </Field>
        </div>

        {/* Row 1: Company | Project | Date */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
          <Field label="Company" required>
            <Select
              value={form.companyId}
              onValueChange={(val) => {
                setField("companyId", val);
                setField("projectId", ""); // reset project on company change
              }}
            >
              <SelectTrigger className="h-10">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 size={14} className="text-muted-foreground shrink-0" />
                  <SelectValue
                    placeholder={loadingCompanies ? "Loading…" : "Select company"}
                  />
                </div>
              </SelectTrigger>
              <SelectContent>
                {loadingCompanies ? (
                  <SelectItem value="__loading" disabled>
                    Loading companies…
                  </SelectItem>
                ) : (companies || []).length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    No companies found
                  </SelectItem>
                ) : (
                  (companies || []).map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Project" required>
            <Select
              value={form.projectId}
              onValueChange={(val) => setField("projectId", val)}
            >
              <SelectTrigger className="h-10">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen size={14} className="text-muted-foreground shrink-0" />
                  <SelectValue
                    placeholder={loadingProjects ? "Loading…" : "Select project"}
                  />
                </div>
              </SelectTrigger>
              <SelectContent>
                {loadingProjects ? (
                  <SelectItem value="__loading" disabled>
                    Loading projects…
                  </SelectItem>
                ) : (projects || []).length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    No projects found
                  </SelectItem>
                ) : (
                  (projects || []).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Issue Date" required>
            <div className="relative">
              <CalendarDays
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setField("date", e.target.value)}
                className="pl-9 h-10"
              />
            </div>
          </Field>
        </div>

        {/* Row 2: Item | UOM | Quantity */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
          <Field label="Item" required>
            <Select
              value={form.itemId}
              onValueChange={(val) => setField("itemId", val)}
            >
              <SelectTrigger className="h-10">
                <div className="flex items-center gap-2 min-w-0">
                  <Box size={14} className="text-muted-foreground shrink-0" />
                  <SelectValue
                    placeholder={loadingItems ? "Loading…" : "Select item"}
                  />
                </div>
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {loadingItems ? (
                  <SelectItem value="__loading" disabled>
                    Loading items…
                  </SelectItem>
                ) : (items || []).length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    No items found
                  </SelectItem>
                ) : (
                  (items || []).map((item: any) => (
                    <SelectItem key={item.M_Id} value={String(item.M_Id)}>
                      {item.M_Name}
                      {item.M_Group && (
                        <span className="text-muted-foreground text-xs ml-1">
                          · {item.M_Group}
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Unit of Measure" required>
            <Select
              value={form.uomCode}
              onValueChange={(val) => setField("uomCode", val)}
            >
              <SelectTrigger className="h-10">
                <div className="flex items-center gap-2 min-w-0">
                  <Ruler size={14} className="text-muted-foreground shrink-0" />
                  <SelectValue
                    placeholder={loadingUoms ? "Loading…" : "Select UOM"}
                  />
                </div>
              </SelectTrigger>
              <SelectContent>
                {loadingUoms ? (
                  <SelectItem value="__loading" disabled>
                    Loading UOMs…
                  </SelectItem>
                ) : (uoms || []).length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    No UOMs found
                  </SelectItem>
                ) : (
                  (uoms || []).map((uom: any) => (
                    <SelectItem key={uom.UOMCode} value={uom.UOMCode}>
                      {uom.UOMName}
                      {uom.Symbol && (
                        <span className="text-muted-foreground text-xs ml-1">
                          ({uom.Symbol})
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Quantity" required>
            <div className="relative">
              <Hash
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.qty}
                onChange={(e) => setField("qty", e.target.value)}
                className="pl-9 h-10"
                placeholder="0.00"
              />
            </div>
          </Field>
        </div>

        {/* Row 3: Reason | Remarks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <Field label="Reason for Issue" required>
            <Textarea
              value={form.reason}
              onChange={(e) => setField("reason", e.target.value)}
              rows={3}
              className="resize-none text-sm"
              placeholder="State the reason for this material issue…"
            />
          </Field>

          <Field label="Remarks">
            <Textarea
              value={form.remarks}
              onChange={(e) => setField("remarks", e.target.value)}
              rows={3}
              className="resize-none text-sm"
              placeholder="Optional additional notes…"
            />
          </Field>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-5 border-t border-border">
          <Button
            variant="outline"
            onClick={goToList}
            disabled={isSaving}
            className="px-6"
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="px-6 gap-2"
          >
            {isSaving ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            {isSaving
              ? "Saving…"
              : editingId
              ? "Update Issue"
              : "Save Issue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // ── Detail / View mode ────────────────────────────────────────────────────
  const IssueView = () => {
    if (!viewingRecord) return null;

    return (
      <Card className="rounded-xl border border-border shadow-sm overflow-hidden">
        <CardHeader className="pb-4 border-b border-border bg-muted/30 flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            Issue — {viewingRecord.IssueNo || `#${viewingRecord.IssueId}`}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEdit(viewingRecord)}
              className="gap-1.5 h-8"
            >
              <Edit3 size={13} /> Edit
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToList}
              className="h-8 w-8"
            >
              <X size={16} />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
            <DetailRow
              label="Doc No"
              value={viewingRecord.DocNo || viewingRecord.IssueNo || "—"}
            />
            <DetailRow label="Company" value={viewingRecord.CompanyName} />
            <DetailRow label="Project" value={viewingRecord.ProjectName} />
            <DetailRow
              label="Date"
              value={
                viewingRecord.Date
                  ? new Date(viewingRecord.Date).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : undefined
              }
            />
            <DetailRow
              label="Status"
              value={<StatusBadge status={viewingRecord.Status || "Draft"} />}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-6">
            <DetailRow
              label="Item"
              value={viewingRecord.ItemName || viewingRecord.ItemId}
            />
            <DetailRow
              label="Quantity"
              value={
                <>
                  <span className="font-bold">{viewingRecord.Quantity}</span>{" "}
                  <span className="text-sm text-muted-foreground">
                    {viewingRecord.UOMId}
                  </span>
                </>
              }
            />
            <DetailRow
              label="Issue No"
              value={viewingRecord.IssueNo || "—"}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">
                Reason for Issue
              </p>
              <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm min-h-[64px]">
                {viewingRecord.Reason || "—"}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1.5">
                Remarks
              </p>
              <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm min-h-[64px]">
                {viewingRecord.Remarks || "—"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── Page render ────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Materials", "Issues"]} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <PackageMinus size={22} className="text-primary" />
            Material Issues
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Record and track material issued to projects.
          </p>
        </div>

        {viewMode === "list" && (
          <Button onClick={() => setViewMode("form")} className="gap-2 shrink-0">
            <Plus size={16} /> New Issue
          </Button>
        )}
      </div>

      {viewMode === "list" && <IssueList />}
      {viewMode === "form" && <IssueForm />}
      {viewMode === "view" && <IssueView />}
    </>
  );
}
