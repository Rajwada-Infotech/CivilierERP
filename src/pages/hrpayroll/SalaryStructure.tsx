import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoneyChange, Add, Edit2 } from "iconsax-react";
import { Trash2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { getEmployeeCompanyOptions } from "@/api/employeeMasterApi";
import { getDeductionAdditions, type DeductionAdditionRow } from "@/api/deductionAdditionMasterApi";
import {
  getSalaryStructures,
  addSalaryStructure,
  updateSalaryStructure,
  deleteSalaryStructure,
  type SalaryStructureRow,
  type SalaryStructureLinePayload,
} from "@/api/salaryStructureApi";

interface LineForm {
  deductionAdditionId: string;
  percentage: string;
  amount: string;
}

const emptyLine = (): LineForm => ({ deductionAdditionId: "", percentage: "", amount: "" });

const emptyHeader = () => ({ companyId: "", name: "", code: "" });

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

  const [editingId, setEditingId] = useState<number | null>(null);
  const [header, setHeader] = useState(emptyHeader());
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["salary-structure"] });

  const resetForm = () => {
    setEditingId(null);
    setHeader(emptyHeader());
    setLines([emptyLine()]);
  };

  const startEdit = (row: SalaryStructureRow) => {
    setEditingId(row.SalaryStructureId);
    setHeader({
      companyId: row.CompanyId ? String(row.CompanyId) : "",
      name: row.Name,
      code: row.Code,
    });
    setLines(
      row.Lines.length
        ? row.Lines.map((l) => ({
            deductionAdditionId: String(l.DeductionAdditionId),
            percentage: l.Percentage == null ? "" : String(l.Percentage),
            amount: l.Amount == null ? "" : String(l.Amount),
          }))
        : [emptyLine()],
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateLine = (idx: number, patch: Partial<LineForm>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const canSave =
    header.name.trim() !== "" &&
    header.code.trim() !== "" &&
    lines.length > 0 &&
    lines.every((l) => l.deductionAdditionId !== "" && (l.percentage.trim() !== "" || l.amount.trim() !== ""));

  const handleSave = async () => {
    if (!canSave) return;
    const payloadLines: SalaryStructureLinePayload[] = lines.map((l) => ({
      DeductionAdditionId: Number(l.deductionAdditionId),
      Percentage: l.percentage.trim() === "" ? null : Number(l.percentage),
      Amount: l.amount.trim() === "" ? null : Number(l.amount),
    }));
    const payload = {
      CompanyId: header.companyId ? Number(header.companyId) : null,
      Name: header.name.trim(),
      Code: header.code.trim(),
      Lines: payloadLines,
    };
    setSaving(true);
    try {
      if (editingId !== null) {
        await updateSalaryStructure(editingId, payload);
        toast.success("Salary structure updated successfully ✓");
      } else {
        await addSalaryStructure(payload);
        toast.success("Salary structure saved successfully ✓");
      }
      resetForm();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save. Please try again.");
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

  const inputBase =
    "w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground";
  const labelBase = "block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5";

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading salary structures...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load Salary Structure.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Salary Structure"]} />
      <HrPayrollShell title="Salary Structure" subtitle="Company-wise pay structures built from Deduction/Addition heads" icon={MoneyChange}>
        <div className="space-y-5">
          {(rights.canCreate || rights.canEdit) && (
            <div className="rounded-xl bg-card/80 backdrop-blur-lg border border-border shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-border bg-muted/20 rounded-t-xl">
                <div>
                  <h2 className="font-heading font-semibold text-foreground text-sm">
                    {editingId !== null ? "Edit Salary Structure" : "Add Salary Structure"}
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {editingId !== null ? "Modify the details below and save." : "Fill in the header, then add Deduction/Addition lines below."}
                  </p>
                </div>
              </div>

              <div className="p-5 space-y-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className={labelBase}>Company</label>
                    <select
                      value={header.companyId}
                      onChange={(e) => setHeader((h) => ({ ...h, companyId: e.target.value }))}
                      className={inputBase}
                    >
                      <option value="">Select...</option>
                      {companyOptions.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelBase}>
                      Name<span className="text-destructive ml-0.5">*</span>
                    </label>
                    <input
                      type="text"
                      value={header.name}
                      onChange={(e) => setHeader((h) => ({ ...h, name: e.target.value }))}
                      className={inputBase}
                    />
                  </div>
                  <div>
                    <label className={labelBase}>
                      Code<span className="text-destructive ml-0.5">*</span>
                    </label>
                    <input
                      type="text"
                      value={header.code}
                      onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value.toUpperCase() }))}
                      className={inputBase}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={labelBase + " mb-0"}>
                      Deduction / Addition Lines<span className="text-destructive ml-0.5">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={addLine}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold border border-border text-foreground hover:bg-muted transition-colors"
                    >
                      <Add size={14} /> Add Row
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    Give either a Percentage or an Amount for each line.
                  </p>

                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/30 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
                      <div className="col-span-6">Deduction / Addition Head</div>
                      <div className="col-span-2">Percentage</div>
                      <div className="col-span-3">Amount</div>
                      <div className="col-span-1" />
                    </div>
                    <div className="divide-y divide-border">
                      {lines.map((line, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                          <div className="col-span-6">
                            <select
                              value={line.deductionAdditionId}
                              onChange={(e) => updateLine(idx, { deductionAdditionId: e.target.value })}
                              className={inputBase + " py-1.5"}
                            >
                              <option value="">Select...</option>
                              {heads.map((h) => (
                                <option key={h.Id} value={String(h.Id)}>
                                  {h.Code} — {h.Name} ({h.Type})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <input
                              type="number"
                              value={line.percentage}
                              onChange={(e) => updateLine(idx, { percentage: e.target.value })}
                              placeholder="%"
                              className={inputBase + " py-1.5"}
                            />
                          </div>
                          <div className="col-span-3">
                            <input
                              type="number"
                              value={line.amount}
                              onChange={(e) => updateLine(idx, { amount: e.target.value })}
                              placeholder="Amount"
                              className={inputBase + " py-1.5"}
                            />
                          </div>
                          <div className="col-span-1 flex justify-center">
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              disabled={lines.length === 1}
                              className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/20 rounded-b-xl">
                <p className="text-[11px] text-muted-foreground hidden sm:block">
                  {canSave ? <span className="text-emerald-500 font-medium">Ready to save</span> : "Fill in the required fields to save"}
                </p>
                <div className="flex items-center gap-2 sm:ml-auto">
                  <button
                    onClick={resetForm}
                    className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    {editingId !== null ? "Cancel" : "Reset"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!canSave || saving || (editingId === null ? !rights.canCreate : !rights.canEdit)}
                    className="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    {editingId !== null ? "Update Salary Structure" : "Save Salary Structure"}
                  </button>
                </div>
              </div>
            </div>
          )}

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
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Company</th>
                    <th className="text-left px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Lines</th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-heading uppercase tracking-widest text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {structures.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No records yet. Add one above.
                      </td>
                    </tr>
                  ) : (
                    structures.map((row) => (
                      <tr key={row.SalaryStructureId} className={`border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors ${editingId === row.SalaryStructureId ? "bg-primary/5" : ""}`}>
                        <td className="px-4 py-2.5 font-medium text-foreground">{row.Name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{row.Code}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.CompanyName || "-"}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.Lines.length}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            {rights.canEdit && (
                              <button onClick={() => startEdit(row)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                                <Edit2 size={14} />
                              </button>
                            )}
                            {rights.canDelete && (
                              deleteConfirmId === row.SalaryStructureId ? (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => handleDelete(row.SalaryStructureId)} className="px-2 py-1 rounded text-[11px] font-medium bg-destructive text-destructive-foreground">
                                    Confirm
                                  </button>
                                  <button onClick={() => setDeleteConfirmId(null)} className="px-2 py-1 rounded text-[11px] font-medium border border-border">
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => setDeleteConfirmId(row.SalaryStructureId)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive">
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
    </>
  );
};

export default SalaryStructure;
