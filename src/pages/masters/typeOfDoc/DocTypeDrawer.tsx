import { Info, Loader2, Save, X } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { FIELD, HEAD, KEY_INK, KEY_LINE, LBL, LINK_OPTIONS, MODULE_CODE_OPTIONS, RULE, ACT, chip } from "./config";
import type { TypeOfDocState } from "./useTypeOfDoc";

const label = `${LBL} block mb-1.5`;
const hint = "mt-1 text-[0.6875rem] text-muted-foreground";
const code = "font-heading font-semibold tracking-wide text-foreground";

export function DocTypeDrawer({ m }: { m: TypeOfDocState }) {
  const {
    form, setForm, editingId, closeDrawer, handleSubmit, companies, projects, visibleProjects,
    selectedProjectCode, entryTypes, handleEntryTypeChange, preview, tierName, toggleLink, isBusy,
  } = m;

  return (
    <BodyPortal><div className="fixed inset-0 bg-black/60 z-50 flex justify-end">
      <div className="w-full max-w-md h-full bg-card flex flex-col" style={{ borderLeft: RULE }}>
        {/* Drawer header */}
        <div className="px-5 py-4 flex items-center justify-between bg-card sticky top-0 z-10" style={{ borderBottom: RULE }}>
          <div>
            <p className={LBL}>Type of document</p>
            <h2 className="font-heading text-lg font-bold tracking-tight mt-0.5">
              {editingId ? "Edit document type" : "New document type"}
            </h2>
          </div>
          <button onClick={closeDrawer} className={`${ACT} hover:text-foreground hover:border-foreground`} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Drawer body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* ── Scope section ── */}
          <div className="space-y-4">
            <p className={HEAD}>Scope</p>

            <div>
              <label htmlFor="tod-company" className={label}>Company</label>
              <select
                id="tod-company"
                value={form.CompanyId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    CompanyId: e.target.value,
                    // Selected Project may not belong to the new Company.
                    ProjectId:
                      e.target.value &&
                      projects.some(
                        (p) =>
                          String(p.ProjectId) === String(form.ProjectId) &&
                          String(p.CompanyId) !== String(e.target.value),
                      )
                        ? ""
                        : form.ProjectId,
                  })
                }
                className={FIELD}
              >
                <option value="">All Companies</option>
                {companies.map((c) => (
                  <option key={c.CompanyId} value={c.CompanyId}>
                    {c.CompanyName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="tod-project" className={label}>Project</label>
              <select
                id="tod-project"
                value={form.ProjectId}
                onChange={(e) => setForm({ ...form, ProjectId: e.target.value })}
                className={FIELD}
              >
                <option value="">
                  {form.CompanyId ? "All Projects in Company" : "All Projects"}
                </option>
                {visibleProjects.map((p) => (
                  <option key={p.ProjectId} value={p.ProjectId}>
                    {p.ProjectCode ? `${p.ProjectCode} – ` : ""}
                    {p.ProjectName}
                  </option>
                ))}
              </select>
              {selectedProjectCode && (
                <p className={hint}>
                  Project code <span className={code}>{selectedProjectCode}</span> — used as the project initials in the doc number
                </p>
              )}
            </div>
          </div>

          {/* ── Identity section ── */}
          <div className="space-y-4 pt-5 border-t border-foreground/20">
            <p className={HEAD}>Identity</p>

            <div>
              <label htmlFor="tod-entry-type" className={label}>
                Entry type <span className="text-destructive">*</span>
              </label>
              <select
                id="tod-entry-type"
                value={form.EntryTypeId}
                onChange={(e) => handleEntryTypeChange(e.target.value)}
                className={FIELD}
                required
              >
                <option value="">Select entry type…</option>
                {entryTypes.map((et) => (
                  <option key={et.EntryTypeId} value={et.EntryTypeId}>
                    {et.EntryType}
                    {et.Eprefix ? ` — ${et.Eprefix}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="tod-module" className={label}>Module code</label>
              <select
                id="tod-module"
                value={form.ModuleCode}
                onChange={(e) => setForm({ ...form, ModuleCode: e.target.value })}
                className={FIELD}
              >
                <option value="">Select module code…</option>
                {MODULE_CODE_OPTIONS.map((mc) => (
                  <option key={mc.value} value={mc.value}>
                    {mc.label}
                  </option>
                ))}
              </select>
              <p className={hint}>
                Appears as the entry-type segment in the doc number (e.g. <span className={code}>WO</span> →{" "}
                <span className={code}>GC-WO/0001/26-27</span>)
              </p>
            </div>

            <div>
              <label htmlFor="tod-docno" className={label}>
                Doc no prefix <span className="normal-case tracking-normal font-normal">(dash format)</span>
              </label>
              <input
                id="tod-docno"
                type="text"
                value={form.DocNoPrefix}
                onChange={(e) => setForm({ ...form, DocNoPrefix: e.target.value.toUpperCase() })}
                className={`${FIELD} font-heading tracking-wide`}
                placeholder="e.g. ExB-PO-GRN"
                maxLength={50}
              />
              <p className={hint}>
                For global (non-project) doc types. Produces <span className={code}>ExB-PO-GRN-2026-00001</span>
              </p>
            </div>

            <div>
              <label htmlFor="tod-prefix" className={label}>
                Legacy prefix <span className="text-destructive">*</span>
              </label>
              <input
                id="tod-prefix"
                type="text"
                value={form.Prefix}
                onChange={(e) => setForm({ ...form, Prefix: e.target.value.toUpperCase() })}
                className={`${FIELD} font-heading tracking-wide`}
                placeholder="e.g. WO"
                maxLength={30}
                required
              />
              <p className={hint}>Auto-filled from the entry type's prefix — also the fallback in the legacy slash format</p>
            </div>

            <div>
              <label htmlFor="tod-start" className={label}>
                Starting number <span className="text-destructive">*</span>
              </label>
              <input
                id="tod-start"
                type="number"
                min={1}
                value={form.StartingDocNo}
                onChange={(e) => setForm({ ...form, StartingDocNo: e.target.value })}
                className={`${FIELD} w-32 tabular-nums`}
                placeholder="1"
                required
              />
            </div>

            <div>
              <span className={label}>Counter</span>
              <div className="inline-flex items-stretch border border-foreground" role="group" aria-label="Counter reset">
                <button
                  type="button"
                  aria-pressed={form.FinYearReset}
                  onClick={() => setForm({ ...form, FinYearReset: true })}
                  className={`${chip(form.FinYearReset)} h-8 border-0`}
                >
                  Resets each April
                </button>
                <button
                  type="button"
                  aria-pressed={!form.FinYearReset}
                  onClick={() => setForm({ ...form, FinYearReset: false })}
                  className={`${chip(!form.FinYearReset)} h-8 border-0 border-l border-l-foreground`}
                >
                  Never resets
                </button>
              </div>
              <p className={hint}>Resets each April = the sequence restarts from 1 every financial year (new convention). Never resets = one ever-incrementing counter (legacy).</p>
            </div>
          </div>

          {/* ── Live preview box ── */}
          {preview && (
            <div className="bg-card px-4 py-3 space-y-1.5" style={{ border: RULE }}>
              <div className="flex items-center justify-between gap-2">
                <p className={LBL}>Document number preview</p>
                <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-foreground text-foreground">
                  {tierName}
                </span>
              </div>
              <p className="font-heading font-bold text-foreground text-lg tracking-wider">{preview}</p>
              <p className="text-[0.6875rem] text-muted-foreground">The actual number is assigned when the document is saved</p>
            </div>
          )}

          {/* ── Description ── */}
          <div className="pt-5 border-t border-foreground/20">
            <label htmlFor="tod-description" className={label}>
              Description <span className="text-destructive">*</span>
            </label>
            <textarea
              id="tod-description"
              value={form.Description}
              onChange={(e) => setForm({ ...form, Description: e.target.value })}
              className="w-full px-2.5 py-2 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none h-20 resize-none"
              placeholder="Brief description for this document type"
              required
            />
          </div>

          {/* ── Links Allowed To ── */}
          <div>
            <span className={label}>Links allowed to</span>
            <div className="flex flex-wrap gap-1.5">
              {LINK_OPTIONS.map((opt) => {
                const checked = form.links_to.includes(opt.value);
                return (
                  <button key={opt.value} type="button" aria-pressed={checked} onClick={() => toggleLink(opt.value)} className={chip(checked)}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {form.links_to.length > 0 && (
              <p className={`${hint} flex items-center gap-1`}>
                <Info size={10} />
                Controls which module dropdowns this doc type appears in
              </p>
            )}
          </div>

          {/* ── Actions ── */}
          <div className="flex gap-2 pt-4" style={{ borderTop: RULE }}>
            <button type="button" onClick={closeDrawer} className={`${KEY_LINE} flex-1 h-10`}>
              Cancel
            </button>
            <button type="submit" disabled={isBusy} className={`${KEY_INK} flex-1 h-10`}>
              {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {isBusy ? "Saving…" : editingId ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div></BodyPortal>
  );
}
