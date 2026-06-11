import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  CheckCircle2,
  FileText,
  Home,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type LogType = "email" | "call" | "sms" | "note" | "payment";

interface ApplicantRecord {
  Id: number;
  ApplicantNo?: string | null;
  ApplicantName?: string | null;
  PrimaryMobile?: string | null;
  Email?: string | null;
  City?: string | null;
  Source?: string | null;
  ProjectId?: number | null;
  ProjectName?: string | null;
  CompanyId?: number | null;
  CompanyName?: string | null;
  PreferredUnitType?: string | null;
  BudgetAmount?: number | null;
  Status?: string | null;
  AssignedToName?: string | null;
  Notes?: string | null;
  CreatedBy?: string | null;
  CreatedAt?: string | null;
  UpdatedBy?: string | null;
  UpdatedAt?: string | null;
}

interface UnitSelectionRecord {
  Id: number;
  SelectionNo?: string | null;
  UnitNo?: string | null;
  BlockName?: string | null;
  FloorName?: string | null;
  UnitType?: string | null;
  AreaSqFt?: number | null;
  RatePerSqFt?: number | null;
  TotalValue?: number | null;
  BookingAmount?: number | null;
  SelectionDate?: string | null;
  Status?: string | null;
  ProjectName?: string | null;
  CompanyName?: string | null;
  Notes?: string | null;
  CreatedAt?: string | null;
}

interface AgreementRecord {
  Id: number;
  AgreementNo?: string | null;
  AgreementDate?: string | null;
  AgreementValue?: number | null;
  AdvanceAmount?: number | null;
  BalanceAmount?: number | null;
  RegistrationDate?: string | null;
  Status?: string | null;
  ProjectName?: string | null;
  CompanyName?: string | null;
  SelectionNo?: string | null;
  UnitNo?: string | null;
  Notes?: string | null;
  CreatedAt?: string | null;
}

interface LogRecord {
  id: string;
  date: string;
  type: LogType;
  customer: string;
  amount: number | null;
  refId: number | null;
  notes: string;
  user: string;
  createdAt: string;
}

interface ReminderRecord {
  id: number;
  tenantName: string;
  message?: string | null;
  module?: string | null;
  refId?: number | null;
  dueDate?: string | null;
  lastSentOn?: string | null;
  CreatedAt?: string | null;
  status: "sent" | "overdue" | "scheduled";
  amountDue?: number | null;
}

interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  module?: string | null;
  priority?: string | null;
  status?: string | null;
  assignedToName?: string | null;
  dueDate?: string | null;
}

interface TimelineEvent {
  id: string;
  type: "applicant" | "unit" | "agreement" | "log" | "reminder";
  date: string;
  title: string;
  description?: string;
  sourceLabel: string;
  badgeClassName: string;
}

interface LogFormState {
  date: string;
  type: LogType;
  customer: string;
  amount: string;
  notes: string;
}

const EMPTY_LOG_FORM: LogFormState = {
  date: "",
  type: "note",
  customer: "",
  amount: "",
  notes: "",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN");
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
}

function formatMoney(value?: number | null) {
  return typeof value === "number"
    ? `Rs ${value.toLocaleString("en-IN")}`
    : "-";
}

function formatTimelineDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
}

function getLogIcon(type: LogType) {
  switch (type) {
    case "email":
      return MessageSquare;
    case "call":
      return Phone;
    case "sms":
      return Bell;
    case "payment":
      return CheckCircle2;
    default:
      return FileText;
  }
}

async function fetchApplicant(id: string) {
  const response = await fetchWithAuth(`/api/followup-applications/${id}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to load applicant");
  }
  return response.json() as Promise<ApplicantRecord>;
}

async function fetchUnitSelections(applicantId: string) {
  const response = await fetchWithAuth(
    `/api/followup-unit-selections?applicantId=${applicantId}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load unit selections");
  }
  const data = await response.json();
  return (
    Array.isArray(data?.data) ? data.data : data
  ) as UnitSelectionRecord[];
}

