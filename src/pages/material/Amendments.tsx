import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  approveAmendment,
  Amendment,
  AmendmentPayload,
  createAmendment,
  deleteAmendment,
  getAmendments,
  rejectAmendment,
  submitAmendment,
  updateAmendment,
} from "@/api/amendmentsApi";
import {
  FilePenLine,
  FileSearch,
  Loader2,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";

const STATUS_OPTIONS = ["all", "Draft", "Pending", "Approved", "Rejected"] as const;
const REF_DOC_TYPES = [
  "PurchaseOrder",
  "WorkOrder",
  "ExpenseBooking",
  "Contract",
  "Other",
] as const;
const APPROVER_ROLES = ["admin", "director", "manager"];

type FormState = {
  RefDocType: string;
  RefDocId: string;
  RefDocNo: string;
  ProjectName: string;
  CompanyName: string;
  Description: string;
  Reason: string;
  AmendmentDate: string;
  OriginalValue: string;
  RevisedValue: string;
};

const EMPTY_FORM: FormState = {
  RefDocType: "",
  RefDocId: "",
  RefDocNo: "",
  ProjectName: "",
  CompanyName: "",
  Description: "",
  Reason: "",
  AmendmentDate: "",
  OriginalValue: "",
  RevisedValue: "",
};

const STATUS_STYLES: Record<string, string> = {
  Draft: "border-slate-300 bg-slate-100 text-slate-700",
  Pending: "border-amber-300 bg-amber-100 text-amber-800",
  Approved: "border-emerald-300 bg-emerald-100 text-emerald-800",
  Rejected: "border-rose-300 bg-rose-100 text-rose-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={STATUS_STYLES[status] || "border-slate-300 bg-slate-100 text-slate-700"}
    >
      {status}
    </Badge>
  );
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN");
}

function getCurrentRole() {
  try {
    const rawUser = localStorage.getItem("user");
    if (!rawUser) return null;
    const parsed = JSON.parse(rawUser);
    return typeof parsed?.role === "string" ? parsed.role.toLowerCase() : null;
  } catch {
    return null;
  }
}

function toPayload(form: FormState): AmendmentPayload {
  const refDocId = form.RefDocId.trim();
  const originalValue = form.OriginalValue.trim();
  const revisedValue = form.RevisedValue.trim();

  return {
    RefDocType: form.RefDocType || undefined,
    RefDocId: refDocId ? Number(refDocId) : undefined,
    RefDocNo: form.RefDocNo.trim() || undefined,
    ProjectName: form.ProjectName.trim() || undefined,
    CompanyName: form.CompanyName.trim() || undefined,
    Description: form.Description.trim() || undefined,
    Reason: form.Reason.trim() || undefined,
    AmendmentDate: form.AmendmentDate || undefined,
    OriginalValue: originalValue ? Number(originalValue) : undefined,
    RevisedValue: revisedValue ? Number(revisedValue) : undefined,
  };
}

function toFormState(amendment: Amendment): FormState {
  return {
    RefDocType: amendment.RefDocType || "",
    RefDocId:
      amendment.RefDocId === null || amendment.RefDocId === undefined
        ? ""
        : String(amendment.RefDocId),
    RefDocNo: amendment.RefDocNo || "",
    ProjectName: amendment.ProjectName || "",
    CompanyName: amendment.CompanyName || "",
    Description: amendment.Description || "",
    Reason: amendment.Reason || "",
    AmendmentDate: amendment.AmendmentDate || "",
    OriginalValue:
      amendment.OriginalValue === null || amendment.OriginalValue === undefined
        ? ""
        : String(amendment.OriginalValue),
    RevisedValue:
      amendment.RevisedValue === null || amendment.RevisedValue === undefined
        ? ""
        : String(amendment.RevisedValue),
  };
}

