import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, Circle, Lock } from "lucide-react";

type StepStatus = "done" | "active" | "locked";

interface Step {
  key: string;
  label: string;
  status: StepStatus;
  date: string | null;
  link: string | null;
  blockedBy: string | null;
}

async function fetchLifecycle(bookingId: number): Promise<{ steps: Step[] } | null> {
  const r = await fetchWithAuth(`/api/crm/bookings/${bookingId}/lifecycle`);
  return r.ok ? r.json() : null;
}

interface BookingLifecycleBarProps {
  bookingId: number;
}

// Compact chip stepper — replaces the old fixed-90px-column horizontal
// layout that forced a scrollbar for all 12 steps. Chips wrap naturally
// (flex-wrap) so nothing ever needs to scroll, and each chip is a single
// inline row (icon + label) instead of a tall icon-over-label-over-date
// stack, so the whole thing takes a fraction of the vertical space.
export const BookingLifecycleBar: React.FC<BookingLifecycleBarProps> = ({ bookingId }) => {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["crm-booking-lifecycle", bookingId],
    queryFn: () => fetchLifecycle(bookingId),
    staleTime: 60_000,
    enabled: !!bookingId,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 flex items-center gap-2 text-muted-foreground/60">
        <div className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        <span className="text-[11px]">Loading lifecycle…</span>
      </div>
    );
  }

  if (!data?.steps?.length) return null;

  const doneCount = data.steps.filter((s) => s.status === "done").length;
  const pct = Math.round((doneCount / data.steps.length) * 100);
  const nextLocked = data.steps.find((s) => s.status === "locked" && s.blockedBy);

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      {/* header + inline progress bar share one row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
          Lifecycle
        </span>
        <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] font-medium text-muted-foreground shrink-0">
          {doneCount}/{data.steps.length} · {pct}%
        </span>
      </div>

      {/* steps — single row that wraps only if truly needed (9 chips fit comfortably) */}
      <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
        {data.steps.map((step, i) => {
          const clickable = !!step.link && step.status !== "locked";
          const isLast = i === data.steps.length - 1;
          return (
            <React.Fragment key={step.key}>
              <button
                onClick={clickable ? () => navigate(step.link!) : undefined}
                disabled={!clickable}
                title={step.blockedBy ?? (step.date ? `${step.label} — ${step.date}` : step.label)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none transition-colors
                  ${step.status === "done" ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400" : ""}
                  ${step.status === "active" ? "border-primary/40 bg-primary/10 text-foreground font-semibold" : ""}
                  ${step.status === "locked" ? "border-transparent bg-muted/30 text-muted-foreground/40" : ""}
                  ${clickable ? "hover:shadow-sm cursor-pointer" : step.status === "locked" ? "cursor-default" : ""}
                `}
              >
                {step.status === "done" && <CheckCircle2 size={10} className="shrink-0" />}
                {step.status === "active" && <Circle size={6} className="fill-primary text-primary shrink-0 animate-pulse" />}
                {step.status === "locked" && <Lock size={8} className="shrink-0" />}
                {step.label}
              </button>
              {!isLast && <span className="text-muted-foreground/20 text-[10px] select-none mx-0.5">›</span>}
            </React.Fragment>
          );
        })}
      </div>

      {/* single-line "what's next" hint, only when something is actually blocked */}
      {nextLocked && (
        <div className="mt-2 text-[10px] text-muted-foreground truncate">
          <span className="font-medium text-foreground">Next:</span> {nextLocked.label} — {nextLocked.blockedBy}
        </div>
      )}
    </div>
  );
};
