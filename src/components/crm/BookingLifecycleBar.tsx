import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CheckCircle2, Circle, Lock, Loader2 } from "lucide-react";

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

const STATUS_STYLES: Record<StepStatus, { node: string; label: string; line: string }> = {
  done:   { node: "text-green-600 dark:text-green-400", label: "text-green-700 dark:text-green-400 font-medium", line: "bg-green-400" },
  active: { node: "text-primary", label: "text-foreground font-semibold", line: "bg-muted-foreground/30" },
  locked: { node: "text-muted-foreground/40", label: "text-muted-foreground/60", line: "bg-muted-foreground/20" },
};

const StepNode: React.FC<{ step: Step; isLast: boolean; onClick: () => void }> = ({ step, isLast, onClick }) => {
  const s = STATUS_STYLES[step.status];
  const clickable = step.status !== "locked" && !!step.link;

  return (
    <div className="flex items-start group">
      {/* node + connector */}
      <div className="flex flex-col items-center">
        <button
          onClick={clickable ? onClick : undefined}
          disabled={!clickable}
          title={step.blockedBy ?? step.label}
          className={`flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all
            ${step.status === "done" ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-950/30" : ""}
            ${step.status === "active" ? "border-primary bg-primary/10 ring-2 ring-primary/20" : ""}
            ${step.status === "locked" ? "border-muted-foreground/25 bg-muted/40 cursor-not-allowed" : ""}
            ${clickable ? "hover:shadow-md cursor-pointer" : ""}
          `}
        >
          {step.status === "done"   && <CheckCircle2 size={14} className={s.node} />}
          {step.status === "active" && <Circle size={10} className="fill-primary text-primary animate-pulse" />}
          {step.status === "locked" && <Lock size={10} className={s.node} />}
        </button>
        {!isLast && (
          <div className={`w-0.5 h-6 mt-1 ${s.line}`} />
        )}
      </div>

      {/* label */}
      <div className="ml-2.5 pb-5 min-w-0">
        <div className={`text-xs leading-tight ${s.label}`}>{step.label}</div>
        {step.date && (
          <div className="text-[10px] text-muted-foreground mt-0.5">{step.date}</div>
        )}
        {step.blockedBy && step.status === "locked" && (
          <div className="text-[10px] text-muted-foreground/60 mt-0.5 max-w-[110px] leading-tight">{step.blockedBy}</div>
        )}
      </div>
    </div>
  );
};

interface BookingLifecycleBarProps {
  bookingId: number;
}

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
      <div className="flex items-center justify-center py-4 text-muted-foreground/50">
        <Loader2 size={14} className="animate-spin mr-2" />
        <span className="text-xs">Loading lifecycle…</span>
      </div>
    );
  }

  if (!data?.steps?.length) return null;

  const doneCount = data.steps.filter((s) => s.status === "done").length;
  const pct = Math.round((doneCount / data.steps.length) * 100);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Booking Lifecycle
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {doneCount}/{data.steps.length} steps · {pct}% complete
        </span>
      </div>

      {/* horizontal progress bar */}
      <div className="h-1.5 rounded-full bg-muted mb-5 overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* steps — horizontal scrollable row on mobile, wrapping grid on desktop */}
      <div className="overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {data.steps.map((step, i) => (
            <div key={step.key} className="flex items-start">
              {/* step node */}
              <div className="flex flex-col items-center w-[90px]">
                <button
                  onClick={step.link && step.status !== "locked" ? () => navigate(step.link!) : undefined}
                  disabled={!step.link || step.status === "locked"}
                  title={step.blockedBy ?? step.label}
                  className={`flex items-center justify-center w-7 h-7 rounded-full border-2 transition-all
                    ${step.status === "done"   ? "border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-950/30 hover:shadow-md cursor-pointer" : ""}
                    ${step.status === "active" ? "border-primary bg-primary/10 ring-2 ring-primary/20 hover:shadow-md cursor-pointer" : ""}
                    ${step.status === "locked" ? "border-muted-foreground/25 bg-muted/40 cursor-not-allowed" : ""}
                  `}
                >
                  {step.status === "done"   && <CheckCircle2 size={14} className="text-green-600 dark:text-green-400" />}
                  {step.status === "active" && <Circle size={10} className="fill-primary text-primary animate-pulse" />}
                  {step.status === "locked" && <Lock size={10} className="text-muted-foreground/40" />}
                </button>
                <div className={`mt-1.5 text-center px-1 text-[10px] leading-tight
                  ${step.status === "done"   ? "text-green-700 dark:text-green-400 font-medium" : ""}
                  ${step.status === "active" ? "text-foreground font-semibold" : ""}
                  ${step.status === "locked" ? "text-muted-foreground/50" : ""}
                `}>
                  {step.label}
                </div>
                {step.date && (
                  <div className="text-[9px] text-muted-foreground/60 text-center">{step.date}</div>
                )}
              </div>

              {/* connector line between steps */}
              {i < data.steps.length - 1 && (
                <div className={`mt-3 h-0.5 w-4 shrink-0 self-start
                  ${step.status === "done" ? "bg-green-400" : "bg-muted-foreground/20"}
                `} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* blocked tooltip for the first active locked step */}
      {(() => {
        const nextLocked = data.steps.find((s) => s.status === "locked" && s.blockedBy);
        if (!nextLocked) return null;
        return (
          <div className="mt-3 text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-1.5 border border-border">
            <span className="font-medium text-foreground">Next: </span>
            {nextLocked.label} — {nextLocked.blockedBy}
          </div>
        );
      })()}
    </div>
  );
};
