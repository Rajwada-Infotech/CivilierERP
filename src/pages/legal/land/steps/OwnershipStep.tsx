import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Circle } from "lucide-react";
import { getLegalRows, type LegalRow } from "@/api/legalMastersApi";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { LegalMasterTable } from "../../LegalMasterPage";

// Pipeline step 5 — Ownership History & Verification: the complete chain from the earliest documented owner
// to today. Overview shows current owners and a timeline; each other tab is that record type's own table.

const card = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";
const eyebrow = "mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground";
const land = { pageKey: "legal-land-master" };

const TABS = [
  ["overview", "Overview & timeline"],
  ["records", "Ownership records"],
  ["events", "Transfer history"],
  ["inheritance", "Inheritance"],
  ["partition", "Partition"],
  ["checks", "Verification checklist"],
] as const;
type Tab = (typeof TABS)[number][0];

const fmt = (d: unknown) => (d ? new Date(String(d).slice(0, 10)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const pct = (v: unknown) => `${Number(v ?? 0).toFixed(2).replace(/\.00$/, "")}%`;

const VERIFY_STYLE: Record<string, string> = {
  Verified: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  Pending: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  Rejected: "border-rose-500/40 bg-rose-500/10 text-rose-600",
  "Needs Correction": "border-rose-500/40 bg-rose-500/10 text-rose-600",
};
const Chip: React.FC<{ s: unknown }> = ({ s }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[0.6875rem] ${VERIFY_STYLE[String(s)] ?? "border-border text-muted-foreground"}`}>{String(s ?? "—")}</span>
);

const Overview: React.FC<{ landId: number }> = ({ landId }) => {
  const records = useQuery({ queryKey: ["legal-master", "ownership-record", landId], queryFn: () => getLegalRows("ownership-record", landId) });
  const events = useQuery({ queryKey: ["legal-master", "ownership-event", landId], queryFn: () => getLegalRows("ownership-event", landId) });
  const current = useMemo(() => (records.data ?? []).filter((r) => r.IsActive && !r.ValidTo), [records.data]);
  const previous = useMemo(() => (records.data ?? []).filter((r) => r.IsActive && r.ValidTo), [records.data]);
  const total = current.reduce((s, r) => s + Number(r.SharePct ?? 0), 0);
  const timeline = useMemo(() => [...(events.data ?? [])].filter((e) => e.IsActive).sort((a, b) => String(a.EventDate).localeCompare(String(b.EventDate))), [events.data]);

  if (records.isLoading || events.isLoading) return <div className="p-5 text-sm text-muted-foreground">Loading ownership…</div>;
  const row = (r: LegalRow) => (
    <tr key={String(r.RecordId)} className="border-t border-border/60">
      <td className="py-2 pr-3">{String(r.PersonId__label ?? "")}</td>
      <td className="py-2 pr-3">{String(r.OwnershipTypeId__label ?? "")}</td>
      <td className="py-2 pr-3">{String(r.RelationshipTypeId__label ?? "—")}</td>
      <td className="py-2 pr-3 tabular-nums">{pct(r.SharePct)}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{fmt(r.ValidFrom)} – {r.ValidTo ? fmt(r.ValidTo) : "Present"}</td>
      <td className="py-2 pr-3"><LegalFileLink id={r.TransferDocFileId} name={String(r.TransferDocFileId__label ?? "")} /></td>
      <td className="py-2"><Chip s={r.VerificationStatus} /></td>
    </tr>
  );
  const head = (
    <tr className="text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
      <th className="pb-2 pr-3 font-medium">Owner</th><th className="pb-2 pr-3 font-medium">Type</th><th className="pb-2 pr-3 font-medium">Relationship</th>
      <th className="pb-2 pr-3 font-medium">Share</th><th className="pb-2 pr-3 font-medium">Period</th><th className="pb-2 pr-3 font-medium">Document</th><th className="pb-2 font-medium">Verification</th>
    </tr>
  );
  return (
    <div className="space-y-4">
      <div className={`${card} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={eyebrow}>Current owners</p>
          <span className={`mb-3 text-xs ${Math.abs(total - 100) < 0.0001 ? "text-emerald-600" : "text-amber-600"}`}>Total share {pct(total)}</span>
        </div>
        {current.length ? <div className="overflow-x-auto"><table className="w-full text-sm">{<thead>{head}</thead>}<tbody>{current.map(row)}</tbody></table></div>
          : <p className="text-sm text-muted-foreground">No current owner recorded yet. Add one in Ownership records (leave the end date blank).</p>}
        {previous.length > 0 && (
          <>
            <p className={`${eyebrow} mt-5`}>Previous owners</p>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead>{head}</thead><tbody>{previous.map(row)}</tbody></table></div>
          </>
        )}
      </div>

      <div className={`${card} p-4 sm:p-5`}>
        <p className={eyebrow}>Ownership timeline</p>
        {!timeline.length ? <p className="text-sm text-muted-foreground">No transfers recorded yet. Add them in Transfer history.</p> : (
          <ol className="relative ml-2 border-l border-border">
            {timeline.map((e) => (
              <li key={String(e.EventId)} className="mb-5 ml-5 last:mb-0">
                <span className="absolute -left-[7px] mt-1 rounded-full bg-card"><Circle size={13} className="fill-rose-700 text-rose-700" /></span>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-foreground">{fmt(e.EventDate)}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{String(e.TransferTypeId__label ?? "")}</span>
                  <Chip s={e.VerificationStatus} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-muted-foreground">{String(e.PreviousOwnerId__label || "Earliest record")}</span>
                  <ArrowRight size={13} className="text-muted-foreground" />
                  <span className="text-foreground">{String(e.NewOwnerId__label ?? "")}</span>
                  {e.TransferSharePct != null && <span className="text-muted-foreground">· {pct(e.TransferSharePct)}</span>}
                  {e.DeedNo ? <span className="text-muted-foreground">· Deed {String(e.DeedNo)}</span> : null}
                </div>
                {e.DocFileId ? <div className="mt-1.5"><LegalFileLink id={e.DocFileId} name={String(e.DocFileId__label ?? "")} /></div> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

export const OwnershipStep: React.FC<{ landId: number; onSaved: () => void }> = ({ landId, onSaved }) => {
  const [tab, setTab] = useState<Tab>("overview");
  const table = (key: string, label: string) => (
    <div className={card}><LegalMasterTable entry={{ ...land, key, label }} parentId={landId} onSaved={onSaved} /></div>
  );
  return (
    <div className="space-y-4">
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${tab === k ? "bg-foreground text-background" : "border border-border hover:bg-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview landId={landId} />}
      {tab === "records" && table("ownership-record", "Ownership Records")}
      {tab === "events" && table("ownership-event", "Transfer History")}
      {tab === "inheritance" && (
        <div className="space-y-4">
          {table("inheritance", "Inheritance")}
          {table("inheritance-heir", "Legal Heirs")}
        </div>
      )}
      {tab === "partition" && table("partition", "Partition")}
      {tab === "checks" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Each ownership record needs all seven checks reviewed — Verified or Not Applicable — before this step can complete.</p>
          {table("ownership-check", "Ownership Verification Checklist")}
        </div>
      )}
    </div>
  );
};
