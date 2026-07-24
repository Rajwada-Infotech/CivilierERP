import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  FileText,
  IndianRupee,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type LogType = "email" | "call" | "sms" | "note" | "payment";

interface LogRecord {
  id: string;
  date: string;
  type: LogType;
  module?: string;
  customer: string;
  amount: number | null;
  refId: number | null;
  notes: string;
  user: string;
  createdAt: string;
}

interface ApplicantRecord {
  Id: number;
  ApplicantNo?: string | null;
  ApplicantName?: string | null;
  ProjectName?: string | null;
  CompanyName?: string | null;
  Status?: string | null;
  BudgetAmount?: number | null;
  AssignedToName?: string | null;
}

interface AgreementRecord {
  Id: number;
  AgreementNo?: string | null;
  ApplicantName?: string | null;
  UnitNo?: string | null;
  ProjectName?: string | null;
  AgreementValue?: number | null;
  Status?: string | null;
  AgreementDate?: string | null;
}

interface UnitSelectionRecord {
  Id: number;
  SelectionNo?: string | null;
  ApplicantName?: string | null;
  UnitNo?: string | null;
  ProjectName?: string | null;
  Status?: string | null;
  TotalValue?: number | null;
}

interface FollowupLogFormState {
  date: string;
  type: LogType;
  customer: string;
  amount: string;
  notes: string;
}