export default function Amendments() {
  const queryClient = useQueryClient();
  const rights = usePageRights("amendments");
  const currentRole = useMemo(() => getCurrentRole(), []);
  const canApprove = APPROVER_ROLES.includes(currentRole || "");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Amendment | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Amendment | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Amendment | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const query = useQuery({
    queryKey: ["amendments", page, search, statusFilter],
    queryFn: () =>
      getAmendments({
        page,
        pageSize: 20,
        search: search.trim() || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
  });

  const invalidateList = () =>
    queryClient.invalidateQueries({
      queryKey: ["amendments"],
    });

  const createMutation = useMutation({
    mutationFn: createAmendment,
    onSuccess: () => {
      toast.success("Amendment created");
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setPage(1);
      invalidateList();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AmendmentPayload }) =>
      updateAmendment(id, payload),
    onSuccess: () => {
      toast.success("Amendment updated");
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      invalidateList();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submitMutation = useMutation({
    mutationFn: submitAmendment,
    onSuccess: () => {
      toast.success("Amendment submitted");
      invalidateList();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveMutation = useMutation({
    mutationFn: approveAmendment,
    onSuccess: () => {
      toast.success("Amendment approved");
      invalidateList();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      rejectAmendment(id, note),
    onSuccess: () => {
      toast.success("Amendment rejected");
      setRejectTarget(null);
      setRejectNote("");
      invalidateList();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAmendment,
    onSuccess: () => {
      toast.success("Amendment deleted");
      setDeleteTarget(null);
      invalidateList();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const difference = useMemo(() => {
    const original = Number(form.OriginalValue);
    const revised = Number(form.RevisedValue);

    if (!form.OriginalValue.trim() || !form.RevisedValue.trim()) return null;
    if (Number.isNaN(original) || Number.isNaN(revised)) return null;

    return revised - original;
  }, [form.OriginalValue, form.RevisedValue]);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const rows = query.data?.data || [];
  const pagination = query.data?.pagination;

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (amendment: Amendment) => {
    setEditing(amendment);
    setForm(toFormState(amendment));
    setFormOpen(true);
  };

  const handleFormChange = (field: keyof FormState, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSave = () => {
    if (!form.ProjectName.trim()) {
      toast.error("Project name is required");
      return;
    }

    if (!form.Description.trim()) {
      toast.error("Description of change is required");
      return;
    }

    const payload = toPayload(form);

    if (editing) {
      updateMutation.mutate({ id: editing.Id, payload });
      return;
    }

    createMutation.mutate(payload);
  };

  return (
    <>
      <Breadcrumbs items={["Material", "Amendments"]} />
      <MaterialShell
        title="Amendments"
        subtitle="Track change requests for purchase orders, work orders, contracts, and more"
        icon={FilePenLine}
        action={
          rights.canCreate ? (
            <Button
              onClick={openCreate}
              className="gradient-accent text-white text-xs px-3 py-1.5 h-auto"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Amendment
            </Button>
          ) : undefined
        }
      >

      <Card className="mb-6">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Amendment Register</CardTitle>
            <CardDescription>
              Search, review, and progress amendment records through approval.
            </CardDescription>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <FileSearch className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="Search number, project, company..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>

            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as (typeof STATUS_OPTIONS)[number]);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status === "all" ? "All Statuses" : status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Amendment No</TableHead>
                <TableHead className="hidden sm:table-cell">Reference</TableHead>
                <TableHead className="hidden sm:table-cell">Project</TableHead>
                <TableHead className="hidden md:table-cell">Value Change</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading amendments...
                    </span>
                  </TableCell>
                </TableRow>
              ) : query.isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-destructive">
                    Failed to load amendments.
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                    No amendments found for the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((amendment) => (
                  <TableRow key={amendment.Id}>
                    <TableCell className="font-medium text-emerald-600 dark:text-emerald-400">
                      <div>{amendment.AmendmentNo}</div>
                      <div className="text-[10px] text-muted-foreground font-normal sm:hidden">
                        {amendment.ProjectName || amendment.CompanyName || ""}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="font-medium">{amendment.RefDocNo || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {amendment.RefDocType || "No reference type"}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="font-medium">{amendment.ProjectName || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {amendment.CompanyName || "No company"}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="text-xs text-muted-foreground">
                        From {formatMoney(amendment.OriginalValue)}
                      </div>
                      <div className="font-medium">
                        To {formatMoney(amendment.RevisedValue)}
                      </div>
                      {amendment.ValueDifference !== null && amendment.ValueDifference !== undefined ? (
                        <div
                          className={`text-xs font-semibold ${
                            amendment.ValueDifference >= 0
                              ? "text-emerald-700"
                              : "text-rose-700"
                          }`}
                        >
                          {amendment.ValueDifference >= 0 ? "+" : ""}
                          {formatMoney(amendment.ValueDifference)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{formatDate(amendment.AmendmentDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={amendment.Status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        {amendment.Status === "Draft" ? (
                          <>
                            {rights.canEdit && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEdit(amendment)}
                              >
                                <Pencil className="h-3.5 w-3.5 sm:mr-1" />
                                <span className="hidden sm:inline">Edit</span>
                              </Button>
                            )}
                            {rights.canCreate && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={submitMutation.isPending}
                                onClick={() => submitMutation.mutate(amendment.Id)}
                              >
                                <Send className="h-3.5 w-3.5 sm:mr-1" />
                                <span className="hidden sm:inline">Submit</span>
                              </Button>
                            )}
                            {rights.canDelete && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-rose-200 text-rose-700 hover:bg-rose-50"
                                onClick={() => setDeleteTarget(amendment)}
                              >
                                <Trash2 className="h-3.5 w-3.5 sm:mr-1" />
                                <span className="hidden sm:inline">Delete</span>
                              </Button>
                            )}
                          </>
                        ) : null}

                        {amendment.Status === "Pending" && canApprove ? (
                          <>
                            <Button
                              size="sm"
                              className="bg-emerald-600 text-white hover:bg-emerald-700"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate(amendment.Id)}
                            >
                              <ShieldCheck className="h-3.5 w-3.5 sm:mr-1" />
                              <span className="hidden sm:inline">Approve</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                              onClick={() => setRejectTarget(amendment)}
                            >
                              <XCircle className="h-3.5 w-3.5 sm:mr-1" />
                              <span className="hidden sm:inline">Reject</span>
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          </div>
          {pagination ? (
            <div className="mt-4 flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                {pagination.total} total records · page {pagination.page} of{" "}
                {Math.max(pagination.totalPages, 1)}
              </p>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() =>
                    setPage((current) => Math.min(pagination.totalPages, current + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!isSaving) {
            setFormOpen(open);
            if (!open) {
              setEditing(null);
              setForm(EMPTY_FORM);
            }
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Amendment" : "New Amendment"}</DialogTitle>
            <DialogDescription>
              Capture the reference, value change, and reason for the amendment.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 grid-cols-1 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Reference Doc Type</Label>
              <Select
                value={form.RefDocType || "__empty"}
                onValueChange={(value) =>
                  handleFormChange("RefDocType", value === "__empty" ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a document type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty">Not set</SelectItem>
                  {REF_DOC_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reference Doc No</Label>
              <Input
                value={form.RefDocNo}
                onChange={(event) => handleFormChange("RefDocNo", event.target.value)}
                placeholder="e.g. PO-0042"
              />
            </div>

            <div className="space-y-2">
              <Label>Reference Doc ID</Label>
              <Input
                type="number"
                min="1"
                value={form.RefDocId}
                onChange={(event) => handleFormChange("RefDocId", event.target.value)}
                placeholder="Numeric source record id"
              />
            </div>

            <div className="space-y-2">
              <Label>Amendment Date</Label>
              <Input
                type="date"
                value={form.AmendmentDate}
                onChange={(event) =>
                  handleFormChange("AmendmentDate", event.target.value)
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Project Name</Label>
              <Input
                value={form.ProjectName}
                onChange={(event) =>
                  handleFormChange("ProjectName", event.target.value)
                }
                placeholder="Project name"
              />
            </div>

            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input
                value={form.CompanyName}
                onChange={(event) =>
                  handleFormChange("CompanyName", event.target.value)
                }
                placeholder="Company or vendor"
              />
            </div>

            <div className="space-y-2">
              <Label>Original Value (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.OriginalValue}
                onChange={(event) =>
                  handleFormChange("OriginalValue", event.target.value)
                }
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label>Revised Value (₹)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.RevisedValue}
                onChange={(event) =>
                  handleFormChange("RevisedValue", event.target.value)
                }
                placeholder="0.00"
              />
            </div>

            {difference !== null ? (
              <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm md:col-span-2">
                <span className="text-muted-foreground">Difference preview: </span>
                <span
                  className={`font-semibold ${
                    difference >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {difference >= 0 ? "+" : ""}
                  {formatMoney(difference)}
                </span>
              </div>
            ) : null}

            <div className="space-y-2 md:col-span-2">
              <Label>Description of Change</Label>
              <Textarea
                value={form.Description}
                onChange={(event) =>
                  handleFormChange("Description", event.target.value)
                }
                placeholder="Summarize what changed"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Business Reason</Label>
              <Textarea
                value={form.Reason}
                onChange={(event) => handleFormChange("Reason", event.target.value)}
                placeholder="Why is this amendment needed?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFormOpen(false);
                setEditing(null);
                setForm(EMPTY_FORM);
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : editing ? (
                "Save Changes"
              ) : (
                "Create Amendment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => {
          if (!rejectMutation.isPending && !open) {
            setRejectTarget(null);
            setRejectNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Amendment</DialogTitle>
            <DialogDescription>
              Add a rejection note before sending this amendment back.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Rejection Note</Label>
            <Textarea
              value={rejectNote}
              onChange={(event) => setRejectNote(event.target.value)}
              placeholder="Reason for rejection"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectNote("");
              }}
              disabled={rejectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectNote.trim() || rejectMutation.isPending || !rejectTarget}
              onClick={() => {
                if (!rejectTarget) return;
                rejectMutation.mutate({
                  id: rejectTarget.Id,
                  note: rejectNote.trim(),
                });
              }}
            >
              {rejectMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejecting...
                </>
              ) : (
                "Confirm Reject"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Amendment?</AlertDialogTitle>
            <AlertDialogDescription>
              This performs a soft delete and is only allowed while the amendment is
              still in Draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending || !deleteTarget}
              onClick={(event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                deleteMutation.mutate(deleteTarget.Id);
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </MaterialShell>
    </>
  );
}