async function fetchAgreements(applicantId: string) {
  const response = await fetchWithAuth(
    `/api/followup-agreements?applicantId=${applicantId}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load agreements");
  }
  const data = await response.json();
  return (Array.isArray(data?.data) ? data.data : data) as AgreementRecord[];
}

async function fetchLogs(applicantId: string) {
  const response = await fetchWithAuth(
    `/api/followup-log?refId=${applicantId}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load log entries");
  }
  return response.json() as Promise<LogRecord[]>;
}

async function fetchReminders(applicantId: string) {
  const response = await fetchWithAuth(
    `/api/tenant-reminders?module=applicant&refId=${applicantId}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load reminders");
  }
  return response.json() as Promise<ReminderRecord[]>;
}

async function fetchTasks() {
  const response = await fetchWithAuth("/api/tasks?module=followup");
  if (!response.ok) {
    throw new Error("Failed to load tasks");
  }
  return response.json() as Promise<TaskRecord[]>;
}

async function createLog(payload: {
  date?: string;
  type: LogType;
  customer: string;
  amount?: number;
  refId?: number;
  notes?: string;
}) {
  const response = await fetchWithAuth("/api/followup-log", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to create log entry");
  }
}

export default function ApplicantTimeline() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [logForm, setLogForm] = useState<LogFormState>(EMPTY_LOG_FORM);

  const applicantId = id ?? "";

  const {
    data: applicant,
    isLoading: isApplicantLoading,
    isError: isApplicantError,
  } = useQuery({
    queryKey: ["followup-applicant", applicantId],
    queryFn: () => fetchApplicant(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: unitSelections = [] } = useQuery({
    queryKey: ["followup-applicant", applicantId, "unit-selections"],
    queryFn: () => fetchUnitSelections(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: agreements = [] } = useQuery({
    queryKey: ["followup-applicant", applicantId, "agreements"],
    queryFn: () => fetchAgreements(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["followup-applicant", applicantId, "logs"],
    queryFn: () => fetchLogs(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: reminders = [] } = useQuery({
    queryKey: ["followup-applicant", applicantId, "reminders"],
    queryFn: () => fetchReminders(applicantId),
    enabled: Boolean(applicantId),
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["followup-applicant", applicantId, "tasks"],
    queryFn: fetchTasks,
    enabled: Boolean(applicantId),
  });

  const logMutation = useMutation({
    mutationFn: createLog,
    onSuccess: () => {
      toast.success("Log entry created");
      queryClient.invalidateQueries({
        queryKey: ["followup-applicant", applicantId, "logs"],
      });
      setLogForm(EMPTY_LOG_FORM);
      setIsAddingLog(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const timeline = useMemo<TimelineEvent[]>(() => {
    const applicantEvents: TimelineEvent[] = applicant
      ? [
          {
            id: `applicant-${applicant.Id}`,
            type: "applicant",
            date: applicant.CreatedAt || "",
            title: "Applicant created",
            description: applicant.Notes || undefined,
            sourceLabel: "Applicant profile",
            badgeClassName: "border-slate-300 bg-slate-500/10 text-slate-700",
          },
        ]
      : [];

    const unitEvents = unitSelections.map((selection) => ({
      id: `unit-${selection.Id}`,
      type: "unit" as const,
      date: selection.CreatedAt || selection.SelectionDate || "",
      title: `Unit selection ${selection.SelectionNo || selection.UnitNo || selection.Id}`,
      description: [
        selection.UnitNo,
        selection.UnitType,
        selection.ProjectName,
        selection.Status,
      ]
        .filter(Boolean)
        .join(" - "),
      sourceLabel: "Unit selections",
      badgeClassName: "border-emerald-300 bg-emerald-500/10 text-emerald-700",
    }));

    const agreementEvents = agreements.map((agreement) => ({
      id: `agreement-${agreement.Id}`,
      type: "agreement" as const,
      date: agreement.CreatedAt || agreement.AgreementDate || "",
      title: `Agreement ${agreement.AgreementNo || agreement.Id}`,
      description: [
        agreement.UnitNo || agreement.SelectionNo,
        formatMoney(agreement.AgreementValue),
        agreement.Status,
      ]
        .filter(Boolean)
        .join(" - "),
      sourceLabel: "Agreements",
      badgeClassName: "border-violet-300 bg-violet-500/10 text-violet-700",
    }));

    const logEvents = logs.map((entry) => ({
      id: `log-${entry.id}`,
      type: "log" as const,
      date: entry.createdAt || entry.date || "",
      title: `${entry.type.toUpperCase()} log`,
      description: [entry.customer, entry.notes, formatMoney(entry.amount)]
        .filter(Boolean)
        .join(" - "),
      sourceLabel: "Follow-up log",
      badgeClassName: "border-blue-300 bg-blue-500/10 text-blue-700",
    }));

    const reminderEvents = reminders.map((reminder) => ({
      id: `reminder-${reminder.id}`,
      type: "reminder" as const,
      date: reminder.CreatedAt || reminder.dueDate || "",
      title: `Reminder ${reminder.tenantName}`,
      description: [
        reminder.message,
        reminder.status,
        formatMoney(reminder.amountDue),
      ]
        .filter(Boolean)
        .join(" - "),
      sourceLabel: "Tenant reminders",
      badgeClassName: "border-amber-300 bg-amber-500/10 text-amber-700",
    }));

    return [
      ...applicantEvents,
      ...unitEvents,
      ...agreementEvents,
      ...logEvents,
      ...reminderEvents,
    ]
      .filter((event) => event.date)
      .sort((left, right) => {
        const rightTime = new Date(right.date).getTime();
        const leftTime = new Date(left.date).getTime();
        return (
          (Number.isNaN(rightTime) ? 0 : rightTime) -
          (Number.isNaN(leftTime) ? 0 : leftTime)
        );
      });
  }, [applicant, unitSelections, agreements, logs, reminders]);

  const applicantName = applicant?.ApplicantName || "Applicant";
  const applicantNo = applicant?.ApplicantNo || `APP${applicantId}`;
  const TypeIcon = getLogIcon(logForm.type);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/followup/sales/applications")}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <Badge className="border-slate-300 bg-slate-500/10 text-slate-700">
              Applicant timeline
            </Badge>
          </div>
          <div>
            <h1 className="text-3xl font-heading font-bold text-foreground">
              {applicantNo} - {applicantName}
            </h1>
            <p className="text-muted-foreground mt-1">
              Combined applicant, sales, communication, and reminder activity.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setIsAddingLog((current) => !current)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Quick log
          </Button>
          <Button
            onClick={() => {
              queryClient.invalidateQueries({
                queryKey: ["followup-applicant", applicantId],
              });
            }}
            className="gap-2"
          >
            <Calendar className="w-4 h-4" />
            Refresh context
          </Button>
        </div>
      </div>

      {isApplicantLoading ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading applicant timeline...
          </CardContent>
        </Card>
      ) : isApplicantError ? (
        <Card>
          <CardContent className="py-10 text-destructive">
            Failed to load applicant details.
          </CardContent>
        </Card>
      ) : applicant ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Status
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-3">
                <BadgeCheck className="w-5 h-5 text-primary" />
                <Badge variant="secondary">{applicant.Status || "-"}</Badge>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Project / Company
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="w-4 h-4 text-primary" />
                  {applicant.ProjectName || "-"}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Home className="w-4 h-4 text-primary" />
                  {applicant.CompanyName || "-"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Assigned / Source
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <UserRound className="w-4 h-4 text-primary" />
                  {applicant.AssignedToName || "-"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {applicant.Source || "-"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Budget / Preferred Unit
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-sm font-medium">
                  {formatMoney(applicant.BudgetAmount)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {applicant.PreferredUnitType || "-"}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Card className="xl:col-span-2">
              <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Activity timeline</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Newest entries first. Applicant-created record is included
                    at the bottom of the stream.
                  </p>
                </div>
                <Badge variant="outline">{timeline.length} events</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {timeline.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
                    No linked activity found yet.
                  </div>
                ) : (
                  timeline.map((event) => {
                    const Icon =
                      event.type === "applicant"
                        ? UserRound
                        : event.type === "unit"
                          ? Home
                          : event.type === "agreement"
                            ? BadgeCheck
                            : event.type === "reminder"
                              ? Bell
                              : MessageSquare;

                    return (
                      <div
                        key={event.id}
                        className="flex gap-4 rounded-lg border p-4"
                      >
                        <div
                          className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${event.badgeClassName}`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium">{event.title}</h3>
                            <Badge variant="outline" className="text-xs">
                              {event.sourceLabel}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {event.description || "-"}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {formatTimelineDate(event.date)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Applicant profile</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <div className="text-muted-foreground">Mobile</div>
                    <div>{applicant.PrimaryMobile || "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Email</div>
                    <div className="break-words">{applicant.Email || "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">City</div>
                    <div>{applicant.City || "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Created</div>
                    <div>{formatDateTime(applicant.CreatedAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Updated</div>
                    <div>{formatDateTime(applicant.UpdatedAt)}</div>
                  </div>
                  {applicant.Notes ? (
                    <div className="rounded-md border bg-muted/30 p-3 text-muted-foreground">
                      {applicant.Notes}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle>Quick log entry</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAddingLog((current) => !current)}
                  >
                    {isAddingLog ? "Hide" : "Open"}
                  </Button>
                </CardHeader>
                <CardContent>
                  {isAddingLog ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Date</Label>
                          <div className="relative">
                            <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                            <input
                              type="date"
                              value={logForm.date}
                              onChange={(event) => setLogForm((current) => ({ ...current, date: event.target.value }))}
                              className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Type</Label>
                          <Select
                            value={logForm.type}
                            onValueChange={(value) =>
                              setLogForm((current) => ({
                                ...current,
                                type: value as LogType,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="note">Note</SelectItem>
                              <SelectItem value="call">Call</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="sms">SMS</SelectItem>
                              <SelectItem value="payment">Payment</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Customer</Label>
                        <Input
                          value={logForm.customer}
                          onChange={(event) =>
                            setLogForm((current) => ({
                              ...current,
                              customer: event.target.value,
                            }))
                          }
                          placeholder={applicant.ApplicantName || "Applicant"}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Amount</Label>
                        <Input
                          value={logForm.amount}
                          onChange={(event) =>
                            setLogForm((current) => ({
                              ...current,
                              amount: event.target.value,
                            }))
                          }
                          placeholder="Optional amount"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Notes</Label>
                        <Textarea
                          value={logForm.notes}
                          onChange={(event) =>
                            setLogForm((current) => ({
                              ...current,
                              notes: event.target.value,
                            }))
                          }
                          placeholder="Meeting notes, call outcome, payment status..."
                        />
                      </div>

                      <Button
                        className="w-full gap-2"
                        disabled={
                          !logForm.customer.trim() || logMutation.isPending
                        }
                        onClick={() =>
                          logMutation.mutate({
                            date: logForm.date || undefined,
                            type: logForm.type,
                            customer: logForm.customer.trim(),
                            amount: logForm.amount
                              ? Number(logForm.amount)
                              : undefined,
                            refId: applicant.Id,
                            notes: logForm.notes.trim() || undefined,
                          })
                        }
                      >
                        <TypeIcon className="w-4 h-4" />
                        {logMutation.isPending ? "Saving..." : "Save log entry"}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Open this panel to add a communication entry linked to
                      this applicant.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Linked records</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div>
                    <div className="font-medium">Unit selections</div>
                    <div className="text-muted-foreground">
                      {unitSelections.length} records
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Agreements</div>
                    <div className="text-muted-foreground">
                      {agreements.length} records
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Reminders</div>
                    <div className="text-muted-foreground">
                      {reminders.length} records
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Tasks</div>
                    <div className="text-muted-foreground">
                      {tasks.length} follow-up module tasks
                    </div>
                  </div>
                  <Button variant="outline" asChild className="w-full">
                    <Link to="/followup/follow-ups/log">
                      Open follow-up log
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
