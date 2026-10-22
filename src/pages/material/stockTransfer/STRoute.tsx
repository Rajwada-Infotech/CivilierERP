import { ArrowRight, AlertCircle, X, ClipboardList, Building2, FolderKanban } from "lucide-react";
import { type Godown } from "@/api/godownsApi";
import { emptyItem } from "./config";
import { FilterSelect } from "./FilterSelect";
import { GodownSelect } from "./GodownSelect";
import type { StockTransferState } from "./useStockTransfer";

// Where the stock goes from and to: company, project and godown on each side.
export function STRoute({ m }: { m: StockTransferState }) {
  const { transferMode, filterCompanyId, setFilterCompanyId, filterProjectId, setFilterProjectId, toCompanyId, setToCompanyId, toProjectId, setToProjectId, sourceMR, mrDropdownValue, mrDropdownLoading, mrDropdownError, fromGodownId, setFromGodownId, toGodownId, setToGodownId, items, setItems, approvedMRs, loadingApprovedMRs, companyGodowns, toProjectOptions, handleMRDropdownSelect, clearSourceMR, toCompanyGodowns, fromGodown, toGodown, companyOptions, projectSelectOptions } = m;
  return (
    <>
      {/* ── Filters + Transfer Route ──────────────────────────────────────── */}
      <div className="border border-foreground bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Filters
          </p>
          <span className="text-[0.625rem] text-muted-foreground/60">
            — narrow godowns by company or project
          </span>
          {(filterCompanyId || filterProjectId) && (
            <button
              onClick={() => {
                setFilterCompanyId("");
                setFilterProjectId("");
                setFromGodownId(null);
                setToGodownId(null);
                setItems([emptyItem()]);
              }}
              className="ml-auto text-[0.625rem] text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors"
            >
              <X size={10} /> Clear filters
            </button>
          )}
        </div>

        <div className="space-y-3">
          {transferMode === "inter" ? (
            <>
              {/* From Company | From Project */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FilterSelect
                  icon={Building2}
                  label="From Company"
                  value={filterCompanyId}
                  onChange={(v) => {
                    setFilterCompanyId(v);
                    setFilterProjectId("");
                    setFromGodownId(null);
                    setToGodownId(null);
                    setItems([emptyItem()]);
                  }}
                  options={companyOptions}
                  placeholder="All companies"
                />
                <FilterSelect
                  icon={FolderKanban}
                  label="From Project"
                  value={filterProjectId}
                  onChange={(v) => {
                    setFilterProjectId(v);
                    setFromGodownId(null);
                    setToGodownId(null);
                    setItems([emptyItem()]);
                  }}
                  options={projectSelectOptions}
                  placeholder={filterCompanyId ? "All projects in company" : "All projects"}
                />
              </div>

              {/* To Company | Receiver Project */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FilterSelect
                  icon={Building2}
                  label="To Company"
                  value={toCompanyId}
                  onChange={(v) => {
                    setToCompanyId(v);
                    setToProjectId("");
                    setToGodownId(null);
                  }}
                  options={companyOptions.filter((o) => o.value !== filterCompanyId)}
                  placeholder="Select destination company"
                />
                <FilterSelect
                  icon={FolderKanban}
                  label="Receiver Project"
                  value={toProjectId}
                  onChange={(v) => {
                    setToProjectId(v);
                    setToGodownId(null);
                  }}
                  options={toProjectOptions.map((p) => ({ value: String(p.id), label: p.label }))}
                  placeholder={toCompanyId ? "All projects in company" : "Select a company first"}
                />
              </div>

              {/* Raise from Material Request */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ClipboardList size={13} /> Raise from Material Request (optional)
                </label>
                {sourceMR ? (
                  <div className="flex items-center justify-between gap-2 border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                      <ClipboardList size={14} className="text-primary" />
                      From MR: {sourceMR.docNo}
                    </span>
                    <button
                      type="button"
                      onClick={clearSourceMR}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X size={12} /> Clear
                    </button>
                  </div>
                ) : (
                  <>
                    <select
                      className="w-full border bg-card px-3 py-2 text-sm disabled:opacity-60"
                      value={mrDropdownValue}
                      onChange={(e) => handleMRDropdownSelect(e.target.value)}
                      disabled={mrDropdownLoading || !toProjectId || loadingApprovedMRs}
                    >
                      <option value="">
                        {mrDropdownLoading
                          ? "Loading..."
                          : !toProjectId
                            ? "Select the receiver project first"
                            : loadingApprovedMRs
                              ? "Loading approved requests…"
                              : approvedMRs.length === 0
                                ? "No approved Material Requests for this project"
                                : "Select a Material Request"}
                      </option>
                      {approvedMRs.map((mr) => (
                        <option key={mr.MRId} value={String(mr.MRId)}>
                          {mr.DocNo} — {mr.ProjectName || mr.CompanyName || ""}
                        </option>
                      ))}
                    </select>
                    <p className="text-[0.6875rem] text-muted-foreground">
                      Only Approved requests of the receiver project are listed. Picking one fills the items and receiver.
                    </p>
                    {mrDropdownError && (
                      <p className="text-xs text-destructive">{mrDropdownError}</p>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Company */}
              <FilterSelect
                icon={Building2}
                label="Company"
                value={filterCompanyId}
                onChange={(v) => {
                  setFilterCompanyId(v);
                  setFilterProjectId("");
                  setFromGodownId(null);
                  setToGodownId(null);
                  setItems([emptyItem()]);
                }}
                options={companyOptions}
                placeholder="All companies"
              />

              {/* Project */}
              <FilterSelect
                icon={FolderKanban}
                label="Project"
                value={filterProjectId}
                onChange={(v) => {
                  setFilterProjectId(v);
                  setFromGodownId(null);
                  setToGodownId(null);
                  setItems([emptyItem()]);
                }}
                options={projectSelectOptions}
                placeholder={filterCompanyId ? "All projects in company" : "All projects"}
              />
            </>
          )}

          {/* From Godown | To Godown */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GodownSelect
              label="From Godown"
              value={fromGodownId}
              onChange={(v) => {
                setFromGodownId(v);
                setItems([emptyItem()]);
              }}
              godowns={companyGodowns}
              exclude={toGodownId}
              variant="from"
              placeholder="Select source godown…"
            />
            <GodownSelect
              label="To Godown"
              value={toGodownId}
              onChange={setToGodownId}
              godowns={toCompanyGodowns}
              exclude={transferMode === "intra" ? fromGodownId : undefined}
              variant="to"
              placeholder="Select destination godown…"
            />
          </div>
        </div>

        {(filterCompanyId || filterProjectId) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {filterCompanyId && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[0.6875rem] bg-card text-foreground border border-foreground/30 font-medium">
                <Building2 size={10} />
                {
                  companyOptions.find((o) => o.value === filterCompanyId)
                    ?.label
                }
                <button
                  onClick={() => {
                    setFilterCompanyId("");
                    setFilterProjectId("");
                    setFromGodownId(null);
                    setToGodownId(null);
                    setItems([emptyItem()]);
                  }}
                  className="ml-0.5 hover:opacity-70"
                >
                  <X size={9} />
                </button>
              </span>
            )}
            {filterProjectId && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[0.6875rem] bg-card text-foreground border border-foreground/30 font-medium">
                <FolderKanban size={10} />
                {
                  projectSelectOptions.find(
                    (o) => o.value === filterProjectId,
                  )?.label
                }
                <button
                  onClick={() => {
                    setFilterProjectId("");
                    setFromGodownId(null);
                    setToGodownId(null);
                    setItems([emptyItem()]);
                  }}
                  className="ml-0.5 hover:opacity-70"
                >
                  <X size={9} />
                </button>
              </span>
            )}
            <span className="text-[0.625rem] text-muted-foreground self-center">
              {companyGodowns.length} godown
              {companyGodowns.length !== 1 ? "s" : ""} available
            </span>
          </div>
        )}

        {fromGodownId && toGodownId && fromGodownId === toGodownId && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle size={11} /> Source and destination must be
            different.
          </p>
        )}

        {fromGodown && toGodown && fromGodownId !== toGodownId && (
          <div className="flex items-center gap-2 px-3 py-2 bg-card border border-foreground text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {fromGodown.GodownName}
            </span>
            <ArrowRight size={12} />
            <span className="font-medium text-foreground">
              {toGodown.GodownName}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
