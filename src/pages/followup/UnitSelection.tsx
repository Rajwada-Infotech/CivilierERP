import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronRight,
  Edit2,
  Home,
  IndianRupee,
  Layers,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
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
  ProjectId?: number | null;
  CompanyId?: number | null;
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
    color: "bg-amber-100 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
  },
  Negotiation: {
    color: "bg-blue-100 text-blue-800 border-blue-200",
    dot: "bg-blue-500",
  },
  Confirmed: {
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
  },
  Released: {
    color: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    color: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
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
}: {
  record: UnitSelection;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const computed = computedValue({
    AreaSqFt: String(record.AreaSqFt ?? ""),
    RatePerSqFt: String(record.RatePerSqFt ?? ""),
  } as FormState);

  return (
    <div className="group relative bg-white border border-slate-200 rounded-2xl p-5 hover:border-violet-300 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-200">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center flex-shrink-0">
            <Home className="w-5 h-5 text-violet-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900 text-base">
                Unit {record.UnitNo}
              </span>
              {record.SelectionNo && (
                <span className="text-xs text-slate-400 font-mono">
                  #{record.SelectionNo}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500 flex-wrap">
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
            <span className="w-4 h-4 text-slate-400 flex-shrink-0">👤</span>
            <span className="text-slate-700 font-medium truncate">
              {record.ApplicantName}
            </span>
            {record.ApplicantNo && (
              <span className="text-xs text-slate-400 font-mono flex-shrink-0">
                ({record.ApplicantNo})
              </span>
            )}
          </div>
        )}
        {record.ProjectName && (
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="text-slate-600 truncate">
              {record.ProjectName}
            </span>
          </div>
        )}
        {record.SelectionDate && (
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="text-slate-600">
              {dateStr(record.SelectionDate)}
            </span>
          </div>
        )}
      </div>

      {/* Financials */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-slate-50 rounded-xl p-3 text-center">
          <div className="text-xs text-slate-400 mb-0.5">Area</div>
          <div className="font-semibold text-slate-800 text-sm">
            {record.AreaSqFt
              ? `${Number(record.AreaSqFt).toLocaleString("en-IN")} ft²`
              : "—"}
          </div>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 text-center">
          <div className="text-xs text-slate-400 mb-0.5">Rate/ft²</div>
          <div className="font-semibold text-slate-800 text-sm">
            {record.RatePerSqFt
              ? `₹${Number(record.RatePerSqFt).toLocaleString("en-IN")}`
              : "—"}
          </div>
        </div>
        <div className="bg-violet-50 rounded-xl p-3 text-center">
          <div className="text-xs text-violet-500 mb-0.5">Total</div>
          <div className="font-bold text-violet-700 text-sm">
            {money(record.TotalValue ?? computed)}
          </div>
        </div>
      </div>

      {record.BookingAmount && (
        <div className="flex items-center justify-between text-xs text-slate-500 mb-4 px-1">
          <span>Booking amount</span>
          <span className="font-semibold text-slate-700">
            {money(record.BookingAmount)}
          </span>
        </div>
      )}

      {record.Notes && (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 mb-4 line-clamp-2">
          {record.Notes}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1 border-t border-slate-100">
        <button
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-600 hover:text-violet-700 hover:bg-violet-50 rounded-lg py-2 transition-colors"
        >
          <Edit2 className="w-3.5 h-3.5" /> Edit
        </button>
        <button
          onClick={onDelete}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg py-2 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
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

  // Sync form when editing changes
  useState(() => {
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
  });

  // Reset on open
  const prevOpen = open;
  if (prevOpen !== open && open) {
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
  }

  const set = (key: keyof FormState, value: string) =>
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Auto-fill project/company from applicant
      if (key === "ApplicantId") {
        const appl = options.applicants.find((a) => String(a.Id) === value);
        if (appl) {
          if (appl.ProjectId) next.ProjectId = String(appl.ProjectId);
          if (appl.CompanyId) next.CompanyId = String(appl.CompanyId);
        }
      }
      return next;
    });

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
              <Input
                type="date"
                value={form.SelectionDate}
                onChange={(e) => set("SelectionDate", e.target.value)}
              />
            </div>
          </div>

          {/* Financials */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
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
            className="bg-violet-600 hover:bg-violet-700 text-white"
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

  const { data, isLoading } = useQuery({
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
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&display=swap');
        .us-page { font-family: 'DM Sans', sans-serif; }
        .us-heading { font-family: 'Syne', sans-serif; }
      `}</style>

      <div className="us-page min-h-screen bg-slate-50/60 p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
                <button
                  onClick={() => navigate("/followup")}
                  className="hover:text-slate-800 transition-colors flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Follow-Up
                </button>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-800 font-medium">
                  Unit Selection
                </span>
              </div>
              <h1 className="us-heading text-3xl font-bold text-slate-900 tracking-tight">
                Unit Selection
              </h1>
              <p className="text-slate-500 text-sm mt-1">
                Reserve, negotiate, and confirm units against applicants.
              </p>
            </div>
            <Button
              onClick={openCreate}
              className="bg-violet-600 hover:bg-violet-700 text-white gap-2 rounded-xl px-5 self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" /> New Selection
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
                  <Layers className="w-4.5 h-4.5 text-violet-600" />
                </div>
                <span className="text-sm text-slate-500">Total</span>
              </div>
              <div className="us-heading text-3xl font-bold text-slate-900">
                {stats.total}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Building2 className="w-4.5 h-4.5 text-emerald-600" />
                </div>
                <span className="text-sm text-slate-500">Confirmed</span>
              </div>
              <div className="us-heading text-3xl font-bold text-slate-900">
                {stats.confirmed}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
                  <IndianRupee className="w-4.5 h-4.5 text-amber-600" />
                </div>
                <span className="text-sm text-slate-500">Visible value</span>
              </div>
              <div className="us-heading text-2xl font-bold text-slate-900">
                ₹{stats.totalValue.toLocaleString("en-IN")}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                className="w-full pl-9 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-colors"
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {["all", ...statusOptions].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(1);
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    statusFilter === s
                      ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                      : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
                  }`}
                >
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white border border-slate-200 rounded-2xl p-5 animate-pulse"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-slate-100 rounded-xl" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-4 bg-slate-100 rounded w-2/3" />
                      <div className="h-3 bg-slate-100 rounded w-1/3" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2].map((j) => (
                      <div key={j} className="h-14 bg-slate-100 rounded-xl" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : records.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
              <div className="w-16 h-16 bg-violet-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Home className="w-8 h-8 text-violet-400" />
              </div>
              <h3 className="us-heading text-lg font-bold text-slate-700 mb-1">
                No unit selections
              </h3>
              <p className="text-slate-400 text-sm mb-5">
                {search || statusFilter !== "all"
                  ? "Try changing your filters"
                  : "Create the first unit selection to get started"}
              </p>
              {!search && statusFilter === "all" && (
                <Button
                  onClick={openCreate}
                  className="bg-violet-600 hover:bg-violet-700 text-white gap-2 rounded-xl"
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
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-slate-500">
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
          <p className="text-sm text-slate-600">
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
