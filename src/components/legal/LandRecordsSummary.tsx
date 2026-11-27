import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSearchSummary, type LandRecordsSummary } from "@/api/legalEnquirySearchApi";

/**
 * Consolidated Land Records Summary of one enquiry: enquiry and land identification, the search by source, CS / RS /
 * LR records, mapping, alternative history, possession, discrepancies, the latest legal review, observations and the
 * overall status. Print / PDF opens a clean printable page; Excel downloads every table as a CSV workbook-ready file.
 * It reports what was found and decided — it does not certify title.
 */
type Row = Record<string, string | number | boolean | null>;
const v = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : typeof x === "boolean" ? (x ? "Yes" : "No") : String(x));
const OVERALL: Record<string, string> = {
  "Recommended to Proceed": "border-emerald-700 bg-emerald-600/10 text-emerald-900", "Proceed with Conditions": "border-emerald-700 bg-emerald-600/10 text-emerald-900",
  "Hold for Further Investigation": "border-amber-600 bg-amber-500/10 text-amber-900", "Not Recommended": "border-destructive bg-destructive/10 text-destructive",
  "Further verification required": "border-amber-600 bg-amber-500/10 text-amber-900",
};

function tables(s: LandRecordsSummary): [string, string[], Row[]][] {
  const recs = (["CS", "RS", "LR"] as const).flatMap((t) => s.records[t].map((r) => ({ Survey: t, ...r })));
  return [
    ["Search by source", ["OfficeType", "SourceKind", "Mandatory", "Status", "FromYear", "Years", "Found", "NotFound", "NotApplicable", "Waiting", "ExceptionNote"], s.sources],
    ["Records found in searches", ["OfficeType", "CalendarYear", "DeedNo", "DeedDate", "Parties", "Details", "SearchMethod"], s.found],
    ["CS / RS / LR records", ["Survey", "Khatian", "Dag", "RecordedHolder", "Area", "Unit", "LandClass", "RecordYear", "RecordStatus", "SourceMethod"], recs],
    ["Record mapping", ["FromType", "ToType", "MatchStatus", "MatchBasis"], s.maps],
    ["Alternative land history", ["Category", "Subcategory", "ReferenceNo", "HolderClaimant", "IssuingAuthority", "RelevantDate", "VerificationStatus"], s.alternative],
    ["Possession history", ["OccupantName", "PossessionType", "StartDate", "EndDate", "VerificationStatus"], s.possession],
    ["Discrepancies & observations", ["DiscrepancyType", "RelatedRecord", "PreviousInfo", "CurrentInfo", "Severity", "InvestigationStatus", "AssignedTo", "ResolutionRemarks"], s.discrepancies],
    ["Supporting documents", ["Kind", "RelatedTo", "FileName"], s.documents],
  ];
}
const human = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2");

