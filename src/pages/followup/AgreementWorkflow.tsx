/**
 * AgreementWorkflow.tsx
 *
 * Track B: 7-step agreement sub-workflow tracker per applicant/agreement.
 * Mirrors LegalMilestones.tsx UI — expandable rows with vertical stepper.
 * Steps: Drafting → Internal Review → Customer Sharing → Customer Approval
 *        → Execution → Registration → Archival
 */

import { useState } from "react";
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
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Input } from "@/components/ui/input";
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
  // Step columns — indexed dynamically
  [key: string]: unknown;
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

// ── Progress bar ───────────────────────────────────────────────────────────────
function ProgressBar({ record }: { record: any }) {
  const completed = STEPS.filter(
    (s) => record[`${s.field}Status`] === "Completed",
  ).length;
  const pct = Math.round((completed / STEPS.length) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
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

// ── Stepper sub-component ──────────────────────────────────────────────────────
function WorkflowStepper({
  record,
  onStepUpdate,
}: {
  record: any;
  onStepUpdate: (id: number, step: any) => void;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [form, setForm] = useState({ status: "", doneDate: "", notes: "" });
  const [signatureId, setSignatureId] = useState<number | null>(null);

  return (
    <div className="py-4 px-6 bg-muted/30 border-t border-border">
      <div className="relative">
        {STEPS.map((step, idx) => {
          const statusKey = `${step.field}Status` as keyof typeof record;
          const doneKey = `${step.field}Done` as keyof typeof record;
          const dueKey = `${step.field}Due` as keyof typeof record;
          const notesKey = `${step.field}Notes` as keyof typeof record;
          const status = (record[statusKey] as string) || "Pending";
          const isLast = idx === STEPS.length - 1;
          const StepIcon = step.icon;

          return (
            <div key={step.field} className="flex gap-4 mb-2">
              {/* Step dot + connector */}
              <div className="flex flex-col items-center w-8 shrink-0">
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
                  {status === "Completed" ? (
                    "✓"
                  ) : (
                    <StepIcon size={12} />
                  )}
                </div>
                {!isLast && <div className="w-0.5 flex-1 bg-border mt-1" />}
              </div>

              {/* Step content */}
              <div className="flex-1 pb-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {step.desc}
                    </p>
                    <div className="flex gap-3 mt-1">
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
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        STEP_STATUS_COLOR[status] ||
                        STEP_STATUS_COLOR["Pending"]
                      }`}
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

              {/* Inline step update dialog */}
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
                        <Input
                          type="date"
                          className="rounded-[9px]"
                          value={form.doneDate}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, doneDate: e.target.value }))
                          }
                        />
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
                      {/* Signature stamp — only on Execution step */}
                      {editingStep === "Execution" && (
                        <div className="space-y-1">
                          <Label className="text-xs">Signature Stamp (optional)</Label>
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
                            ...(step.field === "Execution" && signatureId !== null
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

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AgreementWorkflowPage() {
  const qc = useQueryClient();

  // List state
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Create dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<WorkflowRecord | null>(null);
  const [auditTarget, setAuditTarget] = useState<{ id: number; no: string } | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
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

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      createAgreementWorkflow(payload),
    onSuccess: (res: { WorkflowNo: string }) => {
      toast.success(`Workflow ${res.WorkflowNo} created`);
      qc.invalidateQueries({ queryKey: ["agWorkflow-list"] });
      setDialogOpen(false);
      setForm({});
    },
    onError: (err: any) => toast.error(err.message),
  });

  const stepMutation = useMutation({
    mutationFn: ({ id, step }: { id: number; step: any }) =>
      updateWorkflowStep(id, step),
    onSuccess: () => {
      toast.success("Step updated");
      qc.invalidateQueries({ queryKey: ["agWorkflow-list"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAgreementWorkflow(id),
    onSuccess: () => {
      toast.success("Workflow deleted");
      qc.invalidateQueries({ queryKey: ["agWorkflow-list"] });
      setDeleteTarget(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // ── Toggle expand ──────────────────────────────────────────────────────────
  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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

      {/* ── Toolbar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted-foreground)",
            }}
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
            placeholder="Search workflow, applicant, agreement…"
            style={{
              width: "100%",
              paddingLeft: 32,
              paddingRight: searchInput ? 32 : 12,
              paddingTop: 7,
              paddingBottom: 7,
              borderRadius: 9,
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
              fontSize: 13,
              outline: "none",
            }}
          />
          {searchInput && (
            <button
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setPage(1);
              }}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--muted-foreground)",
                padding: 0,
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Overall Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            setPage(1);
          }}
          style={{
            padding: "7px 10px",
            borderRadius: 9,
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: 13,
            outline: "none",
          }}
        >
          <option value="">All statuses</option>
          {OVERALL_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button
          onClick={() => refetch()}
          title="Refresh"
          style={{
            padding: "7px 10px",
            borderRadius: 9,
            border: "1px solid var(--border)",
            background: "var(--background)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <RefreshCw
            size={14}
            className={isFetching ? "animate-spin" : ""}
            style={{ color: "var(--muted-foreground)" }}
          />
        </button>

        <Button
          onClick={() => setDialogOpen(true)}
          className="gradient-accent text-white rounded-[9px] gap-1.5 font-semibold text-sm px-4 h-9 ml-auto"
        >
          <Plus size={15} />
          New Workflow
        </Button>
      </div>

      {/* ── Table ── */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--card)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                background: "var(--muted)",
                borderBottom: "1px solid var(--border)",
              }}
            >
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
                  style={{
                    padding: "10px 14px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--muted-foreground)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    whiteSpace: "nowrap",
                  }}
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
                  style={{
                    padding: "48px 0",
                    textAlign: "center",
                    color: "var(--muted-foreground)",
                    fontSize: 13,
                  }}
                >
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: "48px 0",
                    textAlign: "center",
                    color: "var(--muted-foreground)",
                    fontSize: 13,
                  }}
                >
                  No workflows found
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const expanded = expandedIds.has(row.Id);
                return (
                  <>
                    <tr
                      key={row.Id}
                      style={{
                        borderBottom: expanded
                          ? "none"
                          : "1px solid var(--border)",
                        background: expanded
                          ? "var(--muted/40)"
                          : "var(--card)",
                        cursor: "pointer",
                        transition: "background 0.15s",
                      }}
                      onClick={() => toggleExpand(row.Id)}
                    >
                      {/* Expand toggle */}
                      <td style={{ padding: "10px 8px 10px 14px", width: 28 }}>
                        {expanded ? (
                          <ChevronDown size={15} style={{ color: "var(--muted-foreground)" }} />
                        ) : (
                          <ChevronRight size={15} style={{ color: "var(--muted-foreground)" }} />
                        )}
                      </td>

                      {/* Workflow No */}
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          style={{
                            fontFamily: "monospace",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--foreground)",
                          }}
                        >
                          {row.WorkflowNo}
                        </span>
                      </td>

                      {/* Applicant */}
                      <td style={{ padding: "10px 14px" }}>
                        <p
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--foreground)",
                            margin: 0,
                          }}
                        >
                          {row.ApplicantName}
                        </p>
                        <p
                          style={{
                            fontSize: 11,
                            color: "var(--muted-foreground)",
                            margin: 0,
                          }}
                        >
                          {row.ApplicantNo}
                        </p>
                      </td>

                      {/* Agreement */}
                      <td style={{ padding: "10px 14px" }}>
                        <p
                          style={{
                            fontSize: 12,
                            color: "var(--foreground)",
                            margin: 0,
                            fontFamily: "monospace",
                          }}
                        >
                          {row.AgreementNo ?? "—"}
                        </p>
                        {row.UnitNo && (
                          <p
                            style={{
                              fontSize: 11,
                              color: "var(--muted-foreground)",
                              margin: 0,
                            }}
                          >
                            Unit: {row.UnitNo}
                          </p>
                        )}
                      </td>

                      {/* Overall Status */}
                      <td
                        style={{ padding: "10px 14px" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            OVERALL_STATUS_COLOR[row.OverallStatus] ||
                            OVERALL_STATUS_COLOR["In Progress"]
                          }`}
                        >
                          {row.OverallStatus}
                        </span>
                      </td>

                      {/* Progress */}
                      <td
                        style={{ padding: "10px 14px" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ProgressBar record={row} />
                      </td>

                      {/* Actions */}
                      <td
                        style={{ padding: "10px 14px" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          title="Delete"
                          onClick={() => setDeleteTarget(row)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--muted-foreground)",
                            padding: 4,
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                        <button
                          title="History"
                          onClick={() => setAuditTarget({ id: row.Id, no: row.WorkflowNo ?? `#${row.Id}` })}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--muted-foreground)",
                            padding: 4,
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <Clock size={14} />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded stepper row */}
                    {expanded && (
                      <tr key={`${row.Id}-stepper`}>
                        <td
                          colSpan={7}
                          style={{
                            padding: 0,
                            borderBottom: "1px solid var(--border)",
                          }}
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
                  </>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              borderTop: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            <span>
              {(pagination.page - 1) * pagination.pageSize + 1}–
              {Math.min(
                pagination.page * pagination.pageSize,
                pagination.total,
              )}{" "}
              of {pagination.total}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => p - 1)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--background)",
                  cursor: pagination.page <= 1 ? "not-allowed" : "pointer",
                  fontSize: 12,
                  color: "var(--foreground)",
                  opacity: pagination.page <= 1 ? 0.4 : 1,
                }}
              >
                Prev
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--background)",
                  cursor:
                    pagination.page >= pagination.totalPages
                      ? "not-allowed"
                      : "pointer",
                  fontSize: 12,
                  color: "var(--foreground)",
                  opacity: pagination.page >= pagination.totalPages ? 0.4 : 1,
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Create Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          style={{ maxWidth: 600, maxHeight: "90vh", overflowY: "auto" }}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>New Agreement Workflow</DialogTitle>
          </DialogHeader>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              paddingTop: 4,
            }}
          >
            {/* Applicant */}
            <div className="col-span-2 space-y-1">
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
                  {(meta?.applicants ?? []).map((a: any) => (
                    <SelectItem key={a.Id} value={String(a.Id)}>
                      {a.ApplicantName} ({a.ApplicantNo})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Agreement */}
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Agreement</Label>
              <Select
                value={form.AgreementId || ""}
                onValueChange={(v) => setForm((f) => ({ ...f, AgreementId: v }))}
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
                      (ag: any) =>
                        !form.ApplicantId ||
                        String(ag.ApplicantId) === form.ApplicantId,
                    )
                    .map((ag: any) => (
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
                      (b: any) =>
                        !form.ApplicantId ||
                        String(b.ApplicantId) === form.ApplicantId,
                    )
                    .map((b: any) => (
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
                      (u: any) =>
                        !form.ApplicantId ||
                        String(u.ApplicantId) === form.ApplicantId,
                    )
                    .map((u: any) => (
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
                  {(meta?.projects ?? []).map((p: any) => (
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
                  {(meta?.companies ?? []).map((c: any) => (
                    <SelectItem key={c.Id} value={String(c.Id)}>
                      {c.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step due dates */}
            <div className="col-span-2 border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                Step Due Dates (optional)
              </p>
            </div>
            {STEPS.map((s) => (
              <div key={s.field} className="space-y-1">
                <Label className="text-xs">{s.label}</Label>
                <Input
                  type="date"
                  className="rounded-[9px]"
                  value={form[`${s.field}Due`] || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [`${s.field}Due`]: e.target.value,
                    }))
                  }
                />
              </div>
            ))}

            {/* Notes */}
            <div className="col-span-2 space-y-1">
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

          <DialogFooter>
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
      <Dialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold">
              Delete Workflow
            </DialogTitle>
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
              onClick={() => deleteMutation.mutate(deleteTarget.Id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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