import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  Edit2,
  Home,
  IndianRupee,
  Layers,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UnitSelection {
  Id: number;
  SelectionNo: string | null;
  ApplicantId: number;
  ApplicantNo: string | null;
  ApplicantName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  UnitNo: string;
  BlockName: string | null;
  FloorName: string | null;
  UnitType: string | null;
  AreaSqFt: number | null;
  RatePerSqFt: number | null;
  TotalValue: number | null;
  BookingAmount: number | null;
  SelectionDate: string | null;
  Status: string;
  Notes: string | null;
}

interface OptionItem {
  Id: number;
  Name?: string;
  ApplicantNo?: string;
  ApplicantName?: string;
}

interface Options {
  applicants: OptionItem[];
  projects: OptionItem[];
  companies: OptionItem[];
  statusOptions: string[];
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type FormState = {
  ApplicantId: string;
  ProjectId: string;
  CompanyId: string;
  UnitNo: string;
  BlockName: string;
  FloorName: string;
  UnitType: string;
  AreaSqFt: string;
  RatePerSqFt: string;
  TotalValue: string;
  BookingAmount: string;
  SelectionDate: string;
  Status: string;
  Notes: string;
};

const EMPTY_FORM: FormState = {
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
};

const NONE = "__none__";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; dot: string }> = {
  Reserved: {
    color: "bg-amber-500/15 text-amber-600 border border-amber-400/30",
    dot: "bg-amber-500",
  },
  Negotiation: {
    color: "bg-blue-500/15 text-blue-600 border border-blue-400/30",
    dot: "bg-blue-500",
  },
  Confirmed: {
    color: "bg-emerald-500/15 text-emerald-600 border border-emerald-400/30",
    dot: "bg-emerald-500",
  },
  Released: {
    color: "bg-muted text-muted-foreground border border-border",
    dot: "bg-muted-foreground",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    color: "bg-muted text-muted-foreground border border-border",
    dot: "bg-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function money(v: number | null | undefined) {
  if (!v && v !== 0) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}

function dateStr(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function computedValue(form: FormState) {
  const area = parseFloat(form.AreaSqFt);
  const rate = parseFloat(form.RatePerSqFt);
  if (isFinite(area) && isFinite(rate)) return area * rate;
  return null;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchOptions(): Promise<Options> {
  const res = await fetchWithAuth("/api/followup-unit-selections/meta/options");
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

async function fetchSelections(search: string, status: string, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (search.trim()) params.set("search", search.trim());
  if (status !== "all") params.set("status", status);
  const res = await fetchWithAuth(`/api/followup-unit-selections?${params}`);
  if (!res.ok) throw new Error("Failed to load unit selections");
  return res.json() as Promise<{
    data: UnitSelection[];
    pagination: Pagination;
  }>;
}

async function saveSelection(form: FormState, id?: number) {
  const payload = {
    ApplicantId: form.ApplicantId || null,
    ProjectId: form.ProjectId || null,
    CompanyId: form.CompanyId || null,
    UnitNo: form.UnitNo,
    BlockName: form.BlockName || null,
    FloorName: form.FloorName || null,
    UnitType: form.UnitType || null,
    AreaSqFt: form.AreaSqFt || null,
    RatePerSqFt: form.RatePerSqFt || null,
    TotalValue: form.TotalValue || computedValue(form) || null,
    BookingAmount: form.BookingAmount || null,
    SelectionDate: form.SelectionDate || null,
    Status: form.Status,
    Notes: form.Notes || null,
  };
  const res = await fetchWithAuth(
    id
      ? `/api/followup-unit-selections/${id}`
      : "/api/followup-unit-selections",
    { method: id ? "PUT" : "POST", body: JSON.stringify(payload) },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to save");
  }
}

async function deleteSelection(id: number) {
  const res = await fetchWithAuth(`/api/followup-unit-selections/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to delete");
  }
}

// ─── Unit Card ────────────────────────────────────────────────────────────────

function UnitCard({
  record,
  onEdit,
  onDelete,
  canDelete,
}: {
  record: UnitSelection;
  onEdit: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const computed = computedValue({
    AreaSqFt: String(record.AreaSqFt ?? ""),
    RatePerSqFt: String(record.RatePerSqFt ?? ""),
  } as FormState);

  return (
    <div className="group relative bg-card border border-border rounded-2xl p-5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Home className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-foreground text-base">
                Unit {record.UnitNo}
              </span>
              {record.SelectionNo && (
                <span className="text-xs text-muted-foreground font-mono">
                  #{record.SelectionNo}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground flex-wrap">
              {record.BlockName && <span>{record.BlockName}</span>}
              {record.BlockName && record.FloorName && <span>·</span>}
              {record.FloorName && <span>{record.FloorName}</span>}
              {record.UnitType && (
                <>
                  {(record.BlockName || record.FloorName) && <span>·</span>}
                  <span>{record.UnitType}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <StatusBadge status={record.Status} />
      </div>

      {/* Applicant + Project */}
      <div className="space-y-1.5 mb-4">
        {record.ApplicantName && (
          <div className="flex items-center gap-2 text-sm">
            <span className="w-4 h-4 text-muted-foreground flex-shrink-0">
              👤
            </span>
            <span className="text-foreground font-medium truncate">
              {record.ApplicantName}
            </span>
            {record.ApplicantNo && (
              <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
                ({record.ApplicantNo})
              </span>
            )}
          </div>
        )}
        {record.ProjectName && (
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-foreground/80 truncate">
              {record.ProjectName}
            </span>
          </div>
        )}
        {record.SelectionDate && (
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-foreground/80">
              {dateStr(record.SelectionDate)}
            </span>
          </div>
        )}
      </div>

      {/* Financials */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-muted rounded-xl p-3 text-center">
          <div className="text-xs text-muted-foreground mb-0.5">Area</div>
          <div className="font-semibold text-foreground text-sm">
            {record.AreaSqFt
              ? `${Number(record.AreaSqFt).toLocaleString("en-IN")} ft²`
              : "—"}
          </div>
        </div>
        <div className="bg-muted rounded-xl p-3 text-center">
          <div className="text-xs text-muted-foreground mb-0.5">Rate/ft²</div>
          <div className="font-semibold text-foreground text-sm">
            {record.RatePerSqFt
              ? `₹${Number(record.RatePerSqFt).toLocaleString("en-IN")}`
              : "—"}
          </div>
        </div>
        <div className="bg-primary/10 rounded-xl p-3 text-center">
          <div className="text-xs text-primary mb-0.5">Total</div>
          <div className="font-bold text-primary text-sm">
            {money(record.TotalValue ?? computed)}
          </div>
        </div>
      </div>

      {record.BookingAmount && (
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-4 px-1">
          <span>Booking amount</span>
          <span className="font-semibold text-foreground">
            {money(record.BookingAmount)}
          </span>
        </div>
      )}

      {record.Notes && (
        <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2 mb-4 line-clamp-2">
          {record.Notes}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1 border-t border-border/60">
        <button
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg py-2 transition-colors"
        >
          <Edit2 className="w-3.5 h-3.5" /> Edit
        </button>
        {canDelete && (
          <button
            onClick={onDelete}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg py-2 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Form Dialog ──────────────────────────────────────────────────────────────

function FormDialog({
  open,
  onClose,
  options,
  editing,
  onSave,
  isSaving,
}: {
  open: boolean;
  onClose: () => void;
  options: Options;
  editing: UnitSelection | null;
  onSave: (form: FormState) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Sync form whenever the dialog opens or the editing record changes.
  // Using useEffect (not useState) so it fires correctly on every change.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        ApplicantId: String(editing.ApplicantId ?? ""),
        ProjectId: String(editing.ProjectId ?? ""),
        CompanyId: String(editing.CompanyId ?? ""),
        UnitNo: editing.UnitNo ?? "",
        BlockName: editing.BlockName ?? "",
        FloorName: editing.FloorName ?? "",
        UnitType: editing.UnitType ?? "",
        AreaSqFt: String(editing.AreaSqFt ?? ""),
        RatePerSqFt: String(editing.RatePerSqFt ?? ""),
        TotalValue: String(editing.TotalValue ?? ""),
        BookingAmount: String(editing.BookingAmount ?? ""),
        SelectionDate:
          editing.SelectionDate ?? new Date().toISOString().slice(0, 10),
        Status: editing.Status ?? "Reserved",
        Notes: editing.Notes ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editing]);

  const set = (key: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const computed = computedValue(form);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {editing ? "Edit Unit Selection" : "New Unit Selection"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Applicant */}
          <div className="space-y-2">
            <Label>
              Applicant <span className="text-red-500">*</span>
            </Label>
            <Select
              value={form.ApplicantId || NONE}
              onValueChange={(v) => set("ApplicantId", v === NONE ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select applicant" />
              </SelectTrigger>
              <SelectContent>
                {options.applicants.map((a) => (
                  <SelectItem key={a.Id} value={String(a.Id)}>
                    {a.ApplicantName ?? "—"}
                    {a.ApplicantNo ? ` (${a.ApplicantNo})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Project + Company */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select
                value={form.ProjectId || NONE}
                onValueChange={(v) => set("ProjectId", v === NONE ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {options.projects.map((p) => (
                    <SelectItem key={p.Id} value={String(p.Id)}>
                      {p.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Company</Label>
              <Select
                value={form.CompanyId || NONE}
                onValueChange={(v) => set("CompanyId", v === NONE ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {options.companies.map((c) => (
                    <SelectItem key={c.Id} value={String(c.Id)}>
                      {c.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Unit details */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>
                Unit No. <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.UnitNo}
                onChange={(e) => set("UnitNo", e.target.value)}
                placeholder="e.g. A-101"
              />
            </div>
            <div className="space-y-2">
              <Label>Block</Label>
              <Input
                value={form.BlockName}
                onChange={(e) => set("BlockName", e.target.value)}
                placeholder="Block A"
              />
            </div>
            <div className="space-y-2">
              <Label>Floor</Label>
              <Input
                value={form.FloorName}
                onChange={(e) => set("FloorName", e.target.value)}
                placeholder="1st Floor"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Unit Type</Label>
              <Input
                value={form.UnitType}
                onChange={(e) => set("UnitType", e.target.value)}
                placeholder="2BHK, Shop, etc."
              />
            </div>
            <div className="space-y-2">
              <Label>Selection Date</Label>
              <div className="relative">
                <CalendarDays
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  type="date"
                  value={form.SelectionDate}
                  onChange={(e) => set("SelectionDate", e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Financials */}
          <div className="bg-muted rounded-xl p-4 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Financials
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Area (sq.ft.)</Label>
                <Input
                  type="number"
                  value={form.AreaSqFt}
                  onChange={(e) => set("AreaSqFt", e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Rate per sq.ft.</Label>
                <Input
                  type="number"
                  value={form.RatePerSqFt}
                  onChange={(e) => set("RatePerSqFt", e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Total Value</Label>
                <Input
                  type="number"
                  value={form.TotalValue}
                  onChange={(e) => set("TotalValue", e.target.value)}
                  placeholder={
                    computed !== null
                      ? `Auto: ₹${computed.toLocaleString("en-IN")}`
                      : "0"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Booking Amount</Label>
                <Input
                  type="number"
                  value={form.BookingAmount}
                  onChange={(e) => set("BookingAmount", e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            {computed !== null && !form.TotalValue && (
              <p className="text-xs text-violet-600">
                Computed value:{" "}
                <strong>₹{computed.toLocaleString("en-IN")}</strong> (area ×
                rate)
              </p>
            )}
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.Status} onValueChange={(v) => set("Status", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(options.statusOptions.length
                  ? options.statusOptions
                  : ["Reserved", "Negotiation", "Confirmed", "Released"]
                ).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={form.Notes}
              onChange={(e) => set("Notes", e.target.value)}
              placeholder="Optional remarks…"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave(form)}
            disabled={!form.ApplicantId || !form.UnitNo.trim() || isSaving}
            className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
          >
            {isSaving ? "Saving…" : editing ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function UnitSelectionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const canDeleteRecords = currentUser?.role !== "engineer";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UnitSelection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UnitSelection | null>(null);

  const {
    data: options = {
      applicants: [],
      projects: [],
      companies: [],
      statusOptions: [],
    },
  } = useQuery({
    queryKey: ["followup-unit-selections-options"],
    queryFn: fetchOptions,
  });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["followup-unit-selections", search, statusFilter, page],
    queryFn: () => fetchSelections(search, statusFilter, page),
  });

  const records = data?.data ?? [];
  const pagination = data?.pagination;

  const stats = useMemo(() => {
    const total = pagination?.total ?? 0;
    const confirmed = records.filter((r) => r.Status === "Confirmed").length;
    const totalValue = records.reduce(
      (s, r) => s + (Number(r.TotalValue) || 0),
      0,
    );
    return { total, confirmed, totalValue };
  }, [pagination?.total, records]);

  const saveMutation = useMutation({
    mutationFn: (form: FormState) => saveSelection(form, editing?.Id),
    onSuccess: () => {
      toast.success(
        editing ? "Unit selection updated" : "Unit selection created",
      );
      queryClient.invalidateQueries({ queryKey: ["followup-unit-selections"] });
      setDialogOpen(false);
      setEditing(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSelection(id),
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["followup-unit-selections"] });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (r: UnitSelection) => {
    setEditing(r);
    setDialogOpen(true);
  };

  const statusOptions = options.statusOptions.length
    ? options.statusOptions
    : ["Reserved", "Negotiation", "Confirmed", "Released"];

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Sales" },
          { label: "Unit Selection" },
        ]}
      />
      <div className="relative space-y-8 mt-6">
        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Unit Selection
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage unit bookings and applicant selections
            </p>
          </div>
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
              size="sm"
              onClick={openCreate}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Plus size={14} /> New Selection
            </Button>
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Total", value: stats.total, dot: "bg-blue-400" },
            { label: "Confirmed", value: stats.confirmed, dot: "bg-emerald-500" },
            { label: "Visible Value", value: `₹${stats.totalValue.toLocaleString("en-IN")}`, dot: "bg-amber-400" },
          ].map(({ label, value, dot }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <div className={`w-2 h-2 rounded-full ${dot} mb-3`} />
              <p className="text-2xl font-bold font-heading text-foreground leading-none">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Filter bar ── */}
        <div className="flex gap-2.5 items-center flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              className="w-full pl-9 pr-9 py-[9px] border border-border rounded-lg text-sm bg-card text-foreground outline-none focus:border-primary/60 transition-colors"
              placeholder="Search unit, applicant, project…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {["all", ...statusOptions].map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className={`px-3.5 py-[7px] rounded-[9px] text-xs font-semibold border-[1.5px] transition-all leading-none ${
                statusFilter === s
                  ? "gradient-accent text-white border-transparent shadow-sm"
                  : "bg-muted text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>

        {/* ── Grid / empty / loading ── */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-xl p-5 animate-pulse"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-muted rounded-xl" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 bg-muted rounded w-2/3" />
                    <div className="h-3 bg-muted rounded w-1/3" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((j) => (
                    <div key={j} className="h-14 bg-muted rounded-xl" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="p-4 rounded-2xl bg-muted mb-4">
              <Home size={28} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              No unit selections
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {search || statusFilter !== "all"
                ? "Try changing your filters"
                : "Create the first unit selection to get started"}
            </p>
            {!search && statusFilter === "all" && (
              <Button
                onClick={openCreate}
                className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto mt-4"
              >
                <Plus className="w-4 h-4" /> New Selection
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {records.map((r) => (
              <UnitCard
                key={r.Id}
                record={r}
                onEdit={() => openEdit(r)}
                onDelete={() => setDeleteTarget(r)}
                canDelete={canDeleteRecords}
              />
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {pagination.page} of {pagination.totalPages} ·{" "}
              {pagination.total} total
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-xl"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-xl"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <FormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        options={options}
        editing={editing}
        onSave={(form) => saveMutation.mutate(form)}
        isSaving={saveMutation.isPending}
      />

      {/* Delete confirm */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete unit selection?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Unit <strong>{deleteTarget?.UnitNo}</strong>
            {deleteTarget?.ApplicantName
              ? ` for ${deleteTarget.ApplicantName}`
              : ""}{" "}
            will be permanently removed. This cannot be undone if an agreement
            is already linked.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
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
    </>
  );
}

export default UnitSelectionPage;