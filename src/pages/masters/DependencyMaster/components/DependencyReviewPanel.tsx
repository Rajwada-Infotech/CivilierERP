import { CheckCircle2 } from "lucide-react";
import type { LadderActivity, WorkType } from "@/api/dependencyMasterApi";

interface Props {
  resolvedPath: string;
  alias: string;
  workType: WorkType;
  rungs: LadderActivity[];
}

// Step 6 — final review shown right above Save: path, alias, work type, and
// the full ordered chain, so nothing is committed the user hasn't seen laid
// out plainly first.
export function DependencyReviewPanel({ resolvedPath, alias, workType, rungs }: Props) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={14} className="text-primary" />
        <h3 className="text-xs font-heading font-semibold uppercase tracking-widest text-foreground">
          Review
        </h3>
      </div>

      <div>
        <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-0.5">Path</p>
        <p className="text-xs font-mono text-foreground">{resolvedPath}</p>
      </div>

      <div className="flex items-center gap-6">
        <div>
          <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-0.5">Alias</p>
          <p className="text-sm font-medium text-foreground">{alias}</p>
        </div>
        <div>
          <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-0.5">Work Type</p>
          <span
            className={`text-[10px] font-heading uppercase tracking-wide px-2 py-0.5 rounded ${
              workType === "INTERNAL" ? "bg-orange-500/10 text-orange-500" : "bg-sky-500/10 text-sky-500"
            }`}
          >
            {workType === "INTERNAL" ? "Internal" : "External"}
          </span>
        </div>
      </div>

      <div>
        <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">
          Activity Chain ({rungs.length})
        </p>
        <ol className="space-y-1">
          {rungs.map((r) => (
            <li key={r.sequenceNo} className="flex items-center gap-2 text-xs text-foreground">
              <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">
                {r.sequenceNo}
              </span>
              {r.activityName}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
