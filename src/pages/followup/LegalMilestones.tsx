/**
 * LegalMilestones.tsx
 *
 * Renders the 8-step sequential legal workflow per applicant/booking.
 * Each row in the table expands to show a vertical stepper.
 * Each step can be marked: Pending / In Progress / Completed / Blocked / Waived
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AuditLogDrawer } from "@/components/AuditLogDrawer";
import {
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  FileText,
  Scale,
  Trash2,
  Clock,
  ChevronsUpDown,
  CalendarDays,
  User,
  Building2,
  BookOpen,
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  fetchLegalMilestones,
  fetchLegalMilestonesOptions,
  createLegalMilestone,
  updateMilestoneStep,
  deleteLegalMilestone,
} from "@/api/legalMilestonesApi";

// ── Step definitions ───────────────────────────────────────────────────────────
const STEPS = [
  { field: "DocCollection", label: "Document Collection", icon: FileText },
  { field: "LegalReview", label: "Legal Review Initiation", icon: Scale },
  { field: "Drafting", label: "Sales Deed / Agreement Draft", icon: FileText },
  {
    field: "InternalApproval",
    label: "Internal Legal Approval",
    icon: CheckCircle2,
  },
  {
    field: "DocShared",
    label: "Document Shared with Customer",
    icon: FileText,
  },
  { field: "MutualAgreement", label: "Mutual Agreement", icon: Scale },
  { field: "DirectorMeeting", label: "Director Meeting", icon: FileText },
  {
    field: "FinalExecution",
    label: "Final Execution & Registration",
    icon: CheckCircle2,
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

// FIX #6: separate color map for OverallStatus (different value set)
const OVERALL_STATUS_COLOR: Record<string, string> = {
  "In Progress": "bg-blue-500/10 text-blue-600 border-blue-400/20",
  Completed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  "On Hold": "bg-amber-500/10 text-amber-600 border-amber-400/20",
  Cancelled: "bg-red-500/10 text-red-600 border-red-400/20",
};

// ── Stepper sub-component ──────────────────────────────────────────────────────
function MilestoneStepper({
  record,
  onStepUpdate,
}: {
  record: any;
  onStepUpdate: (id: number, step: any) => void;
}) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [form, setForm] = useState({ status: "", doneDate: "", notes: "" });

  return (
    <div className="py-4 px-6 bg-muted/30 border-t border-border">
      <div className="relative">
        {STEPS.map((step, idx) => {
          const statusKey = `${step.field}Status` as keyof typeof record;
          const doneKey = `${step.field}Done` as keyof typeof record;
          const dueKey = `${step.field}Due` as keyof typeof record;
          // FIX #4: pre-populate notesKey
          const notesKey = `${step.field}Notes` as keyof typeof record;
          const status = (record[statusKey] as string) || "Pending";
          const isLast = idx === STEPS.length - 1;

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
                  {status === "Completed" ? "✓" : idx + 1}
                </div>
                {!isLast && <div className="w-0.5 flex-1 bg-border mt-1" />}
              </div>

              {/* Step content */}
              <div className="flex-1 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {step.label}
                    </p>
                    <div className="flex gap-3 mt-0.5">
                      {record[dueKey] && (
                        <span className="text-xs text-muted-foreground">
                          Due: {record[dueKey]}
                        </span>
                      )}
                      {record[doneKey] && (
                        <span className="text-xs text-emerald-600">
                          Done: {record[doneKey]}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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
                        // FIX #4: pre-populate existing notes
                        setForm({
                          status,
                          doneDate: (record[doneKey] as string) || "",
                          notes: (record[notesKey] as string) || "",
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
                          value={form.doneDate}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, doneDate: e.target.value }))
                          }
                          className="rounded-[9px]"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Notes</Label>
                        <Textarea
                          rows={2}
                          value={form.notes}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, notes: e.target.value }))
                          }
                          className="rounded-[9px] resize-none"
                        />
                      </div>
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
                        onClick={() => {
                          onStepUpdate(record.Id, {
                            stepField: step.field,
                            status: form.status,
                            doneDate: form.doneDate || undefined,
                            // FIX #5: always send notes (even empty string) so backend can clear it
                            notes: form.notes,
                          });
                          setEditingStep(null);
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

// ── Main Page ──────────────────────────────────────────────────────────────────
export function LegalMilestonesPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [applicantOpen, setApplicantOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [auditTarget, setAuditTarget] = useState<{
    id: number;
    no: string;
  } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: meta } = useQuery({
    queryKey: ["legal-milestones-meta"],
    queryFn: fetchLegalMilestonesOptions,
    staleTime: 5 * 60 * 1000,
  });

  // FIX #10: add staleTime so the list doesn't refetch on every focus/mount
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["legal-milestones"],
    queryFn: () => fetchLegalMilestones(),
    staleTime: 30 * 1000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: createLegalMilestone,
    onSuccess: () => {
      toast.success("Legal milestone created");
      queryClient.invalidateQueries({ queryKey: ["legal-milestones"] });
      setDialogOpen(false);
      setForm({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const stepMutation = useMutation({
    mutationFn: ({ id, step }: { id: number; step: any }) =>
      updateMilestoneStep(id, step),
    onSuccess: () => {
      toast.success("Step updated");
      queryClient.invalidateQueries({ queryKey: ["legal-milestones"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteLegalMilestone(id),
    onSuccess: () => {
      toast.success("Milestone deleted");
      queryClient.invalidateQueries({ queryKey: ["legal-milestones"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const records = (data as any)?.data ?? [];

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Legal Milestones", path: "/followup/legal/milestones" },
        ]}
      />

      <div className="relative space-y-6 mt-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Legal Milestones
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Track the 8-step sequential legal workflow per booking
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Plus size={14} /> New Milestone
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="w-8" />
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Milestone #
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Applicant
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Unit
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Current Step
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Overall Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No legal milestones yet
                  </td>
                </tr>
              ) : (
                // FIX #1: key on React.Fragment, not the inner <tr>
                records.map((rec: any) => (
                  <React.Fragment key={rec.Id}>
                    <tr
                      className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() =>
                        setExpandedId(expandedId === rec.Id ? null : rec.Id)
                      }
                    >
                      <td className="px-3 py-3 text-center">
                        {expandedId === rec.Id ? (
                          <ChevronDown
                            size={14}
                            className="text-muted-foreground"
                          />
                        ) : (
                          <ChevronRight
                            size={14}
                            className="text-muted-foreground"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-primary">
                        {rec.MilestoneNo}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded shrink-0">
                            {rec.ApplicantNo}
                          </span>
                          <p className="font-medium text-foreground truncate">
                            {rec.ApplicantName}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {rec.UnitNo || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {/* FIX #2: clamp CurrentStep to 1..8 before indexing */}
                        <span className="font-medium">{rec.CurrentStep}/8</span>
                        <span className="text-xs text-muted-foreground ml-1">
                          —{" "}
                          {STEPS[Math.max(1, rec.CurrentStep ?? 1) - 1]?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {/* FIX #6: use OVERALL_STATUS_COLOR for overall status badge */}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            OVERALL_STATUS_COLOR[rec.OverallStatus] ||
                            OVERALL_STATUS_COLOR["In Progress"]
                          }`}
                        >
                          {rec.OverallStatus}
                        </span>
                      </td>
                      <td
                        className="px-3.5 py-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1">
                          <button
                            title="History"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAuditTarget({
                                id: rec.Id,
                                no: rec.MilestoneNo ?? `#${rec.Id}`,
                              });
                            }}
                            className="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                          >
                            <Clock size={14} />
                          </button>
                          <button
                            title="Delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(rec);
                            }}
                            className="p-1 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {expandedId === rec.Id && (
                      <tr className="border-b border-border">
                        <td colSpan={7} className="p-0">
                          <MilestoneStepper
                            record={rec}
                            onStepUpdate={(id, step) =>
                              stepMutation.mutate({ id, step })
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create Dialog ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setForm({});
            setApplicantOpen(false);
          }
        }}
      >
        <DialogContent
          className="max-w-2xl p-0 gap-0 overflow-hidden"
          aria-describedby={undefined}
        >
          {/* ── Dialog Header ── */}
          <div className="px-6 py-5 border-b border-border bg-muted/30">
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Scale size={14} className="text-primary" />
              </div>
              New Legal Milestone
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1.5 ml-[38px]">
              Fill in applicant details and optional step due dates
            </p>
          </div>

          {/* ── Scrollable Body ── */}
          <div className="overflow-y-auto max-h-[68vh]">
            {/* Section 1 — Applicant */}
            <div className="px-6 pt-5 pb-5">
              <div className="flex items-center gap-2 mb-4">
                <User size={12} className="text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Applicant
                </span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  Applicant <span className="text-destructive ml-0.5">*</span>
                </Label>
                <Popover open={applicantOpen} onOpenChange={setApplicantOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full h-10 flex items-center justify-between rounded-lg border border-input bg-background px-3 text-sm hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
                    >
                      <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                        {form.ApplicantId ? (
                          (() => {
                            const a = (meta?.applicants ?? []).find(
                              (x: any) => String(x.Id) === form.ApplicantId,
                            );
                            return a ? (
                              <>
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[11px] text-primary border-primary/30 bg-primary/5 shrink-0 px-1.5 py-0 h-5"
                                >
                                  {a.ApplicantNo}
                                </Badge>
                                <span className="truncate font-medium text-foreground">
                                  {a.ApplicantName}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">
                                Select applicant…
                              </span>
                            );
                          })()
                        ) : (
                          <span className="text-muted-foreground">
                            Search by name or application ID…
                          </span>
                        )}
                      </span>
                      <ChevronsUpDown
                        size={14}
                        className="text-muted-foreground shrink-0 ml-2"
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="p-0"
                    style={{ width: "var(--radix-popover-trigger-width)" }}
                    align="start"
                    sideOffset={4}
                  >
                    <Command>
                      <CommandInput
                        placeholder="Search name or App. No…"
                        className="h-9"
                      />
                      <CommandList className="max-h-56">
                        <CommandEmpty>No applicant found.</CommandEmpty>
                        <CommandGroup>
                          {(meta?.applicants ?? []).map((a: any) => (
                            <CommandItem
                              key={a.Id}
                              value={`${a.ApplicantNo} ${a.ApplicantName}`}
                              onSelect={() => {
                                setForm((f) => ({
                                  ...f,
                                  ApplicantId: String(a.Id),
                                  UnitSelectionId: "",
                                  BookingId: "",
                                }));
                                setApplicantOpen(false);
                              }}
                              className="flex items-center gap-2.5 py-2.5 cursor-pointer"
                            >
                              <Badge
                                variant="outline"
                                className="font-mono text-[11px] text-primary border-primary/30 bg-primary/5 shrink-0 px-1.5 py-0 h-5"
                              >
                                {a.ApplicantNo}
                              </Badge>
                              <span className="truncate text-sm">
                                {a.ApplicantName}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Unit Selection</Label>
                  <Select
                    value={form.UnitSelectionId || ""}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, UnitSelectionId: v }))
                    }
                  >
                    <SelectTrigger className="rounded-lg">
                      <SelectValue placeholder="Select unit…" />
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
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Booking</Label>
                  <Select
                    value={form.BookingId || ""}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, BookingId: v }))
                    }
                  >
                    <SelectTrigger className="rounded-lg">
                      <SelectValue placeholder="Select booking…" />
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
              </div>
            </div>

            <Separator />

            {/* Section 2 — Project & Status */}
            <div className="px-6 py-5">
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={12} className="text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Project & Status
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Project</Label>
                  <Select
                    value={form.ProjectId || ""}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, ProjectId: v }))
                    }
                  >
                    <SelectTrigger className="rounded-lg">
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
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Company</Label>
                  <Select
                    value={form.CompanyId || ""}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, CompanyId: v }))
                    }
                  >
                    <SelectTrigger className="rounded-lg">
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
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Overall Status</Label>
                  <Select
                    value={form.OverallStatus || "In Progress"}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, OverallStatus: v }))
                    }
                  >
                    <SelectTrigger className="rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OVERALL_STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Section 3 — Step Due Dates */}
            <div className="px-6 py-5">
              <div className="flex items-center gap-2 mb-4">
                <CalendarDays size={12} className="text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Step Due Dates
                </span>
                <Badge
                  variant="secondary"
                  className="text-[10px] py-0 px-1.5 font-normal ml-1"
                >
                  optional
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {STEPS.map((s, idx) => (
                  <div
                    key={s.field}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <span className="w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate mb-1.5">
                        {s.label}
                      </p>
                      <Input
                        type="date"
                        className="h-7 text-xs rounded-md bg-background px-2"
                        value={form[`${s.field}Due`] || ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            [`${s.field}Due`]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {form.ApplicantId ? (
                <span className="text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 size={12} /> Applicant selected
                </span>
              ) : (
                "Select an applicant to enable Create"
              )}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="rounded-lg"
                onClick={() => {
                  setDialogOpen(false);
                  setForm({});
                  setApplicantOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!form.ApplicantId || createMutation.isPending}
                className="gradient-accent text-white rounded-lg px-5"
                onClick={() =>
                  createMutation.mutate({
                    ApplicantId: Number(form.ApplicantId),
                    UnitSelectionId: form.UnitSelectionId
                      ? Number(form.UnitSelectionId)
                      : undefined,
                    BookingId: form.BookingId
                      ? Number(form.BookingId)
                      : undefined,
                    ProjectId: form.ProjectId
                      ? Number(form.ProjectId)
                      : undefined,
                    CompanyId: form.CompanyId
                      ? Number(form.CompanyId)
                      : undefined,
                    OverallStatus: form.OverallStatus || "In Progress",
                    ...Object.fromEntries(
                      STEPS.map((s) => [
                        `${s.field}Due`,
                        form[`${s.field}Due`] || undefined,
                      ]),
                    ),
                  })
                }
              >
                {createMutation.isPending ? "Creating…" : "Create Milestone"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-sm font-bold">
              Delete Milestone
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">
              {deleteTarget?.MilestoneNo}
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
        module="LegalMilestone"
        recordId={auditTarget?.id ?? null}
        recordNo={auditTarget?.no}
      />
    </>
  );
}

export default LegalMilestonesPage;
