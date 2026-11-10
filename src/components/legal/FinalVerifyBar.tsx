import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { getFinalStatus } from "@/api/legalLandApi";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

/**
 * End of the Land page. While data is missing it lists what to fill; once complete it shows "Final verify", which opens
 * one page with every detail and document. After verification the land is in Deed Process (link to its timeline).
 */
export const FinalVerifyBar: React.FC<{ landId: number }> = ({ landId }) => {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["legal-land-final", landId], queryFn: () => getFinalStatus(landId), enabled: landId > 0 });
  if (!data) return null;

  if (data.inDeedProcess && data.changed) {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-amber-500 bg-amber-500/10 p-4">
        <p className="text-sm text-foreground"><b className="text-amber-700">Changed after verification</b>{data.changed.by ? ` (last by ${data.changed.by})` : ""} — a verifier must re-verify before the deed can be completed.</p>
        <button onClick={() => navigate(`/legal/land/properties/${landId}/details`)} className="border border-foreground px-3 py-1.5 text-xs font-heading font-semibold uppercase tracking-[0.08em] hover:bg-primary/10">Re-verify</button>
      </div>
    );
  }
  if (data.inDeedProcess) {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-emerald-500/50 bg-emerald-500/5 p-4">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <CheckCircle2 size={16} className="text-emerald-600" />
          Verified{data.verifiedBy ? ` by ${data.verifiedBy}` : ""}{data.verifiedAt ? ` on ${fmt(data.verifiedAt)}` : ""} — <b>{data.workflowStatus}</b>{data.targetDate ? `, timeline ${fmt(data.targetDate)}` : ""}
        </p>
        <button onClick={() => navigate("/legal/land/deed-process")} className="border border-foreground px-3 py-1.5 text-xs font-heading font-semibold uppercase tracking-[0.08em] hover:bg-primary/10">
          Open Deed Process
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 border border-border bg-card p-4">
      <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Final verification</p>
      {data.ready ? (
        <p className="mt-1 text-sm text-foreground">All data is entered. The verifier checks every detail and document on one page, then sends the land to Deed Process.</p>
      ) : (
        <div className="mt-1 text-sm text-foreground">
          Complete the data entry first:
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{data.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          disabled={!data.ready}
          onClick={() => navigate(`/legal/land/properties/${landId}/final-verify`)}
          className="inline-flex items-center gap-1.5 bg-foreground px-4 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShieldCheck size={14} /> Final verify
        </button>
        {data.ready && !data.canVerify && data.blockedReason && <span className="text-xs text-muted-foreground">{data.blockedReason}</span>}
      </div>
    </div>
  );
};
