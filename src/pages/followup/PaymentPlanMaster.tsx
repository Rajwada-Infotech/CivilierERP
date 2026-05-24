import React, { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  GripVertical,
  Percent,
  DollarSign,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  ToggleRight,
  Milestone,
  AlertCircle,
} from "lucide-react";

const API = "/api/payment-plan-master";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MilestoneRow {
  id?: number;
  paymentTerm: string;
  valueType: "P" | "A";
  value: string;
}

interface Plan {
  _id: string;
  planName: string;
  isActive: boolean;
  milestoneCount: number;
  totalPercentage: number | null;
}

interface PlanDetail {
  Id: number;
  PlanName: string;
  IsActive: boolean;
  milestones: {
    Id: number;
    MilestoneNo: number;
    PaymentTerm: string;
    ValueType: "P" | "A";
    Value: number;
  }[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchPlans(): Promise<Plan[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch payment plans");
  const data = await res.json();
  return data.map((r: any) => ({
    _id: String(r.Id),
    planName: r.PlanName,
    isActive: Boolean(r.IsActive),
    milestoneCount: r.MilestoneCount ?? 0,
    totalPercentage: r.TotalPercentage ?? null,
  }));
}

async function fetchPlanDetail(id: string): Promise<PlanDetail> {
  const res = await fetchWithAuth(`${API}/${id}`);
  if (!res.ok) throw new Error("Failed to fetch plan details");
  return res.json();
}

// ── Milestone Row Editor ──────────────────────────────────────────────────────

const MilestoneEditor: React.FC<{
  milestones: MilestoneRow[];
  onChange: (rows: MilestoneRow[]) => void;
}> = ({ milestones, onChange }) => {
  const add = () =>
    onChange([...milestones, { paymentTerm: "", valueType: "P", value: "" }]);

  const remove = (i: number) =>
    onChange(milestones.filter((_, idx) => idx !== i));

  const update = (i: number, patch: Partial<MilestoneRow>) =>
    onChange(milestones.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const totalPct = milestones
    .filter((m) => m.valueType === "P")
    .reduce((sum, m) => sum + (parseFloat(m.value) || 0), 0);

  const pctOver = totalPct > 100;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="grid grid-cols-[24px_1fr_130px_100px_32px] gap-2 px-1 pb-1 border-b border-border">
        <span />
        <span className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground">
          Payment Term
        </span>
        <span className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground text-center">
          Type
        </span>
        <span className="text-[10px] font-heading uppercase tracking-wider text-muted-foreground text-right">
          Value
        </span>
        <span />
      </div>

      {/* Rows */}
      {milestones.length === 0 && (
        <div className="py-6 flex flex-col items-center gap-2 text-muted-foreground/60">
          <Milestone size={28} strokeWidth={1.2} />
          <p className="text-xs font-heading">No milestones yet</p>
        </div>
      )}

      {milestones.map((m, i) => (
        <div
          key={i}
          className="grid grid-cols-[24px_1fr_130px_100px_32px] gap-2 items-center group"
        >
          {/* Drag handle (visual only) */}
          <div className="flex items-center justify-center text-muted-foreground/30 group-hover:text-muted-foreground/60 cursor-grab">
            <GripVertical size={14} />
          </div>

          {/* Payment Term */}
          <input
            type="text"
            value={m.paymentTerm}
            onChange={(e) => update(i, { paymentTerm: e.target.value })}
            placeholder={`Milestone ${i + 1} — e.g. On Booking`}
            className="h-8 px-2.5 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/60 transition-colors"
          />

          {/* Type toggler */}
          <div className="flex items-center gap-1 justify-center">
            <button
              type="button"
              onClick={() => update(i, { valueType: "P" })}
              className={`flex items-center gap-1 px-2.5 h-8 rounded-l-lg border text-xs font-heading transition-colors ${
                m.valueType === "P"
                  ? "bg-violet-500/15 border-violet-500/50 text-violet-500"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <Percent size={11} />
              <span>%</span>
            </button>
            <button
              type="button"
              onClick={() => update(i, { valueType: "A" })}
              className={`flex items-center gap-1 px-2.5 h-8 rounded-r-lg border-t border-b border-r text-xs font-heading transition-colors ${
                m.valueType === "A"
                  ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-500"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <DollarSign size={11} />
              <span>Amt</span>
            </button>
          </div>

          {/* Value */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 text-xs pointer-events-none">
              {m.valueType === "P" ? "%" : "₹"}
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={m.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder="0"
              className="h-8 w-full pl-6 pr-2 text-sm text-right rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/60 transition-colors"
            />
          </div>

          {/* Remove */}
          <button
            type="button"
            onClick={() => remove(i)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      {/* Add milestone button */}
      <button
        type="button"
        onClick={add}
        className="mt-1 flex items-center gap-1.5 text-xs font-heading text-violet-500 hover:text-violet-400 transition-colors px-1 py-1"
      >
        <Plus size={13} />
        Add Milestone
      </button>

      {/* Percentage summary */}
      {milestones.some((m) => m.valueType === "P") && (
        <div
          className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-heading border mt-2 ${
            pctOver
              ? "border-red-500/40 bg-red-500/8 text-red-500"
              : totalPct === 100
                ? "border-emerald-500/40 bg-emerald-500/8 text-emerald-500"
                : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          <span className="flex items-center gap-1.5">
            {pctOver && <AlertCircle size={12} />}
            Percentage total
          </span>
          <span className="font-bold tabular-nums">{totalPct.toFixed(2)}%</span>
        </div>
      )}
    </div>
  );
};

// ── Plan Form (create / edit) ─────────────────────────────────────────────────

const PlanForm: React.FC<{
  initial?: { planName: string; isActive: boolean; milestones: MilestoneRow[] };
  onSave: (data: {
    planName: string;
    isActive: boolean;
    milestones: MilestoneRow[];
  }) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}> = ({ initial, onSave, onCancel, saving }) => {
  const [planName, setPlanName] = useState(initial?.planName ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [milestones, setMilestones] = useState<MilestoneRow[]>(
    initial?.milestones ?? [],
  );

  const handleSubmit = async () => {
    if (!planName.trim()) {
      toast.error("Plan name is required");
      return;
    }
    await onSave({ planName, isActive, milestones });
  };

  return (
    <div className="space-y-4">
      {/* Plan name + active toggle */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs font-heading text-muted-foreground mb-1 block">
            Plan Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            placeholder="e.g. Standard Construction Plan"
            className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/60 transition-colors"
          />
        </div>
        <div className="flex flex-col items-center gap-0.5 pt-4">
          <button
            type="button"
            onClick={() => setIsActive((p) => !p)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {isActive ? (
              <ToggleRight size={28} className="text-violet-500" />
            ) : (
              <ToggleLeft size={28} />
            )}
          </button>
          <span className="text-[10px] font-heading text-muted-foreground">
            {isActive ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      {/* Milestone builder */}
      <div>
        <label className="text-xs font-heading text-muted-foreground mb-2 block">
          Milestones
        </label>
        <div className="rounded-xl border border-border bg-card/50 p-3">
          <MilestoneEditor milestones={milestones} onChange={setMilestones} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 h-8 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:bg-muted transition-colors"
        >
          <X size={13} /> Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 h-8 rounded-lg text-sm font-heading bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
        >
          <Check size={13} />
          {saving ? "Saving…" : "Save Plan"}
        </button>
      </div>
    </div>
  );
};

// ── Plan Row (collapsed list item) ───────────────────────────────────────────

const PlanRow: React.FC<{
  plan: Plan;
  onEdit: () => void;
  onDelete: () => void;
  expanded: boolean;
  onToggle: () => void;
  detail: PlanDetail | undefined;
  loadingDetail: boolean;
}> = ({
  plan,
  onEdit,
  onDelete,
  expanded,
  onToggle,
  detail,
  loadingDetail,
}) => (
  <div
    className={`rounded-xl border transition-all duration-200 ${
      expanded ? "border-violet-500/30 shadow-sm" : "border-border"
    } bg-card overflow-hidden`}
  >
    {/* Row header */}
    <div className="flex items-center gap-3 px-4 py-3">
      <button
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-heading font-semibold text-foreground truncate">
            {plan.planName}
          </span>
          {!plan.isActive && (
            <span className="text-[10px] font-heading px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-[11px] text-muted-foreground font-heading">
            {plan.milestoneCount} milestone
            {plan.milestoneCount !== 1 ? "s" : ""}
          </span>
          {plan.totalPercentage != null && plan.totalPercentage > 0 && (
            <span
              className={`text-[11px] font-heading tabular-nums ${
                plan.totalPercentage === 100
                  ? "text-emerald-500"
                  : plan.totalPercentage > 100
                    ? "text-red-500"
                    : "text-amber-500"
              }`}
            >
              {plan.totalPercentage.toFixed(1)}% total
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={onDelete}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>

    {/* Expanded milestone view */}
    {expanded && (
      <div className="border-t border-border px-4 py-3 bg-muted/20">
        {loadingDetail ? (
          <p className="text-xs text-muted-foreground py-2">Loading…</p>
        ) : !detail ? (
          <p className="text-xs text-muted-foreground py-2">
            Could not load milestones.
          </p>
        ) : detail.milestones.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 flex items-center gap-1.5">
            <Milestone size={13} /> No milestones defined.
          </p>
        ) : (
          <div className="space-y-1.5">
            {detail.milestones.map((m) => (
              <div
                key={m.Id}
                className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                {/* Milestone number pip */}
                <div className="w-5 h-5 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-heading text-violet-500 font-bold">
                    {m.MilestoneNo}
                  </span>
                </div>

                <span className="flex-1 text-sm text-foreground font-heading">
                  {m.PaymentTerm}
                </span>

                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-heading font-semibold tabular-nums ${
                    m.ValueType === "P"
                      ? "bg-violet-500/12 text-violet-500"
                      : "bg-emerald-500/12 text-emerald-500"
                  }`}
                >
                  {m.ValueType === "P" ? (
                    <Percent size={10} />
                  ) : (
                    <span className="text-[10px]">₹</span>
                  )}
                  {m.ValueType === "P"
                    ? `${m.Value}%`
                    : `₹${Number(m.Value).toLocaleString("en-IN")}`}
                </div>
              </div>
            ))}

            {/* Total bar for percentage-type plans */}
            {detail.milestones.some((m) => m.ValueType === "P") &&
              (() => {
                const total = detail.milestones
                  .filter((m) => m.ValueType === "P")
                  .reduce((s, m) => s + Number(m.Value), 0);
                const pct = Math.min(total, 100);
                return (
                  <div className="mt-3 pt-2 border-t border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-heading text-muted-foreground uppercase tracking-wider">
                        Percentage Coverage
                      </span>
                      <span
                        className={`text-[11px] font-heading font-bold tabular-nums ${
                          total === 100
                            ? "text-emerald-500"
                            : total > 100
                              ? "text-red-500"
                              : "text-amber-500"
                        }`}
                      >
                        {total.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          total === 100
                            ? "bg-emerald-500"
                            : total > 100
                              ? "bg-red-500"
                              : "bg-violet-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
          </div>
        )}
      </div>
    )}
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────

const PaymentPlanMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editDetail, setEditDetail] = useState<PlanDetail | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    data: plans = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["payment-plan-master"],
    queryFn: fetchPlans,
    staleTime: 5 * 60 * 1000,
  });

  const { data: expandedDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ["payment-plan-detail", expandedId],
    queryFn: () => fetchPlanDetail(expandedId!),
    enabled: !!expandedId,
    staleTime: 2 * 60 * 1000,
  });

  const handleToggleExpand = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  const handleCreate = useCallback(
    async (data: {
      planName: string;
      isActive: boolean;
      milestones: MilestoneRow[];
    }) => {
      setSaving(true);
      try {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            PlanName: data.planName,
            IsActive: data.isActive,
            milestones: data.milestones.map((m) => ({
              PaymentTerm: m.paymentTerm,
              ValueType: m.valueType,
              Value: parseFloat(m.value) || 0,
            })),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        toast.success("Payment plan created!");
        await queryClient.invalidateQueries({
          queryKey: ["payment-plan-master"],
        });
        setMode("list");
      } catch (err: any) {
        toast.error(err.message || "Operation failed");
      } finally {
        setSaving(false);
      }
    },
    [queryClient],
  );

  const handleUpdate = useCallback(
    async (data: {
      planName: string;
      isActive: boolean;
      milestones: MilestoneRow[];
    }) => {
      if (!editingPlan) return;
      setSaving(true);
      try {
        const res = await fetchWithAuth(`${API}/${editingPlan._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            PlanName: data.planName,
            IsActive: data.isActive,
            milestones: data.milestones.map((m) => ({
              PaymentTerm: m.paymentTerm,
              ValueType: m.valueType,
              Value: parseFloat(m.value) || 0,
            })),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        toast.success("Payment plan updated!");
        await queryClient.invalidateQueries({
          queryKey: ["payment-plan-master"],
        });
        await queryClient.invalidateQueries({
          queryKey: ["payment-plan-detail", editingPlan._id],
        });
        setMode("list");
        setEditingPlan(null);
        setEditDetail(null);
      } catch (err: any) {
        toast.error(err.message || "Operation failed");
      } finally {
        setSaving(false);
      }
    },
    [editingPlan, queryClient],
  );

  const handleDelete = useCallback(
    async (plan: Plan) => {
      if (!confirm(`Delete payment plan "${plan.planName}"?`)) return;
      try {
        const res = await fetchWithAuth(`${API}/${plan._id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        toast.success("Payment plan deleted");
        if (expandedId === plan._id) setExpandedId(null);
        await queryClient.invalidateQueries({
          queryKey: ["payment-plan-master"],
        });
      } catch (err: any) {
        toast.error(err.message || "Delete failed");
      }
    },
    [queryClient, expandedId],
  );

  const startEdit = async (plan: Plan) => {
    try {
      const detail = await fetchPlanDetail(plan._id);
      setEditingPlan(plan);
      setEditDetail(detail);
      setMode("edit");
    } catch {
      toast.error("Could not load plan details");
    }
  };

  if (isLoading)
    return (
      <div className="p-6 text-muted-foreground">Loading payment plans…</div>
    );
  if (error)
    return (
      <div className="p-6 text-red-500">Failed to load payment plans.</div>
    );

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Follow-Up", "Setup", "Payment Plan Master"]}
      />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-heading font-bold text-foreground">
          Payment Plan Master
        </h1>
        {mode === "list" && (
          <button
            onClick={() => setMode("create")}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm font-heading bg-violet-600 text-white hover:bg-violet-500 transition-colors"
          >
            <Plus size={14} />
            New Plan
          </button>
        )}
      </div>

      {/* Create / Edit form */}
      {(mode === "create" || mode === "edit") && (
        <div className="mb-6 rounded-xl border border-violet-500/25 bg-card p-5 shadow-sm">
          <h2 className="text-sm font-heading font-semibold text-foreground mb-4 flex items-center gap-2">
            <Milestone size={15} className="text-violet-500" />
            {mode === "create" ? "New Payment Plan" : "Edit Payment Plan"}
          </h2>
          <PlanForm
            initial={
              mode === "edit" && editDetail
                ? {
                    planName: editDetail.PlanName,
                    isActive: editDetail.IsActive,
                    milestones: editDetail.milestones.map((m) => ({
                      id: m.Id,
                      paymentTerm: m.PaymentTerm,
                      valueType: m.ValueType,
                      value: String(m.Value),
                    })),
                  }
                : undefined
            }
            onSave={mode === "create" ? handleCreate : handleUpdate}
            onCancel={() => {
              setMode("list");
              setEditingPlan(null);
              setEditDetail(null);
            }}
            saving={saving}
          />
        </div>
      )}

      {/* Plans list */}
      {plans.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground/50">
          <Milestone size={40} strokeWidth={1} />
          <p className="text-sm font-heading">No payment plans yet</p>
          <button
            onClick={() => setMode("create")}
            className="text-xs font-heading text-violet-500 hover:text-violet-400 transition-colors"
          >
            Create your first plan →
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => (
            <PlanRow
              key={plan._id}
              plan={plan}
              expanded={expandedId === plan._id}
              onToggle={() => handleToggleExpand(plan._id)}
              detail={expandedId === plan._id ? expandedDetail : undefined}
              loadingDetail={loadingDetail && expandedId === plan._id}
              onEdit={() => startEdit(plan)}
              onDelete={() => handleDelete(plan)}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default PaymentPlanMaster;
