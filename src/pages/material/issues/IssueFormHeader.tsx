import { CalendarDays, FileText, Building2, AlertTriangle, Warehouse, ArrowDownToLine, User, Layers, ArrowLeft, ChevronDown, ClipboardList } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { inputCls, selectCls, Field, RULE, LBL, KEY_LINE } from "./config";
import type { IssuesState } from "./useIssues";

// The issue header: number, date, company, project, godown, block / floor, work order, issued to, remarks.
export function IssueFormHeader({ m }: { m: IssuesState }) {
  const { issueCostCenters, glHeads, editingId, viewingRecord, header, setHeader, finYears, finYearStr, cart, setH, companies, loadingCompanies, loadingProjects, godowns, loadingGodowns, blocks, loadingBlocks, blockFloors, loadingFloors, contractors, itemOptions, loadingItems, issDocTypes, issDocTypesLoading, selectedGodown, filteredProjects, filteredGodowns, filteredBlocks, issueWorkOrders, handleCompanyChange, handleProjectChange, handleBlockChange, handleGodownChange, goToList, lowStockItems } = m;
  return (
    <>
      {/* ── Header card ── */}
      <div className="bg-card" style={{ border: RULE }}>
        <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: RULE }}>
          <button
            type="button"
            onClick={goToList}
            className={`${KEY_LINE} h-8 px-3 shrink-0`}
          >
            <ArrowLeft size={13} />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="min-w-0">
            <p className={LBL}>Material issue</p>
            <h2 className="font-heading text-base font-bold tracking-tight text-foreground truncate">
              {editingId ? "Edit issue" : "New issue"}
            </h2>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Doc number */}
          <div className="flex items-center gap-3 border border-dashed border-foreground/30 bg-card px-4 py-3">
            <FileText size={13} className="text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-[0.12em] mr-2 whitespace-nowrap">
              Issue No:
            </span>
            {editingId ? (
              <span className="font-heading font-bold text-foreground text-sm">
                {viewingRecord?.DocNo ?? "Immutable after creation"}
              </span>
            ) : (
              <div className="flex-1 flex items-center gap-3 min-w-0">
                <div className="relative flex-1">
                  <select
                    value={header.docTypeId ? String(header.docTypeId) : ""}
                    onChange={async (e) => {
                      const id = e.target.value ? parseInt(e.target.value, 10) : null;
                      if (!id) { setH("docTypeId", null); setH("docNoPreview", ""); return; }
                      const preview = await fetchNextDocNumber(id, finYearStr);
                      setHeader((p) => ({ ...p, docTypeId: id, docNoPreview: preview }));
                    }}
                    disabled={issDocTypesLoading}
                    className={selectCls}
                  >
                    {issDocTypesLoading ? (
                      <option value="">Loading…</option>
                    ) : issDocTypes.length === 0 ? (
                      <option value="">No doc types found</option>
                    ) : (
                      issDocTypes.map((dt) => {
                        const label =
                          dt.ProjectCode && dt.ModuleCode
                            ? `${dt.ProjectCode}-${dt.ModuleCode}`
                            : (dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix);
                        return (
                          <option key={dt.TypeOfDocId} value={String(dt.TypeOfDocId)}>
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
                {header.docNoPreview && (
                  <span className="font-heading text-sm font-bold text-foreground tracking-wider whitespace-nowrap">
                    {header.docNoPreview}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Row 1: Company | Project | Fin Year | Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Field label="Company" required>
              <div className="relative">
                <select
                  value={header.companyId}
                  onChange={(e) => handleCompanyChange(e.target.value)}
                  className={selectCls}
                >
                  <option value="">
                    {loadingCompanies ? "Loading…" : "Select company"}
                  </option>
                  {(companies as any[]).map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.label ?? c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Project" required>
              <div className="relative">
                <select
                  value={header.projectId}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  className={selectCls}
                >
                  <option value="">
                    {loadingProjects
                      ? "Loading…"
                      : header.companyId
                        ? "Select project"
                        : "Select company first"}
                  </option>
                  {filteredProjects.map((p: any) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Financial Year" required>
              <div className="relative">
                <select
                  value={header.finYearId}
                  onChange={(e) => setH("finYearId", e.target.value)}
                  className={selectCls}
                >
                  <option value="">Select fin year</option>
                  {(finYears as any[]).map((fy) => (
                    <option key={fy.id} value={String(fy.id)} disabled={fy.locked}>
                      {fy.year}
                      {fy.locked ? " (locked)" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </Field>

            <Field label="Issue Date" required>
              <div className="relative">
                <CalendarDays
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <DateInput
                  value={header.date}
                  onChange={(e) => setH("date", e.target.value)}
                  className={`${inputCls} pl-8`}
                />
              </div>
            </Field>
          </div>

          {/* ── Godown selector — prominent, full-width banner. Only opens
              once Company + Project are both picked, scoped to the godown
              tagged to that exact company + project. ── */}
          <div className="border-2 border-foreground/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Warehouse size={16} className="text-foreground" />
              <span className="text-sm font-semibold text-foreground">
                Source Godown
              </span>
              <span className="text-destructive text-sm">*</span>
              <span className="text-xs text-muted-foreground ml-1">
                {header.companyId && header.projectId
                  ? "Stock will be deducted from this godown"
                  : "Select a company and project to open its godown"}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="flex-1 min-w-0">
                <div className="relative">
                  <select
                    value={header.godownId}
                    onChange={(e) => handleGodownChange(e.target.value)}
                    disabled={!header.companyId || !header.projectId}
                    className={`appearance-none ${selectCls} border-foreground/40 disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <option value="">
                      {!header.companyId || !header.projectId
                        ? "Select company & project first"
                        : loadingGodowns
                          ? "Loading godowns…"
                          : filteredGodowns.length === 0
                            ? "No godown tagged to this company/project"
                            : "Select godown"}
                    </option>
                    {filteredGodowns.map((g) => (
                      <option key={g.id} value={String(g.id)}>
                        {g.name}
                        {g.code ? ` (${g.code})` : ""}
                        {g.isMain ? " · Main" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
              </div>

              {/* Stock summary for selected godown */}
              {selectedGodown && !loadingItems && (
                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-card border border-foreground/30">
                    <Layers size={12} className="text-muted-foreground" />
                    <span className="text-muted-foreground">Items:</span>
                    <span className="font-semibold text-foreground">
                      {(itemOptions as any[]).length}
                    </span>
                  </div>
                  {lowStockItems > 0 && (
                    <div className="flex items-center gap-1.5 px-3 py-2 bg-card border border-foreground/40">
                      <AlertTriangle
                        size={12}
                        className="text-foreground"
                      />
                      <span className="text-foreground font-medium">
                        {lowStockItems} out of stock
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Hint: changing godown resets cart */}
            {cart.some((ci) => ci.ItemId) && (
              <p className="text-[0.6875rem] text-foreground mt-2 flex items-center gap-1">
                <AlertTriangle size={10} />
                Changing the godown will reset all added items
              </p>
            )}
          </div>

          {/* Row 2: Block | Floor — which part of the site this material is
              for. Optional: Block is scoped to the selected project, Floor
              is scoped to the selected block (no standalone Floor Master
              exists, so this lists the floor numbers already in use under
              that block's units). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Block">
              <div className="relative">
                <Building2
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <select
                  value={header.blockId}
                  onChange={(e) => handleBlockChange(e.target.value)}
                  disabled={!header.projectId}
                  className={`${selectCls} pl-9 disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <option value="">
                    {!header.projectId
                      ? "Select project first"
                      : loadingBlocks
                        ? "Loading…"
                        : filteredBlocks.length === 0
                          ? "No blocks for this project"
                          : "— Select block —"}
                  </option>
                  {filteredBlocks.map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>
                      {b.BlockName}
                    </option>
                  ))}
                </select>
              </div>
            </Field>

            <Field label="Floor">
              <div className="relative">
                <Layers
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <select
                  value={header.floorNo}
                  onChange={(e) => setH("floorNo", e.target.value)}
                  disabled={!header.blockId}
                  className={`${selectCls} pl-9 disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <option value="">
                    {!header.blockId
                      ? "Select block first"
                      : loadingFloors
                        ? "Loading…"
                        : blockFloors.length === 0
                          ? "No floors found for this block"
                          : "— Select floor —"}
                  </option>
                  {blockFloors.map((f) => (
                    <option key={f} value={String(f)}>
                      {f === 0 ? "Ground Floor" : `Floor ${f}`}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          </div>

          {/* Row 3: Issued To | Cost Center */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Issued To (Contractor)">
              <div className="relative">
                <User
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <SearchableNativeSelect
                  value={header.issuedTo}
                  onChange={(e) => setH("issuedTo", e.target.value)}
                  className={`${selectCls} pl-9`}
                >
                  <option value="">— Select contractor —</option>
                  {contractors.map((c) => (
                    <option key={c.id} value={c.label}>{c.label}</option>
                  ))}
                </SearchableNativeSelect>
              </div>
            </Field>

            <Field label="Cost Center / GL Account">
              <div className="relative">
                <SearchableNativeSelect
                  value={header.costCenter}
                  onChange={(e) => setH("costCenter", e.target.value)}
                  className={selectCls}
                >
                  <option value="">— Select cost centre or GL account —</option>
                  {/* An older issue may hold a typed value that is in neither list; keep it selectable. */}
                  {header.costCenter &&
                    !issueCostCenters.some((c) => c.label === header.costCenter) &&
                    !glHeads.some((g) => g.label === header.costCenter) && (
                      <option value={header.costCenter}>{header.costCenter}</option>
                    )}
                  {issueCostCenters.length > 0 && (
                    <optgroup label="Cost centres">
                      {issueCostCenters.map((c) => (
                        <option key={`cc-${c.id}`} value={c.label}>{c.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {glHeads.length > 0 && (
                    <optgroup label="GL accounts">
                      {glHeads.map((g) => (
                        <option key={`gl-${g.id}`} value={g.label}>{g.label}</option>
                      ))}
                    </optgroup>
                  )}
                </SearchableNativeSelect>
              </div>
            </Field>
          </div>

          {/* Work order tag */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Work Order (optional)">
              <div className="relative">
                <ClipboardList
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <select
                  value={header.workOrderId}
                  onChange={(e) => {
                    const wo = issueWorkOrders.find((w) => String(w.id) === e.target.value);
                    setH("workOrderId", e.target.value);
                    setH("workOrderDocNo", wo?.docNo ?? "");
                  }}
                  disabled={!header.companyId || !header.projectId}
                  className={`${selectCls} pl-9 disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <option value="">
                    {!header.companyId || !header.projectId
                      ? "Select company and project first"
                      : issueWorkOrders.length === 0
                        ? "No work orders with a Material Request for this project"
                        : "— Tag a work order —"}
                  </option>
                  {header.workOrderId && !issueWorkOrders.some((w) => String(w.id) === header.workOrderId) && (
                    <option value={header.workOrderId}>{header.workOrderDocNo || `Work order #${header.workOrderId}`}</option>
                  )}
                  {issueWorkOrders.map((w) => (
                    <option key={w.id} value={String(w.id)}>
                      {w.docNo}
                      {w.contractorName ? ` · ${w.contractorName}` : ""}
                      {w.mrDocNo ? ` · ${w.mrDocNo}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <p className="text-[0.6875rem] text-muted-foreground self-end pb-2">
              Only approved work orders of this company and project that already have a Material Request are listed. Tagging one shows what the work order listed next to what is being issued.
            </p>
          </div>

          {/* Row 3: Reason | Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Reason for Issue" required>
              <Textarea
                value={header.reason}
                onChange={(e) => setH("reason", e.target.value)}
                rows={2}
                className="resize-none text-sm"
                placeholder="State the reason for this material issue…"
              />
            </Field>
            <Field label="Remarks">
              <Textarea
                value={header.remarks}
                onChange={(e) => setH("remarks", e.target.value)}
                rows={2}
                className="resize-none text-sm"
                placeholder="Optional notes…"
              />
            </Field>
          </div>
        </div>
      </div>
    </>
  );
}
