import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { getSearchReport, type SearchFigures } from "@/api/legalEnquirySearchApi";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/**
 * Legal dashboard — Deed Registry Search report: all projects or one project. Counted per office search (each enquiry
 * gets one per registration office type); rejected enquiries are left out. A project row opens the search page on it.
 */
export function DeedSearchReport() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["legal-enq-search-report"], queryFn: getSearchReport, staleTime: 60 * 1000, retry: false });
  const [pid, setPid] = useState<number | "all" | "none">("all");
  if (!data?.total || !data.total.Searches) return null;
  const keyOf = (id: number | null) => id ?? "none";
  const sel: SearchFigures = pid === "all" ? data.total : data.projects.find((p) => keyOf(p.ProjectId) === pid) ?? data.total;
  // Opens Deed Registry Search on that project (the page reads the remembered project) and that portion of the queue.
  const open = (scope: number | "all" | "none", view = "all") => {
    navigate(`/legal/land/deed-search?view=${view}&project=${scope}`);
  };
  const here = pid;
  const tiles: [string, number, string, string][] = [
    ["Total searches", sel.Searches, "border-border", "all"],
    ["Completed", sel.Completed, "border-emerald-600", "done"],
    ["Not completed", sel.NotCompleted, "border-amber-500", "pending"],
    ["Overdue", sel.Overdue, sel.Overdue ? "border-destructive" : "border-border", "overdue"],
    ["Within time", sel.OnTime, "border-sky-600", "ontime"],
    ["Deeds found", sel.DeedsFound, "border-border", "all"],
    ["Enquiries fully searched", sel.EnquiriesDone ?? 0, "border-border", "done"],
  ];
  const done = pct(sel.Completed, sel.Searches);

  return (
    <div className="border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-heading font-bold uppercase tracking-[0.12em] text-muted-foreground">Deed Registry Search</p>
        <button onClick={() => open(here)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Open Deed Registry Search <ChevronRight size={13} /></button>
      </div>
      {/* Project switch */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {([["all", "All projects"], ...data.projects.map((p) => [keyOf(p.ProjectId), p.ProjectId == null ? "Without a project" : p.ProjectName])] as [number | "all" | "none", string][]).map(([k, label]) => (
          <button key={String(k)} onClick={() => setPid(k)} className={`border px-3 py-1 text-xs font-semibold ${pid === k ? "border-foreground bg-foreground text-card" : "border-border hover:bg-muted"}`}>{label}</button>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {tiles.map(([label, n, edge, view]) => (
          <button key={label} onClick={() => open(here, view)} title={`Open ${label.toLowerCase()} in Deed Registry Search`}
            className={`border border-l-4 ${edge} ${label === "Overdue" && n ? "bg-destructive/10" : "bg-muted/20"} px-3 py-2 text-left transition-transform hover:-translate-y-0.5`}>
            <span className={`block text-xl font-bold tabular-nums leading-none ${label === "Overdue" && n ? "text-destructive" : ""}`}>{n}</span>
            <span className="mt-1 block text-[0.6875rem] leading-tight text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        <span className="h-2 flex-1 bg-muted"><span className="block h-full bg-emerald-600" style={{ width: `${done}%` }} /></span>
        <span className="tabular-nums text-muted-foreground">{done}% of {sel.Searches} office searches complete</span>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="overflow-x-auto">
          <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">By project</p>
          <table className="w-full text-left text-xs">
            <thead className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-1.5">Project</th><th className="py-1.5 text-right">Enquiries</th><th className="py-1.5 text-right">Searches</th><th className="py-1.5 text-right">Completed</th><th className="py-1.5 text-right">Not completed</th><th className="py-1.5 text-right">Overdue</th><th className="py-1.5 text-right">Found</th></tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={String(p.ProjectId)} onClick={() => open(keyOf(p.ProjectId))} className={`cursor-pointer border-t border-border hover:bg-muted/40 ${pid === keyOf(p.ProjectId) ? "bg-primary/10" : ""}`}>
                  <td className="py-1.5 font-semibold">{p.ProjectName}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.Enquiries}</td><td className="py-1.5 text-right tabular-nums">{p.Searches}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-700">{p.Completed}</td><td className="py-1.5 text-right tabular-nums text-amber-700">{p.NotCompleted}</td>
                  <td className={`py-1.5 text-right tabular-nums ${p.Overdue ? "font-bold text-destructive" : ""}`}>{p.Overdue}</td><td className="py-1.5 text-right tabular-nums">{p.DeedsFound}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border font-bold">
                <td className="py-1.5">All projects</td><td className="py-1.5 text-right tabular-nums">{data.total.Enquiries}</td><td className="py-1.5 text-right tabular-nums">{data.total.Searches}</td>
                <td className="py-1.5 text-right tabular-nums">{data.total.Completed}</td><td className="py-1.5 text-right tabular-nums">{data.total.NotCompleted}</td>
                <td className="py-1.5 text-right tabular-nums">{data.total.Overdue}</td><td className="py-1.5 text-right tabular-nums">{data.total.DeedsFound}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">By registration office (all projects)</p>
          <table className="w-full text-left text-xs">
            <thead className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-1.5">Office</th><th className="py-1.5 text-right">Searches</th><th className="py-1.5 text-right">Completed</th><th className="py-1.5 text-right">Not completed</th><th className="py-1.5 text-right">Overdue</th><th className="py-1.5 text-right">Found</th></tr>
            </thead>
            <tbody>
              {data.offices.map((o) => (
                <tr key={o.OfficeType} className="border-t border-border">
                  <td className="py-1.5 font-semibold">{o.OfficeType}</td><td className="py-1.5 text-right tabular-nums">{o.Searches}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-700">{o.Completed}</td><td className="py-1.5 text-right tabular-nums text-amber-700">{o.NotCompleted}</td>
                  <td className={`py-1.5 text-right tabular-nums ${o.Overdue ? "font-bold text-destructive" : ""}`}>{o.Overdue}</td><td className="py-1.5 text-right tabular-nums">{o.DeedsFound}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