function exportCsv(s: LandRecordsSummary) {
  const esc = (x: unknown) => `"${v(x).replace(/"/g, '""')}"`;
  const lines: string[] = [`Land Records Summary,${esc(s.enquiry.EnquiryNo)}`, `Overall status,${esc(s.overall)}`, ""];
  for (const [title, cols, rows] of tables(s)) {
    lines.push(esc(title), cols.map((c) => esc(human(c))).join(","));
    rows.forEach((r) => lines.push(cols.map((c) => esc(r[c])).join(",")));
    lines.push("");
  }
  if (s.review) { lines.push("Legal review", ...Object.entries(s.review).map(([k, x]) => `${esc(human(k))},${esc(x)}`)); }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Land-Records-Summary-${v(s.enquiry.EnquiryNo)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function printSummary(s: LandRecordsSummary) {
  const esc = (x: unknown) => v(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const body = tables(s).map(([title, cols, rows]) => `<h2>${title}</h2>${rows.length
    ? `<table><tr>${cols.map((c) => `<th>${human(c)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</table>`
    : "<p>None.</p>"}`).join("");
  const e = s.enquiry;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Land Records Summary ${esc(e.EnquiryNo)}</title>
<style>body{font:12px/1.4 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.06em}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}.box{border:2px solid #111;padding:8px;margin:12px 0}
.note{color:#555;font-size:10px;margin-top:20px}</style></head><body>
<h1>Land Records Summary — ${esc(e.EnquiryNo)}</h1>
<p>${esc(e.LandLocation)} · ${esc(e.MouzaName)}, ${esc(e.DistrictName)} · J.L. ${esc(e.JLNo)} · RS Dag ${esc(e.RsDagNo)} / Kh ${esc(e.RsKhatianNo)} · LR Dag ${esc(e.LrDagNo)} / Kh ${esc(e.LrKhatianNo)} · ${esc(e.ProjectName)}</p>
<div class="box"><b>Overall status: ${esc(s.overall)}</b>${s.observations.length ? `<ul>${s.observations.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}</div>
${body}
<h2>Legal review</h2>${s.review ? `<table>${Object.entries(s.review).map(([k, x]) => `<tr><th>${human(k)}</th><td>${esc(x)}</td></tr>`).join("")}</table>` : "<p>Not reviewed yet.</p>"}
<p class="note">Printed ${new Date().toLocaleString("en-IN")}. This summary lists records found and decisions recorded; it does not certify legal title.</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export function LandRecordsSummaryView({ enquiryId }: { enquiryId: number }) {
  const { data: s, error, isLoading } = useQuery({ queryKey: ["legal-enq-summary", enquiryId], queryFn: () => getSearchSummary(enquiryId) });
  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Building the summary…</p>;
  if (error || !s) return <p className="p-4 text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>;
  const f = s.figures;
  const tiles: [string, number, string?][] = [
    ["Sources", f.totalSources], ["Completed", f.completed, "text-emerald-700"], ["Pending", f.pending], ["Overdue", f.overdue, f.overdue ? "text-destructive" : ""],
    ["Found", f.found], ["Not found", f.notFound], ["Not applicable", f.notApplicable], ["Waiting", f.waiting, f.waiting ? "text-amber-700" : ""],
    ["Exceptions", f.exceptions, f.exceptions ? "text-destructive" : ""], ["Open discrepancies", f.openDiscrepancies, f.openDiscrepancies ? "text-amber-700" : ""],
    ["High / critical open", f.seriousOpen, f.seriousOpen ? "text-destructive" : ""], ["Mapping to review", f.mappingPending],
  ];
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className={`border-2 px-3 py-2 ${OVERALL[s.overall] ?? "border-foreground/40"}`}>
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.12em]">Overall status</p>
          <b className="text-base">{s.overall}</b>
          {s.review && <p className="text-xs">Latest review: {v(s.review.Recommendation)} · risk {v(s.review.RiskLevel)} · {v(s.review.Reviewer)} {v(s.review.ReviewDate)}</p>}
        </div>
        <span className="flex gap-2">
          <button className="border border-foreground px-3 py-1.5 text-xs font-semibold uppercase" onClick={() => printSummary(s)}>Print / PDF</button>
          <button className="border border-foreground px-3 py-1.5 text-xs font-semibold uppercase" onClick={() => exportCsv(s)}>Excel (CSV)</button>
        </span>
      </div>
      <div className="grid grid-cols-3 border-l border-t border-border sm:grid-cols-6">
        {tiles.map(([l, n, tone]) => (
          <div key={l} className="border-b border-r border-border px-2 py-1.5">
            <span className="block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">{l}</span><b className={`tabular-nums ${tone ?? ""}`}>{n}</b>
          </div>
        ))}
      </div>
      {s.observations.length > 0 && (
        <div className="border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-xs">
          <p className="mb-1 font-semibold uppercase tracking-[0.08em]">Important observations</p>
          <ul className="list-disc space-y-0.5 pl-4">{s.observations.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      )}
      {tables(s).map(([title, cols, rows]) => (
        <div key={title} className="border border-border">
          <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider">{title} · {rows.length}</p>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr>{cols.map((c) => <th key={c} className="whitespace-nowrap border-b border-border px-2 py-1 font-semibold">{human(c)}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-border/60 last:border-b-0">{cols.map((c) => <td key={c} className="px-2 py-1">{v(r[c])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : <p className="px-3 py-2 text-xs text-muted-foreground">None.</p>}
        </div>
      ))}
      <p className="text-[0.6875rem] text-muted-foreground">This summary lists the records found and the decisions recorded. It does not certify legal title — the legal team decides.</p>
    </div>
  );
}
