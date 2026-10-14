import React, { useCallback, useMemo, useState } from "react";
import { useFinYear, type FinYear } from "@/contexts/FinYearContext";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
import { DateInput } from "@/components/ui/date-input";

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

// ─── Drawing-sheet ink ─────────────────────────────────────────────────────────

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";

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

  return (
    <div className={`bg-card flex flex-col border ${isActive ? "border-foreground" : "border-dashed border-foreground/50"}`}>
      <div className="p-4 space-y-3 flex-1">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={LBL}>Financial year</p>
            <p className="font-heading text-xl font-bold tracking-tight tabular-nums text-foreground leading-tight whitespace-nowrap mt-0.5">
              {fy.year}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {isActive ? <SheetMark text="Active" tone="done" /> : <span className={LBL}>{fy.status}</span>}
            <span className={`${TAG} ${fy.locked ? "bg-foreground text-card border-foreground" : "text-muted-foreground border-foreground/40"}`}>
              {fy.locked ? <Lock size={9} /> : <Unlock size={9} />}
              {fy.locked ? "Locked" : "Open"}
            </span>
          </div>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2 text-xs whitespace-nowrap py-2 border-y border-foreground/15">
          <CalendarDays size={12} className="shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground tabular-nums">{fmtDate(fy.startDate)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium text-foreground tabular-nums">{fmtDate(fy.endDate)}</span>
        </div>

        {/* How far through the year (active years only) */}
        {isActive && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className={LBL}>Year progress</span>
              <span className="font-heading text-xs font-semibold tabular-nums text-foreground">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 border border-foreground/50 overflow-hidden">
              <div className="h-full bg-foreground transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {(canEdit || canDelete) && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-foreground/25">
          {canEdit && (
            <button onClick={onEdit} className={`${KEY_LINE} flex-1 h-8`}>
              <Edit3 size={11} />
              Edit
            </button>
          )}
          {canEdit && (
            <button onClick={onToggleLock} disabled={lockPending} className={`${KEY_LINE} flex-1 h-8`}>
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
              aria-label={`Delete ${fy.year}`}
              className="w-8 h-8 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
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
    "w-full h-10 px-3 text-sm border border-foreground/40 focus:border-foreground bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none";

  const dateCls =
    "w-full pl-8 pr-3 h-10 text-sm border border-foreground/40 focus:border-foreground bg-card text-foreground focus:outline-none";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isSaving) onClose(); }}>
      <DialogContent className="sheet-frame p-0 gap-0 overflow-hidden max-w-sm w-[calc(100vw-2rem)]" style={{ margin: 0 }}>
        <DialogTitle className="sr-only">
          {editing ? "Edit Financial Year" : "New Financial Year"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Configure financial year details
        </DialogDescription>

        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: RULE }}>
          <p className={LBL}>{editing ? `Editing ${editing.year}` : "Dates, status and lock"}</p>
          <p className="font-heading text-lg font-bold tracking-tight text-foreground mt-1">
            {editing ? "Edit financial year" : "New financial year"}
          </p>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="px-6 py-5 space-y-4">

            {/* Year name */}
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>
                Year Label <span className="text-destructive">*</span>
              </label>
              <input
                {...register("year")}
                placeholder="e.g. 2025-26 or FY 2025-2026"
                className={inputCls}
              />
              {errors.year && (
                <p className="text-[0.6875rem] text-destructive flex items-center gap-1">
                  <AlertTriangle size={10} /> {errors.year.message}
                </p>
              )}
            </div>

            {/* Date range */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={`${LBL} block`}>
                  Start Date <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <DateInput {...register("startDate")} className={dateCls} />
                </div>
                {errors.startDate && (
                  <p className="text-[0.6875rem] text-destructive">{errors.startDate.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className={`${LBL} block`}>
                  End Date <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <DateInput {...register("endDate")} className={dateCls} />
                </div>
                {errors.endDate && (
                  <p className="text-[0.6875rem] text-destructive">{errors.endDate.message}</p>
                )}
              </div>
            </div>

            {/* Status toggle buttons */}
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>Status</label>
              <div className="flex gap-2">
                {(["Active", "Closed"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setValue("status", s, { shouldValidate: true })}
                    aria-pressed={formData.status === s}
                    className={`${KEY} flex-1 h-9 border ${
                      formData.status === s
                        ? "bg-foreground text-card border-foreground"
                        : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"
                    }`}
                  >
                    {s === "Active" ? <CheckCircle2 size={12} /> : <X size={12} />}
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Lock toggle */}
            <div className={`flex items-center justify-between px-3.5 py-3 border transition-colors ${
              formData.locked ? "border-foreground" : "border-foreground/30"
            }`}>
              <div className="flex items-center gap-2.5">
                {formData.locked
                  ? <Lock size={14} className="text-foreground" />
                  : <Unlock size={14} className="text-muted-foreground" />}
                <div>
                  <p className="text-xs font-semibold text-foreground">Lock year</p>
                  <p className="text-[0.625rem] text-muted-foreground">Prevents new entries when locked</p>
                </div>
              </div>
              <Switch
                checked={formData.locked}
                onCheckedChange={(c) => setValue("locked", c)}
                className="data-[state=checked]:bg-foreground"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pb-5 flex gap-2 pt-4" style={{ borderTop: RULE }}>
            <button
              type="button"
              onClick={() => { if (!isSaving) onClose(); }}
              disabled={isSaving}
              className={`${KEY_LINE} flex-1 h-10`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className={`${KEY_INK} flex-1 h-10`}
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {isSaving ? "Saving…" : editing ? "Save changes" : "Create year"}
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

      <SheetShell
        eyebrow="CivilierERP · Admin · Rights"
        title="Financial years"
        subtitle="The financial years entries are booked in, their date ranges, and whether each is locked against new entries."
        action={
          rights.canCreate && (
            <button
              onClick={openAdd}
              disabled={isLoading}
              className={`${KEY_INK} h-9 px-4`}
            >
              <Plus size={13} />
              New year
            </button>
          )
        }
      >

        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Years", value: finYears.length, note: "set up" },
              { label: "Active", value: activeCount, note: "open for the year's work" },
              { label: "Closed", value: closedCount, note: "finished" },
              { label: "Locked", value: lockedCount, note: "no new entries" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5 mr-auto">
              <span className={HEAD}>Years</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{filtered.length}</span>
            </p>
            <div className="relative w-full sm:w-72">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search financial years…"
                className="w-full h-9 pl-8 pr-8 text-sm border border-foreground/40 focus:border-foreground bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="p-4">
        {/* ── Grid ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground text-sm">
            <Loader2 size={16} className="animate-spin" />
            Loading financial years…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-3 text-center border border-dashed border-foreground/40">
            <div>
              <p className="font-heading text-base font-bold tracking-tight text-foreground">
                {searchTerm ? "No years match your search" : "No financial years configured"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchTerm ? "Try clearing your search." : "Use New year to add your first financial year."}
              </p>
            </div>
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} className={`${KEY_LINE} h-9 px-4`}>
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
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
          </div>
        </div>

      </SheetShell>

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
        <AlertDialogContent className="sheet-frame" style={{ margin: 0 }}>
          <AlertDialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Financial year</p>
              <AlertDialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Delete {deletingYear?.year}</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-semibold text-foreground">{deletingYear?.year}</span>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-3" style={{ borderTop: RULE }}>
            <AlertDialogCancel disabled={isDeleting} className={`${KEY_LINE} h-9 px-4 rounded-none bg-card`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={`${KEY} h-9 px-5 rounded-none !bg-destructive !text-destructive-foreground border border-destructive hover:!bg-destructive/90`}
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Deleting…</>
              ) : (
                <><Trash2 className="h-3.5 w-3.5" />Delete</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
