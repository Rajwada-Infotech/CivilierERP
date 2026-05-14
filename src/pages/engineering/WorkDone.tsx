import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Hammer,
  Plus,
  RefreshCw,
  Search,
  Filter,
  FileText,
  ChevronDown,
  X,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  Building2,
  HardHat,
  Calendar,
  IndianRupee,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────
interface WorkDoneEntry {
  ID: number;
  DocNo: string;
  WorkOrderNo: string;
  WorkOrderID: number;
  ContractorName: string;
  ProjectName: string;
  PeriodFrom: string;
  PeriodTo: string;
  DescriptionOfWork: string;
  QuantityDone: number;
  Unit: string;
  RatePerUnit: number;
  GrossAmount: number;
  Deductions: number;
  CertifiedAmount: number;
  Status: string;
  Remarks: string;
  CreatedAt: string;
  CreatedBy: string;
}

interface WorkOrderRef {
  ID: number;
  DocNo: string;
  ContractorName: string;
  ProjectName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n ?? 0);

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

// ─── Summary card ─────────────────────────────────────────────────────────────
function SummaryCard({
  label,
  value,
  icon: Icon,
  iconColor,
  iconBg,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${iconBg}`}>
        <Icon size={15} className={iconColor} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-heading font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

// ─── Form dialog ──────────────────────────────────────────────────────────────
interface FormState {
  WorkOrderID: string;
  PeriodFrom: string;
  PeriodTo: string;
  DescriptionOfWork: string;
  QuantityDone: string;
  Unit: string;
  RatePerUnit: string;
  Deductions: string;
  Remarks: string;
  Status: string;
}

const EMPTY_FORM: FormState = {
  WorkOrderID: "",
  PeriodFrom: "",
  PeriodTo: "",
  DescriptionOfWork: "",
  QuantityDone: "",
  Unit: "",
  RatePerUnit: "",
  Deductions: "0",
  Remarks: "",
  Status: "Draft",
};

function WorkDoneFormDialog({
  open,
  onClose,
  record,
  workOrders,
}: {
  open: boolean;
  onClose: () => void;
  record?: WorkDoneEntry | null;
  workOrders: WorkOrderRef[];
}) {
  const qc = useQueryClient();
  const isEdit = !!record;

  const [form, setForm] = useState<FormState>(
    record
      ? {
          WorkOrderID: String(record.WorkOrderID ?? ""),
          PeriodFrom: record.PeriodFrom?.slice(0, 10) ?? "",
          PeriodTo: record.PeriodTo?.slice(0, 10) ?? "",
          DescriptionOfWork: record.DescriptionOfWork ?? "",
          QuantityDone: String(record.QuantityDone ?? ""),
          Unit: record.Unit ?? "",
          RatePerUnit: String(record.RatePerUnit ?? ""),
          Deductions: String(record.Deductions ?? "0"),
          Remarks: record.Remarks ?? "",
          Status: record.Status ?? "Draft",
        }
      : EMPTY_FORM,
  );

  const set = (k: keyof FormState) => (v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const gross =
    (parseFloat(form.QuantityDone) || 0) * (parseFloat(form.RatePerUnit) || 0);
  const certified = gross - (parseFloat(form.Deductions) || 0);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        WorkOrderID: parseInt(form.WorkOrderID),
        QuantityDone: parseFloat(form.QuantityDone) || 0,
        RatePerUnit: parseFloat(form.RatePerUnit) || 0,
        Deductions: parseFloat(form.Deductions) || 0,
        GrossAmount: gross,
        CertifiedAmount: certified,
      };
      const url = isEdit
        ? `/api/engineering/work-done/${record!.ID}`
        : "/api/engineering/work-done";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["engineering-work-done"] });
      qc.invalidateQueries({ queryKey: ["engineering-dashboard"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading">
            <Hammer size={16} className="text-orange-600" />
            {isEdit ? "Edit Work Done" : "New Work Done Entry"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          {/* Work Order */}
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Work Order *
            </label>
            <Select value={form.WorkOrderID} onValueChange={set("WorkOrderID")}>
              <SelectTrigger>
                <SelectValue placeholder="Select work order…" />
              </SelectTrigger>
              <SelectContent>
                {workOrders.map((wo) => (
                  <SelectItem key={wo.ID} value={String(wo.ID)}>
                    {wo.DocNo} — {wo.ContractorName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Period */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Period From *
            </label>
            <Input
              type="date"
              value={form.PeriodFrom}
              onChange={(e) => set("PeriodFrom")(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Period To *
            </label>
            <Input
              type="date"
              value={form.PeriodTo}
              onChange={(e) => set("PeriodTo")(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Description of Work *
            </label>
            <textarea
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={form.DescriptionOfWork}
              onChange={(e) => set("DescriptionOfWork")(e.target.value)}
              placeholder="Describe the work completed…"
            />
          </div>

          {/* Qty / Unit / Rate */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Quantity Done *
            </label>
            <Input
              type="number"
              value={form.QuantityDone}
              onChange={(e) => set("QuantityDone")(e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Unit
            </label>
            <Input
              value={form.Unit}
              onChange={(e) => set("Unit")(e.target.value)}
              placeholder="e.g. sqm, rmt, nos…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Rate per Unit (₹) *
            </label>
            <Input
              type="number"
              value={form.RatePerUnit}
              onChange={(e) => set("RatePerUnit")(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Deductions (₹)
            </label>
            <Input
              type="number"
              value={form.Deductions}
              onChange={(e) => set("Deductions")(e.target.value)}
              placeholder="0.00"
            />
          </div>

          {/* Auto-computed */}
          <div className="sm:col-span-2 rounded-lg bg-orange-500/5 border border-orange-500/20 p-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Gross Amount</p>
              <p className="text-base font-heading font-bold text-foreground">
                {fmt(gross)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Certified Amount</p>
              <p className="text-base font-heading font-bold text-emerald-600">
                {fmt(certified)}
              </p>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Status
            </label>
            <Select value={form.Status} onValueChange={set("Status")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Draft", "Pending", "Approved", "Rejected"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Remarks */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Remarks
            </label>
            <Input
              value={form.Remarks}
              onChange={(e) => set("Remarks")(e.target.value)}
              placeholder="Optional remarks…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending ||
              !form.WorkOrderID ||
              !form.PeriodFrom ||
              !form.PeriodTo ||
              !form.DescriptionOfWork
            }
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {saveMutation.isPending ? "Saving…" : isEdit ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function WorkDone() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editRecord, setEditRecord] = useState<WorkDoneEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: entries = [], isLoading, refetch, isFetching } = useQuery<WorkDoneEntry[]>({
    queryKey: ["engineering-work-done"],
    queryFn: () =>
      fetchWithAuth("/api/engineering/work-done").then((r) => r.json()),
    staleTime: 60 * 1000,
  });

  const { data: workOrders = [] } = useQuery<WorkOrderRef[]>({
    queryKey: ["work-orders-ref"],
    queryFn: () =>
      fetchWithAuth("/api/work-orders?ref=true").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const filtered =
    statusFilter === "all"
      ? entries
      : entries.filter((e) => e.Status === statusFilter);

  const totalCertified = filtered.reduce(
    (sum, e) => sum + (e.CertifiedAmount ?? 0),
    0,
  );
  const pendingCount = entries.filter((e) => e.Status === "Pending").length;
  const approvedCount = entries.filter((e) => e.Status === "Approved").length;

  const COLUMNS: ColumnDef<WorkDoneEntry>[] = [
    {
      key: "DocNo",
      header: "Doc No",
      render: (v: string) => (
        <span className="font-mono text-[11px] text-primary font-medium">
          {v || "—"}
        </span>
      ),
    },
    {
      key: "WorkOrderNo",
      header: "Work Order",
      render: (v: string) => (
        <span className="text-xs text-muted-foreground">{v || "—"}</span>
      ),
    },
    {
      key: "ContractorName",
      header: "Contractor",
      render: (v: string) => (
        <span className="text-xs font-medium">{v || "—"}</span>
      ),
    },
    {
      key: "DescriptionOfWork",
      header: "Description",
      render: (v: string) => (
        <span
          className="text-xs text-muted-foreground max-w-[160px] truncate block"
          title={v}
        >
          {v || "—"}
        </span>
      ),
    },
    {
      key: "PeriodFrom",
      header: "Period",
      render: (_: string, row: WorkDoneEntry) => (
        <span className="text-xs">
          {fmtDate(row.PeriodFrom)} – {fmtDate(row.PeriodTo)}
        </span>
      ),
    },
    {
      key: "GrossAmount",
      header: "Gross",
      render: (v: number) => (
        <span className="text-xs">{fmt(v)}</span>
      ),
    },
    {
      key: "CertifiedAmount",
      header: "Certified",
      render: (v: number) => (
        <span className="text-xs font-semibold text-emerald-600">
          {fmt(v)}
        </span>
      ),
    },
    {
      key: "Status",
      header: "Status",
      render: (v: string) => <StatusBadge status={v} />,
    },
    {
      key: "ID",
      header: "",
      render: (_: number, row: WorkDoneEntry) => (
        <button
          onClick={() => {
            setEditRecord(row);
            setShowForm(true);
          }}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors"
        >
          <Eye size={11} /> View
        </button>
      ),
    },
  ];

  const openNew = () => {
    setEditRecord(null);
    setShowForm(true);
  };

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumbs
            items={[
              { label: "Engineering", href: "/engineering" },
              { label: "Work Done" },
            ]}
          />
          <div className="flex items-center gap-3 mt-1">
            <div className="p-2 rounded-lg bg-orange-500/10">
              <Hammer size={18} className="text-orange-600" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">
                Work Done
              </h1>
              <p className="text-xs text-muted-foreground">
                Record and certify contractor work completion
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          </button>
          <Button
            onClick={openNew}
            className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-8 px-3 flex items-center gap-1.5"
          >
            <Plus size={13} /> New Entry
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Total Entries"
          value={String(entries.length)}
          icon={FileText}
          iconColor="text-orange-600"
          iconBg="bg-orange-500/10"
        />
        <SummaryCard
          label="Certified Amount"
          value={fmt(totalCertified)}
          icon={IndianRupee}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-500/10"
        />
        <SummaryCard
          label="Pending Approval"
          value={String(pendingCount)}
          icon={Clock}
          iconColor="text-amber-600"
          iconBg="bg-amber-500/10"
        />
        <SummaryCard
          label="Approved"
          value={String(approvedCount)}
          icon={CheckCircle2}
          iconColor="text-blue-600"
          iconBg="bg-blue-500/10"
        />
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {["all", "Draft", "Pending", "Approved", "Rejected"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              statusFilter === s
                ? "bg-orange-600 text-white border-orange-600"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {s === "all" ? "All" : s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <DataTable
          data={filtered}
          columns={COLUMNS}
          isLoading={isLoading}
          searchable
          paginated
          emptyMessage="No work done entries found."
        />
      </div>

      {/* Form Dialog */}
      {showForm && (
        <WorkDoneFormDialog
          open={showForm}
          onClose={() => {
            setShowForm(false);
            setEditRecord(null);
          }}
          record={editRecord}
          workOrders={workOrders}
        />
      )}
    </div>
  );
}
