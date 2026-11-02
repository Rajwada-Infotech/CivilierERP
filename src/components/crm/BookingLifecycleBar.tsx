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
      <div className="border border-border bg-card px-3 py-2 flex items-center gap-2 text-muted-foreground/60">
        <div className="h-3 w-3 border-2 border-current border-t-transparent animate-spin" />
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
    <div className="border border-border bg-card px-3 py-2.5">
      {/* header + inline progress bar share one row */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
          Journey
        </span>
        <div className="h-1 flex-1 bg-muted overflow-hidden">
          <div
            className="h-full bg-foreground transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[0.625rem] font-medium text-muted-foreground shrink-0">
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
                className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[0.6875rem] leading-none transition-colors
                  ${step.status === "done" ? "border-foreground/30 bg-card text-foreground" : ""}
                  ${step.status === "active" ? "border-primary/40 bg-primary/10 text-foreground font-semibold" : ""}
                  ${step.status === "locked" ? "border-transparent bg-muted/30 text-muted-foreground/40" : ""}
                  ${clickable ? "cursor-pointer" : step.status === "locked" ? "cursor-default" : ""}
                `}
              >
                {step.status === "done" && <CheckCircle2 size={10} className="shrink-0" />}
                {step.status === "active" && <Circle size={6} className="fill-primary text-foreground shrink-0 animate-pulse" />}
                {step.status === "locked" && <Lock size={8} className="shrink-0" />}
                {step.label}
                {step.stage && <span className="font-normal text-muted-foreground">· {step.stage}</span>}
              </button>
              {!isLast && <span className="text-muted-foreground/20 text-[0.625rem] select-none mx-0.5">›</span>}
            </React.Fragment>
          );
        })}
      </div>

      {/* The open step: what to do now, and the way to it. */}
      {nowStep ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2">
          <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-primary shrink-0">Now</span>
          <span className="text-[0.75rem] text-foreground min-w-0 flex-1">
            <span className="font-semibold">{nowStep.label}</span> — {nowText}
          </span>
          {nowStep.link && !nowIsHere && (
            <button
              onClick={() => navigate(nowStep.link!)}
              className="inline-flex items-center gap-1 border border-primary/40 bg-primary/10 px-2.5 py-1 text-[0.6875rem] font-semibold text-foreground hover:bg-primary/20 shrink-0"
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
