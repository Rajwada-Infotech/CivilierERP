import { CheckCircle2, FolderOpen, ChevronDown, Filter, CopyPlus, Warehouse, RotateCcw, Lock } from "lucide-react";
import { hasRemainingItems, countRemainingItems } from "../grnRemainingItems";
import { createEmptyItem, inpSel, FieldLabel, SectionCard, SectionTitle, InfoPill } from "./config";
import type { GRNState } from "./useGRN";

// Company, project and the purchase order being received against.
export function GRNPoSection({ m }: { m: GRNState }) {
  const { editingId, loadingPO, pendingVehicleInOuts, loadingVehicleInOuts, poRemainingItems, selectedFinYear, setSelectedFinYear, finYearOptions, formData, setFormData, errors, godowns, findProjectGodownId, filteredProjects, companiesData, pos, handlePOSelect, handleVehicleInOutSelect, handleUseRemainingItems } = m;
  return (
    <>
      {/* ── Section 1: Filters + PO ── */}
      <SectionCard>
        <SectionTitle
          icon={Filter}
          label="Filters & Purchase Order"
          sub="Narrow the list, then select a PO"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Fin Year */}
          <div>
            <FieldLabel>Financial Year</FieldLabel>
            <div className="relative">
              {/* Defaults to the active financial year but stays
                  editable — some GRNs are booked against a prior
                  year (e.g. late entries). */}
              <select
                value={selectedFinYear}
                onChange={(e) => setSelectedFinYear(e.target.value)}
                className={inpSel}
              >
                {finYearOptions.length === 0 && (
                  <option value="">Loading…</option>
                )}
                {finYearOptions.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>

          {/* Company */}
          <div>
            <FieldLabel>Company</FieldLabel>
            <div className="relative">
              <select
                value={formData.companyId}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    companyId: e.target.value,
                    projectId: "",
                    poId: "",
                    poNumber: "",
                    supplierId: "",
                    supplierName: "",
                    items: [createEmptyItem()],
                    parentDocNo: "",
                    rootExBDocNo: "",
                  }))
                }
                className={inpSel}
              >
                <option value="">All Companies</option>
                {(companiesData as any[]).map((c: any) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>

          {/* Project */}
          <div>
            <FieldLabel>
              <span className="inline-flex items-center gap-1">
                <FolderOpen size={9} />
                Project
              </span>
            </FieldLabel>
            <div className="relative">
              <select
                value={formData.projectId}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    projectId: e.target.value,
                    poId: "",
                    poNumber: "",
                    supplierId: "",
                    supplierName: "",
                    items: [createEmptyItem()],
                    parentDocNo: "",
                    rootExBDocNo: "",
                  }))
                }
                className={inpSel}
              >
                <option value="">All Projects</option>
                {filteredProjects.map((p: any) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>

          {/* Godown — once a Project is picked, this is locked to
              that project's own linked godown (auto-selected above
              by findProjectGodownId) rather than letting the user
              pick any godown company-wide. No project yet → falls
              back to the full godown list so it isn't blocked. */}
          <div>
            <FieldLabel>
              <span className="inline-flex items-center gap-1">
                <Warehouse size={9} />
                Godown
              </span>
            </FieldLabel>
            <div className="relative">
              {formData.projectId ? (
                <div
                  className={`${inpSel} flex items-center gap-1.5 bg-card cursor-not-allowed`}
                  title="Locked to this project's linked godown"
                >
                  <Lock size={11} className="text-muted-foreground shrink-0" />
                  <span className="truncate">
                    {formData.godownId
                      ? (godowns.find(
                          (g: any) =>
                            String(g.GodownID) === formData.godownId,
                        )?.GodownName ?? "Main Godown")
                      : "Main Godown"}
                  </span>
                </div>
              ) : (
                <>
                  <select
                    value={formData.godownId}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        godownId: e.target.value,
                      }))
                    }
                    className={inpSel}
                  >
                    <option value="">Main Godown</option>
                    {godowns
                      .filter((g: any) => !g.IsMain)
                      .map((g: any) => (
                        <option key={g.GodownID} value={String(g.GodownID)}>
                          {g.GodownName}
                        </option>
                      ))}
                  </select>
                  <ChevronDown
                    size={12}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </>
              )}
            </div>
          </div>

          {/* Purchase Order — spans 2 cols */}
          <div className="sm:col-span-2">
            <FieldLabel required>Purchase Order</FieldLabel>
            <div className="relative">
              <select
                value={formData.poId}
                onChange={(e) => handlePOSelect(e.target.value)}
                disabled={!!editingId || loadingPO}
                className={`appearance-none ${inpSel} ${!!editingId || loadingPO ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <option value="">
                  {loadingPO
                    ? "Loading…"
                    : pos.length === 0
                      ? "No POs for selected filters"
                      : "Select Purchase Order…"}
                </option>
                {pos.map((po) => (
                  <option key={po.value} value={po.value}>
                    {po.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
            {errors.poId && (
              <p className="text-destructive text-[0.6875rem] mt-1">
                {errors.poId}
              </p>
            )}
            {loadingPO && (
              <p className="text-[0.6875rem] text-muted-foreground mt-1 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 border-2 border-foreground/40 border-t-transparent animate-spin inline-block" />
                Loading PO details…
              </p>
            )}
          </div>

          {/* Vehicle In/Out — only shown once a PO is selected. One
              of two ways to source this GRN's items: pick a Vehicle
              In/Out lot linked to this PO that doesn't already have
              a GRN, or use "Remaining Items" below instead. */}
          {formData.poId && (
            <div className="sm:col-span-2">
              <FieldLabel required={formData.grnSourceMode !== "remaining"}>
                Vehicle In/Out Document
              </FieldLabel>
              <div className="relative">
                <select
                  value={formData.vehicleInOutId}
                  onChange={(e) =>
                    handleVehicleInOutSelect(e.target.value)
                  }
                  disabled={
                    !!editingId ||
                    loadingPO ||
                    loadingVehicleInOuts ||
                    formData.grnSourceMode === "remaining"
                  }
                  className={`appearance-none ${inpSel} ${!!editingId || loadingPO || loadingVehicleInOuts || formData.grnSourceMode === "remaining" ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <option value="">
                    {loadingVehicleInOuts
                      ? "Loading…"
                      : pendingVehicleInOuts.length === 0
                        ? "No pending Vehicle In/Out documents for this PO"
                        : "Select Vehicle In/Out…"}
                  </option>
                  {pendingVehicleInOuts.map((v) => (
                    <option
                      key={v.VehicleInOutID}
                      value={String(v.VehicleInOutID)}
                    >
                      {v.DocNo} — {v.VehicleNo || "No Vehicle No"}
                      {v.DocDate
                        ? ` (${new Date(v.DocDate).toLocaleDateString("en-IN")})`
                        : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
              {errors.vehicleInOutId && (
                <p className="text-destructive text-[0.6875rem] mt-1">
                  {errors.vehicleInOutId}
                </p>
              )}
              {formData.grnSourceMode === "remaining" && (
                <p className="text-[0.6875rem] text-muted-foreground mt-1">
                  Sourced from remaining PO items instead — clear it below to pick a Vehicle In/Out lot.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Remaining PO Items — the second way to raise a GRN
            against this PO, grouped alongside the linked PO
            itself rather than routed through a Vehicle In/Out
            lot. Lets the same PO be split across as many GRNs as
            needed as quantities trickle in. */}
        {formData.poId &&
          !editingId &&
          poRemainingItems.length > 0 && (
            <div className="border border-foreground/30 bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-foreground/30 bg-card">
                <RotateCcw
                  size={12}
                  className="text-foreground shrink-0"
                />
                <span className="text-xs font-semibold text-foreground">
                  Remaining Items on this PO
                </span>
                <span className="ml-auto text-[0.625rem] text-muted-foreground">
                  {countRemainingItems(poRemainingItems)} of{" "}
                  {poRemainingItems.length} item
                  {poRemainingItems.length !== 1 ? "s" : ""} left
                </span>
              </div>
              {hasRemainingItems(poRemainingItems) ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-card border-b border-foreground/30">
                          <th className="px-3 py-2 text-left text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">
                            Item
                          </th>
                          <th className="px-3 py-2 text-right text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">
                            Ordered
                          </th>
                          <th className="px-3 py-2 text-right text-[0.625rem] font-heading uppercase tracking-wider text-muted-foreground">
                            Received
                          </th>
                          <th className="px-3 py-2 text-right text-[0.625rem] font-heading uppercase tracking-wider text-foreground">
                            Remaining
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-foreground/10">
                        {poRemainingItems
                          .filter((it) => it.remainingQty > 1e-6)
                          .map((it, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-1.5 font-medium text-foreground max-w-[200px] truncate">
                                {it.itemName || `Item ${idx + 1}`}
                              </td>
                              <td className="px-3 py-1.5 text-right font-heading text-muted-foreground">
                                {it.orderedQty}
                              </td>
                              <td className="px-3 py-1.5 text-right font-heading text-muted-foreground">
                                {it.receivedQty}
                              </td>
                              <td className="px-3 py-1.5 text-right font-heading font-semibold text-foreground">
                                {it.remainingQty}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-2.5 border-t border-foreground/30">
                    <button
                      type="button"
                      onClick={handleUseRemainingItems}
                      disabled={
                        loadingPO ||
                        formData.grnSourceMode === "vehicleInOut"
                      }
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 border transition-colors ${
                        formData.grnSourceMode === "remaining"
                          ? "border-foreground/40 bg-card text-foreground cursor-default"
                          : formData.grnSourceMode === "vehicleInOut"
                            ? "border-foreground/30 text-muted-foreground opacity-50 cursor-not-allowed"
                            : "border-foreground/40 text-foreground hover:bg-primary/5"
                      }`}
                    >
                      {formData.grnSourceMode === "remaining" ? (
                        <>
                          <CheckCircle2 size={13} /> Using Remaining Items
                        </>
                      ) : (
                        <>
                          <CopyPlus size={13} /> Create GRN for Remaining Items
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="px-4 py-4 text-center text-xs text-muted-foreground">
                  Fully received — no quantity left to receive on this PO.
                </div>
              )}
            </div>
          )}

        {/* Autofilled chips */}
        {formData.poId && !loadingPO && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <InfoPill label="Supplier" value={formData.supplierName} />
            <InfoPill label="PO No" value={formData.poNumber} mono />
            <InfoPill label="Fin Year" value={formData.finYear} />
            {formData.vehicleInOutDocNo && (
              <InfoPill
                label="Vehicle In/Out"
                value={formData.vehicleInOutDocNo}
                mono
              />
            )}
            {formData.projectId && (
              <InfoPill
                label="Project"
                value={
                  (filteredProjects as any[]).find(
                    (p: any) => String(p.id) === formData.projectId,
                  )?.name || ""
                }
              />
            )}
          </div>
        )}
      </SectionCard>
    </>
  );
}
