import React from "react";
import { Building2, Calendar, CalendarRange, ChevronDown, X } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import type { ActiveFilter, CompanyOption, DateMode, FilterState, FinYearOption } from "@/pages/reports/types";

// ── Filter bar (inside expanded section) ─────────────────────────────────────

export const SectionFilters: React.FC<{
  companies: CompanyOption[];
  projects: { id: number; name: string }[];
  finYears: FinYearOption[];
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  activeFilters: ActiveFilter[];
  onClearAll: () => void;
}> = ({
  companies,
  projects,
  finYears,
  filters,
  onChange,
  activeFilters,
  onClearAll,
}) => (
  <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2.5">
    <div className="flex flex-wrap items-end gap-2.5">
      {/* Company */}
      <div className="min-w-[160px] flex-1 max-w-[210px]">
        <label className="block text-[0.625rem] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Company
        </label>
        <div className="relative">
          <Building2
            size={11}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <select
            value={filters.companyId}
            onChange={(e) => onChange({ companyId: e.target.value })}
            className="w-full appearance-none pl-7 pr-6 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          >
            <option value="">All Companies</option>
            {companies.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={11}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
        </div>
      </div>

      {/* Project */}
      <div className="min-w-[160px] flex-1 max-w-[210px]">
        <label className="block text-[0.625rem] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Project
        </label>
        <div className="relative">
          <Building2
            size={11}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <select
            value={filters.projectId}
            onChange={(e) => onChange({ projectId: e.target.value })}
            className="w-full appearance-none pl-7 pr-6 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={11}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
        </div>
      </div>

      {/* Fin Year */}
      <div className="min-w-[140px] flex-1 max-w-[180px]">
        <label className="block text-[0.625rem] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Financial Year
        </label>
        <div className="relative">
          <Calendar
            size={11}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <select
            value={filters.finYearId}
            onChange={(e) => onChange({ finYearId: e.target.value })}
            className="w-full appearance-none pl-7 pr-6 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          >
            <option value="">All Years</option>
            {finYears.map((f) => (
              <option key={f.FId} value={String(f.FId)}>
                {f.FName}
              </option>
            ))}
          </select>
          <ChevronDown
            size={11}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
        </div>
      </div>

      {/* Date mode + inputs */}
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-[0.625rem] font-heading font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Date
          </label>
          <div className="flex rounded-lg border border-border overflow-hidden bg-muted/30 h-[34px]">
            {(["single", "range"] as DateMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ dateMode: m })}
                className={`px-3 flex items-center gap-1 text-[0.6875rem] font-medium transition-all
                  ${filters.dateMode === m ? "btn-module text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "single" ? (
                  <Calendar size={10} />
                ) : (
                  <CalendarRange size={10} />
                )}
                {m === "single" ? "Day" : "Range"}
              </button>
            ))}
          </div>
        </div>

        {filters.dateMode === "single" ? (
          <DateInput
            value={filters.singleDate}
            onChange={(e) => onChange({ singleDate: e.target.value })}
            disabled={!!filters.finYearId}
            className="rounded-lg border border-border bg-background text-foreground text-xs px-2.5 py-2 h-[34px] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40 transition-all"
          />
        ) : (
          <div className="flex gap-1.5 items-center">
            <DateInput
              value={filters.rangeFrom}
              onChange={(e) => onChange({ rangeFrom: e.target.value })}
              disabled={!!filters.finYearId}
              className="rounded-lg border border-border bg-background text-foreground text-xs px-2.5 py-2 h-[34px] w-[130px] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40 transition-all"
            />
            <span className="text-[0.625rem] text-muted-foreground">→</span>
            <DateInput
              value={filters.rangeTo}
              onChange={(e) => onChange({ rangeTo: e.target.value })}
              disabled={!!filters.finYearId}
              className="rounded-lg border border-border bg-background text-foreground text-xs px-2.5 py-2 h-[34px] w-[130px] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40 transition-all"
            />
          </div>
        )}
      </div>

      {/* Clear */}
      {activeFilters.length > 0 && (
        <button
          onClick={onClearAll}
          className="flex items-center gap-1 px-2.5 py-2 h-[34px] rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
        >
          <X size={11} /> Clear
        </button>
      )}
    </div>

    {/* Active chips */}
    {activeFilters.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/40">
        <span className="text-[0.625rem] text-muted-foreground font-heading uppercase tracking-wider">
          Active:
        </span>
        {activeFilters.map((f) => (
          <span
            key={f.label}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-medium bg-primary/10 text-primary border border-primary/20"
          >
            {f.label}
            <button
              onClick={f.clear}
              className="hover:text-destructive transition-colors"
            >
              <X size={8} />
            </button>
          </span>
        ))}
      </div>
    )}
  </div>
);
