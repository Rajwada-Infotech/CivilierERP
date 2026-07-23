/**
 * AgreementWorkflow.tsx — responsive rewrite
 * Desktop: table with expandable stepper rows
 * Mobile: card list with expandable stepper
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  FileText,
  Users,
  Stamp,
  Archive,
  Eye,
  Send,
  Trash2,
  Search,
  X,
  Clock,
  CalendarDays,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchAgreementWorkflows,
  fetchAgreementWorkflowOptions,
  createAgreementWorkflow,
  updateWorkflowStep,
  deleteAgreementWorkflow,
} from "@/api/agreementWorkflowApi";
import { SignaturePicker } from "@/components/SignaturePicker";
import { AuditLogDrawer } from "@/components/AuditLogDrawer";

// ── Types ──────────────────────────────────────────────────────────────────────
interface OptionItem {
  Id: number;
  Name?: string;
  ApplicantNo?: string;
  ApplicantName?: string;
  AgreementNo?: string;
  BookingNo?: string;
  SelectionNo?: string;
  UnitNo?: string;
  ApplicantId?: number;
  CompanyId?: number;
}

interface MetaOptions {
  applicants: OptionItem[];
  agreements: OptionItem[];
  bookings: OptionItem[];
  unitSelections: OptionItem[];
  projects: OptionItem[];
  companies: OptionItem[];
  stepStatusOptions: string[];
  overallStatusOptions: string[];
  steps: string[];
}

interface WorkflowRecord {
  Id: number;
  WorkflowNo: string;
  ApplicantId: number;
  ApplicantNo: string;
  ApplicantName: string;
  AgreementId: number | null;
  AgreementNo: string | null;
  BookingId: number | null;
  BookingNo: string | null;
  UnitSelectionId: number | null;
  UnitNo: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  CurrentStep: number;
  OverallStatus: string;
  Notes: string | null;
  [key: string]: unknown;
}

interface WorkflowStepPayload {
  stepField: string;
  status: string;
  doneDate?: string;
  notes?: string;
  signatureId?: number;
}

interface ListResponse {
  data: WorkflowRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ── Step definitions ───────────────────────────────────────────────────────────
const STEPS = [
  {
    field: "Drafting",
    label: "Agreement Drafting",
    icon: FileText,
    desc: "Prepare the initial agreement draft",
  },
  {
    field: "InternalReview",
    label: "Internal Review",
    icon: Eye,
    desc: "Internal legal team review and approval",
  },
  {
    field: "CustomerSharing",
    label: "Document Shared with Customer",
    icon: Send,
    desc: "Share draft with customer for review",
  },
  {
    field: "CustomerApproval",
    label: "Customer Approval",
    icon: Users,
    desc: "Obtain customer's approval and sign-off",
  },
  {
    field: "Execution",
    label: "Agreement Execution",
    icon: Stamp,
    desc: "Both parties sign the agreement",
  },
  {
    field: "Registration",
    label: "Registration",
    icon: CheckCircle2,
    desc: "Register the agreement with relevant authority",
  },
  {
    field: "Archival",
    label: "Archival",
    icon: Archive,
    desc: "Archive signed & registered documents",
  },
];

const STEP_STATUS_OPTIONS = [
  "Pending",
  "In Progress",
  "Completed",
  "Blocked",
  "Waived",
];
const OVERALL_STATUS_OPTIONS = [
  "In Progress",
  "Completed",
  "On Hold",
  "Cancelled",
];

const STEP_STATUS_COLOR: Record<string, string> = {
  Pending: "bg-slate-500/10 text-slate-600 border-slate-400/20",
  "In Progress": "bg-blue-500/10 text-blue-600 border-blue-400/20",
  Completed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  Blocked: "bg-red-500/10 text-red-600 border-red-400/20",
  Waived: "bg-amber-500/10 text-amber-600 border-amber-400/20",
};

const OVERALL_STATUS_COLOR: Record<string, string> = {
  "In Progress": "bg-blue-500/10 text-blue-600 border-blue-400/20",
  Completed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  "On Hold": "bg-amber-500/10 text-amber-600 border-amber-400/20",
  Cancelled: "bg-red-500/10 text-red-600 border-red-400/20",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// ── Helper ─────────────────────────────────────────────────────────────────────
function filterProjectsByCompany(
  projects: OptionItem[],
  companyId: string | undefined,
): OptionItem[] {
  if (!companyId) return projects;
  return projects.filter(
    (p) => String(p.CompanyId) === companyId,
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────
function ProgressBar({ record }: { record: WorkflowRecord }) {
  const completed = STEPS.filter(
    (s) => record[`${s.field}Status`] === "Completed",
  ).length;
  const pct = Math.round((completed / STEPS.length) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {completed}/{STEPS.length}
      </span>
    </div>
  );
}

// ── Stepper ────────────────────────────────────────────────────────────────────
function WorkflowStepper({
  record,
  onStepUpdate,
}: {
  record: WorkflowRecord;
  onStepUpdate: (id: number, step: WorkflowStepPayload) => void;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [form, setForm] = useState({ status: "", doneDate: "", notes: "" });
  const [signatureId, setSignatureId] = useState<number | null>(null);

  return (
    <div className="py-4 px-4 sm:px-6 bg-muted/30 border-t border-border">
      <div className="relative">
        {STEPS.map((step, idx) => {
          const statusKey = `${step.field}Status`;
          const doneKey = `${step.field}Done`;
          const dueKey = `${step.field}Due`;
          const notesKey = `${step.field}Notes`;
          const status = (record[statusKey] as string) || "Pending";
          const isLast = idx === STEPS.length - 1;
          const StepIcon = step.icon;

          return (
            <div key={step.field} className="flex gap-3 sm:gap-4 mb-2">
              {/* dot + connector */}
              <div className="flex flex-col items-center w-7 shrink-0">
                <div
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[11px] font-bold shrink-0
                  ${
                    status === "Completed"
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : status === "In Progress"
                        ? "bg-blue-500 border-blue-500 text-white"
                        : status === "Blocked"
                          ? "bg-red-500 border-red-500 text-white"
                          : status === "Waived"
                            ? "bg-amber-400 border-amber-400 text-white"
                            : "bg-card border-border text-muted-foreground"
                  }`}
                >
                  {status === "Completed" ? "✓" : <StepIcon size={12} />}
                </div>
                {!isLast && <div className="w-0.5 flex-1 bg-border mt-1" />}
              </div>

              {/* content */}
              <div className="flex-1 pb-5 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {step.desc}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1">
                      {record[dueKey] && (
                        <span className="text-xs text-muted-foreground">
                          Due: {fmtDate(record[dueKey] as string)}
                        </span>
                      )}
                      {record[doneKey] && (
                        <span className="text-xs text-emerald-600 font-medium">
                          Done: {fmtDate(record[doneKey] as string)}
                        </span>
                      )}
                    </div>
                    {record[notesKey] && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        {record[notesKey] as string}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STEP_STATUS_COLOR[status] || STEP_STATUS_COLOR["Pending"]}`}
                    >
                      {status}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => {
                        setEditingStep(step.field);
                        setSignatureId(null);
                        setForm({
                          status,
                          doneDate: (record[doneKey] as string) || "",
                          notes: "",
                        });
                      }}
                    >
                      Update
                    </Button>
                  </div>
                </div>
              </div>

              {/* step update dialog */}
              {editingStep === step.field && (
                <Dialog open onOpenChange={() => setEditingStep(null)}>
                  <DialogContent
                    className="max-w-sm"
                    aria-describedby={undefined}
                  >
                    <DialogHeader>
                      <DialogTitle className="text-sm font-bold">
                        Update: {step.label}
                      </DialogTitle>
                      <DialogDescription className="sr-only">
                        Update the status and details for this workflow step.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                      <div className="space-y-1">
                        <Label className="text-xs">Status</Label>
                        <Select
                          value={form.status}
                          onValueChange={(v) =>
                            setForm((f) => ({ ...f, status: v }))
                          }
                        >
                          <SelectTrigger className="rounded-[9px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STEP_STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Completion Date</Label>
                        <div className="relative">
                          <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                          <input
                            type="date"
                            value={form.doneDate}
                            onChange={(e) => setForm((f) => ({ ...f, doneDate: e.target.value }))}
                            className="w-full pl-8 pr-3 py-2 rounded-[9px] text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Notes</Label>
                        <Textarea
                          rows={2}
                          className="rounded-[9px] text-xs"
                          placeholder="Optional notes…"
                          value={form.notes}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, notes: e.target.value }))
                          }
                        />
                      </div>
                      {editingStep === "Execution" && (
                        <div className="space-y-1">
                          <Label className="text-xs">
                            Signature Stamp (optional)
                          </Label>
                          <SignaturePicker
                            value={signatureId}
                            onChange={setSignatureId}
                          />
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-[9px]"
                        onClick={() => setEditingStep(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="gradient-accent text-white rounded-[9px]"
                        disabled={!form.status}
                        onClick={() => {
                          onStepUpdate(record.Id, {
                            stepField: step.field,
                            status: form.status,
                            doneDate: form.doneDate || undefined,
                            notes: form.notes || undefined,
                            ...(step.field === "Execution" &&
                            signatureId !== null
                              ? { signatureId }
                              : {}),
                          });
                          setEditingStep(null);
                          setSignatureId(null);
                        }}
                      >
                        Save
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Row card (mobile) ──────────────────────────────────────────────────────────
function MobileCard({
  row,
  expanded,
  onToggle,
  onDelete,
  onAudit,
  onStepUpdate,
}: {
  row: WorkflowRecord;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onAudit: () => void;
  onStepUpdate: (id: number, step: WorkflowStepPayload) => void;
}) {
  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card mb-2">
      <div
        className="w-full text-left p-3.5 flex items-start gap-3 hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <div className="mt-0.5 text-muted-foreground shrink-0">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-semibold text-foreground">
              {row.WorkflowNo}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${OVERALL_STATUS_COLOR[row.OverallStatus] || OVERALL_STATUS_COLOR["In Progress"]}`}
            >
              {row.OverallStatus}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground mt-0.5 truncate">
            {row.ApplicantName}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.ApplicantNo}
            {row.AgreementNo ? ` · ${row.AgreementNo}` : ""}
          </p>
          <div className="mt-2">
            <ProgressBar record={row} />
          </div>
        </div>
        <div
          className="flex gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            title="History"
            onClick={onAudit}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Clock size={14} />
          </button>
          <button
            title="Delete"
            onClick={onDelete}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {expanded && <WorkflowStepper record={row} onStepUpdate={onStepUpdate} />}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AgreementWorkflowPage() {
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<WorkflowRecord | null>(null);
  const [auditTarget, setAuditTarget] = useState<{
    id: number;
    no: string;
  } | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: meta } = useQuery<MetaOptions>({
    queryKey: ["agWorkflow-meta"],
    queryFn: fetchAgreementWorkflowOptions,
    staleTime: 5 * 60 * 1000,
  });

  const listParams: Record<string, string> = {
    page: String(page),
    pageSize: String(PAGE_SIZE),
  };
  if (search) listParams.search = search;
  if (filterStatus) listParams.overallStatus = filterStatus;

  const {
    data: listData,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<ListResponse>({
    queryKey: ["agWorkflow-list", listParams],
    queryFn: () => fetchAgreementWorkflows(listParams),
    placeholderData: (prev) => prev,
  });

  const rows: WorkflowRecord[] = listData?.data ?? [];
  const pagination = listData?.pagination;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      createAgreementWorkflow(payload),
    onSuccess: (res: { WorkflowNo: string }) => {
      toast.success(`Workflow ${res.WorkflowNo} created`);
      qc.invalidateQueries({ queryKey: ["agWorkflow-list"] });
      setDialogOpen(false);
      setForm({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stepMutation = useMutation({
    mutationFn: ({ id, step }: { id: number; step: WorkflowStepPayload }) =>
      updateWorkflowStep(id, step),
    onSuccess: () => {
      toast.success("Step updated");
      qc.invalidateQueries({ queryKey: ["agWorkflow-list"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAgreementWorkflow(id),
    onSuccess: () => {
      toast.success("Workflow deleted");
      qc.invalidateQueries({ queryKey: ["agWorkflow-list"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Followup" },
          { label: "Agreement" },
          { label: "Workflow Tracker" },
        ]}
      />

      <FollowupShell
        title="Agreement Workflow"
        icon={FileText}
        action={
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              Refresh
            </button>
            <Button
              onClick={() => setDialogOpen(true)}
              className="gradient-accent text-white rounded-[9px] gap-1.5 font-semibold text-sm px-5 py-2 h-auto shrink-0"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">New Workflow</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        }
      >
      {/* ── Toolbar ── */}

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setSearch(searchInput);
                setPage(1);
              }
            }}
            placeholder="Search workflow, applicant…"
            className="w-full pl-8 pr-8 py-1.5 rounded-[9px] border border-border bg-background text-foreground text-[13px] outline-none focus:ring-2 focus:ring-primary/25"
          />
          {searchInput && (
            <button
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setPage(1);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            setPage(1);
          }}
          className="h-[34px] px-2.5 rounded-[9px] border border-border bg-background text-foreground text-[13px] outline-none"
        >
          <option value="">All statuses</option>
          {OVERALL_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

      </div>

      {/* ── Mobile card list (hidden on md+) ── */}
      <div className="md:hidden">
        {isLoading ? (
          <p className="text-center text-muted-foreground text-sm py-12">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-12">
            No workflows found
          </p>
        ) : (
          rows.map((row) => (
            <MobileCard
              key={row.Id}
              row={row}
              expanded={expandedIds.has(row.Id)}
              onToggle={() => toggleExpand(row.Id)}
              onDelete={() => setDeleteTarget(row)}
              onAudit={() =>
                setAuditTarget({
                  id: row.Id,
                  no: row.WorkflowNo ?? `#${row.Id}`,
                })
              }
              onStepUpdate={(id, step) => stepMutation.mutate({ id, step })}
            />
          ))
        )}
      </div>

      {/* ── Desktop table (hidden below md) ── */}
      <div className="hidden md:block border border-border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-muted border-b border-border">
                {[
                  "",
                  "Workflow No",
                  "Applicant",
                  "Agreement",
                  "Overall Status",
                  "Progress",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3.5 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-muted-foreground text-sm"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center text-muted-foreground text-sm"
                  >
                    No workflows found
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const expanded = expandedIds.has(row.Id);
                  return (
                    <React.Fragment key={row.Id}>
                      <tr
                        key={row.Id}
                        className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
                        style={{ borderBottom: expanded ? "none" : undefined }}
                        onClick={() => toggleExpand(row.Id)}
                      >
                        <td className="px-3.5 py-2.5 w-7">
                          {expanded ? (
                            <ChevronDown
                              size={15}
                              className="text-muted-foreground"
                            />
                          ) : (
                            <ChevronRight
                              size={15}
                              className="text-muted-foreground"
                            />
                          )}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span className="font-mono text-xs font-semibold">
                            {row.WorkflowNo}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <p className="font-medium text-foreground">
                            {row.ApplicantName}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {row.ApplicantNo}
                          </p>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <p className="font-mono text-xs text-foreground">
                            {row.AgreementNo ?? "—"}
                          </p>
                          {row.UnitNo && (
                            <p className="text-[11px] text-muted-foreground">
                              Unit: {row.UnitNo}
                            </p>
                          )}
                        </td>
                        <td
                          className="px-3.5 py-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${OVERALL_STATUS_COLOR[row.OverallStatus] || OVERALL_STATUS_COLOR["In Progress"]}`}
                          >
                            {row.OverallStatus}
                          </span>
                        </td>
                        <td
                          className="px-3.5 py-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ProgressBar record={row} />
                        </td>
                        <td
                          className="px-3.5 py-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1">
                            <button
                              title="History"
                              onClick={() =>
                                setAuditTarget({
                                  id: row.Id,
                                  no: row.WorkflowNo ?? `#${row.Id}`,
                                })
                              }
                              className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                              <Clock size={14} />
                            </button>
                            <button
                              title="Delete"
                              onClick={() => setDeleteTarget(row)}
                              className="p-1 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${row.Id}-stepper`}>
                          <td
                            colSpan={7}
                            className="p-0 border-b border-border"
                          >
                            <WorkflowStepper
                              record={row}
                              onStepUpdate={(id, step) =>
                                stepMutation.mutate({ id, step })
                              }
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
            <span>
              {(pagination.page - 1) * pagination.pageSize + 1}–
              {Math.min(
                pagination.page * pagination.pageSize,
                pagination.total,
              )}{" "}
              of {pagination.total}
            </span>
            <div className="flex gap-1.5">
              <button
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 rounded-lg border border-border bg-background text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted transition-colors"
              >
                Prev
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 rounded-lg border border-border bg-background text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="md:hidden flex items-center justify-between px-1 py-3 text-xs text-muted-foreground">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)}{" "}
            of {pagination.total}
          </span>
          <div className="flex gap-1.5">
            <button
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 rounded-lg border border-border bg-background text-foreground disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Prev
            </button>
            <button
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded-lg border border-border bg-background text-foreground disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Create Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Agreement Workflow</DialogTitle>
            <DialogDescription className="sr-only">
              Create a new agreement workflow for an applicant.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            {/* Applicant */}
            <div className="col-span-full space-y-1">
              <Label className="text-xs">
                Applicant <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.ApplicantId || ""}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    ApplicantId: v,
                    AgreementId: "",
                    BookingId: "",
                    UnitSelectionId: "",
                  }))
                }
              >
                <SelectTrigger className="rounded-[9px]">
                  <SelectValue placeholder="Select applicant…" />
                </SelectTrigger>
                <SelectContent>
                  {(meta?.applicants ?? []).map((a: OptionItem) => (
                    <SelectItem key={a.Id} value={String(a.Id)}>
                      {a.ApplicantName} ({a.ApplicantNo})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Agreement */}
            <div className="col-span-full space-y-1">
              <Label className="text-xs">Agreement</Label>
              <Select
                value={form.AgreementId || ""}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, AgreementId: v }))
                }
                disabled={!form.ApplicantId}
              >
                <SelectTrigger className="rounded-[9px]">
                  <SelectValue
                    placeholder={
                      form.ApplicantId
                        ? "Select agreement…"
                        : "Select applicant first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(meta?.agreements ?? [])
                    .filter(
                      (ag: OptionItem) =>
                        !form.ApplicantId ||
                        String(ag.ApplicantId) === form.ApplicantId,
                    )
                    .map((ag: OptionItem) => (
                      <SelectItem key={ag.Id} value={String(ag.Id)}>
                        {ag.AgreementNo}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Booking */}
            <div className="space-y-1">
              <Label className="text-xs">Booking</Label>
              <Select
                value={form.BookingId || ""}
                onValueChange={(v) => setForm((f) => ({ ...f, BookingId: v }))}
                disabled={!form.ApplicantId}
              >
                <SelectTrigger className="rounded-[9px]">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(meta?.bookings ?? [])
                    .filter(
                      (b: OptionItem) =>
                        !form.ApplicantId ||
                        String(b.ApplicantId) === form.ApplicantId,
                    )
                    .map((b: OptionItem) => (
                      <SelectItem key={b.Id} value={String(b.Id)}>
                        {b.BookingNo}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Unit Selection */}
            <div className="space-y-1">
              <Label className="text-xs">Unit Selection</Label>
              <Select
                value={form.UnitSelectionId || ""}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, UnitSelectionId: v }))
                }
                disabled={!form.ApplicantId}
              >
                <SelectTrigger className="rounded-[9px]">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(meta?.unitSelections ?? [])
                    .filter(
                      (u: OptionItem) =>
                        !form.ApplicantId ||
                        String(u.ApplicantId) === form.ApplicantId,
                    )
                    .map((u: OptionItem) => (
                      <SelectItem key={u.Id} value={String(u.Id)}>
                        {u.SelectionNo} — {u.UnitNo}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Project */}
            <div className="space-y-1">
              <Label className="text-xs">Project</Label>
              <Select
                value={form.ProjectId || ""}
                onValueChange={(v) => setForm((f) => ({ ...f, ProjectId: v }))}
              >
                <SelectTrigger className="rounded-[9px]">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {filterProjectsByCompany(
                    meta?.projects ?? [],
                    form.CompanyId,
                  ).map((p: OptionItem) => (
                    <SelectItem key={p.Id} value={String(p.Id)}>
                      {p.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Company */}
            <div className="space-y-1">
              <Label className="text-xs">Company</Label>
              <Select
                value={form.CompanyId || ""}
                onValueChange={(v) => setForm((f) => ({ ...f, CompanyId: v }))}
              >
                <SelectTrigger className="rounded-[9px]">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(meta?.companies ?? []).map((c: OptionItem) => (
                    <SelectItem key={c.Id} value={String(c.Id)}>
                      {c.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step due dates */}
            <div className="col-span-full border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                Step Due Dates (optional)
              </p>
            </div>
            {STEPS.map((s) => (
              <div key={s.field} className="space-y-1">
                <Label className="text-xs">{s.label}</Label>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                  <input
                    type="date"
                    value={form[`${s.field}Due`] || ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        [`${s.field}Due`]: e.target.value,
                      }))
                    }
                    className="w-full pl-8 pr-3 py-2 rounded-[9px] text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
            ))}

            {/* Notes */}
            <div className="col-span-full space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea
                rows={2}
                className="rounded-[9px] text-xs"
                placeholder="Optional notes…"
                value={form.Notes || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, Notes: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              className="rounded-[9px]"
              onClick={() => {
                setDialogOpen(false);
                setForm({});
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!form.ApplicantId || createMutation.isPending}
              className="gradient-accent text-white rounded-[9px]"
              onClick={() =>
                createMutation.mutate({
                  ApplicantId: Number(form.ApplicantId),
                  AgreementId: form.AgreementId
                    ? Number(form.AgreementId)
                    : undefined,
                  BookingId: form.BookingId
                    ? Number(form.BookingId)
                    : undefined,
                  UnitSelectionId: form.UnitSelectionId
                    ? Number(form.UnitSelectionId)
                    : undefined,
                  ProjectId: form.ProjectId
                    ? Number(form.ProjectId)
                    : undefined,
                  CompanyId: form.CompanyId
                    ? Number(form.CompanyId)
                    : undefined,
                  Notes: form.Notes || undefined,
                  ...Object.fromEntries(
                    STEPS.map((s) => [
                      `${s.field}Due`,
                      form[`${s.field}Due`] || undefined,
                    ]),
                  ),
                })
              }
            >
              {createMutation.isPending ? "Creating…" : "Create Workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold">
              Delete Workflow
            </DialogTitle>
            <DialogDescription className="sr-only">
              Confirm deletion of this workflow record.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">
              {deleteTarget?.WorkflowNo}
            </span>
            ? This cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="rounded-[9px]"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="rounded-[9px]"
              disabled={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.Id)
              }
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </FollowupShell>

      <AuditLogDrawer
        open={!!auditTarget}
        onClose={() => setAuditTarget(null)}
        module="AgreementWorkflow"
        recordId={auditTarget?.id ?? null}
        recordNo={auditTarget?.no}
      />
    </>
  );
}