const EMPTY_FORM: FollowupLogFormState = {
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

function formatMoney(value?: number | null) {
  return typeof value === "number"
    ? `Rs ${value.toLocaleString("en-IN")}`
    : "-";
}

function getTypeLabel(type: LogType) {
  switch (type) {
    case "email":
      return "Email";
    case "call":
      return "Call";
    case "sms":
      return "SMS";
    case "payment":
      return "Payment";
    default:
      return "Note";
  }
}

async function fetchLogs(moduleName: string) {
  const response = await fetchWithAuth(
    `/api/followup-log?module=${encodeURIComponent(moduleName)}`,
  );
  if (!response.ok) throw new Error("Failed to load follow-up records");
  return response.json().catch(() => ({})) as Promise<LogRecord[]>;
}

async function createLog(payload: {
  date?: string;
  type: LogType;
  module: string;
  customer: string;
  amount?: number;
  notes?: string;
}) {
  const response = await fetchWithAuth("/api/followup-log", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to create record");
  }
}

async function fetchApplicants() {
  const response = await fetchWithAuth(
    "/api/followup-applications?page=1&pageSize=50",
  );
  if (!response.ok) throw new Error("Failed to load applicants");
  return response.json().catch(() => ({})) as Promise<{
    data: ApplicantRecord[];
    pagination: { total: number };
  }>;
}

async function fetchAgreements() {
  const response = await fetchWithAuth(
    "/api/followup-agreements?page=1&pageSize=50",
  );
  if (!response.ok) throw new Error("Failed to load agreements");
  return response.json().catch(() => ({})) as Promise<{
    data: AgreementRecord[];
    pagination: { total: number };
  }>;
}

async function fetchUnitSelections() {
  const response = await fetchWithAuth(
    "/api/followup-unit-selections?page=1&pageSize=50",
  );
  if (!response.ok) throw new Error("Failed to load unit selections");
  return response.json().catch(() => ({})) as Promise<{
    data: UnitSelectionRecord[];
    pagination: { total: number };
  }>;
}

function ScopedLogPage({
  title,
  description,
  moduleName,
  defaultType = "note",
  helpText,
}: {
  title: string;
  description: string;
  moduleName: string;
  defaultType?: LogType;
  helpText: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<FollowupLogFormState>({
    ...EMPTY_FORM,
    type: defaultType,
  });

  const {
    data: logs = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["followup-log", moduleName],
    queryFn: () => fetchLogs(moduleName),
  });

  const createMutation = useMutation({
    mutationFn: createLog,
    onSuccess: () => {
      toast.success("Record created");
      queryClient.invalidateQueries({ queryKey: ["followup-log", moduleName] });
      setForm({ ...EMPTY_FORM, type: defaultType });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const filteredLogs = logs.filter((entry) => {
    const haystack = [entry.customer, entry.notes, entry.user, entry.type]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  const countByType = useMemo(() => {
    return logs.reduce<Record<LogType, number>>(
      (acc, item) => {
        acc[item.type] += 1;
        return acc;
      },
      { email: 0, call: 0, sms: 0, note: 0, payment: 0 },
    );
  }, [logs]);

  const totalAmount = logs.reduce(
    (sum, entry) => sum + (Number(entry.amount) || 0),
    0,
  );

  return (
    <FollowupShell
      title={title}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/followup")}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Button>
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Entry
          </Button>
        </div>
      }
    >

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <div>
              <div className="text-2xl font-bold">{logs.length}</div>
              <div className="text-sm text-muted-foreground">Records</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <IndianRupee className="w-5 h-5 text-amber-600" />
            <div>
              <div className="text-2xl font-bold">
                {totalAmount.toLocaleString("en-IN")}
              </div>
              <div className="text-sm text-muted-foreground">Visible value</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <BadgeCheck className="w-5 h-5 text-emerald-600" />
            <div>
              <div className="text-2xl font-bold">{countByType.note}</div>
              <div className="text-sm text-muted-foreground">Notes</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{title} Log</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{helpText}</p>
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search records"
            className="sm:w-72"
          />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto thin-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Loading records...
                    </TableCell>
                  </TableRow>
                )}
                {isError && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-destructive"
                    >
                      Failed to load records.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !isError && filteredLogs.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No records found.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  !isError &&
                  filteredLogs.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-sm">
                        {formatDate(entry.date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {getTypeLabel(entry.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {entry.customer}
                      </TableCell>
                      <TableCell>{formatMoney(entry.amount)}</TableCell>
                      <TableCell>{entry.user || "-"}</TableCell>
                      <TableCell className="max-w-md">
                        <span className="text-sm line-clamp-2">
                          {entry.notes || "-"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New {title} Entry</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm((current) => ({
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
                value={form.customer}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    customer: event.target.value,
                  }))
                }
                placeholder="Customer / applicant / unit"
              />
            </div>

            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                value={form.amount}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="Activity notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  date: form.date || undefined,
                  type: form.type,
                  module: moduleName,
                  customer: form.customer.trim(),
                  amount: form.amount ? Number(form.amount) : undefined,
                  notes: form.notes.trim() || undefined,
                })
              }
              disabled={!form.customer.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Saving..." : "Save Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FollowupShell>
  );
}

function ReportPage({
  title,
  description,
  kind,
}: {
  title: string;
  description: string;
  kind: "customer" | "financial" | "project";
}) {
  const navigate = useNavigate();
  const { data: applicantsPage } = useQuery({
    queryKey: ["followup-report", "applicants"],
    queryFn: fetchApplicants,
  });
  const { data: agreementsPage } = useQuery({
    queryKey: ["followup-report", "agreements"],
    queryFn: fetchAgreements,
  });
  const { data: unitSelectionsPage } = useQuery({
    queryKey: ["followup-report", "unit-selections"],
    queryFn: fetchUnitSelections,
  });

  const applicantRows = applicantsPage?.data ?? [];
  const agreementRows = agreementsPage?.data ?? [];
  const unitRows = unitSelectionsPage?.data ?? [];

  const stats = useMemo(() => {
    const applicantCount = applicantsPage?.pagination.total ?? 0;
    const agreementCount = agreementsPage?.pagination.total ?? 0;
    const selectionCount = unitSelectionsPage?.pagination.total ?? 0;
    const agreementValue = agreementRows.reduce(
      (sum, item) => sum + (Number(item.AgreementValue) || 0),
      0,
    );
    return { applicantCount, agreementCount, selectionCount, agreementValue };
  }, [
    applicantsPage?.pagination.total,
    agreementsPage?.pagination.total,
    unitSelectionsPage?.pagination.total,
    agreementRows,
  ]);

  const customerRows = applicantRows.slice(0, 8);
  const financialRows = agreementRows.slice(0, 8);
  const projectRows = unitRows.slice(0, 8);

  return (
    <FollowupShell
      title={title}
      action={
        <Button
          variant="outline"
          onClick={() => navigate("/followup")}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Button>
      }
    >

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold">{stats.applicantCount}</div>
            <div className="text-sm text-muted-foreground">Applicants</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold">{stats.selectionCount}</div>
            <div className="text-sm text-muted-foreground">Unit selections</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold">{stats.agreementCount}</div>
            <div className="text-sm text-muted-foreground">Agreements</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-2xl font-bold">
              {stats.agreementValue.toLocaleString("en-IN")}
            </div>
            <div className="text-sm text-muted-foreground">Agreement value</div>
          </CardContent>
        </Card>
      </div>

      {kind === "customer" && (
        <Card>
          <CardHeader>
            <CardTitle>Customer pipeline</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto thin-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerRows.map((row) => (
                  <TableRow key={row.Id}>
                    <TableCell className="font-medium">
                      {row.ApplicantName || row.ApplicantNo || "-"}
                    </TableCell>
                    <TableCell>{row.ProjectName || "-"}</TableCell>
                    <TableCell>{row.Status || "-"}</TableCell>
                    <TableCell>{formatMoney(row.BudgetAmount)}</TableCell>
                    <TableCell>{row.AssignedToName || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {kind === "financial" && (
        <Card>
          <CardHeader>
            <CardTitle>Financial follow-up</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto thin-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agreement</TableHead>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {financialRows.map((row) => (
                  <TableRow key={row.Id}>
                    <TableCell className="font-medium">
                      {row.AgreementNo || "-"}
                    </TableCell>
                    <TableCell>{row.ApplicantName || "-"}</TableCell>
                    <TableCell>{row.UnitNo || "-"}</TableCell>
                    <TableCell>{formatDate(row.AgreementDate)}</TableCell>
                    <TableCell>{formatMoney(row.AgreementValue)}</TableCell>
                    <TableCell>{row.Status || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {kind === "project" && (
        <Card>
          <CardHeader>
            <CardTitle>Project status</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto thin-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Selection</TableHead>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projectRows.map((row) => (
                  <TableRow key={row.Id}>
                    <TableCell className="font-medium">
                      {row.SelectionNo || "-"}
                    </TableCell>
                    <TableCell>{row.ApplicantName || "-"}</TableCell>
                    <TableCell>{row.UnitNo || "-"}</TableCell>
                    <TableCell>{row.ProjectName || "-"}</TableCell>
                    <TableCell>{row.Status || "-"}</TableCell>
                    <TableCell>{formatMoney(row.TotalValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </FollowupShell>
  );
}

export { WelcomeCallsPage } from "./WelcomeCalls";

export function NocPage() {
  return (
    <ScopedLogPage
      title="NOC"
      description="Monitor no-objection certificate updates and pending closures."
      moduleName="closure_noc"
      defaultType="note"
      helpText="Use notes to track certificate requests, approvals, and handoffs."
    />
  );
}

export function SalesDeedPage() {
  return (
    <ScopedLogPage
      title="Sales Deed"
      description="Log deed preparation, execution, and document coordination."
      moduleName="closure_sales_deed"
      defaultType="note"
      helpText="Use this page as the closure checklist for deed processing."
    />
  );
}

export { HandoverPage } from "./Handover";

export function ConstructionUpdatesPage() {
  return (
    <ScopedLogPage
      title="Construction Updates"
      description="Record project progress updates for applicants and owners."
      moduleName="construction_updates"
      defaultType="note"
      helpText="This page is the living construction update register."
    />
  );
}

export function CustomerReportPage() {
  return (
    <ReportPage
      title="Customer Report"
      description="A quick customer-side summary of pipeline health."
      kind="customer"
    />
  );
}

export function FinancialReportPage() {
  return (
    <ReportPage
      title="Financial Report"
      description="A simple financial snapshot of agreements and pipeline value."
      kind="financial"
    />
  );
}

export function ProjectStatusReportPage() {
  return (
    <ReportPage
      title="Project Status Report"
      description="A project-wise view of selection progress and closure status."
      kind="project"
    />
  );
}

export default ScopedLogPage;
