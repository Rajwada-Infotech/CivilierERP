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
    <div className="bg-card p-4 space-y-4" style={{ border: "1.5px solid hsl(var(--foreground))" }}>
      <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground pb-2" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
        Review before saving
      </h3>

      <div>
        <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1">Path</p>
        <p className="text-xs text-foreground break-words">{resolvedPath}</p>
      </div>

      <div className="flex items-center gap-6">
        <div>
          <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1">Alias</p>
          <p className="text-sm font-medium text-foreground">{alias}</p>
        </div>
        <div>
          <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1">Work type</p>
          <p className="text-sm font-medium text-foreground">{workType === "INTERNAL" ? "Internal" : "External"}</p>
        </div>
      </div>

      <div>
        <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
          Activity chain · {rungs.length}
        </p>
        <ol className="space-y-1.5">
          {rungs.map((r) => (
            <li key={r.sequenceNo} className="flex items-center gap-2 text-xs text-foreground">
              <span className="min-w-[1.125rem] h-[1.125rem] px-0.5 bg-foreground text-card font-heading text-[0.5625rem] font-bold tabular-nums flex items-center justify-center shrink-0">
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
