import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { getFlowLand } from "@/api/legalFlowApi";

type Row = Record<string, unknown>;
const v = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : String(x));
const d = (x: unknown) => (x ? new Date(String(x)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const H = ({ children }: { children: React.ReactNode }) => <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{children}</p>;
const STATE: Record<string, string> = { Verified: "text-emerald-700 dark:text-emerald-400", Pending: "text-amber-700 dark:text-amber-400", Missing: "font-semibold text-destructive", Rejected: "font-semibold text-destructive" };

function Mini({ rows, cols, empty }: { rows: Row[]; cols: [string, string, ((r: Row) => React.ReactNode)?][]; empty: string }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr className="text-left uppercase tracking-[0.06em] text-muted-foreground">{cols.map(([, l]) => <th key={l} className="py-1 pr-3 font-semibold">{l}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border/60 align-top">{cols.map(([k, , f]) => <td key={k} className="py-1.5 pr-3">{f ? f(r) : v(r[k])}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

/**
 * Everything a verifier / approver needs to decide, in one fold-out: the land's key details, RS / LR records, owners,
 * every document (click to preview), the checklist with what is pending, and the stages still open.
 */
export function LandSummary({ landId }: { landId: number }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-flow", landId, null], queryFn: () => getFlowLand(landId) });
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading summary…</p>;
  if (error || !data?.land) return <p className="text-xs text-destructive">{(error as Error)?.message ?? "Could not load the land"}</p>;
  const l = data.land;
  const latest = data.versions?.[data.versions.length - 1];
  const items = latest?.checklist?.items ?? [];
  const pending = items.filter((i) => ["Missing", "Pending", "Rejected"].includes(i.state));
  const open = (data.stages ?? []).filter((s) => s.state === "current" || s.state === "pending");
  const kv: [string, unknown][] = [
    ["Land ID", l.LandCode], ["Land", l.LandName], ["Project", l.ProjectName], ["Mouza", l.MouzaName ? `${l.MouzaName}${l.JLNo ? ` (J.L. ${l.JLNo})` : ""}` : null],
    ["District", l.DistrictName], ["Area", l.Area != null ? `${l.Area} ${l.AreaUnitName ?? ""}` : null], ["RS Khatian / Dag", `${v(l.RsKhatianNo)} / ${v(l.RsDagNo)}`],
    ["LR Khatian / Dag", `${v(l.LrKhatianNo)} / ${v(l.LrDagNo)}`], ["Land type", l.LandTypeName], ["Entry type", l.EntryType], ["Stage", l.WorkflowStatus], ["Possession", l.PossessionStatus],
  ];
  return (
    <div className="space-y-4 border-t border-border pt-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {kv.map(([k, x]) => <div key={k}><dt className="text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">{k}</dt><dd className="text-sm font-medium">{v(x)}</dd></div>)}
      </dl>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div><H>RS records ({data.rsRecords.length})</H>
          <Mini rows={data.rsRecords} empty="No RS record." cols={[["RsKhatianNo", "Khatian"], ["RsDagNo", "Dag"], ["RecordedHolder", "Holder"], ["Area", "Area"], ["VerificationStatus", "Verified"]]} /></div>
        <div><H>LR records ({data.lrRecords.length})</H>
          <Mini rows={data.lrRecords} empty="No LR record." cols={[["LrKhatianNo", "Khatian"], ["LrDagNo", "Dag"], ["RecordedHolder", "Holder"], ["Area", "Area"], ["VerificationStatus", "Verified"]]} /></div>
      </div>

      <div><H>Owners ({data.owners.length})</H>
        <Mini rows={data.owners} empty="No owner recorded." cols={[["OwnerName", "Owner"], ["OwnerGuardian", "Father / husband"], ["SharePct", "Share %"], ["ValidFrom", "From", (r) => d(r.ValidFrom)], ["VerificationStatus", "Verified"]]} /></div>

      <div><H>Documents ({data.documents.length}) — click to open</H>
        <Mini rows={data.documents} empty="No document uploaded." cols={[
          ["DocumentCode", "Document", (r) => <span><b className="font-mono">{v(r.DocumentCode)}</b> {v(r.Title)}</span>],
          ["DocTypeName", "Type"], ["DocumentNo", "No."], ["CurrentVersionNo", "File v", (r) => `v${v(r.CurrentVersionNo)}`],
          ["ReviewStatus", "Review", (r) => <span className={STATE[String(r.ReviewStatus)] ?? ""}>{v(r.ReviewStatus)}</span>],
          ["FileId", "File", (r) => <LegalFileLink id={r.FileId} name={String(r.FileName ?? r.Title ?? "Document")} />],
        ]} /></div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div><H>Document checklist — {pending.length ? <span className="text-destructive">{pending.length} pending</span> : <span className="text-emerald-700 dark:text-emerald-400">nothing pending</span>}</H>
          {items.length ? <Mini rows={items as unknown as Row[]} empty="" cols={[["doc", "Document"], ["requirement", "Needed"], ["state", "State", (r) => <span className={STATE[String(r.state)] ?? "text-muted-foreground"}>{String(r.state) === "Pending" ? "Waiting for review" : v(r.state)}</span>]]} />
            : <p className="text-xs text-muted-foreground">No document checklist is set for this land.</p>}</div>
        <div><H>Not done yet ({open.length})</H>
          {open.length ? <ul className="space-y-1 text-xs">{open.map((s) => <li key={s.key}><b>{s.label}</b> — <span className={s.state === "current" ? "text-amber-700 dark:text-amber-400" : "text-destructive"}>{s.state === "current" ? "in progress" : "not started"}</span>{s.note ? <span className="text-muted-foreground"> · {s.note}</span> : null}</li>)}</ul>
            : <p className="text-xs text-emerald-700 dark:text-emerald-400">All stages complete.</p>}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => navigate(`/legal/land/properties/${landId}`)} className="h-8 border border-foreground/40 px-3 text-xs font-semibold uppercase tracking-[0.06em] hover:border-foreground">Open full land workspace</button>
        <button onClick={() => navigate(`/legal/versions?land=${landId}`)} className="h-8 border border-foreground/40 px-3 text-xs font-semibold uppercase tracking-[0.06em] hover:border-foreground">Versions & documents history</button>
      </div>
    </div>
  );
}
