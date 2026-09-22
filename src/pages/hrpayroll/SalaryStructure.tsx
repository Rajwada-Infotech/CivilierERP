import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoneyChange, Add, Edit2, ArrowUp2, ArrowDown2, Copy, TickCircle, CloseCircle } from "iconsax-react";
import { Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
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

const inputBase =
  "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";
const labelBase = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";
const smallInput = inputBase + " py-1.5 text-xs";

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
      if (!res.errors?.length) toast.success("No validation errors found ✓");
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
        toast.success("Salary structure updated successfully ✓");
        if (res.warnings?.length) setValidationErrors(res.warnings);
      } else {
        const res = await addSalaryStructure(buildPayload());
        toast.success("Salary structure saved successfully ✓");
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
      toast.success("Salary structure activated ✓");
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
      toast.success("Salary structure copied successfully ✓");
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

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading salary structures...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load Salary Structure.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Salary Structure"]} />
      <HrPayrollShell title="Salary Structure Master" subtitle="Formula-driven payroll templates built from Salary Heads" icon={MoneyChange}>
        <div className="space-y-5">
          {(rights.canCreate || rights.canEdit) && (
            <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-border bg-muted/20 rounded-t-xl">
                <div>
                  <h2 className="font-heading font-semibold text-foreground text-sm">
                    {editingId !== null ? `Edit Salary Structure${header.isActive ? "" : " (Draft)"}` : "New Salary Structure"}
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {editingId !== null ? "Modify the template below and save." : "Define the header, add Salary Head lines, then validate and activate."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <Add size={14} /> New
                </button>
              </div>

              <div className="p-5 space-y-5">
                {/* Header fields */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className={labelBase}>Company</label>
                    <select value={header.companyId} onChange={(e) => setHeader((h) => ({ ...h, companyId: e.target.value }))} className={inputBase}>
                      <option value="">Select...</option>
                      {companyOptions.map((c) => (
                        <option key={c.id} value={String(c.id)}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelBase}>Structure Name<span className="text-destructive ml-0.5">*</span></label>
                    <input type="text" value={header.name} onChange={(e) => setHeader((h) => ({ ...h, name: e.target.value }))} className={inputBase} />
                  </div>
                  <div>
                    <label className={labelBase}>Structure Code<span className="text-destructive ml-0.5">*</span></label>
                    <input type="text" value={header.code} onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value.toUpperCase() }))} className={inputBase} />
                  </div>
                  <div className="md:col-span-3">
                    <label className={labelBase}>Description</label>
                    <textarea value={header.description} onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))} rows={2} className={inputBase} />
                  </div>
                  <div>
                    <label className={labelBase}>Effective From</label>
                    <input type="date" value={header.effectiveFrom} onChange={(e) => setHeader((h) => ({ ...h, effectiveFrom: e.target.value }))} className={inputBase} />
                  </div>
                  <div>
                    <label className={labelBase}>Effective To</label>
                    <input type="date" value={header.effectiveTo} onChange={(e) => setHeader((h) => ({ ...h, effectiveTo: e.target.value }))} className={inputBase} />
                  </div>
                  <div>
                    <label className={labelBase}>CTC Frequency</label>
                    <select value={header.ctcFrequency} onChange={(e) => setHeader((h) => ({ ...h, ctcFrequency: e.target.value as CTCFrequency }))} className={inputBase}>
                      <option value="Monthly">Monthly</option>
                      <option value="Annual">Annual</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <label className={labelBase + " mb-0"}>Status</label>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${header.isActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}>
                      {header.isActive ? "Active" : "Draft / Inactive"}
                    </span>
                  </div>
                </div>

                {/* Component grid */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={labelBase + " mb-0"}>Salary Components<span className="text-destructive ml-0.5">*</span></label>
                    <button type="button" onClick={addLine} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold border border-border text-foreground hover:bg-muted transition-colors">
                      <Add size={14} /> Add Row
                    </button>
                  </div>

                  <div className="space-y-3">
                    {lines.map((line, idx) => {
                      const head = heads.find((h) => String(h.Id) === line.deductionAdditionId);
                      return (
                        <div key={idx} className="rounded-lg border border-border p-3 bg-muted/10">
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                            <div className="md:col-span-4">
                              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Salary Head</label>
                              <select value={line.deductionAdditionId} onChange={(e) => updateLine(idx, { deductionAdditionId: e.target.value })} className={smallInput}>
                                <option value="">Select...</option>
                                {heads.map((h) => (
                                  <option key={h.Id} value={String(h.Id)}>{h.Code} — {h.Name} ({h.Type})</option>
                                ))}
                              </select>
                            </div>
                            <div className="md:col-span-2">
                              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Calc Type</label>
                              <select value={line.calculationType} onChange={(e) => updateLine(idx, { calculationType: e.target.value as CalculationType })} className={smallInput}>
                                {CALCULATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            <div className="md:col-span-4">
                              {line.calculationType === "Fixed" && (
                                <>
                                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Fixed Amount</label>
                                  <input type="number" value={line.amount} onChange={(e) => updateLine(idx, { amount: e.target.value })} className={smallInput} placeholder="Amount" />
                                </>
                              )}
                              {line.calculationType === "Percentage" && (
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Base</label>
                                    <select value={line.calculationBase} onChange={(e) => updateLine(idx, { calculationBase: e.target.value })} className={smallInput}>
                                      <option value="">Select...</option>
                                      {calculationBaseOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Percentage</label>
                                    <input type="number" value={line.percentage} onChange={(e) => updateLine(idx, { percentage: e.target.value })} className={smallInput} placeholder="%" />
                                  </div>
                                </div>
                              )}
                              {line.calculationType === "Formula" && (
                                <>
                                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Formula</label>
                                  <div className="flex gap-1.5">
                                    <input type="text" value={line.formula} onChange={(e) => updateLine(idx, { formula: e.target.value })} className={smallInput + " font-mono"} placeholder="e.g. GROSS - BASIC - HRA" />
                                    <button type="button" onClick={() => setFormulaBuilderIdx(idx)} className="px-2.5 py-1.5 rounded-lg text-xs border border-border hover:bg-muted transition-colors whitespace-nowrap">
                                      Builder
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="md:col-span-2 flex items-center justify-end gap-1">
                              <button type="button" onClick={() => moveLine(idx, -1)} disabled={idx === 0} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground">
                                <ArrowUp2 size={14} />
                              </button>
                              <button type="button" onClick={() => moveLine(idx, 1)} disabled={idx === lines.length - 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground">
                                <ArrowDown2 size={14} />
                              </button>
                              <button type="button" onClick={() => removeLine(idx)} disabled={lines.length === 1} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground hover:text-destructive">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-2">
                            <div>
                              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Min Amount</label>
                              <input type="number" value={line.minAmount} onChange={(e) => updateLine(idx, { minAmount: e.target.value })} className={smallInput} />
                            </div>
                            <div>
                              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Max Amount</label>
                              <input type="number" value={line.maxAmount} onChange={(e) => updateLine(idx, { maxAmount: e.target.value })} className={smallInput} />
                            </div>
                            <div>
                              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Rounding</label>
                              <select value={line.roundingRule} onChange={(e) => updateLine(idx, { roundingRule: e.target.value as RoundingRule })} className={smallInput}>
                                {ROUNDING_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </div>
                            <div className="col-span-2 md:col-span-3 flex flex-wrap items-center gap-x-3 gap-y-1 pt-4">
                              <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                                <input type="checkbox" checked={line.includeInGross} onChange={(e) => updateLine(idx, { includeInGross: e.target.checked })} /> In Gross
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                                <input type="checkbox" checked={line.includeInCTC} onChange={(e) => updateLine(idx, { includeInCTC: e.target.checked })} /> In CTC
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                                <input type="checkbox" checked={line.includeInNet} onChange={(e) => updateLine(idx, { includeInNet: e.target.checked })} /> In Net
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                                <input type="checkbox" checked={line.taxable} onChange={(e) => updateLine(idx, { taxable: e.target.checked })} /> Taxable
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                                <input type="checkbox" checked={line.isActive} onChange={(e) => updateLine(idx, { isActive: e.target.checked })} /> Active
                              </label>
                              <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground cursor-pointer">
                                <input type="radio" checked={line.isBalancing} onChange={() => setBalancing(idx)} /> Balancing Component
                              </label>
                            </div>
                          </div>
                          {head && (
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                              {head.Code} · {head.Type}{head.LedgerName ? ` · ${head.LedgerName}` : ""}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {validationErrors.length > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                    <p className="text-xs font-heading font-semibold text-destructive">Validation issues</p>
                    {validationErrors.map((e, i) => (
                      <p key={i} className="text-xs text-destructive flex items-start gap-1.5">
                        <CloseCircle size={13} className="mt-0.5 shrink-0" /> {e.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl flex-wrap">
                <p className="text-[11px] text-muted-foreground hidden sm:block">
                  {canSave ? <span className="text-emerald-500 font-medium">Ready to save</span> : "Fill in the required fields to save"}
                </p>
                <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
                  <button type="button" onClick={handleValidate} disabled={validating || !canSave} className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40">
                    Validate Formula
                  </button>
                  <button type="button" onClick={runPreview} disabled={previewLoading || !canSave} className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40">
                    Preview
                  </button>
                  <button
                    onClick={() => handleSave(false)}
                    disabled={!canSave || saving || (editingId === null ? !rights.canCreate : !rights.canEdit)}
                    className="px-3 py-1.5 rounded-lg text-xs font-heading font-semibold border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={!canSave || saving || (editingId === null ? !rights.canCreate : !rights.canEdit)}
                    className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-white shadow-sm disabled:opacity-40"
                  >
                    {editingId !== null ? "Update & Calculate" : "Save & Calculate"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Preview calculator */}
          <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-border bg-muted/20">
              <h3 className="font-heading font-semibold text-foreground text-sm">Preview Calculator</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Enter a test CTC and calculate the salary breakup this template produces.</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelBase}>Test CTC</label>
                  <input type="number" value={testCtc} onChange={(e) => setTestCtc(e.target.value)} className={inputBase} style={{ width: 180 }} />
                </div>
                <div>
                  <label className={labelBase}>Frequency</label>
                  <select value={testCtcFrequency} onChange={(e) => setTestCtcFrequency(e.target.value as CTCFrequency)} className={inputBase} style={{ width: 140 }}>
                    <option value="Monthly">Monthly</option>
                    <option value="Annual">Annual</option>
                  </select>
                </div>
                <button type="button" onClick={runPreview} disabled={previewLoading} className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm disabled:opacity-40">
                  {previewLoading ? "Calculating..." : "Calculate"}
                </button>
              </div>

              {previewResult && !previewResult.valid && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                  {previewResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive">{e.message}</p>
                  ))}
                </div>
              )}

              {previewResult && previewResult.valid && previewResult.totals && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                        <th className="text-left px-3 py-2">Salary Head</th>
                        <th className="text-left px-3 py-2">Type</th>
                        <th className="text-left px-3 py-2">Calculation</th>
                        <th className="text-right px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {previewResult.lines.map((l) => (
                        <tr key={l.DeductionAdditionId}>
                          <td className="px-3 py-2 font-medium">{l.HeadName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{l.HeadType}</td>
                          <td className="px-3 py-2 text-muted-foreground">{l.Calculation}</td>
                          <td className="px-3 py-2 text-right font-mono">₹{l.Amount.toLocaleString("en-IN")}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/20 font-semibold">
                        <td className="px-3 py-2" colSpan={3}>Gross Salary</td>
                        <td className="px-3 py-2 text-right font-mono">₹{previewResult.totals.GrossSalary.toLocaleString("en-IN")}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={3}>Total Employee Deduction</td>
                        <td className="px-3 py-2 text-right font-mono">₹{previewResult.totals.TotalEmployeeDeduction.toLocaleString("en-IN")}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={3}>Net Salary</td>
                        <td className="px-3 py-2 text-right font-mono">₹{previewResult.totals.NetSalary.toLocaleString("en-IN")}</td>
                      </tr>
                      <tr className="font-semibold">
                        <td className="px-3 py-2" colSpan={3}>Employer Contribution</td>
                        <td className="px-3 py-2 text-right font-mono">₹{previewResult.totals.TotalEmployerContribution.toLocaleString("en-IN")}</td>
                      </tr>
                      <tr className="bg-primary/10 font-bold">
                        <td className="px-3 py-2" colSpan={3}>Total CTC</td>
                        <td className="px-3 py-2 text-right font-mono">₹{previewResult.totals.TotalCTC.toLocaleString("en-IN")}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Records list */}
          <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-border bg-card/60 rounded-t-xl">
              <div>
                <h3 className="font-heading font-semibold text-foreground text-sm">Salary Structure Records</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">{structures.length} record{structures.length !== 1 ? "s" : ""}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/10">
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Name</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Code</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Version</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Company</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Lines</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {structures.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">No records yet. Add one above.</td></tr>
                  ) : (
                    structures.map((row) => (
                      <tr key={row.SalaryStructureId} className={`border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors ${editingId === row.SalaryStructureId ? "bg-primary/5" : ""}`}>
                        <td className="px-4 py-2.5 font-medium text-foreground">{row.Name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{row.Code}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">v{row.Version}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.CompanyName || "-"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.Lines.length}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${row.IsActive ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}>
                            {row.IsActive ? "Active" : "Draft"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {rights.canEdit && (
                              <button onClick={() => startEdit(row)} title="Edit" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                                <Edit2 size={14} />
                              </button>
                            )}
                            {rights.canEdit && !row.IsActive && (
                              <button onClick={() => handleActivate(row.SalaryStructureId)} title="Activate" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-emerald-600">
                                <TickCircle size={14} />
                              </button>
                            )}
                            {rights.canEdit && row.IsActive && (
                              <button onClick={() => handleDeactivate(row.SalaryStructureId)} title="Deactivate" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-amber-600">
                                <CloseCircle size={14} />
                              </button>
                            )}
                            {rights.canCreate && (
                              <button onClick={() => { setCopyTargetId(row.SalaryStructureId); setCopyCode(""); setCopyName(`${row.Name} Copy`); }} title="Copy Structure" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                                <Copy size={14} />
                              </button>
                            )}
                            {rights.canDelete && (
                              deleteConfirmId === row.SalaryStructureId ? (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => handleDelete(row.SalaryStructureId)} className="px-2 py-1 rounded text-[11px] font-medium bg-destructive text-destructive-foreground">Confirm</button>
                                  <button onClick={() => setDeleteConfirmId(null)} className="px-2 py-1 rounded text-[11px] font-medium border border-border">Cancel</button>
                                </div>
                              ) : (
                                <button onClick={() => setDeleteConfirmId(row.SalaryStructureId)} title="Delete" className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive">
                                  <Trash2 size={14} />
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCopyTargetId(null)}>
          <div className="bg-card border border-border rounded-xl shadow-lg p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading font-semibold text-foreground text-sm mb-3">Copy Structure</h3>
            <div className="space-y-3">
              <div>
                <label className={labelBase}>New Structure Name</label>
                <input type="text" value={copyName} onChange={(e) => setCopyName(e.target.value)} className={inputBase} />
              </div>
              <div>
                <label className={labelBase}>New Structure Code<span className="text-destructive ml-0.5">*</span></label>
                <input type="text" value={copyCode} onChange={(e) => setCopyCode(e.target.value.toUpperCase())} className={inputBase} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setCopyTargetId(null)} className="px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button onClick={handleCopy} disabled={!copyCode.trim()} className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-white shadow-sm disabled:opacity-40">Copy</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SalaryStructure;
