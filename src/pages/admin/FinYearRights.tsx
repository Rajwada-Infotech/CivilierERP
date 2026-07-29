import React, { useCallback, useMemo, useState } from "react";
import { useFinYear, type FinYear } from "@/contexts/FinYearContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  Edit3,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  Unlock,
  X,
  AlertTriangle,
  CalendarRange,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { finYearSchema, type FinYearForm } from "@/schemas/finYearSchema";
import { usePageRights } from "@/hooks/usePageRights";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMPTY_FORM: FinYearForm = {
  year: "",
  startDate: "",
  endDate: "",
  status: "Active",
  locked: false,
};

function fmtDate(d: string) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** How far through the financial year are we? (0–100) */
function periodProgress(startDate: string, endDate: string): number {
  const now   = Date.now();
  const start = new Date(startDate).getTime();
  const end   = new Date(endDate).getTime();
  if (!start || !end || end <= start) return 0;
  const pct = ((now - start) / (end - start)) * 100;
  return Math.min(100, Math.max(0, pct));
}

// ─── Stat Pill ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}
      >
        <Icon size={15} style={{ color: accent }} />
      </div>
      <div>
        <p className="text-xl font-bold text-foreground leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ─── Year Card ────────────────────────────────────────────────────────────────

function YearCard({
  fy,
  lockPending,
  onEdit,
  onToggleLock,
  onDelete,
  canEdit,
  canDelete,
}: {
  fy: FinYear;
  lockPending: boolean;
  onEdit: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const isActive  = fy.status === "Active";
  const progress  = isActive ? periodProgress(fy.startDate, fy.endDate) : 0;

  const statusCls = isActive
    ? "bg-emerald-500/10 text-emerald-600 border-emerald-400/20 dark:text-emerald-400"
    : "bg-slate-500/10 text-slate-500 border-slate-400/20";

  const lockCls = fy.locked
    ? "bg-amber-500/10 text-amber-600 border-amber-400/20 dark:text-amber-400"
    : "bg-muted text-muted-foreground border-border";

  const accentColor = isActive ? "#3b82f6" : "#64748b";

  return (
    <div className="relative rounded-2xl border border-border bg-card overflow-hidden hover:border-blue-400/30 hover:shadow-md transition-all duration-200 group">
      {/* Top accent bar */}
      <div
        className="h-0.5 w-full"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
      />

      <div className="p-5 space-y-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}25` }}
            >
              <CalendarRange size={16} style={{ color: accentColor }} />
            </div>
            <div>
              <p className="text-base font-bold text-foreground font-heading leading-tight">
                {fy.year}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Financial Year</p>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
              {fy.status}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${lockCls}`}>
              {fy.locked ? <Lock size={9} /> : <Unlock size={9} />}
              {fy.locked ? "Locked" : "Open"}
            </span>
          </div>
        </div>

        {/* Date range */}
        <div className="rounded-xl bg-muted/40 border border-border/60 px-3.5 py-2.5 flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarDays size={12} className="shrink-0 text-blue-500/70" />
          <span className="font-medium text-foreground">{fmtDate(fy.startDate)}</span>
          <span className="text-muted-foreground/40 mx-0.5">→</span>
          <span className="font-medium text-foreground">{fmtDate(fy.endDate)}</span>
        </div>

        {/* Progress bar (only for active years) */}
        {isActive && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Year progress</span>
              <span className="font-semibold text-foreground">{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/60">
          {canEdit && (
            <button
              onClick={onEdit}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted hover:text-foreground text-muted-foreground transition-colors"
            >
              <Edit3 size={11} />
              Edit
            </button>
          )}
          {canEdit && (
            <button
              onClick={onToggleLock}
              disabled={lockPending}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                fy.locked
                  ? "border-emerald-400/30 text-emerald-600 hover:bg-emerald-500/8 dark:text-emerald-400"
                  : "border-amber-400/30 text-amber-600 hover:bg-amber-500/8 dark:text-amber-400"
              }`}
            >
              {lockPending
                ? <Loader2 size={11} className="animate-spin" />
                : fy.locked
                ? <Unlock size={11} />
                : <Lock size={11} />}
              {fy.locked ? "Unlock" : "Lock"}
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:bg-red-500/8 hover:text-red-500 hover:border-red-400/30 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Form Dialog ──────────────────────────────────────────────────────────────

function FinYearDialog({
  open,
  editing,
  isSaving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: FinYear | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (v: FinYearForm) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FinYearForm>({
    resolver: zodResolver(finYearSchema),
    defaultValues: EMPTY_FORM,
  });

  const formData = watch();

  React.useEffect(() => {
    if (open) {
      reset(
        editing
          ? { year: editing.year, startDate: editing.startDate, endDate: editing.endDate, status: editing.status, locked: editing.locked }
          : EMPTY_FORM,
      );
    }
  }, [open, editing, reset]);

  const inputCls =
    "w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/50 transition-all";

  const dateCls =
    "w-full pl-8 pr-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/50 transition-all [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:cursor-pointer";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isSaving) onClose(); }}>
      <DialogContent className="p-0 gap-0 overflow-hidden max-w-sm w-[calc(100vw-2rem)]">
        <DialogTitle className="sr-only">
          {editing ? "Edit Financial Year" : "New Financial Year"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Configure financial year details
        </DialogDescription>

        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-blue-500/8 via-transparent to-transparent border-b border-border">
          <button
            onClick={() => { if (!isSaving) onClose(); }}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
              <CalendarRange size={15} className="text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {editing ? "Edit Financial Year" : "New Financial Year"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {editing ? `Editing ${editing.year}` : "Configure dates, status and lock"}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="px-6 py-5 space-y-4">

            {/* Year name */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Year Label <span className="text-red-500">*</span>
              </label>
              <input
                {...register("year")}
                placeholder="e.g. 2025-26 or FY 2025-2026"
                className={inputCls}
              />
              {errors.year && (
                <p className="text-[11px] text-red-500 flex items-center gap-1">
                  <AlertTriangle size={10} /> {errors.year.message}
                </p>
              )}
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Start Date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input type="date" {...register("startDate")} className={dateCls} />
                </div>
                {errors.startDate && (
                  <p className="text-[11px] text-red-500">{errors.startDate.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  End Date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input type="date" {...register("endDate")} className={dateCls} />
                </div>
                {errors.endDate && (
                  <p className="text-[11px] text-red-500">{errors.endDate.message}</p>
                )}
              </div>
            </div>

            {/* Status toggle buttons */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Status</label>
              <div className="flex gap-2">
                {(["Active", "Closed"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setValue("status", s, { shouldValidate: true })}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-xl border transition-all ${
                      formData.status === s
                        ? s === "Active"
                          ? "bg-emerald-500/10 border-emerald-400/40 text-emerald-600 dark:text-emerald-400"
                          : "bg-slate-500/10 border-slate-400/40 text-slate-600 dark:text-slate-400"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {s === "Active" ? <CheckCircle2 size={12} /> : <X size={12} />}
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Lock toggle */}
            <div className={`flex items-center justify-between px-3.5 py-3 rounded-xl border transition-colors ${
              formData.locked
                ? "bg-amber-500/8 border-amber-400/30"
                : "bg-muted/30 border-border"
            }`}>
              <div className="flex items-center gap-2.5">
                {formData.locked
                  ? <Lock size={14} className="text-amber-500" />
                  : <Unlock size={14} className="text-muted-foreground" />}
                <div>
                  <p className="text-xs font-semibold text-foreground">Lock Year</p>
                  <p className="text-[10px] text-muted-foreground">Prevents new entries when locked</p>
                </div>
              </div>
              <Switch
                checked={formData.locked}
                onCheckedChange={(c) => setValue("locked", c)}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pb-5 flex gap-2.5 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => { if (!isSaving) onClose(); }}
              disabled={isSaving}
              className="flex-1 py-2.5 text-sm rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-heading font-semibold rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {isSaving ? "Saving…" : editing ? "Save Changes" : "Create Year"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function FinYearRights() {
  const rights = usePageRights("fin-year-rights");
  const { finYears, isLoading, addFinYear, updateFinYear, toggleLock, deleteFinYear } = useFinYear();

  const [searchTerm, setSearchTerm]   = useState("");
  const [showDialog, setShowDialog]   = useState(false);
  const [editingFY, setEditingFY]     = useState<FinYear | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [pendingLockId, setPendingLockId] = useState<string | null>(null);
  const [isSaving, setIsSaving]       = useState(false);
  const [isDeleting, setIsDeleting]   = useState(false);

  const filtered = useMemo(
    () =>
      finYears.filter(
        (fy) =>
          fy.year.toLowerCase().includes(searchTerm.toLowerCase()) ||
          fy.startDate.includes(searchTerm) ||
          fy.endDate.includes(searchTerm),
      ),
    [finYears, searchTerm],
  );

  const activeCount = useMemo(() => finYears.filter((f) => f.status === "Active").length, [finYears]);
  const lockedCount = useMemo(() => finYears.filter((f) => f.locked).length, [finYears]);
  const closedCount = finYears.length - activeCount;

  const openAdd = useCallback(() => { setEditingFY(null); setShowDialog(true); }, []);
  const openEdit = useCallback((fy: FinYear) => { setEditingFY(fy); setShowDialog(true); }, []);
  const closeDialog = useCallback(() => { setShowDialog(false); setEditingFY(null); }, []);

  const handleSave = useCallback(
    async (values: FinYearForm) => {
      setIsSaving(true);
      try {
        if (editingFY) {
          await updateFinYear(editingFY.id, values);
          toast.success(`"${values.year}" updated`);
        } else {
          await addFinYear(values as Omit<FinYear, "id">);
          toast.success(`"${values.year}" created`);
        }
        closeDialog();
      } catch (err: any) {
        toast.error(err?.message || "Save failed");
      } finally {
        setIsSaving(false);
      }
    },
    [addFinYear, editingFY, updateFinYear, closeDialog],
  );

  const handleToggleLock = useCallback(
    async (id: string, locked: boolean) => {
      setPendingLockId(id);
      try {
        await toggleLock(id, !locked);
        toast.success(!locked ? "Year locked" : "Year unlocked");
      } catch (err: any) {
        toast.error(err?.message || "Failed to change lock");
      } finally {
        setPendingLockId(null);
      }
    },
    [toggleLock],
  );

  const handleDelete = useCallback(async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await deleteFinYear(deletingId);
      toast.success("Financial year deleted");
    } catch (err: any) {
      toast.error(err?.message || "Delete failed");
    } finally {
      setIsDeleting(false);
      setDeletingId(null);
    }
  }, [deleteFinYear, deletingId]);

  const deletingYear = finYears.find((f) => f.id === deletingId);

  return (
    <>
      <Breadcrumbs items={["Admin", "Rights", "Fin Year Rights"]} />

      <AdminShell
        title="Financial Year Rights"
        subtitle="Manage financial years, date ranges, and lock status"
        icon={Calendar}
        action={
          rights.canCreate && (
            <button
              onClick={openAdd}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 transition-all disabled:opacity-50"
            >
              <Plus size={13} />
              New Year
            </button>
          )
        }
      >

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={CalendarRange} label="Total Years"    value={finYears.length} accent="#3b82f6" />
          <StatCard icon={CheckCircle2}  label="Active"         value={activeCount}     accent="#10b981" />
          <StatCard icon={X}             label="Closed"         value={closedCount}     accent="#64748b" />
          <StatCard icon={ShieldCheck}   label="Locked"         value={lockedCount}     accent="#f59e0b" />
        </div>

        {/* ── Search ── */}
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search financial years…"
            className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500/50 transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* ── Grid ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" />
            Loading financial years…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-4 text-center rounded-2xl border border-dashed border-border bg-muted/20">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              <CalendarDays size={22} className="text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {searchTerm ? "No years match your search" : "No financial years configured"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchTerm ? "Try clearing your search." : "Click \"New Year\" to add your first financial year."}
              </p>
            </div>
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} className="text-xs text-blue-500 hover:underline">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((fy) => (
              <YearCard
                key={fy.id}
                fy={fy}
                lockPending={pendingLockId === fy.id}
                onEdit={() => openEdit(fy)}
                onToggleLock={() => handleToggleLock(fy.id, fy.locked)}
                onDelete={() => setDeletingId(fy.id)}
                canEdit={rights.canEdit}
                canDelete={rights.canDelete}
              />
            ))}
          </div>
        )}

      </AdminShell>

      {/* ── Form dialog ── */}
      <FinYearDialog
        open={showDialog}
        editing={editingFY}
        isSaving={isSaving}
        onClose={closeDialog}
        onSubmit={handleSave}
      />

      {/* ── Delete confirm ── */}
      <AlertDialog open={!!deletingId} onOpenChange={(o) => { if (!o) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" />
              Delete Financial Year?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-semibold text-foreground">{deletingYear?.year}</span>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Deleting…</>
              ) : (
                <><Trash2 className="mr-2 h-3.5 w-3.5" />Delete</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
