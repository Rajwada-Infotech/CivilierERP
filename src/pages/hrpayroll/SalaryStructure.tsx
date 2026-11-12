import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoneyChange, Add, Edit2, ArrowUp2, ArrowDown2, Copy, TickCircle, CloseCircle } from "iconsax-react";
import { Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrBreakup, HrError, HrSkeleton, hrCard, hrTypeTone, HR_FIELD, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE, KEY_RED_SOLID } from "@/components/sheet/sheetParts";
import { SheetMark } from "@/components/sheet/Sheet";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { FormulaBuilderModal } from "@/components/hrpayroll/FormulaBuilderModal";
import { getEmployeeCompanyOptions } from "@/api/employeeMasterApi";
import { getDeductionAdditions, type DeductionAdditionRow } from "@/api/deductionAdditionMasterApi";
import {
  getSalaryStructures,
  addSalaryStructure,
  updateSalaryStructure,
  deleteSalaryStructure,
  validateSalaryStructure,
  previewCalculate,
  activateSalaryStructure,
  deactivateSalaryStructure,
  copySalaryStructure,
  type SalaryStructureRow,
  type SalaryStructureLinePayload,
  type CalculationType,
  type RoundingRule,
  type CTCFrequency,
  type ValidationError,
  type CalculationResult,
} from "@/api/salaryStructureApi";
import { DateInput } from "@/components/ui/date-input";
import { BodyPortal } from "@/components/ui/body-portal";

const RESERVED_KEYWORDS = [
  "CTC",
  "ANNUAL_CTC",
  "MONTHLY_CTC",
  "GROSS",
  "NET",
  "TOTAL_EARNINGS",
  "TOTAL_DEDUCTION",
  "TOTAL_EMPLOYER_CONTRIBUTION",
];
const CALCULATION_TYPES: CalculationType[] = ["Fixed", "Percentage", "Formula"];
const ROUNDING_RULES: RoundingRule[] = ["None", "Nearest", "Up", "Down"];

interface LineForm {
  deductionAdditionId: string;
  calculationType: CalculationType;
  calculationBase: string;
  percentage: string;
  amount: string;
  formula: string;
  minAmount: string;
  maxAmount: string;
  roundingRule: RoundingRule;
  sequence: number;
  includeInGross: boolean;
  includeInCTC: boolean;
  includeInNet: boolean;
  taxable: boolean;
  isBalancing: boolean;
  isActive: boolean;
}

const emptyLine = (sequence: number): LineForm => ({
  deductionAdditionId: "",
  calculationType: "Fixed",
  calculationBase: "",
  percentage: "",
  amount: "",
  formula: "",
  minAmount: "",
  maxAmount: "",
  roundingRule: "None",
  sequence,
  includeInGross: false,
  includeInCTC: false,
  includeInNet: false,
  taxable: false,
  isBalancing: false,
  isActive: true,
});

const emptyHeader = () => ({
  companyId: "",
  name: "",
  code: "",
  description: "",
  effectiveFrom: "",
  effectiveTo: "",
  ctcFrequency: "Monthly" as CTCFrequency,
  isActive: false,
});

// Sheet fields (docs/DESIGN.md): square h-9 fields in the form, h-8 inside a component line.
const inputBase = HR_FIELD;
const labelBase = `block ${HR_LBL} mb-1.5`;
const smallInput = `${HR_FIELD} !h-8 text-xs`;
const lineLabel = `block ${HR_LBL} mb-1`;
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-30 disabled:hover:border-transparent";
// A segmented switch: one ink-ruled box, the chosen option filled ink.
const SEG = "flex border border-foreground";
const segKey = (on: boolean) => `px-3 h-8 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:bg-primary/10 hover:text-foreground"}`;
const TAG = "inline-flex items-center px-1.5 py-0.5 border font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]";

