import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Edit,
  FileCheck2,
  Home,
  IndianRupee,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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

type Entity = "applicants" | "unit-selections" | "agreements";
type Option = Record<string, unknown> & { Id: number; Name?: string };
type RecordRow = Record<string, unknown> & { Id: number; Status?: string };
type FieldType = "text" | "number" | "date" | "textarea" | "select";

interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  optionKey?: string;
  optionLabel?: (option: Option) => string;
  readOnly?: boolean;
}

interface ColumnConfig {
  key: string;
  label: string;
  format?: (value: unknown, row: RecordRow) => string;
}

interface PageConfig {
  entity: Entity;
  title: string;
  description: string;
  apiPath: string;
  queryKey: string;
  createLabel: string;
  emptyText: string;
  icon: typeof UserRound;
  statusParam?: string;
  applicantParam?: string;
  fields: FieldConfig[];
  columns: ColumnConfig[];
  getInitialForm: () => Record<string, string>;
  normalizeRecord: (record: RecordRow) => Record<string, string>;
  buildPayload: (form: Record<string, string>) => Record<string, unknown>;
  syncForm?: (
    form: Record<string, string>,
    changedKey: string,
    options: OptionsBag,
  ) => Record<string, string>;
}

interface OptionsBag {
  applicants?: Option[];
  unitSelections?: Option[];
  projects?: Option[];
  companies?: Option[];
  users?: Option[];
  statusOptions?: string[];
}

const NONE = "__none";

