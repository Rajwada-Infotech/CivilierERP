import { useMemo, useRef, useState } from "react";
import { useElementWidth } from "@/components/legal/useElementWidth";
import { useQuery } from "@tanstack/react-query";
import { DocumentText } from "iconsax-react";
import { Download, Printer } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { exportToCsv } from "@/lib/export";
import { getLandReport, getLandReports, getLandStats } from "@/api/legalLandApi";
import { getLegalLookup } from "@/api/legalMastersApi";
import { usePageRights as useRights } from "@/hooks/usePageRights";

// Land Management reports (pipeline step 30): pick a report on the left, read and export it on the right.

const card = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const cell = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—"
    : isDate(v) ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : typeof v === "number" ? v.toLocaleString("en-IN") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);

export default function LandReportsPage() {
  const rights = usePageRights("legal-land-reports");
  const { data: list } = useQuery({ queryKey: ["legal-land-reports"], queryFn: getLandReports, staleTime: Infinity });
  const [key, setKey] = useState("land-register");
  const [q, setQ] = useState("");
  const [landCode, setLandCode] = useState("");
  const landRights = useRights("legal-land-master");
  const { data: stats } = useQuery({ queryKey: ["legal-land-stats"], queryFn: getLandStats, enabled: landRights.canView, staleTime: 60 * 1000 });
  const { data: lands } = useQuery({ queryKey: ["legal-lookup", "land"], queryFn: () => getLegalLookup("land"), staleTime: 60 * 1000 });
  const layoutRef = useRef<HTMLDivElement>(null);
  const wide = useElementWidth(layoutRef) >= 820;
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-land-report", key], queryFn: () => getLandReport(key) });
  const groups = useMemo(() => [...new Set((list ?? []).map((r) => r.group))], [list]);
  const hasLandCol = !!data?.columns.includes("Land ID");
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.rows ?? [])
      .filter((r) => !landCode || !hasLandCol || String(r["Land ID"]) === landCode)
      .filter((r) => !t || Object.values(r).some((v) => cell(v).toLowerCase().includes(t)));
  }, [data, q, landCode, hasLandCol]);
  const print = () => {
    document.body.classList.add("legal-printing");
    const done = () => { document.body.classList.remove("legal-printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", "Reports"]} />
      <LegalShell title="Land Reports" subtitle="Registers and status reports across every land property" icon={DocumentText}>
        {stats && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            {([
              ["Land properties", stats.totalLands], ["Active enquiries", stats.activeEnquiries], ["In progress", stats.inProgress],
              ["Pending verification", stats.pendingVerification], ["On hold", stats.onHold], ["Pending registration", stats.pendingRegistration],
              ["Mutation pending", stats.mutationPending], ["Completed", stats.completed],
            ] as const).map(([l, v]) => (
              <div key={l} className={`${card} p-3`}>
                <div className="text-xl font-heading font-bold tabular-nums text-foreground">{v ?? 0}</div>
                <div className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
        )}
        <div ref={layoutRef} className={`grid gap-4 ${wide ? "grid-cols-[240px_minmax(0,1fr)]" : "grid-cols-1"}`}>
          <div className={`${card} p-3 ${wide ? "hidden" : ""}`}>
            <label className="text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground" htmlFor="legal-report-picker">Report</label>
            <select id="legal-report-picker" className="mt-1 w-full rounded-lg border border-border bg-muted px-2.5 py-2 text-sm" value={key} onChange={(e) => { setKey(e.target.value); setQ(""); }}>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {(list ?? []).filter((r) => r.group === g).map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <nav className={`${card} p-2 ${wide ? "self-start" : "hidden"}`}>
            {groups.map((g) => (
              <div key={g} className="mb-2">
                <p className="px-2.5 pb-1 pt-2 text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">{g}</p>
                {(list ?? []).filter((r) => r.group === g).map((r) => (
                  <button key={r.key} onClick={() => { setKey(r.key); setQ(""); }}
                    className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm ${r.key === key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                    {r.title}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className={`${card} legal-print min-w-0 p-4 sm:p-5`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-heading font-semibold text-foreground">{data?.title ?? "…"}</h3>
                <p className="text-xs text-muted-foreground">{rows.length} row(s)</p>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                {hasLandCol && (
                  <select className="min-w-0 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm sm:w-52" value={landCode} onChange={(e) => setLandCode(e.target.value)} title="Filter by land">
                    <option value="">All lands</option>
                    {(lands ?? []).map((l) => <option key={l.value} value={l.label.split(" - ")[0]}>{l.label}</option>)}
                  </select>
                )}
                <input className="min-w-0 flex-1 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm sm:w-56 sm:flex-none" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
                {rights.canExport && data && (
                  <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    onClick={() => exportToCsv(rows.map((r) => Object.fromEntries(data.columns.map((c) => [c, cell(r[c])]))), data.columns.map((c) => ({ header: c, accessor: c })), `legal-${key}`)}>
                    <Download size={13} /> CSV
                  </button>
                )}
                {data && (
                  <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={print}>
                    <Printer size={13} /> PDF
                  </button>
                )}
              </div>
            </div>
            {error ? <p className="text-sm text-destructive">{(error as Error).message}</p> : isLoading || !data ? <p className="text-sm text-muted-foreground">Loading…</p> : !rows.length ? (
              <p className="text-sm text-muted-foreground">Nothing to show.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{data.columns.map((c) => <th key={c} className="whitespace-nowrap pb-2 pr-4 font-medium">{c}</th>)}</tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">{data.columns.map((c) => <td key={c} className="max-w-[320px] py-2 pr-4 align-top">{cell(r[c])}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </LegalShell>
    </>
  );
}
