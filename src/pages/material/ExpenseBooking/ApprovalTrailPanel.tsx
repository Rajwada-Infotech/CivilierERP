import React from "react";
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Shield,
} from "lucide-react";
import type { ApprovalTrail } from "./types";

interface Props {
  trail: ApprovalTrail | undefined;
  currentStatus: string;
}

export function ApprovalTrailPanel({ trail, currentStatus }: Props) {
  if (!trail || trail.steps.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
        <AlertCircle size={13} />
        No approval workflow configured for this module.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground">
          Approval Levels
        </p>
        <span
          className={
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-heading " +
            (currentStatus === "Approved"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : currentStatus === "Rejected"
                ? "bg-red-50 text-red-700 border-red-200"
                : currentStatus === "Pending"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-slate-100 text-slate-600 border-slate-200")
          }
        >
          {currentStatus}
        </span>
      </div>

      <ol className="relative space-y-0">
        {trail.steps.map((step, idx) => {
          const isActive = step.level === trail.currentLevel;
          const isDone = step.status === "Approved";
          const isRejected = step.status === "Rejected";

          return (
            <li key={step.level} className="flex gap-3">
              {/* Connector line */}
              <div className="flex flex-col items-center">
                <div
                  className={
                    "flex items-center justify-center w-7 h-7 rounded-full border-2 shrink-0 z-10 " +
                    (isDone
                      ? "border-emerald-500 bg-emerald-50"
                      : isRejected
                        ? "border-red-400 bg-red-50"
                        : isActive
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-border bg-muted/40")
                  }
                >
                  {isDone ? (
                    <CheckCircle2 size={13} className="text-emerald-600" />
                  ) : isRejected ? (
                    <XCircle size={13} className="text-red-500" />
                  ) : isActive ? (
                    <Clock size={13} className="text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Shield size={13} className="text-muted-foreground/50" />
                  )}
                </div>
                {idx < trail.steps.length - 1 && (
                  <div
                    className={
                      "w-px flex-1 mt-0.5 mb-0.5 " +
                      (isDone ? "bg-emerald-300" : "bg-border")
                    }
                    style={{ minHeight: 18 }}
                  />
                )}
              </div>

              {/* Content */}
              <div className="pb-3 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p
                    className={
                      "text-xs font-heading font-semibold " +
                      (isDone
                        ? "text-emerald-700"
                        : isRejected
                          ? "text-red-600"
                          : isActive
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground")
                    }
                  >
                    Level {step.level} — {step.role}
                  </p>
                  {isActive && (
                    <span className="text-[10px] rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 font-heading">
                      Current
                    </span>
                  )}
                </div>
                {step.approverEmail && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {step.approverEmail}
                  </p>
                )}
                {step.actionAt && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                    {new Date(step.actionAt).toLocaleString("en-IN")}
                  </p>
                )}
                {step.note && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 italic border-l-2 border-muted pl-2">
                    "{step.note}"
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