function toStringValue(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function toNumberOrNull(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function money(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric !== 0
    ? `Rs ${numeric.toLocaleString("en-IN")}`
    : "-";
}

function dateText(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-IN");
}


function applicantLabel(option: Option) {
  return `${option.ApplicantName ?? option.Name ?? "Applicant"}${option.ApplicantNo ? ` (${option.ApplicantNo})` : ""}`;
}

function unitLabel(option: Option) {
  return `${option.SelectionNo ?? "Selection"}${option.UnitNo ? ` - ${option.UnitNo}` : ""}`;
}

async function fetchList(
  apiPath: string,
  search: string,
  status: string,
  page: number,
) {
  const params = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (search.trim()) params.set("search", search.trim());
  if (status !== "all") params.set("status", status);

  const response = await fetchWithAuth(`${apiPath}?${params.toString()}`);
  if (!response.ok) throw new Error("Failed to load records");
  return response.json().catch(() => ({})) as Promise<{
    data: RecordRow[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }>;
}

async function fetchOptions(apiPath: string) {
  const response = await fetchWithAuth(`${apiPath}/meta/options`);
  if (!response.ok) throw new Error("Failed to load form options");
  return response.json().catch(() => ({})) as Promise<OptionsBag>;
}

async function saveRecord(
  apiPath: string,
  payload: Record<string, unknown>,
  id?: number,
) {
  const response = await fetchWithAuth(id ? `${apiPath}/${id}` : apiPath, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to save record");
  }
}

async function deleteRecord(apiPath: string, id: number) {
  const response = await fetchWithAuth(`${apiPath}/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to delete record");
  }
}

const configs: Record<Entity, PageConfig> = {
  applicants: {
    entity: "applicants",
    title: "Applicants",
    description:
      "Sales enquiries, project interest, ownership, and qualification status.",
    apiPath: "/api/followup-applications",
    queryKey: "followup-applications",
    createLabel: "New Applicant",
    emptyText: "No applicants found.",
    icon: UserRound,
    fields: [
      {
        key: "ApplicantName",
        label: "Applicant Name",
        type: "text",
        required: true,
      },
      { key: "PrimaryMobile", label: "Mobile", type: "text" },
      { key: "Email", label: "Email", type: "text" },
      { key: "City", label: "City", type: "text" },
      { key: "Source", label: "Source", type: "text" },
      {
        key: "ProjectId",
        label: "Project",
        type: "select",
        optionKey: "projects",
      },
      {
        key: "CompanyId",
        label: "Company",
        type: "select",
        optionKey: "companies",
      },
      { key: "PreferredUnitType", label: "Preferred Unit", type: "text" },
      { key: "BudgetAmount", label: "Budget", type: "number" },
      {
        key: "AssignedTo",
        label: "Assigned To",
        type: "select",
        optionKey: "users",
      },
      {
        key: "Status",
        label: "Status",
        type: "select",
        optionKey: "statusOptions",
      },
      { key: "Notes", label: "Notes", type: "textarea" },
    ],
    columns: [
      { key: "ApplicantNo", label: "No." },
      { key: "ApplicantName", label: "Applicant" },
      { key: "PrimaryMobile", label: "Mobile" },
      { key: "ProjectName", label: "Project" },
      { key: "BudgetAmount", label: "Budget", format: money },
      { key: "Status", label: "Status" },
    ],
    getInitialForm: () => ({
      ApplicantName: "",
      PrimaryMobile: "",
      Email: "",
      City: "",
      Source: "",
      ProjectId: "",
      CompanyId: "",
      PreferredUnitType: "",
      BudgetAmount: "",
      AssignedTo: "",
      Status: "New",
      Notes: "",
    }),
    normalizeRecord: (record) => ({
      ApplicantName: toStringValue(record.ApplicantName),
      PrimaryMobile: toStringValue(record.PrimaryMobile),
      Email: toStringValue(record.Email),
      City: toStringValue(record.City),
      Source: toStringValue(record.Source),
      ProjectId: toStringValue(record.ProjectId),
      CompanyId: toStringValue(record.CompanyId),
      PreferredUnitType: toStringValue(record.PreferredUnitType),
      BudgetAmount: toStringValue(record.BudgetAmount),
      AssignedTo: toStringValue(record.AssignedTo),
      Status: toStringValue(record.Status || "New"),
      Notes: toStringValue(record.Notes),
    }),
    buildPayload: (form) => ({
      ...form,
      ProjectId: toNumberOrNull(form.ProjectId),
      CompanyId: toNumberOrNull(form.CompanyId),
      BudgetAmount: toNumberOrNull(form.BudgetAmount),
      AssignedTo: toNumberOrNull(form.AssignedTo),
    }),
  },
  "unit-selections": {
    entity: "unit-selections",
    title: "Unit Selection",
    description: "Reserve, negotiate, and confirm units against applicants.",
    apiPath: "/api/followup-unit-selections",
    queryKey: "followup-unit-selections",
    createLabel: "New Selection",
    emptyText: "No unit selections found.",
    icon: Home,
    fields: [
      {
        key: "ApplicantId",
        label: "Applicant",
        type: "select",
        required: true,
        optionKey: "applicants",
        optionLabel: applicantLabel,
      },
      {
        key: "ProjectId",
        label: "Project",
        type: "select",
        optionKey: "projects",
      },
      {
        key: "CompanyId",
        label: "Company",
        type: "select",
        optionKey: "companies",
      },
      { key: "UnitNo", label: "Unit No.", type: "text", required: true },
      { key: "BlockName", label: "Block", type: "text" },
      { key: "FloorName", label: "Floor", type: "text" },
      { key: "UnitType", label: "Unit Type", type: "text" },
      { key: "AreaSqFt", label: "Area Sq.Ft.", type: "number" },
      { key: "RatePerSqFt", label: "Rate / Sq.Ft.", type: "number" },
      { key: "TotalValue", label: "Total Value", type: "number" },
      { key: "BookingAmount", label: "Booking Amount", type: "number" },
      { key: "SelectionDate", label: "Selection Date", type: "date" },
      {
        key: "Status",
        label: "Status",
        type: "select",
        optionKey: "statusOptions",
      },
      { key: "Notes", label: "Notes", type: "textarea" },
    ],
    columns: [
      { key: "SelectionNo", label: "No." },
      { key: "ApplicantName", label: "Applicant" },
      { key: "UnitNo", label: "Unit" },
      { key: "ProjectName", label: "Project" },
      { key: "TotalValue", label: "Value", format: money },
      { key: "Status", label: "Status" },
    ],
    getInitialForm: () => ({
      ApplicantId: "",
      ProjectId: "",
      CompanyId: "",
      UnitNo: "",
      BlockName: "",
      FloorName: "",
      UnitType: "",
      AreaSqFt: "",
      RatePerSqFt: "",
      TotalValue: "",
      BookingAmount: "",
      SelectionDate: new Date().toISOString().slice(0, 10),
      Status: "Reserved",
      Notes: "",
    }),
    normalizeRecord: (record) => ({
      ApplicantId: toStringValue(record.ApplicantId),
      ProjectId: toStringValue(record.ProjectId),
      CompanyId: toStringValue(record.CompanyId),
      UnitNo: toStringValue(record.UnitNo),
      BlockName: toStringValue(record.BlockName),
      FloorName: toStringValue(record.FloorName),
      UnitType: toStringValue(record.UnitType),
      AreaSqFt: toStringValue(record.AreaSqFt),
      RatePerSqFt: toStringValue(record.RatePerSqFt),
      TotalValue: toStringValue(record.TotalValue),
      BookingAmount: toStringValue(record.BookingAmount),
      SelectionDate: toStringValue(record.SelectionDate),
      Status: toStringValue(record.Status || "Reserved"),
      Notes: toStringValue(record.Notes),
    }),
    buildPayload: (form) => ({
      ...form,
      ApplicantId: toNumberOrNull(form.ApplicantId),
      ProjectId: toNumberOrNull(form.ProjectId),
      CompanyId: toNumberOrNull(form.CompanyId),
      AreaSqFt: toNumberOrNull(form.AreaSqFt),
      RatePerSqFt: toNumberOrNull(form.RatePerSqFt),
      TotalValue: toNumberOrNull(form.TotalValue),
      BookingAmount: toNumberOrNull(form.BookingAmount),
    }),
    syncForm: (form, changedKey, options) => {
      if (changedKey !== "ApplicantId") return form;
      const applicant = options.applicants?.find(
        (item) => String(item.Id) === form.ApplicantId,
      );
      return {
        ...form,
        ProjectId: toStringValue(applicant?.ProjectId),
        CompanyId: toStringValue(applicant?.CompanyId),
      };
    },
  },
  agreements: {
    entity: "agreements",
    title: "Agreements",
    description:
      "Agreement values, advances, balances, registration dates, and status.",
    apiPath: "/api/followup-agreements",
    queryKey: "followup-agreements",
    createLabel: "New Agreement",
    emptyText: "No agreements found.",
    icon: FileCheck2,
    fields: [
      {
        key: "ApplicantId",
        label: "Applicant",
        type: "select",
        required: true,
        optionKey: "applicants",
        optionLabel: applicantLabel,
      },
      {
        key: "UnitSelectionId",
        label: "Unit Selection",
        type: "select",
        optionKey: "unitSelections",
        optionLabel: unitLabel,
      },
      {
        key: "ProjectId",
        label: "Project",
        type: "select",
        optionKey: "projects",
      },
      {
        key: "CompanyId",
        label: "Company",
        type: "select",
        optionKey: "companies",
      },
      { key: "AgreementDate", label: "Agreement Date", type: "date" },
      { key: "AgreementValue", label: "Agreement Value", type: "number" },
      { key: "AdvanceAmount", label: "Advance", type: "number" },
      { key: "RegistrationDate", label: "Registration Date", type: "date" },
      {
        key: "Status",
        label: "Status",
        type: "select",
        optionKey: "statusOptions",
      },
      { key: "Notes", label: "Notes", type: "textarea" },
    ],
    columns: [
      { key: "AgreementNo", label: "No." },
      { key: "ApplicantName", label: "Applicant" },
      { key: "UnitNo", label: "Unit" },
      { key: "AgreementValue", label: "Value", format: money },
      { key: "AgreementDate", label: "Date", format: dateText },
      { key: "Status", label: "Status" },
    ],
    getInitialForm: () => ({
      ApplicantId: "",
      UnitSelectionId: "",
      ProjectId: "",
      CompanyId: "",
      AgreementDate: new Date().toISOString().slice(0, 10),
      AgreementValue: "",
      AdvanceAmount: "",
      RegistrationDate: "",
      Status: "Draft",
      Notes: "",
    }),
    normalizeRecord: (record) => ({
      ApplicantId: toStringValue(record.ApplicantId),
      UnitSelectionId: toStringValue(record.UnitSelectionId),
      ProjectId: toStringValue(record.ProjectId),
      CompanyId: toStringValue(record.CompanyId),
      AgreementDate: toStringValue(record.AgreementDate),
      AgreementValue: toStringValue(record.AgreementValue),
      AdvanceAmount: toStringValue(record.AdvanceAmount),
      RegistrationDate: toStringValue(record.RegistrationDate),
      Status: toStringValue(record.Status || "Draft"),
      Notes: toStringValue(record.Notes),
    }),
    buildPayload: (form) => ({
      ...form,
      ApplicantId: toNumberOrNull(form.ApplicantId),
      UnitSelectionId: toNumberOrNull(form.UnitSelectionId),
      ProjectId: toNumberOrNull(form.ProjectId),
      CompanyId: toNumberOrNull(form.CompanyId),
      AgreementValue: toNumberOrNull(form.AgreementValue),
      AdvanceAmount: toNumberOrNull(form.AdvanceAmount),
    }),
    syncForm: (form, changedKey, options) => {
      if (changedKey === "ApplicantId") {
        const applicant = options.applicants?.find(
          (item) => String(item.Id) === form.ApplicantId,
        );
        return {
          ...form,
          UnitSelectionId: "",
          ProjectId: toStringValue(applicant?.ProjectId),
          CompanyId: toStringValue(applicant?.CompanyId),
        };
      }
      if (changedKey === "UnitSelectionId") {
        const unit = options.unitSelections?.find(
          (item) => String(item.Id) === form.UnitSelectionId,
        );
        return {
          ...form,
          ApplicantId: toStringValue(unit?.ApplicantId || form.ApplicantId),
          ProjectId: toStringValue(unit?.ProjectId || form.ProjectId),
          CompanyId: toStringValue(unit?.CompanyId || form.CompanyId),
        };
      }
      return form;
    },
  },
};

function fieldOptions(
  field: FieldConfig,
  options: OptionsBag,
  form: Record<string, string>,
) {
  if (!field.optionKey) return [];
  const rawOptions = options[field.optionKey as keyof OptionsBag] ?? [];
  if (field.optionKey === "unitSelections" && form.ApplicantId) {
    return (rawOptions as Option[]).filter(
      (option) => String(option.ApplicantId) === form.ApplicantId,
    );
  }
  return rawOptions as Option[] | string[];
}

function FollowupPipelinePage({ entity }: { entity: Entity }) {
  const config = configs[entity];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const Icon = config.icon;

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [form, setForm] = useState(config.getInitialForm());
  const [isOpen, setIsOpen] = useState(false);

  const { data: options = {}, isError: optionsError } = useQuery({
    queryKey: [config.queryKey, "options"],
    queryFn: () => fetchOptions(config.apiPath),
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: [config.queryKey, search, status, page],
    queryFn: () => fetchList(config.apiPath, search, status, page),
  });

  const records = data?.data ?? [];
  const pagination = data?.pagination;
  const statusOptions = options.statusOptions ?? [];

  const summary = useMemo(() => {
    const amountKeys = ["BudgetAmount", "TotalValue", "AgreementValue"];
    const amountKey = amountKeys.find((key) =>
      records.some((record) => record[key] !== undefined),
    );
    const totalValue = amountKey
      ? records.reduce(
          (sum, record) => sum + (Number(record[amountKey]) || 0),
          0,
        )
      : 0;

    return {
      total: pagination?.total ?? records.length,
      visible: records.length,
      totalValue,
    };
  }, [pagination?.total, records]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveRecord(config.apiPath, config.buildPayload(form), editing?.Id),
    onSuccess: () => {
      toast.success(editing ? "Record updated" : "Record created");
      queryClient.invalidateQueries({ queryKey: [config.queryKey] });
      setIsOpen(false);
      setEditing(null);
      setForm(config.getInitialForm());
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRecord(config.apiPath, id),
    onSuccess: () => {
      toast.success("Record deleted");
      queryClient.invalidateQueries({ queryKey: [config.queryKey] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(config.getInitialForm());
    setIsOpen(true);
  };

  const openEdit = (record: RecordRow) => {
    setEditing(record);
    setForm(config.normalizeRecord(record));
    setIsOpen(true);
  };

  const updateForm = (key: string, value: string) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      return config.syncForm ? config.syncForm(next, key, options) : next;
    });
  };

  const renderField = (field: FieldConfig) => {
    const value = form[field.key] ?? "";
    const commonId = `${entity}-${field.key}`;
    if (field.type === "textarea") {
      return (
        <div className="md:col-span-2 space-y-2" key={field.key}>
          <Label htmlFor={commonId}>{field.label}</Label>
          <Textarea
            id={commonId}
            value={value}
            onChange={(event) => updateForm(field.key, event.target.value)}
          />
        </div>
      );
    }

    if (field.type === "select") {
      const optionsForField = fieldOptions(field, options, form);
      return (
        <div className="space-y-2" key={field.key}>
          <Label>{field.label}</Label>
          <Select
            value={value || NONE}
            onValueChange={(next) =>
              updateForm(field.key, next === NONE ? "" : next)
            }
          >
            <SelectTrigger>
              <SelectValue
                placeholder={`Select ${field.label.toLowerCase()}`}
              />
            </SelectTrigger>
            <SelectContent>
              {!field.required && <SelectItem value={NONE}>None</SelectItem>}
              {optionsForField.map((option) => {
                if (typeof option === "string") {
                  return (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  );
                }
                return (
                  <SelectItem key={option.Id} value={String(option.Id)}>
                    {field.optionLabel
                      ? field.optionLabel(option)
                      : option.Name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      );
    }

    return (
      <div className="space-y-2" key={field.key}>
        <Label htmlFor={commonId}>{field.label}</Label>
        <Input
          id={commonId}
          type={field.type}
          value={value}
          onChange={(event) => updateForm(field.key, event.target.value)}
          required={field.required}
        />
      </div>
    );
  };

  return (
    <FollowupShell
      title={config.title}
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
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" />
            {config.createLabel}
          </Button>
        </div>
      }
    >

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Records
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Icon className="w-5 h-5 text-primary" />
            <span className="text-2xl font-bold">{summary.total}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Visible Now
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-primary" />
            <span className="text-2xl font-bold">{summary.visible}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Visible Value
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <IndianRupee className="w-5 h-5 text-primary" />
            <span className="text-2xl font-bold">
              {summary.totalValue.toLocaleString("en-IN")}
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle>{config.title}</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search records"
                className="pl-9 sm:w-64"
              />
            </div>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="sm:w-48">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statusOptions.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {(isError || optionsError) && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Unable to load followup data.
            </div>
          )}
          <div className="overflow-x-auto thin-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  {config.columns.map((column) => (
                    <TableHead key={column.key}>{column.label}</TableHead>
                  ))}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={config.columns.length + 1}
                      className="text-center text-muted-foreground"
                    >
                      Loading...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  records.map((record) => (
                    <TableRow key={record.Id}>
                      {config.columns.map((column) => (
                        <TableCell key={column.key}>
                          {config.entity === "applicants" &&
                          column.key === "ApplicantName" ? (
                            <Link
                              to={`/followup/sales/applications/${record.Id}`}
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {toStringValue(record[column.key] || "-")}
                            </Link>
                          ) : column.key === "Status" ? (
                            <Badge variant="secondary">
                              {toStringValue(record.Status || "-")}
                            </Badge>
                          ) : (
                            (column.format?.(record[column.key], record) ??
                            toStringValue(record[column.key] || "-"))
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(record)}
                          aria-label="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(record.Id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading && records.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={config.columns.length + 1}
                      className="text-center text-muted-foreground"
                    >
                      {config.emptyText}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-muted-foreground">
              Page {pagination?.page ?? 1} of {pagination?.totalPages || 1}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={page >= (pagination?.totalPages || 1)}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${config.title}` : config.createLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            {config.fields.map(renderField)}
            {entity === "agreements" && (
              <div className="space-y-2">
                <Label>Balance</Label>
                <Input
                  value={String(
                    (Number(form.AgreementValue) || 0) -
                      (Number(form.AdvanceAmount) || 0),
                  )}
                  readOnly
                />
              </div>
            )}
            {entity === "unit-selections" && (
              <div className="space-y-2">
                <Label>Computed Value</Label>
                <Input
                  value={String(
                    (Number(form.AreaSqFt) || 0) *
                      (Number(form.RatePerSqFt) || 0),
                  )}
                  readOnly
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FollowupShell>
  );
}

export function ApplicantsPage() {
  return <FollowupPipelinePage entity="applicants" />;
}

export function UnitSelectionPage() {
  return <FollowupPipelinePage entity="unit-selections" />;
}

export function AgreementsPage() {
  return <FollowupPipelinePage entity="agreements" />;
}

export default FollowupPipelinePage;
