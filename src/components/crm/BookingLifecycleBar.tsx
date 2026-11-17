import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, Circle, Lock, ArrowRight } from "lucide-react";

type StepStatus = "done" | "active" | "locked";

interface Step {
  key: string;
  label: string;
  status: StepStatus;
  date: string | null;
  link: string | null;
  blockedBy: string | null;
  /** Where the step sits inside its own approval chain (Booking only). */
  stage?: string | null;
  /** What has to be done now, when this is the open step. */
  todo?: string | null;
}

async function fetchLifecycle(bookingId: number): Promise<{ steps: Step[]; current: string | null } | null> {
  const r = await fetchWithAuth(`/api/crm/bookings/${bookingId}/lifecycle`);
  return r.ok ? r.json() : null;
}

interface BookingLifecycleBarProps {
  bookingId: number;
  /** The booking's approval stage — a change refetches the bar. */
  stage?: string | null;
}

// Compact chip stepper — replaces the old fixed-90px-column horizontal
// layout that forced a scrollbar for all 12 steps. Chips wrap naturally
// (flex-wrap) so nothing ever needs to scroll, and each chip is a single
// inline row (icon + label) instead of a tall icon-over-label-over-date
// stack, so the whole thing takes a fraction of the vertical space.
export const BookingLifecycleBar: React.FC<BookingLifecycleBarProps> = ({ bookingId, stage }) => {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["crm-booking-lifecycle", bookingId, stage],
    queryFn: () => fetchLifecycle(bookingId),
    staleTime: 60_000,
    enabled: bookingId != null,
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-2.5 flex items-center gap-2 text-muted-foreground/60">
        <div className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        <span className="text-[0.6875rem]">Loading lifecycle…</span>
      </div>
    );
  }

  if (!data?.steps?.length) return null;

  const doneCount = data.steps.filter((s) => s.status === "done").length;
  const pct = Math.round((doneCount / data.steps.length) * 100);
  const nowStep = data.steps.find((s) => s.key === data.current) ?? null;
  const nowText = nowStep ? nowStep.todo || nowStep.blockedBy || `Continue on the ${nowStep.label} page` : null;
  const nowIsHere = nowStep?.key === "booking";

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      {/* header + inline progress bar share one row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-semibold text-foreground shrink-0">
          Journey
        </span>
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground shrink-0">
          {doneCount}/{data.steps.length} · {pct}%
        </span>
      </div>

      {/* steps — single row that wraps only if truly needed (9 chips fit comfortably) */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {data.steps.map((step, i) => {
          const clickable = !!step.link && step.status !== "locked";
          const isLast = i === data.steps.length - 1;
          // Several steps can be open at once (a welcome call can happen while
          // the booking is still in approval); only the one in "Now" is lit.
          const isNow = step.key === data.current;
          return (
            <React.Fragment key={step.key}>
              <button
                onClick={clickable ? () => navigate(step.link!) : undefined}
                disabled={!clickable}
                title={step.blockedBy ?? (step.date ? `${step.label} — ${step.date}` : step.label)}
                className={`inline-flex items-center gap-1 h-6 rounded-full border px-2.5 text-[0.6875rem] leading-none transition-colors
                  ${step.status === "done" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : ""}
                  ${step.status === "active" && isNow ? "border-primary bg-primary text-primary-foreground font-semibold" : ""}
                  ${step.status === "active" && !isNow ? "border-border bg-card text-foreground" : ""}
                  ${step.status === "locked" ? "border-transparent bg-muted/60 text-muted-foreground/60" : ""}
                  ${clickable ? "cursor-pointer" : step.status === "locked" ? "cursor-default" : ""}
                `}
              >
                {step.status === "done" && <CheckCircle2 size={10} className="shrink-0" />}
                {step.status === "active" && isNow && <Circle size={6} className="fill-current shrink-0 animate-pulse" />}
                {step.status === "active" && !isNow && <Circle size={6} className="text-muted-foreground shrink-0" />}
                {step.status === "locked" && <Lock size={8} className="shrink-0" />}
                {step.label}
                {step.stage && <span className="font-normal opacity-75">· {step.stage}</span>}
              </button>
              {!isLast && <span className="text-muted-foreground/20 text-[0.625rem] select-none mx-0.5">›</span>}
            </React.Fragment>
          );
        })}
      </div>

      {/* The open step: what to do now, and the way to it. */}
      {nowStep ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2">
          <span className="inline-flex items-center h-5 px-2 rounded-full bg-primary/10 text-[0.6875rem] font-semibold text-primary shrink-0">Now</span>
          <span className="text-[0.75rem] text-foreground min-w-0 flex-1">
            <span className="font-semibold">{nowStep.label}</span> — {nowText}
          </span>
          {nowStep.link && !nowIsHere && (
            <button
              onClick={() => navigate(nowStep.link!)}
              className="inline-flex items-center gap-1 h-7 rounded-md border border-primary bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shrink-0"
            >
              Open {nowStep.label} <ArrowRight size={11} />
            </button>
          )}
        </div>
      ) : doneCount === data.steps.length ? (
        <div className="mt-2 text-[0.6875rem] text-muted-foreground">Every step is complete.</div>
      ) : null}
    </div>
  );
};