const SalaryStructure: React.FC = () => {
  const rights = usePageRights("salary-structure");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["salary-structure"],
    queryFn: getSalaryStructures,
    staleTime: 60 * 1000,
  });
  const { data: companyData } = useQuery({
    queryKey: ["employee-company-options"],
    queryFn: getEmployeeCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });
  const { data: headData } = useQuery({
    queryKey: ["deduction-addition-master"],
    queryFn: getDeductionAdditions,
    staleTime: 60 * 1000,
  });

  const structures: SalaryStructureRow[] = Array.isArray(data) ? data : [];
  const companyOptions = Array.isArray(companyData) ? companyData : [];
  const heads: DeductionAdditionRow[] = Array.isArray(headData) ? headData.filter((h) => h.IsActive) : [];
  const headByCode = new Map(heads.map((h) => [h.Code.toUpperCase(), h]));

  const [editingId, setEditingId] = useState<number | null>(null);
  const [header, setHeader] = useState(emptyHeader());
  const [lines, setLines] = useState<LineForm[]>([emptyLine(1)]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [validating, setValidating] = useState(false);
  const [formulaBuilderIdx, setFormulaBuilderIdx] = useState<number | null>(null);
  const [copyTargetId, setCopyTargetId] = useState<number | null>(null);
  const [copyCode, setCopyCode] = useState("");
  const [copyName, setCopyName] = useState("");

  // Preview calculator state
  const [testCtc, setTestCtc] = useState("50000");
  const [testCtcFrequency, setTestCtcFrequency] = useState<CTCFrequency>("Monthly");
  const [previewResult, setPreviewResult] = useState<CalculationResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["salary-structure"] });

  const resetForm = () => {
    setEditingId(null);
    setHeader(emptyHeader());
    setLines([emptyLine(1)]);
    setValidationErrors([]);
    setPreviewResult(null);
  };

  const startEdit = (row: SalaryStructureRow) => {
    setEditingId(row.SalaryStructureId);
    setHeader({
      companyId: row.CompanyId ? String(row.CompanyId) : "",
      name: row.Name,
      code: row.Code,
      description: row.Description || "",
      effectiveFrom: row.EffectiveFrom ? row.EffectiveFrom.slice(0, 10) : "",
      effectiveTo: row.EffectiveTo ? row.EffectiveTo.slice(0, 10) : "",
      ctcFrequency: row.CTCFrequency,
      isActive: row.IsActive,
    });
    setLines(
      row.Lines.length
        ? row.Lines.map((l) => ({
            deductionAdditionId: String(l.DeductionAdditionId),
            calculationType: l.CalculationType,
            calculationBase: l.CalculationBase || "",
            percentage: l.Percentage == null ? "" : String(l.Percentage),
            amount: l.Amount == null ? "" : String(l.Amount),
            formula: l.Formula || "",
            minAmount: l.MinAmount == null ? "" : String(l.MinAmount),
            maxAmount: l.MaxAmount == null ? "" : String(l.MaxAmount),
            roundingRule: l.RoundingRule,
            sequence: l.Sequence,
            includeInGross: l.IncludeInGross,
            includeInCTC: l.IncludeInCTC,
            includeInNet: l.IncludeInNet,
            taxable: l.Taxable,
            isBalancing: l.IsBalancing,
            isActive: l.IsActive,
          }))
        : [emptyLine(1)],
    );
    setValidationErrors([]);
    setPreviewResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateLine = (idx: number, patch: Partial<LineForm>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine(prev.length + 1)]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  const moveLine = (idx: number, dir: -1 | 1) => {
    setLines((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((l, i) => ({ ...l, sequence: i + 1 }));
    });
  };
  const setBalancing = (idx: number) =>
    setLines((prev) => prev.map((l, i) => ({ ...l, isBalancing: i === idx ? !l.isBalancing : false })));

  const linesToPayload = (): SalaryStructureLinePayload[] =>
    lines
      .filter((l) => l.deductionAdditionId !== "")
      .map((l) => ({
        DeductionAdditionId: Number(l.deductionAdditionId),
        CalculationType: l.calculationType,
        CalculationBase: l.calculationType === "Percentage" ? l.calculationBase || null : null,
        Percentage: l.calculationType === "Percentage" && l.percentage.trim() !== "" ? Number(l.percentage) : null,
        Amount: l.calculationType === "Fixed" && l.amount.trim() !== "" ? Number(l.amount) : null,
        Formula: l.calculationType === "Formula" ? l.formula || null : null,
        MinAmount: l.minAmount.trim() === "" ? null : Number(l.minAmount),
        MaxAmount: l.maxAmount.trim() === "" ? null : Number(l.maxAmount),
        RoundingRule: l.roundingRule,
        Sequence: l.sequence,
        IncludeInGross: l.includeInGross,
        IncludeInCTC: l.includeInCTC,
        IncludeInNet: l.includeInNet,
        Taxable: l.taxable,
        IsBalancing: l.isBalancing,
        IsActive: l.isActive,
      }));

  const buildPayload = (isActiveOverride?: boolean) => ({
    CompanyId: header.companyId ? Number(header.companyId) : null,
    Name: header.name.trim(),
    Code: header.code.trim(),
    Description: header.description.trim() || null,
    EffectiveFrom: header.effectiveFrom || null,
    EffectiveTo: header.effectiveTo || null,
    CTCFrequency: header.ctcFrequency,
    IsActive: isActiveOverride !== undefined ? isActiveOverride : header.isActive,
    Lines: linesToPayload(),
  });

  const canSave =
    header.name.trim() !== "" &&
    header.code.trim() !== "" &&
    lines.some((l) => l.deductionAdditionId !== "");

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await validateSalaryStructure(buildPayload());
      setValidationErrors(res.errors || []);
      if (!res.errors?.length) toast.success("No validation errors found");
      else toast.error(`${res.errors.length} validation issue(s) found`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  };

  const runPreview = async () => {
    const ctcNum = Number(testCtc);
    if (!Number.isFinite(ctcNum) || ctcNum <= 0) {
      toast.error("Enter a valid Test CTC");
      return;
    }
    setPreviewLoading(true);
    try {
      const payload =
        editingId !== null
          ? { Id: editingId, TestCTC: ctcNum, TestCTCFrequency: testCtcFrequency }
          : { ...buildPayload(), TestCTC: ctcNum, TestCTCFrequency: testCtcFrequency };
      const res = await previewCalculate(payload);
      setPreviewResult(res);
      if (!res.valid) toast.error("Preview failed validation -- see errors below");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async (andCalculate = false) => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (editingId !== null) {
        const res = await updateSalaryStructure(editingId, buildPayload());
        toast.success("Salary structure updated successfully");
        if (res.warnings?.length) setValidationErrors(res.warnings);
      } else {
        const res = await addSalaryStructure(buildPayload());
        toast.success("Salary structure saved successfully");
        if (res.warnings?.length) setValidationErrors(res.warnings);
        else setValidationErrors([]);
        if (andCalculate) {
          setEditingId(res.id);
          await refresh();
          await runPreview();
          setSaving(false);
          return;
        }
      }
      if (!andCalculate) resetForm();
      await refresh();
    } catch (err) {
      const e = err as Error & { errors?: ValidationError[] };
      toast.error(e.message || "Failed to save. Please try again.");
      if (e.errors?.length) setValidationErrors(e.errors);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await deleteSalaryStructure(id);
      toast.success(res?.message || "Salary structure deleted");
      setDeleteConfirmId(null);
      if (editingId === id) resetForm();
      await refresh();
    } catch (err) {
      setDeleteConfirmId(null);
      toast.error(err instanceof Error ? err.message : "Failed to delete. Please try again.");
    }
  };

  const handleActivate = async (id: number) => {
    try {
      await activateSalaryStructure(id);
      toast.success("Salary structure activated");
      await refresh();
    } catch (err) {
      const e = err as Error & { errors?: ValidationError[] };
      toast.error(e.message || "Failed to activate");
      if (e.errors?.length) {
        e.errors.forEach((er) => toast.error(er.message));
      }
    }
  };

  const handleDeactivate = async (id: number) => {
    try {
      await deactivateSalaryStructure(id);
      toast.success("Salary structure deactivated");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deactivate");
    }
  };

  const handleCopy = async () => {
    if (copyTargetId === null || !copyCode.trim()) return;
    try {
      await copySalaryStructure(copyTargetId, copyCode.trim().toUpperCase(), copyName.trim() || undefined);
      toast.success("Salary structure copied successfully");
      setCopyTargetId(null);
      setCopyCode("");
      setCopyName("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to copy");
    }
  };

  const availableHeadsForFormula = lines
    .filter((l) => l.deductionAdditionId !== "")
    .map((l) => {
      const head = heads.find((h) => String(h.Id) === l.deductionAdditionId);
      return head ? { code: head.Code, label: head.Name } : null;
    })
    .filter((h): h is { code: string; label: string } => h !== null);

  const calculationBaseOptions = [...RESERVED_KEYWORDS, ...availableHeadsForFormula.map((h) => h.code)];

  // ── Presentation helpers (display only) ────────────────────────────────
  // Earnings ink, deductions red, employer contributions blue, informational graphite — same as the breakup (HrUi).
  const toneOf = hrTypeTone;
  const [libSearch, setLibSearch] = useState("");
  const shownStructures = structures.filter((r) => {
    const q = libSearch.trim().toLowerCase();
    return !q || [r.Name, r.Code, r.CompanyName].some((v) => (v || "").toLowerCase().includes(q));
  });
  const card = hrCard;
  const StepHead = ({ n, title, hint }: { n: number; title: string; hint: string }) => (
    <div className="flex items-center gap-3 mb-4">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center border border-foreground text-[0.6875rem] font-bold text-foreground ${HR_NUM}`}>{n}</span>
      <div>
        <p className={`${HR_HEAD} leading-tight`}>{title}</p>
        <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{hint}</p>
      </div>
    </div>
  );
  const Flag = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 h-7 px-2.5 border font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${on ? "bg-foreground text-card border-foreground" : "border-foreground/30 text-muted-foreground hover:text-foreground hover:border-foreground"}`}
    >
      {on && <TickCircle size={11} />} {label}
    </button>
  );
  const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

  const canWrite = editingId === null ? rights.canCreate : rights.canEdit;
  const t = previewResult?.totals;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Salary Structures"]} />
      <HrPayrollShell title="Salary Structures" subtitle="Formula-driven payroll templates built from Salary Heads" icon={MoneyChange}>
        {isLoading ? (
          <HrSkeleton rows={2} />
        ) : error ? (
          <HrError text="Failed to load salary structures." />
        ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[22rem_minmax(0,1fr)] gap-5 items-start">
          {/* ═════════ Library ═════════ */}
          <aside className={`${card} p-4 xl:sticky xl:top-20`}>
            <div className="flex items-center justify-between gap-2 mb-3 pb-3" style={{ borderBottom: HR_RULE }}>
              <div className="flex items-baseline gap-2.5">
                <p className={HR_HEAD}>Structure library</p>
                <span className={`${HR_NUM} text-[0.6875rem] text-muted-foreground`}>{structures.length}</span>
              </div>
              {(rights.canCreate || rights.canEdit) && (
                <button type="button" onClick={resetForm} className={`${KEY_INK} h-8 px-3`}>
                  <Add size={12} /> New
                </button>
              )}
            </div>
            <input value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="Search name, code, company…" className={smallInput + " mb-3"} />
            <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-0.5">
              {shownStructures.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">{structures.length ? "No templates match." : "No templates yet — build one in the builder."}</p>
              ) : shownStructures.map((row) => {
                const sel = editingId === row.SalaryStructureId;
                return (
                  <div
                    key={row.SalaryStructureId}
                    className={`group border p-3 transition-colors ${sel ? "border-foreground bg-primary/5" : "border-foreground/25 bg-card hover:border-foreground"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" onClick={() => rights.canEdit && startEdit(row)} className="min-w-0 text-left" disabled={!rights.canEdit}>
                        <p className="text-sm font-semibold text-foreground truncate">{row.Name}</p>
                        <p className="text-[0.6875rem] text-muted-foreground truncate">
                          <span className={HR_NUM}>{row.Code}</span> · v{row.Version} · {row.Lines.length} line{row.Lines.length !== 1 ? "s" : ""}
                        </p>
                        {row.CompanyName && <p className="text-[0.6875rem] text-muted-foreground truncate">{row.CompanyName}</p>}
                      </button>
                      <span className="shrink-0"><SheetMark text={row.IsActive ? "Active" : "Draft"} tone={row.IsActive ? "done" : "draft"} /></span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-1 border-t border-foreground/15 pt-2">
                      {rights.canEdit && (
                        <button onClick={() => startEdit(row)} title="Edit" className={ACT}><Edit2 size={13} /></button>
                      )}
                      {rights.canEdit && !row.IsActive && (
                        <button onClick={() => handleActivate(row.SalaryStructureId)} title="Activate" className={`${KEY_LINE} h-7 px-2.5`}><TickCircle size={12} /> Activate</button>
                      )}
                      {rights.canEdit && row.IsActive && (
                        <button onClick={() => handleDeactivate(row.SalaryStructureId)} title="Deactivate" className={`${KEY_LINE} h-7 px-2.5`}><CloseCircle size={12} /> Deactivate</button>
                      )}
                      <span className="flex-1" />
                      {rights.canCreate && (
                        <button onClick={() => { setCopyTargetId(row.SalaryStructureId); setCopyCode(""); setCopyName(`${row.Name} Copy`); }} title="Copy structure" className={ACT}><Copy size={13} /></button>
                      )}
                      {rights.canDelete && (
                        deleteConfirmId === row.SalaryStructureId ? (
                          <span className="flex items-center gap-1">
                            <button onClick={() => handleDelete(row.SalaryStructureId)} className={`${KEY_RED_SOLID} h-7 px-2.5`}>Confirm</button>
                            <button onClick={() => setDeleteConfirmId(null)} className={`${KEY_LINE} h-7 px-2.5`}>Cancel</button>
                          </span>
                        ) : (
                          <button onClick={() => setDeleteConfirmId(row.SalaryStructureId)} title="Delete" className={`${ACT} hover:text-destructive hover:border-destructive`}><Trash2 size={13} /></button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ═════════ Builder ═════════ */}
          <div className="space-y-5 min-w-0">
            {(rights.canCreate || rights.canEdit) && (
              <div className={`${card} overflow-hidden`}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: HR_RULE }}>
                  <div>
                    <p className={HR_LBL}>{editingId !== null ? "Editing" : "New template"}</p>
                    <h2 className="font-heading font-semibold text-foreground mt-0.5">
                      {editingId !== null ? (header.name || "Salary structure") : "Build a salary structure"}
                    </h2>
                  </div>
                  <SheetMark text={header.isActive ? "Active" : "Draft / Inactive"} tone={header.isActive ? "done" : "draft"} />
                </div>

                <div className="p-5 space-y-7">
                  {/* ① Details */}
                  <section>
                    <StepHead n={1} title="Details" hint="Name the template and when it applies" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-4">
                      <div className="min-w-0">
                        <label className={labelBase}>Company</label>
                        <SearchableNativeSelect value={header.companyId} onChange={(e) => setHeader((h) => ({ ...h, companyId: e.target.value }))} className={inputBase} searchPlaceholder="Search company…">
                          <option value="">Select...</option>
                          {companyOptions.map((c) => (
                            <option key={c.id} value={String(c.id)}>{c.label}</option>
                          ))}
                        </SearchableNativeSelect>
                      </div>
                      <div>
                        <label className={labelBase}>Structure Name<span className="text-destructive ml-0.5">*</span></label>
                        <input type="text" value={header.name} onChange={(e) => setHeader((h) => ({ ...h, name: e.target.value }))} className={inputBase} placeholder="e.g. Staff — Standard" />
                      </div>
                      <div>
                        <label className={labelBase}>Structure Code<span className="text-destructive ml-0.5">*</span></label>
                        <input type="text" value={header.code} onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value.toUpperCase() }))} className={`${inputBase} ${HR_NUM}`} placeholder="e.g. STF-STD" />
                      </div>
                      <div>
                        <label className={labelBase}>Effective From</label>
                        <DateInput value={header.effectiveFrom} onChange={(e) => setHeader((h) => ({ ...h, effectiveFrom: e.target.value }))} className={inputBase} />
                      </div>
                      <div>
                        <label className={labelBase}>Effective To</label>
                        <DateInput value={header.effectiveTo} onChange={(e) => setHeader((h) => ({ ...h, effectiveTo: e.target.value }))} className={inputBase} />
                      </div>
                      <div>
                        <label className={labelBase}>CTC Frequency</label>
                        <div className={SEG}>
                          {(["Monthly", "Annual"] as CTCFrequency[]).map((f) => (
                            <button key={f} type="button" onClick={() => setHeader((h) => ({ ...h, ctcFrequency: f }))}
                              className={`flex-1 h-9 ${segKey(header.ctcFrequency === f)}`}>
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="col-span-full">
                        <label className={labelBase}>Description</label>
                        <textarea value={header.description} onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))} rows={2} className={`${inputBase} !h-auto py-2 resize-none`} placeholder="Optional — who this template is for" />
                      </div>
                    </div>
                  </section>

                  {/* ② Components */}
                  <section>
                    <div className="flex items-start justify-between gap-3">
                      <StepHead n={2} title="Salary components" hint="Each line is one salary head and how it's calculated, in order" />
                      <button type="button" onClick={addLine} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
                        <Add size={12} /> Add component
                      </button>
                    </div>
                    <div className="space-y-3">
                      {lines.map((line, idx) => {
                        const head = heads.find((h) => String(h.Id) === line.deductionAdditionId);
                        const tone = toneOf(head?.Type);
                        return (
                          <div key={idx} className={`relative border bg-card p-3.5 pl-5 ${line.isActive ? "border-foreground/30" : "border-dashed border-foreground/30 opacity-70"}`}>
                            <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: tone.bar }} />
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                              <span className={`flex h-6 w-6 items-center justify-center border border-foreground text-[0.6875rem] font-bold text-foreground ${HR_NUM}`}>{idx + 1}</span>
                              {head ? (
                                <span className={`${TAG} ${tone.chip}`}>{tone.label}</span>
                              ) : (
                                <span className="text-[0.6875rem] text-muted-foreground">Pick a salary head</span>
                              )}
                              {line.isBalancing && <span className={`${TAG} bg-foreground text-card border-foreground`}>Balancing</span>}
                              <span className="flex-1" />
                              <button type="button" onClick={() => moveLine(idx, -1)} disabled={idx === 0} title="Move up" className={ACT}><ArrowUp2 size={13} /></button>
                              <button type="button" onClick={() => moveLine(idx, 1)} disabled={idx === lines.length - 1} title="Move down" className={ACT}><ArrowDown2 size={13} /></button>
                              <button type="button" onClick={() => removeLine(idx)} disabled={lines.length === 1} title="Remove" className={`${ACT} hover:text-destructive hover:border-destructive`}><Trash2 size={13} /></button>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1.2fr)] gap-3 items-end">
                              <div className="min-w-0">
                                <label className={lineLabel}>Salary Head</label>
                                <select value={line.deductionAdditionId} onChange={(e) => updateLine(idx, { deductionAdditionId: e.target.value })} className={smallInput}>
                                  <option value="">Select...</option>
                                  {heads.map((h) => (
                                    <option key={h.Id} value={String(h.Id)}>{h.Code} — {h.Name} ({h.Type})</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className={lineLabel}>Calculated as</label>
                                <div className={SEG}>
                                  {CALCULATION_TYPES.map((ct) => (
                                    <button key={ct} type="button" onClick={() => updateLine(idx, { calculationType: ct })}
                                      className={segKey(line.calculationType === ct)}>
                                      {ct === "Percentage" ? "%" : ct}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="min-w-0">
                                {line.calculationType === "Fixed" && (
                                  <>
                                    <label className={lineLabel}>Fixed Amount (₹)</label>
                                    <input type="number" value={line.amount} onChange={(e) => updateLine(idx, { amount: e.target.value })} className={smallInput} placeholder="Amount" />
                                  </>
                                )}
                                {line.calculationType === "Percentage" && (
                                  <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                                    <div className="min-w-0">
                                      <label className={lineLabel}>Of</label>
                                      <select value={line.calculationBase} onChange={(e) => updateLine(idx, { calculationBase: e.target.value })} className={smallInput}>
                                        <option value="">Select...</option>
                                        {calculationBaseOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className={lineLabel}>Percent</label>
                                      <input type="number" value={line.percentage} onChange={(e) => updateLine(idx, { percentage: e.target.value })} className={smallInput} placeholder="%" />
                                    </div>
                                  </div>
                                )}
                                {line.calculationType === "Formula" && (
                                  <>
                                    <label className={lineLabel}>Formula</label>
                                    <div className="flex gap-1.5">
                                      <input type="text" value={line.formula} onChange={(e) => updateLine(idx, { formula: e.target.value })} className={`${smallInput} font-mono`} placeholder="e.g. GROSS - BASIC - HRA" />
                                      <button type="button" onClick={() => setFormulaBuilderIdx(idx)} className={`${KEY_INK} h-8 px-3 whitespace-nowrap`}>
                                        Builder
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-3 gap-2 sm:max-w-md">
                              <div>
                                <label className={lineLabel}>Min ₹</label>
                                <input type="number" value={line.minAmount} onChange={(e) => updateLine(idx, { minAmount: e.target.value })} className={smallInput} />
                              </div>
                              <div>
                                <label className={lineLabel}>Max ₹</label>
                                <input type="number" value={line.maxAmount} onChange={(e) => updateLine(idx, { maxAmount: e.target.value })} className={smallInput} />
                              </div>
                              <div>
                                <label className={lineLabel}>Rounding</label>
                                <select value={line.roundingRule} onChange={(e) => updateLine(idx, { roundingRule: e.target.value as RoundingRule })} className={smallInput}>
                                  {ROUNDING_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              <Flag on={line.includeInGross} label="In Gross" onClick={() => updateLine(idx, { includeInGross: !line.includeInGross })} />
                              <Flag on={line.includeInCTC} label="In CTC" onClick={() => updateLine(idx, { includeInCTC: !line.includeInCTC })} />
                              <Flag on={line.includeInNet} label="In Net" onClick={() => updateLine(idx, { includeInNet: !line.includeInNet })} />
                              <Flag on={line.taxable} label="Taxable" onClick={() => updateLine(idx, { taxable: !line.taxable })} />
                              <Flag on={line.isActive} label="Active" onClick={() => updateLine(idx, { isActive: !line.isActive })} />
                              <Flag on={line.isBalancing} label="Balancing" onClick={() => setBalancing(idx)} />
                            </div>
                            {head && (
                              <p className="text-[0.625rem] text-muted-foreground mt-2">
                                <span className={HR_NUM}>{head.Code}</span> · {head.Type}{head.LedgerName ? ` · ${head.LedgerName}` : ""}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {validationErrors.length > 0 && (
                    <div className="border border-destructive bg-destructive/5 p-3.5 space-y-1">
                      <p className={`${HR_HEAD} !text-destructive`}>Validation issues</p>
                      {validationErrors.map((e, i) => (
                        <p key={i} className="text-xs text-destructive flex items-start gap-1.5">
                          <CloseCircle size={13} className="mt-0.5 shrink-0" /> {e.message}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pinned action bar */}
                <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 px-5 py-3 bg-card" style={{ borderTop: HR_RULE }}>
                  {canSave ? <SheetMark text="Ready to save" tone="done" /> : <span className="text-[0.6875rem] text-muted-foreground">Name, code and at least one component are required</span>}
                  <span className="flex-1" />
                  <button type="button" onClick={handleValidate} disabled={validating || !canSave} className={`${KEY_LINE} h-9 px-3`}>
                    {validating ? "Validating…" : "Validate formula"}
                  </button>
                  <button type="button" onClick={runPreview} disabled={previewLoading || !canSave} className={`${KEY_LINE} h-9 px-3`}>
                    Preview
                  </button>
                  <button onClick={() => handleSave(false)} disabled={!canSave || saving || !canWrite} className={`${KEY_LINE} h-9 px-4`}>
                    Save
                  </button>
                  <button onClick={() => handleSave(true)} disabled={!canSave || saving || !canWrite} className={`${KEY_INK} h-9 px-5`}>
                    {saving ? "Saving…" : editingId !== null ? "Update & calculate" : "Save & calculate"}
                  </button>
                </div>
              </div>
            )}

            {/* ③ Check & preview */}
            <div className={`${card} p-5`}>
              <StepHead n={3} title="Preview the breakup" hint="Try a test CTC and see exactly what this template pays" />
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelBase}>Test CTC (₹)</label>
                  <input type="number" value={testCtc} onChange={(e) => setTestCtc(e.target.value)} className={`${inputBase} !w-44 ${HR_NUM}`} />
                </div>
                <div>
                  <label className={labelBase}>Frequency</label>
                  <div className={SEG}>
                    {(["Monthly", "Annual"] as CTCFrequency[]).map((f) => (
                      <button key={f} type="button" onClick={() => setTestCtcFrequency(f)}
                        className={`h-9 ${segKey(testCtcFrequency === f)}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={runPreview} disabled={previewLoading} className={`${KEY_INK} h-9 px-4`}>
                  {previewLoading ? "Calculating…" : "Calculate"}
                </button>
              </div>

              {previewResult && !previewResult.valid && (
                <div className="mt-4 border border-destructive bg-destructive/5 p-3 space-y-1">
                  {previewResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive">{e.message}</p>
                  ))}
                </div>
              )}

              {previewResult && previewResult.valid && t && (
                <div className="mt-5">
                  {/* Same breakup Salary Calculation and Payroll Run show (HrUi). */}
                  <HrBreakup lines={previewResult.lines} totals={t} />
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </HrPayrollShell>

      {formulaBuilderIdx !== null && (
        <FormulaBuilderModal
          open={formulaBuilderIdx !== null}
          onClose={() => setFormulaBuilderIdx(null)}
          onApply={(formula) => updateLine(formulaBuilderIdx, { formula })}
          initialFormula={lines[formulaBuilderIdx]?.formula || ""}
          availableHeads={availableHeadsForFormula.filter((h) => h.code !== heads.find((hh) => String(hh.Id) === lines[formulaBuilderIdx]?.deductionAdditionId)?.Code)}
          reservedKeywords={RESERVED_KEYWORDS}
        />
      )}

      {copyTargetId !== null && (
        <BodyPortal><div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setCopyTargetId(null)}>
          <div className="bg-card p-5 w-full max-w-sm" style={{ border: HR_RULE }} onClick={(e) => e.stopPropagation()}>
            <h3 className={`${HR_HEAD} mb-3`}>Copy structure</h3>
            <div className="space-y-3">
              <div>
                <label className={labelBase}>New Structure Name</label>
                <input type="text" value={copyName} onChange={(e) => setCopyName(e.target.value)} className={inputBase} />
              </div>
              <div>
                <label className={labelBase}>New Structure Code<span className="text-destructive ml-0.5">*</span></label>
                <input type="text" value={copyCode} onChange={(e) => setCopyCode(e.target.value.toUpperCase())} className={`${inputBase} ${HR_NUM}`} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4 pt-3" style={{ borderTop: "1px solid hsl(var(--foreground) / 0.15)" }}>
              <button onClick={() => setCopyTargetId(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={handleCopy} disabled={!copyCode.trim()} className={`${KEY_INK} h-9 px-5`}>Copy</button>
            </div>
          </div>
        </div></BodyPortal>
      )}
    </>
  );
};

export default SalaryStructure;
