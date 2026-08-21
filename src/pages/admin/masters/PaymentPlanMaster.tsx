import React, { useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Button } from "@/components/ui/button";
import {
  Landmark,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Search,
  IndianRupee,
  Percent,
} from "lucide-react";

// Same mount path — no server.js change needed
const API = "/api/payment-plan-master";

// ─── Types ────────────────────────────────────────────────────────────────────
type ValueType = "percent" | "fixed";

interface PaymentTerm {
  TermID: number;
  TermName: string;
  ValueType: ValueType;
  TermValue: number;
  CreditDays: number | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

interface DraftRow {
  TermName: string;
  ValueType: ValueType;
  TermValue: string;
  CreditDays: string;
}

const EMPTY_DRAFT: DraftRow = {
  TermName: "",
  ValueType: "percent",
  TermValue: "",
  CreditDays: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchTerms(): Promise<PaymentTerm[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch payment terms");
  return res.json().catch(() => ({}));
}

const TYPE_META: Record<
  ValueType,
  { label: string; icon: React.ReactNode; badge: string }
> = {
  percent: {
    label: "%",
    icon: <Percent size={10} />,
    badge: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
  fixed: {
    label: "Fixed",
    icon: <IndianRupee size={10} />,
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
};

const formatValue = (t: PaymentTerm) => {
  if (t.ValueType === "percent") return `${t.TermValue}%`;
  return `₹${Number(t.TermValue).toLocaleString("en-IN")}`;
};

const TypeToggle: React.FC<{
  value: ValueType;
  onChange: (v: ValueType) => void;
}> = ({ value, onChange }) => (
  <div className="flex items-center gap-1 justify-center flex-wrap">
    {(Object.keys(TYPE_META) as ValueType[]).map((vt) => (
      <button
        key={vt}
        onClick={() => onChange(vt)}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] transition-colors ${
          value === vt
            ? "bg-primary text-primary-foreground border-primary"
            : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
        }`}
      >
        {TYPE_META[vt].icon}
        {TYPE_META[vt].label}
      </button>
    ))}
  </div>
);

// ─── Component ────────────────────────────────────────────────────────────────
const PaymentPlanMaster: React.FC = () => {
  usePageRights("payment-plan-master");
  const queryClient = useQueryClient();

  const [showAddRow, setShowAddRow] = useState(false);
  const [draft, setDraft] = useState<DraftRow>(EMPTY_DRAFT);
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | ValueType>("all");

  const {
    data: terms = [],
    isLoading,
    error,
  } = useQuery<PaymentTerm[]>({
    queryKey: ["payment-term-master"],
    queryFn: fetchTerms,
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["payment-term-master"] }),
    [queryClient],
  );

  const filtered = useMemo(
    () =>
      terms.filter((t) => {
        const matchSearch =
          !search || t.TermName.toLowerCase().includes(search.toLowerCase());
        const matchType = filterType === "all" || t.ValueType === filterType;
        return matchSearch && matchType;
      }),
    [terms, search, filterType],
  );

  const totalPercent = useMemo(
    () =>
      terms
        .filter((t) => t.ValueType === "percent" && t.IsActive)
        .reduce((acc, t) => acc + t.TermValue, 0),
    [terms],
  );

  const activeCount = useMemo(
    () => terms.filter((t) => t.IsActive).length,
    [terms],
  );

  const validate = (d: DraftRow): string | null => {
    if (!d.TermName.trim()) return "Term name is required";
    const v = parseFloat(d.TermValue);
    if (isNaN(v) || v < 0) return "Value must be a positive number";
    if (d.ValueType === "percent" && v > 100)
      return "Percent cannot exceed 100";
    if (d.CreditDays !== "") {
      const days = parseInt(d.CreditDays, 10);
      if (!Number.isFinite(days) || days < 0)
        return "Credit days must be zero or more";
    }
    return null;
  };

  // ── Add ────────────────────────────────────────────────────────────────────
  const handleAdd = useCallback(async () => {
    const err = validate(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          TermName: draft.TermName.trim(),
          ValueType: draft.ValueType,
          TermValue: parseFloat(draft.TermValue),
          CreditDays:
            draft.CreditDays === "" ? null : parseInt(draft.CreditDays, 10),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success("Payment term added");
      await invalidate();
      setDraft(EMPTY_DRAFT);
      setShowAddRow(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to add term");
    } finally {
      setSaving(false);
    }
  }, [draft, invalidate]);

  // ── Edit ───────────────────────────────────────────────────────────────────
  const startEdit = useCallback((t: PaymentTerm) => {
    setEditId(t.TermID);
    setEditDraft({
      TermName: t.TermName,
      ValueType: t.ValueType,
      TermValue: String(t.TermValue),
      CreditDays: t.CreditDays == null ? "" : String(t.CreditDays),
    });
    setShowAddRow(false);
  }, []);

  const handleEdit = useCallback(async () => {
    const err = validate(editDraft);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          TermName: editDraft.TermName.trim(),
          ValueType: editDraft.ValueType,
          TermValue: parseFloat(editDraft.TermValue),
          CreditDays:
            editDraft.CreditDays === ""
              ? null
              : parseInt(editDraft.CreditDays, 10),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success("Term updated");
      await invalidate();
      setEditId(null);
    } catch (e: any) {
      toast.error(e.message || "Failed to update term");
    } finally {
      setSaving(false);
    }
  }, [editId, editDraft, invalidate]);

  // ── Toggle active ──────────────────────────────────────────────────────────
  const handleToggle = useCallback(
    async (term: PaymentTerm) => {
      try {
        const res = await fetchWithAuth(`${API}/${term.TermID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ IsActive: !term.IsActive }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        await invalidate();
        toast.success(term.IsActive ? "Term deactivated" : "Term activated");
      } catch (e: any) {
        toast.error(e.message || "Failed");
      }
    },
    [invalidate],
  );

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    async (term: PaymentTerm) => {
      if (!confirm(`Delete "${term.TermName}"?`)) return;
      try {
        const res = await fetchWithAuth(`${API}/${term.TermID}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed");
        const data = await res.json();
        await invalidate();
        if (data.softDeleted)
          toast.info("Term is in use — deactivated instead of deleted");
        else toast.success("Term deleted");
      } catch (e: any) {
        toast.error(e.message || "Delete failed");
      }
    },
    [invalidate],
  );

  if (error)
    return (
      <div className="p-6 text-red-500 text-sm">
        Failed to load payment terms.
      </div>
    );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Dashboard" },
          { label: "Follow-Up" },
          { label: "Setup" },
          { label: "Payment Plan Master" },
        ]}
      />

      <FollowupShell
        title="Payment Plan Master"
        icon={Landmark}
        action={
          <Button
            size="sm"
            onClick={() => {
              setShowAddRow(true);
              setEditId(null);
            }}
            className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
          >
            <Plus size={14} />
            Add Milestone
          </Button>
        }
      >

      {/* ── Summary chips ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-3 py-1 rounded-full text-xs font-heading bg-primary/10 text-primary border border-primary/20">
          {activeCount} active
        </span>
        {totalPercent > 0 && (
          <span
            className={`px-3 py-1 rounded-full text-xs font-heading border ${
              totalPercent === 100
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : totalPercent > 100
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
            }`}
          >
            % total: {totalPercent.toFixed(2)}%
            {totalPercent === 100 ? " ✓" : totalPercent > 100 ? " !" : ""}
          </span>
        )}
      </div>

      {/* ── Table card ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-card/80 border border-border shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card/60">
          <div className="relative w-full sm:w-52">
            <Search
              size={12}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              placeholder="Search term…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(["all", "percent", "fixed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterType(f)}
                className={`px-2.5 py-1 text-[11px] rounded-lg border whitespace-nowrap transition-colors ${
                  filterType === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f === "all"
                  ? "All"
                  : f === "percent"
                    ? "% Percent"
                    : "₹ Fixed"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Mobile cards (< sm) ────────────────────────────────────────────── */}
        <div className="sm:hidden divide-y divide-border/40">
          {/* Add row — mobile */}
          {showAddRow && (
            <div className="p-4 bg-primary/5 border-b border-primary/30 space-y-3">
              <input
                autoFocus
                placeholder="Payment term name"
                value={draft.TermName}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, TermName: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <TypeToggle
                value={draft.ValueType}
                onChange={(vt) => setDraft((d) => ({ ...d, ValueType: vt }))}
              />
              <input
                type="number"
                min={0}
                placeholder="0"
                value={draft.TermValue}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, TermValue: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                type="number"
                min={0}
                placeholder="Credit days"
                value={draft.CreditDays}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, CreditDays: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}{" "}
                  Save
                </button>
                <button
                  onClick={() => {
                    setShowAddRow(false);
                    setDraft(EMPTY_DRAFT);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border bg-muted text-muted-foreground text-sm"
                >
                  <X size={14} /> Cancel
                </button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Landmark className="w-10 h-10 opacity-20 mx-auto mb-2" />
              <p className="text-sm font-heading">
                {terms.length === 0 ? "No payment terms yet" : "No results"}
              </p>
            </div>
          ) : (
            filtered.map((term) => {
              const isEditing = editId === term.TermID;
              const meta = TYPE_META[term.ValueType];
              return (
                <div
                  key={term.TermID}
                  className={`p-4 space-y-3 ${!term.IsActive ? "opacity-50" : ""} ${isEditing ? "bg-primary/5" : ""}`}
                >
                  {isEditing ? (
                    <>
                      <input
                        autoFocus
                        value={editDraft.TermName}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            TermName: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <TypeToggle
                        value={editDraft.ValueType}
                        onChange={(vt) =>
                          setEditDraft((d) => ({ ...d, ValueType: vt }))
                        }
                      />
                      <input
                        type="number"
                        min={0}
                        value={editDraft.TermValue}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            TermValue: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <input
                        type="number"
                        min={0}
                        placeholder="Credit days"
                        value={editDraft.CreditDays}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            CreditDays: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleEdit}
                          disabled={saving}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
                        >
                          {saving ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}{" "}
                          Save
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border bg-muted text-muted-foreground text-sm"
                        >
                          <X size={14} /> Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-body text-foreground truncate">
                          {term.TermName}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-heading ${meta.badge}`}
                          >
                            {meta.icon} {meta.label}
                          </span>
                          <span className="font-mono font-semibold text-sm text-foreground">
                            {formatValue(term)}
                          </span>
                          {term.CreditDays != null && (
                            <span className="text-[11px] text-muted-foreground">
                              {term.CreditDays} credit days
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleToggle(term)}
                          className="text-muted-foreground hover:text-primary transition-colors"
                        >
                          {term.IsActive ? (
                            <ToggleRight size={22} className="text-primary" />
                          ) : (
                            <ToggleLeft size={22} />
                          )}
                        </button>
                        <button
                          onClick={() => startEdit(term)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(term)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:text-red-400 hover:border-red-400/40 transition-all"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── Desktop table (>= sm) ─────────────────────────────────────────── */}
        <div className="hidden sm:block overflow-x-auto thin-scroll">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground">
                  Payment Term Name
                </th>
                <th className="px-4 py-3 font-heading font-semibold text-muted-foreground text-center w-44">
                  Type
                </th>
                <th className="px-4 py-3 font-heading font-semibold text-muted-foreground text-right w-36">
                  Value
                </th>
                <th className="px-4 py-3 font-heading font-semibold text-muted-foreground text-right w-32">
                  Credit Days
                </th>
                <th className="px-4 py-3 font-heading font-semibold text-muted-foreground text-center w-20">
                  Active
                </th>
                <th className="px-4 py-3 font-heading font-semibold text-muted-foreground text-center w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Add row */}
              {showAddRow && (
                <tr className="border-b border-primary/30 bg-primary/5">
                  <td className="px-5 py-2.5">
                    <input
                      autoFocus
                      placeholder="e.g. On Foundation"
                      value={draft.TermName}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, TermName: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAdd();
                        if (e.key === "Escape") {
                          setShowAddRow(false);
                          setDraft(EMPTY_DRAFT);
                        }
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-sm bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <TypeToggle
                      value={draft.ValueType}
                      onChange={(vt) =>
                        setDraft((d) => ({ ...d, ValueType: vt }))
                      }
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={draft.TermValue}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, TermValue: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAdd();
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-sm text-right bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={draft.CreditDays}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          CreditDays: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAdd();
                      }}
                      className="w-full px-3 py-1.5 rounded-lg text-sm text-right bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </td>
                  <td />
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={handleAdd}
                        disabled={saving}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
                      >
                        {saving ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Check size={13} />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setShowAddRow(false);
                          setDraft(EMPTY_DRAFT);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Data rows */}
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-16 text-center text-muted-foreground"
                  >
                    <Landmark className="w-10 h-10 opacity-20 mx-auto mb-2" />
                    <p className="text-sm font-heading">
                      {terms.length === 0
                        ? "No payment terms yet — add your first milestone"
                        : "No results match your filter"}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((term) => {
                  const isEditing = editId === term.TermID;
                  const meta = TYPE_META[term.ValueType];
                  return (
                    <tr
                      key={term.TermID}
                      className={`border-b border-border/40 transition-colors ${isEditing ? "bg-primary/5 border-primary/20" : "hover:bg-muted/20"} ${!term.IsActive ? "opacity-50" : ""}`}
                    >
                      {/* Name */}
                      <td className="px-5 py-2.5">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editDraft.TermName}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                TermName: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleEdit();
                              if (e.key === "Escape") setEditId(null);
                            }}
                            className="w-full px-3 py-1.5 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ) : (
                          <span className="font-body text-foreground">
                            {term.TermName}
                          </span>
                        )}
                      </td>
                      {/* Type */}
                      <td className="px-4 py-2.5 text-center">
                        {isEditing ? (
                          <TypeToggle
                            value={editDraft.ValueType}
                            onChange={(vt) =>
                              setEditDraft((d) => ({ ...d, ValueType: vt }))
                            }
                          />
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-heading ${meta.badge}`}
                          >
                            {meta.icon} {meta.label}
                          </span>
                        )}
                      </td>
                      {/* Value */}
                      <td className="px-4 py-2.5 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            value={editDraft.TermValue}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                TermValue: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleEdit();
                            }}
                            className="w-full px-3 py-1.5 rounded-lg text-sm text-right bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ) : (
                          <span className="font-mono font-semibold text-foreground">
                            {formatValue(term)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            value={editDraft.CreditDays}
                            onChange={(e) =>
                              setEditDraft((d) => ({
                                ...d,
                                CreditDays: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleEdit();
                            }}
                            className="w-full px-3 py-1.5 rounded-lg text-sm text-right bg-muted border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ) : (
                          <span className="font-mono text-foreground">
                            {term.CreditDays ?? "-"}
                          </span>
                        )}
                      </td>
                      {/* Active */}
                      <td className="px-4 py-2.5 text-center">
                        {!isEditing && (
                          <button
                            onClick={() => handleToggle(term)}
                            className="text-muted-foreground hover:text-primary transition-colors"
                          >
                            {term.IsActive ? (
                              <ToggleRight size={22} className="text-primary" />
                            ) : (
                              <ToggleLeft size={22} />
                            )}
                          </button>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {isEditing ? (
                            <>
                              <button
                                onClick={handleEdit}
                                disabled={saving}
                                className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
                              >
                                {saving ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Check size={13} />
                                )}
                              </button>
                              <button
                                onClick={() => setEditId(null)}
                                className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEdit(term)}
                                className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => handleDelete(term)}
                                className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:text-red-400 hover:border-red-400/40 transition-all"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {!isLoading && terms.length > 0 && (
          <div className="px-5 py-3 border-t border-border bg-muted/20">
            <p className="text-xs text-muted-foreground font-body">
              {filtered.length} of {terms.length} terms shown
              {filterType !== "all" || search ? " (filtered)" : ""}
            </p>
          </div>
        )}
      </div>
      </FollowupShell>
    </>
  );
};

export default PaymentPlanMaster;
