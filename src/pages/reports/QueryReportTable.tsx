import React, { useState, useEffect } from "react";
import { getProjects as fetchProjectOptions } from "@/api/grnApi";
import { todayIstDate } from "@/lib/attendanceFormat";
import { ReportTable } from "@/pages/reports/ReportTable";
import { REPORT_MAP } from "@/pages/reports/registry";

export const daysAgoIst = (n: number) => {
  const d = new Date(`${todayIstDate()}T00:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** One report shown on its own page (Civil Work DPR > Query) — the same definition and table as in Reports. */
export const QueryReportTable: React.FC<{
  reportId: string;
  onClose: () => void;
  onRowOpen: (row: Record<string, unknown>) => void;
}> = ({ reportId, onClose, onRowOpen }) => {
  const report = REPORT_MAP.get(reportId);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    fetchProjectOptions()
      .then((l) => setProjects(Array.isArray(l) ? l : []))
      .catch(() => setProjects([]));
  }, []);
  if (!report) return null;
  return (
    <ReportTable
      report={report}
      // Query shows the last 30 days (not just today) so records are there on opening; picking a date narrows to that day.
      filters={{ companyId: "", projectId: "", finYearId: "", dateMode: "range", singleDate: "", rangeFrom: daysAgoIst(30), rangeTo: todayIstDate() }}
      companies={[]}
      projects={projects}
      onClose={onClose}
      onRowOpen={onRowOpen}
      startWithoutDate
    />
  );
};
