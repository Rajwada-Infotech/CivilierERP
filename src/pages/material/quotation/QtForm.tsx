import { CalendarDays, FileText, Save, ArrowLeft, ChevronDown, FileSpreadsheet, ClipboardList, Users, X, Plus, Check, Package, Building2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { DateInput } from "@/components/ui/date-input";
import { BodyPortal } from "@/components/ui/body-portal";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { inputCls, selectCls, Field, SectionHeader } from "./config";
import type { QtState } from "./useQuotation";

// Create / edit a quotation (RFQ): scope, source MR, items, suppliers, terms.
export function QtForm({ m }: { m: QtState }) {
  const { editingId, header, setHeader, items, setItems, supplierIds, tcIds, setTcIds, tcDropdownOpen, setTcDropdownOpen, addSupplierId, setAddSupplierId, setH, companies, filteredProjects, finYears, finYearStr, suppliers, tcRecords, approvedMRs, supplierMap, qtDocTypes, qtDocTypesLoading, rows, tagMR, addSupplier, removeSupplier, isSaving, goToList, headerIsValid, onSave } = m;
  return (
    <div className="space-y-4">
      {/* Page header bar */}
      <div className="relative overflow-hidden flex items-center justify-between gap-3 px-5 py-3.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
        <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl bg-gradient-to-b from-transparent via-emerald-500 to-transparent" />
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={goToList}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <span className="text-emerald-500/40">|</span>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md flex items-center justify-center bg-emerald-500/[0.18] border border-emerald-500/30 shrink-0">
              <FileSpreadsheet size={12} className="text-emerald-400" />
            </div>
            <h2 className="text-sm font-bold text-foreground truncate">
              {editingId ? "Edit Quotation" : "New Quotation"}
            </h2>
          </div>
        </div>
        {/* Doc number preview */}
        <div className="flex items-center gap-2 shrink-0">
          {editingId ? (
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
              {header.docNoPreview}
            </span>
          ) : (
            <div className="flex items-center gap-2">
              {qtDocTypes.length > 1 && (
                <div className="relative">
                  <select
                    value={header.docTypeId ? String(header.docTypeId) : ""}
                    onChange={async (e) => {
                      const id = e.target.value ? parseInt(e.target.value, 10) : null;
                      if (!id) { setHeader((p) => ({ ...p, docTypeId: null, docNoPreview: "" })); return; }
                      const preview = await fetchNextDocNumber(id, finYearStr);
                      setHeader((p) => ({ ...p, docTypeId: id, docNoPreview: preview }));
                    }}
                    disabled={qtDocTypesLoading}
                    className="text-xs rounded-md border border-border px-2 py-1.5 pr-6 bg-background appearance-none focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                  >
                    {qtDocTypesLoading ? (
                      <option value="">Loading…</option>
                    ) : (
                      qtDocTypes.map((dt) => (
                        <option key={dt.TypeOfDocId} value={String(dt.TypeOfDocId)}>
                          {dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix}
                        </option>
                      ))
                    )}
                  </select>
                  <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              )}
              {header.docNoPreview && (
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm tracking-wider">
                  {header.docNoPreview}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main form card */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-6 space-y-6">

          {/* Section 1: Scope */}
          <div>
            <SectionHeader icon={Building2} title="Scope" sub="Company, project and financial year" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Company" required>
                <div className="relative">
                  <select
                    value={header.companyId}
                    onChange={(e) => { setH("companyId", e.target.value); setH("projectId", ""); setH("sourceMRId", ""); setItems([]); }}
                    className={selectCls}
                  >
                    <option value="">Select company</option>
                    {(companies as any[]).map((c) => (
                      <option key={c.id} value={String(c.id)}>{c.label ?? c.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </Field>

              <Field label="Project" required>
                <div className="relative">
                  <select
                    value={header.projectId}
                    onChange={(e) => { setH("projectId", e.target.value); setH("sourceMRId", ""); setItems([]); }}
                    className={selectCls}
                    disabled={!header.companyId}
                  >
                    <option value="">{!header.companyId ? "Select company first" : "Select project"}</option>
                    {filteredProjects.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.label ?? p.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </Field>

              <Field label="Financial Year">
                <div className="relative">
                  <select
                    value={header.finYearId}
                    onChange={(e) => { setH("finYearId", e.target.value); setH("sourceMRId", ""); setItems([]); }}
                    className={selectCls}
                  >
                    <option value="">All years</option>
                    {(finYears as any[]).map((fy) => (
                      <option key={fy.id} value={String(fy.id)}>{fy.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </Field>
            </div>
          </div>

          {/* Section 2: Dates & MR */}
          <div>
            <SectionHeader icon={CalendarDays} title="Timeline & Source" sub="Tag the approved MR and set response deadline" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Tag Material Request" required>
                <div className="relative">
                  <select
                    value={header.sourceMRId}
                    onChange={(e) => tagMR(e.target.value)}
                    className={selectCls}
                    disabled={!header.companyId || !header.projectId}
                  >
                    <option value="">
                      {!header.companyId || !header.projectId ? "Select company & project first" : "Select approved MR…"}
                    </option>
                    {(approvedMRs as any[]).map((mr) => (
                      <option key={mr.MRId} value={String(mr.MRId)}>{mr.DocNo}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </Field>

              <Field label="Quotation Date" required>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <DateInput value={header.docDate} onChange={(e) => setH("docDate", e.target.value)} className={`${inputCls} pl-8`} />
                </div>
              </Field>

              <Field label="Response Due Date">
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <DateInput value={header.dueDate} onChange={(e) => setH("dueDate", e.target.value)} className={`${inputCls} pl-8`} />
                </div>
              </Field>
            </div>
          </div>

          {/* Section 3: Items from MR */}
          <div>
            <SectionHeader
              icon={Package}
              title="Items"
              sub={items.length > 0 ? `${items.length} items from ${header.sourceMRDocNo}` : "Pulled automatically from tagged MR"}
            />
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
                <ClipboardList size={20} className="mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Tag an approved Material Request above to populate items.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border text-left text-[0.625rem] font-semibold uppercase tracking-widest text-muted-foreground">
                      <th className="px-4 py-2.5 w-8">#</th>
                      <th className="px-4 py-2.5">Item</th>
                      <th className="px-4 py-2.5 w-24 text-right">UOM</th>
                      <th className="px-4 py-2.5 w-20 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{idx + 1}</td>
                        <td className="px-4 py-2.5 font-medium">{it.ItemName || it.ItemId}</td>
                        <td className="px-4 py-2.5 text-muted-foreground text-right">{it.UOMName || it.UOMCode}</td>
                        <td className="px-4 py-2.5 font-semibold text-right">{it.Quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 4: Suppliers */}
          <div>
            <SectionHeader icon={Users} title="Suppliers to Quote" sub="Tag every supplier who should receive this RFQ" />
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1 max-w-sm">
                <SearchableNativeSelect value={addSupplierId} onChange={(e) => setAddSupplierId(e.target.value)} className={selectCls}>
                  <option value="">Select a supplier…</option>
                  {(suppliers as any[])
                    .filter((s) => !supplierIds.includes(String(s.LHeadId ?? s.id)))
                    .map((s) => (
                      <option key={s.LHeadId ?? s.id} value={String(s.LHeadId ?? s.id)}>
                        {s.LHeadName ?? s.label ?? s.name}
                      </option>
                    ))}
                </SearchableNativeSelect>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addSupplier} disabled={!addSupplierId} className="gap-1.5 shrink-0">
                <Plus size={13} /> Add
              </Button>
            </div>
            {supplierIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No suppliers tagged yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {supplierIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    {supplierMap[id]?.LHeadName ?? supplierMap[id]?.label ?? `Supplier #${id}`}
                    <button type="button" onClick={() => removeSupplier(id)} className="hover:text-destructive transition-colors">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Section 5: Terms & Remarks.
              Previously gated on `(tcRecords as any[]).length > 0 || true` —
              the `|| true` already made this always render regardless of
              tcRecords, so the dead check is removed here rather than
              reintroducing conditional hiding, which would change current
              behavior. */}
          <div>
              <SectionHeader icon={FileText} title="Remarks & Terms" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Remarks">
                  <Textarea
                    value={header.remarks}
                    onChange={(e) => setH("remarks", e.target.value)}
                    rows={3}
                    className="resize-none text-sm"
                    placeholder="Optional notes…"
                  />
                </Field>
                <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                      <ClipboardList size={11} className="text-emerald-600 dark:text-emerald-400" />
                      Terms &amp; Conditions
                    </h3>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setTcDropdownOpen((o) => !o)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted transition-colors"
                      >
                        <Plus size={13} /> Add T&amp;C
                      </button>
                      {tcDropdownOpen && (
                        <>
                          <BodyPortal><div className="fixed inset-0 z-10" onClick={() => setTcDropdownOpen(false)} /></BodyPortal>
                          <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                            <div className="px-3 py-2 border-b border-border">
                              <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider">Select Terms &amp; Conditions</p>
                            </div>
                            <div className="max-h-56 overflow-y-auto divide-y divide-border">
                              {(tcRecords as any[]).length === 0 ? (
                                <p className="px-4 py-6 text-xs text-center text-muted-foreground">No T&amp;C records found</p>
                              ) : (
                                (tcRecords as any[]).map((tc) => {
                                  const isSelected = tcIds.includes(String(tc.Id));
                                  return (
                                    <button
                                      key={tc.Id}
                                      type="button"
                                      onClick={() => setTcIds((p) => isSelected ? p.filter((id) => id !== String(tc.Id)) : [...p, String(tc.Id)])}
                                      className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-muted/40 transition ${isSelected ? "bg-emerald-500/[0.05]" : ""}`}
                                    >
                                      <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${isSelected ? "bg-emerald-500 border-emerald-500" : "border-border"}`}>
                                        {isSelected && <Check size={10} className="text-primary-foreground" />}
                                      </span>
                                      <span className="block text-sm font-medium text-foreground truncate">{tc.Name}</span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                            <div className="px-3 py-2 border-t border-border">
                              <button type="button" onClick={() => setTcDropdownOpen(false)} className="w-full text-xs text-center text-muted-foreground hover:text-foreground transition py-1">Done</button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {tcIds.length > 0 ? (
                    <div className="space-y-2">
                      {(tcRecords as any[]).filter((tc) => tcIds.includes(String(tc.Id))).map((tc, idx) => (
                        <div key={tc.Id} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[0.625rem] font-bold flex items-center justify-center mt-0.5">{idx + 1}</span>
                          <p className="flex-1 text-sm font-semibold text-foreground min-w-0 truncate">{tc.Name}</p>
                          <button
                            type="button"
                            onClick={() => setTcIds((p) => p.filter((id) => id !== String(tc.Id)))}
                            className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 transition"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-4 text-muted-foreground text-xs">
                      <ClipboardList size={14} className="opacity-40" />
                      <span>No terms selected — click <strong>+ Add T&amp;C</strong> to add from master</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={goToList}>Cancel</Button>
        <Button type="button" onClick={onSave} disabled={isSaving || !headerIsValid} className="gap-1.5 btn-module text-white hover:opacity-90 border-0 disabled:opacity-40">
          <Save size={14} /> {isSaving ? "Saving…" : "Save as Draft"}
        </Button>
      </div>
    </div>
  );
}
