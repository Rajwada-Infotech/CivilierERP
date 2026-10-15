import { CalendarDays, Save, ArrowLeft, ChevronDown, X, Plus, Check } from "lucide-react";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { DateInput } from "@/components/ui/date-input";
import { BodyPortal } from "@/components/ui/body-portal";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { inputCls, selectCls, Field, SectionHeader, LBL, RULE, KEY_INK, KEY_LINE, ACT } from "./config";
import type { QtState } from "./useQuotation";

const Chevron = () => (
  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
);

// Create / edit a quotation (RFQ): scope, source MR, items, suppliers, terms.
export function QtForm({ m }: { m: QtState }) {
  const { editingId, header, setHeader, items, setItems, supplierIds, tcIds, setTcIds, tcDropdownOpen, setTcDropdownOpen, addSupplierId, setAddSupplierId, setH, companies, filteredProjects, finYears, finYearStr, suppliers, tcRecords, approvedMRs, supplierMap, qtDocTypes, qtDocTypesLoading, tagMR, addSupplier, removeSupplier, isSaving, goToList, headerIsValid, onSave } = m;
  return (
    <div className="space-y-4">
      {/* Page header bar */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ border: RULE }}>
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={goToList} className={`${KEY_LINE} h-8 px-3 shrink-0`}>
            <ArrowLeft size={12} /> Back
          </button>
          <h2 className="font-heading text-base font-bold tracking-tight text-foreground truncate">
            {editingId ? "Edit quotation" : "New quotation"}
          </h2>
        </div>
        {/* Doc number preview */}
        <div className="flex items-center gap-2 shrink-0">
          {editingId ? (
            <span className="font-heading font-bold tracking-wide text-foreground text-sm">{header.docNoPreview}</span>
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
                    aria-label="Document type"
                    className="text-xs border border-foreground/40 focus:border-foreground px-2 py-1.5 pr-6 bg-card appearance-none outline-none"
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
                <span className="font-heading font-bold text-foreground text-sm tracking-wider border border-dashed border-foreground/50 px-2 py-1">
                  {header.docNoPreview}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main form */}
      <div className="bg-card p-5 space-y-7" style={{ border: RULE }}>

        {/* Section 1: Scope */}
        <div>
          <SectionHeader title="Scope" sub="Company, project and financial year" />
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
                <Chevron />
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
                <Chevron />
              </div>
            </Field>

            <Field label="Financial year">
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
                <Chevron />
              </div>
            </Field>
          </div>
        </div>

        {/* Section 2: Dates & MR */}
        <div>
          <SectionHeader title="Timeline and source" sub="Tag the approved MR and set the response deadline" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Tag material request" required>
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
                <Chevron />
              </div>
            </Field>

            <Field label="Quotation date" required>
              <div className="relative">
                <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <DateInput value={header.docDate} onChange={(e) => setH("docDate", e.target.value)} className={`${inputCls} pl-8`} />
              </div>
            </Field>

            <Field label="Response due date">
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
            title="Items"
            sub={items.length > 0 ? `${items.length} items from ${header.sourceMRDocNo}` : "Pulled automatically from the tagged MR"}
          />
          {items.length === 0 ? (
            <div className="border border-dashed border-foreground/40 px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">Tag an approved material request above to fill in the items.</p>
            </div>
          ) : (
            <div className="overflow-x-auto" style={{ border: RULE }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className={`${LBL} text-left`} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.3)" }}>
                    <th className="px-4 py-2.5 w-10 font-semibold">#</th>
                    <th className="px-4 py-2.5 font-semibold">Item</th>
                    <th className="px-4 py-2.5 w-24 text-right font-semibold">UOM</th>
                    <th className="px-4 py-2.5 w-20 text-right font-semibold">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/10">
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs font-heading tabular-nums">{String(idx + 1).padStart(2, "0")}</td>
                      <td className="px-4 py-2.5 font-medium">{it.ItemName || it.ItemId}</td>
                      <td className="px-4 py-2.5 text-muted-foreground text-right">{it.UOMName || it.UOMCode}</td>
                      <td className="px-4 py-2.5 font-heading font-semibold tabular-nums text-right">{it.Quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Section 4: Suppliers */}
        <div>
          <SectionHeader title="Suppliers to quote" sub="Tag every supplier who should receive this RFQ" />
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
              <Chevron />
            </div>
            <button type="button" onClick={addSupplier} disabled={!addSupplierId} className={`${KEY_LINE} h-10 px-3 shrink-0`}>
              <Plus size={12} /> Add
            </button>
          </div>
          {supplierIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suppliers tagged yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {supplierIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1.5 border border-foreground px-2.5 py-1 text-xs font-medium text-foreground">
                  {supplierMap[id]?.LHeadName ?? supplierMap[id]?.label ?? `Supplier #${id}`}
                  <button type="button" onClick={() => removeSupplier(id)} className="text-muted-foreground hover:text-destructive transition-colors" aria-label="Remove supplier">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Section 5: Terms & Remarks */}
        <div>
          <SectionHeader title="Remarks and terms" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Remarks">
              <textarea
                value={header.remarks}
                onChange={(e) => setH("remarks", e.target.value)}
                rows={3}
                className={`${inputCls} resize-none`}
                placeholder="Optional notes…"
              />
            </Field>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className={LBL}>Terms and conditions</span>
                <div className="relative">
                  <button type="button" onClick={() => setTcDropdownOpen((o) => !o)} className={`${KEY_LINE} h-7 px-2.5`} aria-expanded={tcDropdownOpen}>
                    <Plus size={12} /> Add T&amp;C
                  </button>
                  {tcDropdownOpen && (
                    <>
                      <BodyPortal><div className="fixed inset-0 z-10" onClick={() => setTcDropdownOpen(false)} /></BodyPortal>
                      <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-card overflow-hidden shadow-[5px_5px_0_hsl(var(--foreground)/0.12)]" style={{ border: RULE }}>
                        <div className="px-3 py-2" style={{ borderBottom: RULE }}>
                          <p className={LBL}>Select terms and conditions</p>
                        </div>
                        <div className="max-h-56 overflow-y-auto divide-y divide-foreground/10">
                          {(tcRecords as any[]).length === 0 ? (
                            <p className="px-4 py-6 text-xs text-center text-muted-foreground">No T&amp;C records found</p>
                          ) : (
                            (tcRecords as any[]).map((tc) => {
                              const isSelected = tcIds.includes(String(tc.Id));
                              return (
                                <button
                                  key={tc.Id}
                                  type="button"
                                  aria-pressed={isSelected}
                                  onClick={() => setTcIds((p) => isSelected ? p.filter((id) => id !== String(tc.Id)) : [...p, String(tc.Id)])}
                                  className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-primary/5 transition ${isSelected ? "bg-primary/5" : ""}`}
                                >
                                  <span className={`mt-0.5 flex-shrink-0 w-4 h-4 border flex items-center justify-center ${isSelected ? "bg-foreground border-foreground" : "border-foreground/40"}`}>
                                    {isSelected && <Check size={10} className="text-card" strokeWidth={3} />}
                                  </span>
                                  <span className="block text-sm font-medium text-foreground truncate">{tc.Name}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                        <div className="px-3 py-2" style={{ borderTop: RULE }}>
                          <button type="button" onClick={() => setTcDropdownOpen(false)} className={`${KEY_INK} w-full h-8`}>Done</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {tcIds.length > 0 ? (
                <div className="border border-foreground/30 divide-y divide-foreground/10">
                  {(tcRecords as any[]).filter((tc) => tcIds.includes(String(tc.Id))).map((tc, idx) => (
                    <div key={tc.Id} className="flex items-center gap-3 px-3 py-2">
                      <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-muted-foreground w-5">{String(idx + 1).padStart(2, "0")}</span>
                      <p className="flex-1 text-sm font-medium text-foreground min-w-0 truncate">{tc.Name}</p>
                      <button
                        type="button"
                        onClick={() => setTcIds((p) => p.filter((id) => id !== String(tc.Id)))}
                        className={`${ACT} hover:text-destructive hover:border-destructive`}
                        aria-label={`Remove ${tc.Name}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border border-dashed border-foreground/40 px-4 py-4 text-muted-foreground text-xs">
                  No terms selected — use Add T&amp;C to pick them from the master.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-card flex items-center justify-end gap-2 px-4 py-3" style={{ border: RULE }}>
        <button type="button" onClick={goToList} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
        <button type="button" onClick={onSave} disabled={isSaving || !headerIsValid} className={`${KEY_INK} h-9 px-5`}>
          <Save size={13} /> {isSaving ? "Saving…" : "Save as draft"}
        </button>
      </div>
    </div>
  );
}
