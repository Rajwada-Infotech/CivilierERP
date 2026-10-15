import { Hash, Calendar, ChevronDown, Building2, FolderOpen, FileText } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { inp, inpSel, FieldLabel, SectionCard, SectionTitle } from "./config";
import type { VIOState } from "./useVehicleInOut";

// Document info: type and number, year, company, project, godown, entry time.
export function VIODocInfo({ m }: { m: VIOState }) {
  const { finYears, editingId, errors, setReceivedQtyByItem, setPhotoByItem, setQualityByItem, setBrandByItem, form, pf, docNoPreview, loadingPreview, companies, filteredProjects } = m;
  return (
    <>
      {/* ── Section 1: Document Info ── */}
      <SectionCard>
        <SectionTitle
          icon={FileText}
          label="Document Details"
          sub="Basic document information"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Company */}
          <div>
            <FieldLabel required>
              <span className="inline-flex items-center gap-1">
                <Building2 size={9} />
                Company
              </span>
            </FieldLabel>
            <div className="relative">
              <select
                value={form.companyId ?? ""}
                onChange={(e) => {
                  const nextCompanyId = e.target.value
                    ? Number(e.target.value)
                    : null;
                  // A PO picked under the old company/project no
                  // longer applies once either filter changes — clear
                  // it (and the supplier it auto-filled) instead of
                  // leaving a stale selection the new filter can't see.
                  pf({
                    companyId: nextCompanyId,
                    projectId: null,
                    poId: null,
                    poNumber: "",
                    supplierId: null,
                    supplierName: "",
                    contactPerson: "",
                  });
                  setReceivedQtyByItem({});
                  setPhotoByItem({});
                  setQualityByItem({});
                  setBrandByItem({});
                }}
                className={`appearance-none ${inpSel} ${errors.companyId ? "border-destructive/60" : ""}`}
              >
                <option value="">Select Company…</option>
                {(companies as any[]).map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
            {errors.companyId && (
              <p className="text-[0.625rem] text-destructive mt-1">
                {errors.companyId}
              </p>
            )}
          </div>

          {/* Project */}
          <div>
            <FieldLabel required>
              <span className="inline-flex items-center gap-1">
                <FolderOpen size={9} />
                Project
              </span>
            </FieldLabel>
            <div className="relative">
              <select
                value={form.projectId ?? ""}
                onChange={(e) => {
                  const nextProjectId = e.target.value
                    ? Number(e.target.value)
                    : null;
                  // Same reasoning as the Company select — a PO for
                  // the previous project shouldn't linger once the
                  // project filter changes.
                  pf({
                    projectId: nextProjectId,
                    poId: null,
                    poNumber: "",
                    supplierId: null,
                    supplierName: "",
                    contactPerson: "",
                  });
                  setReceivedQtyByItem({});
                  setPhotoByItem({});
                  setQualityByItem({});
                  setBrandByItem({});
                }}
                className={`${inpSel} ${errors.projectId ? "border-destructive/60" : ""}`}
              >
                <option value="">Select Project…</option>
                {filteredProjects.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
            {errors.projectId && (
              <p className="text-[0.625rem] text-destructive mt-1">
                {errors.projectId}
              </p>
            )}
          </div>

          {/* Doc Date — locked to today; entries are dated when
              they're actually made, not backdated/postdated. */}
          <div>
            <FieldLabel required>Doc Date</FieldLabel>
            <div className="relative">
              <Calendar
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <DateInput
                value={form.docDate}
                readOnly
                disabled
                title="Doc date is always today's date"
                className={`${inp} pl-9 bg-muted/30 cursor-not-allowed opacity-70 [&::-webkit-calendar-picker-indicator]:hidden`}
              />
            </div>
          </div>

          {/* Fin Year */}
          <div>
            <FieldLabel>Financial Year</FieldLabel>
            <div className="relative">
              <select
                value={form.finYear}
                onChange={(e) => pf({ finYear: e.target.value })}
                className={inpSel}
              >
                <option value="">Select FY…</option>
                {finYears
                  .filter((fy) => !fy.locked && fy.status === "Active")
                  .sort((a, b) => b.year.localeCompare(a.year))
                  .map((fy) => (
                    <option key={fy.id} value={fy.year}>
                      {fy.year}
                    </option>
                  ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
          </div>

          {/* Doc Number preview */}
          <div>
            <FieldLabel>Doc Number</FieldLabel>
            <div className="flex items-center gap-2 px-3 h-[38px] rounded-lg bg-muted/40 border border-dashed border-border">
              <Hash
                size={13}
                className="text-muted-foreground shrink-0"
              />
              {editingId ? (
                <span className="font-mono text-sm text-primary font-semibold">
                  {form.docNo || "—"}
                </span>
              ) : docNoPreview?.nextDocNo ? (
                <span className="font-mono text-sm text-primary font-semibold">
                  {docNoPreview.nextDocNo}
                </span>
              ) : loadingPreview ? (
                <span className="text-sm text-muted-foreground/60 animate-pulse">
                  Generating…
                </span>
              ) : (
                <span className="text-sm text-muted-foreground/40 italic">
                  Auto-generated on save
                </span>
              )}
            </div>
          </div>

          {/* Remarks */}
          <div className="sm:col-span-3">
            <FieldLabel>Remarks</FieldLabel>
            <input
              type="text"
              value={form.remarks}
              onChange={(e) => pf({ remarks: e.target.value })}
              className={inp}
              placeholder="Optional notes…"
            />
          </div>
        </div>
      </SectionCard>
    </>
  );
}
