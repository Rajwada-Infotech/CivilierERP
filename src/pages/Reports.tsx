import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { getProjects as fetchProjectOptions } from "@/api/grnApi";
import { ChevronRight } from "lucide-react";
import { ReportTable } from "@/pages/reports/ReportTable";
import { ReportTile } from "@/pages/reports/ReportTile";
import { SectionFilters } from "@/pages/reports/SectionFilters";
import { MODULE_SECTIONS, REPORT_MAP } from "@/pages/reports/registry";
import type { ActiveFilter, CompanyOption, FilterState, FinYearOption, ReportDef } from "@/pages/reports/types";

// ── Main page ─────────────────────────────────────────────────────────────────

// marketing_head is scoped to Sales Automation + CRM only (see auth.utils.ts
// isMarketingHeadPage) — showing Finance/Material/Admin tiles they can't
// actually open would just be a dead end (backend 403s on click).
const MARKETING_HEAD_SECTION_IDS = new Set(["sales-automation", "crm"]);

const Reports: React.FC = () => {
  usePageRights("reports");
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const visibleSections =
    currentUser?.role === "marketing_head"
      ? MODULE_SECTIONS.filter((s) => MARKETING_HEAD_SECTION_IDS.has(s.id))
      : MODULE_SECTIONS;

  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [finYears, setFinYears] = useState<FinYearOption[]>([]);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    companyId: "",
    projectId: "",
    finYearId: "",
    dateMode: "single",
    singleDate: "",
    rangeFrom: "",
    rangeTo: "",
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    fetchWithAuth("/api/reports/companies")
      .then((r) => r.json().catch(() => ({})))
      .then((l: CompanyOption[]) => setCompanies(Array.isArray(l) ? l : []))
      .catch(() => {});
    fetchWithAuth("/api/fin-year")
      .then((r) => r.json().catch(() => ({})))
      .then((l: FinYearOption[]) => setFinYears(Array.isArray(l) ? l : []))
      .catch(() => {});
  }, []);

  // Projects re-scope to whichever company is selected (same convention as
  // every other Company→Project cascade in the app) — cleared automatically
  // below whenever the company changes so a stale cross-company project id
  // never lingers in the filter.
  useEffect(() => {
    fetchProjectOptions(filters.companyId || undefined)
      .then((l) => setProjects(Array.isArray(l) ? l : []))
      .catch(() => setProjects([]));
  }, [filters.companyId]);

  const patchFilters = (patch: Partial<FilterState>) =>
    setFilters((prev) => ({
      ...prev,
      ...patch,
      // Changing company invalidates any previously-picked project unless
      // this same patch is also setting a new one.
      ...(("companyId" in patch) && !("projectId" in patch) ? { projectId: "" } : {}),
    }));

  const clearFilters = () =>
    setFilters({
      companyId: "",
      projectId: "",
      finYearId: "",
      dateMode: "single",
      singleDate: "",
      rangeFrom: "",
      rangeTo: "",
    });

  // Build active filter chips
  const activeFilters: ActiveFilter[] = [];
  if (filters.companyId) {
    const c = companies.find((x) => String(x.id) === filters.companyId);
    if (c)
      activeFilters.push({
        label: c.name,
        clear: () => patchFilters({ companyId: "" }),
      });
  }
  if (filters.projectId) {
    const p = projects.find((x) => String(x.id) === filters.projectId);
    if (p)
      activeFilters.push({
        label: p.name,
        clear: () => patchFilters({ projectId: "" }),
      });
  }
  if (filters.finYearId) {
    const fy = finYears.find((f) => String(f.FId) === filters.finYearId);
    if (fy)
      activeFilters.push({
        label: fy.FName,
        clear: () => patchFilters({ finYearId: "" }),
      });
  } else {
    if (filters.singleDate)
      activeFilters.push({
        label: filters.singleDate,
        clear: () => patchFilters({ singleDate: "" }),
      });
    if (filters.rangeFrom && filters.rangeTo)
      activeFilters.push({
        label: `${filters.rangeFrom} → ${filters.rangeTo}`,
        clear: () => patchFilters({ rangeFrom: "", rangeTo: "" }),
      });
  }

  const handleSectionClick = (id: string) => {
    const opening = openSection !== id;
    setOpenSection(opening ? id : null);
    setActiveReport(null);
    if (opening) {
      setTimeout(
        () =>
          sectionRefs.current[id]?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          }),
        80,
      );
    }
  };

  const handleTileClick = (reportId: string) => {
    // Launcher tiles (Follow-Up performance reports) open their own page.
    const routeTo = REPORT_MAP.get(reportId)?.route;
    if (routeTo) {
      navigate(routeTo);
      return;
    }
    setActiveReport((prev) => (prev === reportId ? null : reportId));
    setTimeout(
      () =>
        panelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      60,
    );
  };

  const openSectionDef = visibleSections.find((s) => s.id === openSection);
  const totalReports = visibleSections.reduce((n, s) => n + s.reportIds.length, 0);

  return (
    <div className="flex flex-col min-h-0">
      <Breadcrumbs items={["Dashboard", "Reports"]} />
      <style>{REPORTS_CSS}</style>

      <SheetShell
        eyebrow="CivilierERP · Reports"
        title="Reports"
        subtitle={
          openSectionDef
            ? `${openSectionDef.label} · ${openSectionDef.reportIds.length} reports available`
            : "Open a module to see its reports, set the filters, then pick a report."
        }
      >
        {/* Figures */}
        <div className="statrow">
          <div>
            <p className="label">Modules</p>
            <p className="rp-figure">{visibleSections.length}</p>
          </div>
          <div>
            <p className="label">Reports</p>
            <p className="rp-figure">{totalReports}</p>
          </div>
          <div>
            <p className="label">Open</p>
            <p className="rp-figure rp-figure-text">{openSectionDef?.label ?? "—"}</p>
          </div>
        </div>

        {/* Module sections: lettered rows, each opening into its filters, tiles and report */}
        <div className="rp-sections">
          {visibleSections.map((section, si) => {
            const isOpen = openSection === section.id;
            const reports = section.reportIds
              .map((id) => REPORT_MAP.get(id))
              .filter(Boolean) as ReportDef[];
            const activeReportDef = activeReport
              ? REPORT_MAP.get(activeReport)
              : undefined;
            const reportHere =
              !!activeReport && section.reportIds.includes(activeReport);

            return (
              <div
                key={section.id}
                className={`rp-sec ${isOpen ? "open" : ""}`}
                style={{ ["--rp-accent" as string]: section.accent } as React.CSSProperties}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
              >
                {/* ── Module row ── */}
                <button
                  type="button"
                  onClick={() => handleSectionClick(section.id)}
                  aria-expanded={isOpen}
                  className="rp-sec-head"
                >
                  <span className="tag">{String.fromCharCode(65 + (si % 26))}</span>
                  <span className="rp-mark" style={{ color: section.accent }}>
                    <section.icon size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="rp-sec-name">{section.label}</span>
                    <span className="rp-sec-desc">{section.description}</span>
                  </span>

                  {/* Report marks */}
                  <span className="hidden md:flex items-center gap-1 shrink-0">
                    {reports.slice(0, 5).map((r) => (
                      <span key={r.id} className="rp-mini" style={{ color: r.color }}>
                        <r.icon size={11} />
                      </span>
                    ))}
                    {reports.length > 5 && <span className="label">+{reports.length - 5}</span>}
                  </span>

                  <span className="label shrink-0 hidden sm:inline">{reports.length} reports</span>
                  <ChevronRight size={15} className={`shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                </button>

                {/* ── Expanded section ── */}
                {isOpen && (
                  <div className="rp-sec-body">
                    {/* Filters */}
                    <SectionFilters
                      companies={companies}
                      projects={projects}
                      finYears={finYears}
                      filters={filters}
                      onChange={patchFilters}
                      activeFilters={activeFilters}
                      onClearAll={clearFilters}
                    />

                    {/* Tiles */}
                    <div className="rp-tiles">
                      {reports.map((report) => (
                        <ReportTile
                          key={report.id}
                          report={report}
                          active={activeReport === report.id}
                          onClick={() => handleTileClick(report.id)}
                        />
                      ))}
                    </div>

                    {/* Report table */}
                    <div ref={reportHere ? panelRef : undefined}>
                      {reportHere && activeReportDef && (
                        <ReportTable
                          key={activeReportDef.id}
                          report={activeReportDef}
                          filters={filters}
                          companies={companies}
                          projects={projects}
                          onClose={() => setActiveReport(null)}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetShell>
    </div>
  );
};

// The Reports page on the sheet: modules as lettered ruled rows with a square mark in the module's colour; an open
// module shows its filters, its reports as square tiles and the chosen report's table (which draws itself in ink on
// a sheet). Uses the sheet frame's variables (--ink, --rule, --graphite...).
const REPORTS_CSS = `
.sheet-frame .rp-figure { font-family: "Sora", sans-serif; font-weight: 600; font-size: 24px; letter-spacing: -0.02em; line-height: 1; margin-top: 6px; color: var(--ink); }
.sheet-frame .rp-figure-text { font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sheet-frame .rp-sections { border: 1px solid var(--ink); }
.sheet-frame .rp-sec + .rp-sec { border-top: 1px solid var(--rule); }
.sheet-frame .rp-sec.open { box-shadow: inset 3px 0 0 var(--rp-accent); }
.sheet-frame .rp-sec-head { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 16px; text-align: left; transition: background-color .15s; }
.sheet-frame .rp-sec-head:hover { background: var(--blue-wash); }
.sheet-frame .rp-sec.open .rp-sec-head { border-bottom: 1px solid var(--ink); }
.sheet-frame .rp-mark { width: 34px; height: 34px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--rule); background: hsl(var(--card)); }
.sheet-frame .rp-sec.open .rp-sec-head .rp-mark { border: 1.5px solid var(--ink); }
.sheet-frame .rp-sec-name { display: block; font-family: "Sora", sans-serif; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; color: var(--ink); }
.sheet-frame .rp-sec-desc { display: block; font-size: 12px; color: var(--graphite); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sheet-frame .rp-mini { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--rule-soft); opacity: 0.75; }
.sheet-frame .rp-sec-head:hover .rp-mini { opacity: 1; }
.sheet-frame .rp-sec-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 14px; background: hsl(var(--card) / 0.6); }
.sheet-frame .rp-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.sheet-frame .rp-tile { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; text-align: left;
  border: 1px solid var(--rule); background: hsl(var(--card)); transition: background-color .15s, border-color .15s; }
.sheet-frame .rp-tile:hover { border-color: var(--ink); background: var(--blue-wash); }
.sheet-frame .rp-tile.on { border: 1.5px solid var(--ink); box-shadow: inset 0 -3px 0 var(--rp-c); }
.sheet-frame .rp-tile .rp-mark { width: 30px; height: 30px; }
.sheet-frame .rp-tile.on .rp-mark { border-color: var(--ink); }
.sheet-frame .rp-tile-name { display: block; font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sheet-frame .rp-tile-desc { display: block; font-size: 11px; color: var(--graphite); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 640px) {
  .sheet-frame .rp-sec-head { padding: 12px; gap: 10px; }
  .sheet-frame .rp-sec-head .tag { display: none; }
  .sheet-frame .rp-sec-body { padding: 12px; }
  .sheet-frame .rp-tiles { grid-template-columns: minmax(0, 1fr); }
}
`;

export { QueryReportTable } from "@/pages/reports/QueryReportTable";

export default Reports;
