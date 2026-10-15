import { Card } from "@/components/ui/card";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { Hash, RefreshCw, AlertCircle, ClipboardList, X, Receipt, ChevronDown } from "lucide-react";
import { inputCls, selectCls, FieldLabel } from "./config";
import type { POState } from "./usePurchaseOrder";

// Document type and number, financial year, and the source (MR, quotation, work order) a PO is raised from.
export function PODocSource({ m }: { m: POState }) {
  const { viewMode, poDocTypeId, poDocNo, poDocTypes, poDocTypesLoading, finYearOptions, selectedFinYear, setSelectedFinYear, saving, sourceMR, mrDropdownValue, setMrDropdownValue, mrDropdownLoading, mrDropdownError, mrFilterCompanyId, setMrFilterCompanyId, mrFilterProjectId, setMrFilterProjectId, sourceWD, sourceWO, sourceSaleInvoice, setSourceSaleInvoice, saleInvoiceInput, setSaleInvoiceInput, approvedMRs, approvedMRsLoading, companies, filteredMRProjects, items, handleMRDropdownSelect, applyPoDocNumber, refreshPoDocNumber, validate, isReadOnly } = m;
  return (
    <>
      {/* ── Document Type & Fin Year Card ─────────────────────────────────── */}
      {/* ── MR Doc Number Lookup (only shown in create mode, before any source is set) ── */}
      {viewMode === "create" &&
        !sourceMR &&
        !sourceWD &&
        !sourceWO &&
        !isReadOnly && (
          <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
            <h3
              className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-2"
              title="Filter by company and project, then select an approved Material Request to auto-fill items and details."
            >
              <ClipboardList
                size={11}
                className="text-emerald-600 dark:text-emerald-400"
              />
              Load from Material Request
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="relative">
                <select
                  value={mrFilterCompanyId}
                  onChange={(e) => {
                    setMrFilterCompanyId(e.target.value);
                    setMrFilterProjectId("");
                    setMrDropdownValue("");
                  }}
                  className={`${inputCls} pr-8 appearance-none`}
                >
                  <option value="">Company —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
              <div className="relative">
                <select
                  value={mrFilterProjectId}
                  onChange={(e) => {
                    setMrFilterProjectId(e.target.value);
                    setMrDropdownValue("");
                  }}
                  disabled={filteredMRProjects.length === 0}
                  className={`${inputCls} pr-8 appearance-none`}
                >
                  <option value="">Project —</option>
                  {filteredMRProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
              <div className="relative">
                <select
                  value={mrDropdownValue}
                  onChange={(e) =>
                    void handleMRDropdownSelect(e.target.value)
                  }
                  disabled={approvedMRsLoading || mrDropdownLoading}
                  className={`${inputCls} pr-8 appearance-none ${mrDropdownError ? "border-red-400" : ""}`}
                >
                  <option value="">
                    {approvedMRsLoading
                      ? "Loading MRs…"
                      : approvedMRs.length === 0
                        ? "No approved MRs"
                        : "Material Request —"}
                  </option>
                  {approvedMRs.map((mr) => (
                    <option key={mr.MRId} value={String(mr.MRId)}>
                      {mr.DocNo}
                      {mr.ProjectName ? ` · ${mr.ProjectName}` : ""}
                      {mr.FinYearName ? ` (${mr.FinYearName})` : ""}
                    </option>
                  ))}
                </select>
                {mrDropdownLoading ? (
                  <RefreshCw
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin"
                  />
                ) : (
                  <ChevronDown
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                )}
              </div>
            </div>
            {mrDropdownError && (
              <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                <AlertCircle size={11} />
                {mrDropdownError}
              </p>
            )}
          </div>
        )}

      {viewMode === "create" &&
        !sourceMR &&
        !sourceWD &&
        !sourceWO &&
        !isReadOnly && (
          <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-sm flex flex-wrap items-center gap-2">
            <span
              className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 shrink-0"
              title="Enter a paid Sale Invoice doc number to link this PO to a Sale Invoice. The backend will validate that the invoice is fully paid before saving."
            >
              <Receipt size={11} className="text-blue-500" />
              Link Sale Invoice
            </span>
            <input
              type="number"
              value={saleInvoiceInput}
              onChange={(e) => setSaleInvoiceInput(e.target.value)}
              placeholder="Sale Invoice ID (optional)"
              className={`${inputCls} flex-1 min-w-[140px] !py-1.5`}
              disabled={!!sourceSaleInvoice}
              min={1}
            />
            {!sourceSaleInvoice ? (
              <button
                type="button"
                onClick={() => {
                  const id = parseInt(saleInvoiceInput.trim(), 10);
                  if (!id || id <= 0) return;
                  setSourceSaleInvoice({ id, docNo: `SI-${id}` });
                }}
                disabled={!saleInvoiceInput.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
              >
                Link
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSourceSaleInvoice(null);
                  setSaleInvoiceInput("");
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:bg-muted transition-colors shrink-0"
              >
                Clear
              </button>
            )}
          </div>
        )}

      {sourceSaleInvoice && !isReadOnly && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 flex items-center gap-3 text-sm">
          <Receipt
            size={15}
            className="text-blue-600 dark:text-blue-400 shrink-0"
          />
          <span className="text-blue-700 dark:text-blue-300 flex-1">
            Linked to Sale Invoice{" "}
            <span className="font-mono font-bold">
              {sourceSaleInvoice.docNo}
            </span>
            . The backend will validate that this invoice is fully paid
            before saving.
          </span>
          <button
            type="button"
            onClick={() => {
              setSourceSaleInvoice(null);
              setSaleInvoiceInput("");
            }}
            className="text-blue-400 hover:text-blue-600 transition-colors"
            title="Remove link"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {sourceMR && !isReadOnly && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 flex items-center gap-3 text-sm">
          <ClipboardList
            size={15}
            className="text-emerald-600 dark:text-emerald-400 shrink-0"
          />
          <span className="text-emerald-700 dark:text-emerald-300">
            Creating <span className="font-semibold">Normal PO</span> from
            Material Request{" "}
            <span className="font-mono font-bold">{sourceMR.docNo}</span>.
            Items, company and project have been pre-filled.
          </span>
        </div>
      )}

      {sourceWD && !isReadOnly && (
        <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 px-4 py-3 flex items-center gap-3 text-sm">
          <ClipboardList
            size={15}
            className="text-orange-600 dark:text-orange-400 shrink-0"
          />
          <span className="text-orange-700 dark:text-orange-300">
            Creating <span className="font-semibold">Material PO</span> from
            Work Done{" "}
            <span className="font-mono font-bold">{sourceWD.docNo}</span>.
            Company, project and line items have been pre-filled.
          </span>
        </div>
      )}

      {sourceWO && !isReadOnly && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 flex items-center gap-3 text-sm">
          <ClipboardList
            size={15}
            className="text-emerald-600 dark:text-emerald-400 shrink-0"
          />
          <span className="text-emerald-700 dark:text-emerald-300">
            Creating <span className="font-semibold">Material PO</span> from
            Work Order{" "}
            <span className="font-mono font-bold">{sourceWO.docNo}</span>.
            Company, project and material line items have been pre-filled.
          </span>
        </div>
      )}

      {!isReadOnly && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
            <Hash
              size={11}
              className="text-emerald-600 dark:text-emerald-400"
            />
            Document Configuration
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Financial Year</FieldLabel>
              <div className="relative">
                <select
                  value={selectedFinYear ?? ""}
                  onChange={(e) => {
                    const nextFinYear = e.target.value || undefined;
                    setSelectedFinYear(nextFinYear);
                    if (poDocTypeId)
                      void refreshPoDocNumber(poDocTypeId, nextFinYear);
                  }}
                  className={selectCls}
                >
                  <option value="">Select Fin Year…</option>
                  {finYearOptions.map((fy) => (
                    <option key={fy.id} value={fy.year}>
                      {fy.year}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </div>
            <div>
              <FieldLabel>Document Type &amp; Number</FieldLabel>
              {sourceWO ? (
                // Locked to WO_PO type — no dropdown
                <div className="space-y-2">
                  <div className="flex items-center gap-2 w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-muted/30 text-foreground">
                    <Hash
                      size={13}
                      className="text-muted-foreground shrink-0"
                    />
                    <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      WO_PO
                    </span>
                    <span className="text-xs opacity-40">·</span>
                    <span className="text-xs text-muted-foreground">
                      Work Order for Materials
                    </span>
                  </div>
                  {poDocNo && (
                    <div className="flex items-center gap-2 px-1">
                      <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">
                        {poDocNo}
                      </span>
                      {selectedFinYear && (
                        <span className="text-[0.625rem] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-heading">
                          FY {selectedFinYear}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <select
                      value={poDocTypeId ? String(poDocTypeId) : ""}
                      onChange={async (e) => {
                        const id = e.target.value
                          ? parseInt(e.target.value, 10)
                          : null;
                        if (!id) {
                          applyPoDocNumber(null, "");
                          return;
                        }
                        const docNo = await fetchNextDocNumber(
                          id,
                          selectedFinYear || undefined,
                        );
                        applyPoDocNumber(id, docNo);
                      }}
                      disabled={poDocTypesLoading || viewMode === "edit"}
                      className={selectCls}
                    >
                      {poDocTypesLoading ? (
                        <option value="">Loading…</option>
                      ) : poDocTypes.length === 0 ? (
                        <option value="">No document types found</option>
                      ) : (
                        poDocTypes.map((dt) => {
                          const label =
                            dt.ProjectCode && dt.ModuleCode
                              ? `${dt.ProjectCode}-${dt.ModuleCode}`
                              : (dt.DocNoPrefix ??
                                dt.FullPrefix ??
                                dt.Prefix);
                          return (
                            <option
                              key={dt.TypeOfDocId}
                              value={String(dt.TypeOfDocId)}
                            >
                              {label} — {dt.Description}
                            </option>
                          );
                        })
                      )}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                  {poDocNo && (
                    <div className="flex items-center gap-2 px-1">
                      <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">
                        {poDocNo}
                      </span>
                      {selectedFinYear && (
                        <span className="text-[0.625rem] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-heading">
                          FY {selectedFinYear}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
