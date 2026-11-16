// The dashboard's Time tracker: a ring that counts today's working time live, with Punch in (play), Take a break (pause)
// and Punch out (stop). Uses the same punch, camera + location capture and break rules as the Attendance page.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coffee, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { getPortalBreakTypes, getPortalPunchState, portalBreakStop, type PunchState } from "@/api/employeePortalApi";
import { CaptureDialog, place } from "./PunchCard";
import { StartDialog, fmtDur, useBreakReminder } from "./BreakPanel";
import { fmtTime } from "./employeeUi";

const TARGET_SEC = 8 * 3600; // a full working day, for the ring
const R = 68;
const CIRC = 2 * Math.PI * R;
const two = (n: number) => String(Math.floor(n)).padStart(2, "0");

export default function TimeTracker() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ["ep-punch"], queryFn: getPortalPunchState, refetchInterval: 60_000 });
  const [dialog, setDialog] = useState<"in" | "out" | "break" | null>(null);
  const cur = data?.current;
  const skewMs = data ? new Date(data.serverNow).getTime() - Date.now() : 0;
  const running = data?.state === "WORKING" || data?.state === "ON_BREAK";

  const types = useQuery({ queryKey: ["ep-break-types"], queryFn: getPortalBreakTypes, staleTime: 5 * 60_000, enabled: !!data?.allowed.breakStart });
  const setState = (s: PunchState) => { qc.setQueryData(["ep-punch"], s); qc.invalidateQueries({ queryKey: ["ep-attendance"] }); };
  const stop = useMutation({ mutationFn: portalBreakStop, onSuccess: setState, onError: (e: Error) => toast.error(e.message) });
  const done = () => { setDialog(null); qc.invalidateQueries({ queryKey: ["ep-punch"] }); qc.invalidateQueries({ queryKey: ["ep-attendance"] }); };

  // A second-by-second clock while the day is running.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const openBreak = cur?.breaks.find((b) => b.open);
  const { elapsed: breakElapsed, over } = useBreakReminder(openBreak, skewMs);

  // Working time so far: (now − In) less the deductible breaks (the running one counts too, unless it is official work).
  let workSec = 0;
  if (cur) {
    if (cur.outTime) workSec = cur.netSeconds ?? 0;
    else {
      const t = now + skewMs;
      const total = (t - new Date(cur.inTime).getTime()) / 1000;
      const runningDeduct = openBreak && openBreak.deduct ? (t - new Date(openBreak.start).getTime()) / 1000 : 0;
      workSec = Math.max(0, total - cur.breakSeconds - runningDeduct);
    }
  }
  const progress = Math.min(1, workSec / TARGET_SEC);
  const label = !cur ? "Not in yet" : cur.outTime ? "Day complete" : data?.state === "ON_BREAK" ? (over > 0 ? "Break over time" : "On break") : "Working";

  return (
    <section className="ep-card p-5 flex flex-col h-full" aria-label="Time tracker">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold">Time tracker</h2>
        <span className={`px-2.5 py-1 rounded-full text-[0.625rem] font-bold uppercase tracking-[0.08em] whitespace-nowrap ${over > 0 ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-muted text-muted-foreground"}`}>{label}</span>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground mt-6">Loading…</p> : isError ? <p className="text-sm text-destructive mt-6">{(error as Error).message}</p> : (
        <>
          <div className="relative mx-auto mt-3" style={{ width: 176, height: 176 }}>
            <svg viewBox="0 0 176 176" width="176" height="176" aria-hidden>
              <circle cx="88" cy="88" r="52" fill="none" stroke="hsl(var(--foreground) / .18)" strokeWidth="14" strokeDasharray="1.5 7" />
              <circle cx="88" cy="88" r={R} fill="none" stroke="hsl(var(--foreground) / .08)" strokeWidth="9" />
              <circle cx="88" cy="88" r={R} fill="none" stroke="hsl(var(--ep-gold))" strokeWidth="9" strokeLinecap="round"
                strokeDasharray={`${CIRC * progress} ${CIRC}`} transform="rotate(-90 88 88)" style={{ transition: "stroke-dasharray .6s ease" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="font-heading text-3xl font-bold tabular-nums leading-none">{two(workSec / 3600)}:{two((workSec % 3600) / 60)}<span className="text-base text-muted-foreground">:{two(workSec % 60)}</span></p>
              <p className="text-xs text-muted-foreground mt-1">Work time</p>
            </div>
          </div>

          {/* play / pause / stop */}
          <div className="flex items-center justify-center gap-3 mt-3">
            {data?.state === "ON_BREAK"
              ? <button className="ep-round ep-gold" onClick={() => stop.mutate()} disabled={stop.isPending} title="End break" aria-label="End break"><Play size={18} /></button>
              : <button className="ep-round ep-gold" onClick={() => setDialog("in")} disabled={!data?.allowed.in} title="Punch in" aria-label="Punch in"><Play size={18} /></button>}
            <button className="ep-round ep-ink" onClick={() => setDialog("break")} disabled={!data?.allowed.breakStart || !types.data?.length} title="Take a break" aria-label="Take a break"><Pause size={18} /></button>
            <button className="ep-round ep-ink" onClick={() => setDialog("out")} disabled={!data?.allowed.out} title="Punch out" aria-label="Punch out"><Square size={16} /></button>
          </div>
          <p className="text-center text-[0.6875rem] text-muted-foreground mt-1.5">
            {data?.state === "ON_BREAK" ? "Play ends your break" : data?.allowed.in ? "Play to punch in" : data?.allowed.out ? "Pause for a break · Stop to punch out" : "Today's attendance is complete"}
          </p>

          {openBreak && (
            <div className={`mt-3 rounded-2xl p-3 text-sm flex items-center justify-between gap-2 ${over > 0 ? "bg-red-500/10 border border-red-500/50" : "bg-muted/50"}`} role="status">
              <span className="flex items-center gap-2 min-w-0"><Coffee size={16} className="shrink-0" /><span className="truncate"><b>{openBreak.type}</b>{openBreak.allowedSeconds != null ? ` · ${fmtDur(openBreak.allowedSeconds)} allowed` : " · no limit"}</span></span>
              <span className="font-heading font-bold tabular-nums shrink-0">{two(breakElapsed / 60)}:{two(breakElapsed % 60)}{over > 0 && <span className="text-red-600 dark:text-red-400"> +{fmtDur(over)}</span>}</span>
            </div>
          )}

          <div className="mt-auto pt-4 grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">In</p><p className="font-heading font-bold tabular-nums">{cur ? fmtTime(cur.inTime) : "—"}</p><p className="text-[0.6875rem]">{place(cur?.inLocation ?? null)}</p></div>
            <div><p className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Out</p><p className="font-heading font-bold tabular-nums">{cur?.outTime ? fmtTime(cur.outTime) : "—"}</p><p className="text-[0.6875rem]">{place(cur?.outLocation ?? null)}</p></div>
            {cur && <p className="col-span-2 text-xs text-muted-foreground">Break {fmtDur(cur.breakSeconds)} · Official out {fmtDur(cur.officialSeconds)} · Extra <span className={cur.extraSeconds > 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}>{fmtDur(cur.extraSeconds)}</span></p>}
          </div>
        </>
      )}

      {(dialog === "in" || dialog === "out") && <CaptureDialog kind={dialog} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "break" && types.data && <StartDialog types={types.data} onClose={() => setDialog(null)} onStarted={(s) => { setDialog(null); setState(s); }} />}
    </section>
  );
}
