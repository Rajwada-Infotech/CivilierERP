import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DocumentText } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { ExportMenu } from "@/components/ExportMenu";
import { useProjectScope } from "@/components/legal/ProjectPicker";
import { usePageRights } from "@/hooks/usePageRights";
import { getReport, getReportList, getVerifications } from "@/api/legalVerificationApi";

const input = "h-9 border border-foreground/30 bg-background px-2 text-sm focus:border-foreground focus:outline-none";
const lbl = "mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground";

/** Legal verification reports: pick a report, filter by the project picker and dates, export to PDF / Excel. */
export default function LegalVerificationReportsPage() {
  const { scope } = useProjectScope();
  const rights = usePageRights("legal-land-enquiry");
  const project = String(scope);
  const list = useQuery({ queryKey: ["legal-report-list"], queryFn: getReportList, staleTime: 3600_000 });
  const [key, setKey] = useState("verification-register");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [vid, setVid] = useState("");
  const [flt, setFlt] = useState({ enquiry: "", mouza: "", dag: "", employee: "", status: "", verify: "" });
  const [applied, setApplied] = useState(flt);
  const meta = list.data?.find((r) => r.key === key);
  const ws = useQuery({ queryKey: ["legal-verification-list", "all-for-report", project], queryFn: () => getVerifications(`project=${project}`), enabled: !!meta?.needsVerification });
  const rep = useQuery({ queryKey: ["legal-report", key, project, from, to, vid, applied], queryFn: () => getReport(key, { project, from, to, verificationId: vid ? Number(vid) : null, ...applied }),
    enabled: !meta?.needsVerification || !!vid });
  const data = rep.data;
  const fmt = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-IN") : String(v));
  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Verification reports" }]} />
      <LegalShell title="Verification reports" subtitle="Registers, pending and overdue work, searches, clearances, ownership and land history — follows the project picker." icon={DocumentText}
        action={data ? <ExportMenu data={data.rows} columns={data.columns.map((c) => ({ header: c.label, accessor: c.key }))} title={data.title} subtitle={data.subtitle}
          filename={key} disabled={!data.rows.length || !rights.canExport} /> : undefined}>
        <div className="mb-4 flex flex-wrap items-end gap-2 border border-border bg-card p-3">
          <label className="min-w-[16rem] flex-1"><span className={lbl}>Report</span>
            <select className={`${input} w-full`} value={key} onChange={(e) => setKey(e.target.value)}>
              {(list.data ?? []).map((r, i) => <option key={r.key} value={r.key}>{i + 1}. {r.title}</option>)}
            </select></label>
          {meta?.needsVerification && (
            <label className="min-w-[14rem]"><span className={lbl}>Verification</span>
              <select className={`${input} w-full`} value={vid} onChange={(e) => setVid(e.target.value)}>
                <option value="">Choose…</option>{(ws.data?.items ?? []).map((w) => <option key={w.VerificationId} value={w.VerificationId}>{w.VerificationNo} · {w.EnquiryNo} · {w.MouzaName ?? ""}</option>)}
              </select></label>
          )}
          <label><span className={lbl}>From</span><input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span className={lbl}>To</span><input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          {(from || to) && <button className="h-9 text-xs underline" onClick={() => { setFrom(""); setTo(""); }}>Clear dates</button>}
        </div>
        <div className="mb-4 flex flex-wrap items-end gap-2 border border-border bg-card p-3">
          {([["enquiry", "Enquiry / verification no."], ["mouza", "Mouza"], ["dag", "Dag"], ["employee", "Employee"], ["status", "Status / result"]] as const).map(([k, l]) => (
            <label key={k} className="min-w-[9rem] flex-1"><span className={lbl}>{l}</span>
              <input className={`${input} w-full`} value={flt[k]} onChange={(e) => setFlt({ ...flt, [k]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && setApplied(flt)} /></label>
          ))}
          <label className="min-w-[9rem]"><span className={lbl}>Verification status</span>
            <select className={`${input} w-full`} value={flt.verify} onChange={(e) => setFlt({ ...flt, verify: e.target.value })}>
              <option value="">Any</option>{["Not Reviewed", "Under Review", "Verified", "Returned", "Rejected", "N/A"].map((s) => <option key={s}>{s}</option>)}</select></label>
          <button className="h-9 bg-foreground px-4 text-xs font-semibold uppercase text-background" onClick={() => setApplied(flt)}>Apply</button>
          {Object.values(applied).some(Boolean) && <button className="h-9 text-xs underline" onClick={() => { const e = { enquiry: "", mouza: "", dag: "", employee: "", status: "", verify: "" }; setFlt(e); setApplied(e); }}>Clear filters</button>}
        </div>
        {rep.error ? <p className="p-6 text-destructive">{(rep.error as Error).message}</p> : meta?.needsVerification && !vid ? <p className="border border-border p-6 text-sm text-muted-foreground">Choose a verification.</p>
          : rep.isLoading || !data ? <p className="p-6 text-muted-foreground">Loading…</p> : (
          <section className="border border-border bg-card">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
              <b>{data.title}</b><span className="text-xs text-muted-foreground">{data.subtitle ? `${data.subtitle} · ` : ""}{data.rows.length} row{data.rows.length === 1 ? "" : "s"}</span>
            </header>
            {!data.rows.length ? <p className="p-6 text-sm text-muted-foreground">{data.note ?? "Nothing to show for this filter."}</p> : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="sticky top-0 bg-card text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                    <tr>{data.columns.map((c) => <th key={c.key} className="border-b border-border px-2 py-1.5">{c.label}</th>)}</tr>
                  </thead>
                  <tbody>{data.rows.map((r, i) => <tr key={i} className="border-t border-border/60 align-top">{data.columns.map((c) => <td key={c.key} className="px-2 py-1.5">{fmt(r[c.key])}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </LegalShell>
    </>
  );
}
