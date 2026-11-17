// Breaks on the Employee Portal's Today card: start a break for a reason (Break / Meeting at other office / Other reason
// with a note), a live timer with the allowed time, a reminder when the allowance runs out, and the day's breaks with
// their totals. A meeting at another office is official work, so it isn't taken off working time; the other reasons are.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlarmClock, Coffee, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { getPortalBreakTypes, portalBreakStart, portalBreakStop, type BreakType, type PunchBreak, type PunchState } from "@/api/employeePortalApi";
import { BodyPortal } from "@/components/ui/body-portal";
import { fieldCls, fmtTime, isViewOnly, keyInk, keyLine, labelCls } from "./employeeUi";

export const fmtDur = (sec: number | null | undefined) => {
  const s = Math.max(0, Math.round(sec ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`;
};
const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const ruleText = (t: BreakType) =>
  `${t.deduct ? "Taken off working time" : "Counts as work"}${t.allowedMinutes != null ? ` · ${t.allowedMinutes} min allowed` : " · no limit"}`;

export function StartDialog({ types, onClose, onStarted }: { types: BreakType[]; onClose: () => void; onStarted: (s: PunchState) => void }) {
  const [type, setType] = useState(types[0]?.type ?? "Break");
  const [note, setNote] = useState("");
  const rule = types.find((t) => t.type === type);
  const start = useMutation({
    mutationFn: () => portalBreakStart(type, note),
    onSuccess: (s) => {
      // Ask once for permission so the extra-time reminder can reach the employee even from another tab.
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
      onStarted(s);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const ok = !!rule && (!rule.requiresNote || note.trim().length >= 3);
  return (
    <BodyPortal>
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Start a break">
      <div className="w-full max-w-md max-h-[calc(100vh-1.5rem)] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl">
        <div className="px-4 py-3 border-b border-border"><h2 className="font-heading text-sm font-bold">Start a break</h2></div>
        <div className="p-4 space-y-3">
          <div className="space-y-2" role="radiogroup" aria-label="Reason">
            {types.map((t) => (
              <label key={t.type} className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer ${type === t.type ? "border-[hsl(var(--ep-gold))] bg-[hsl(var(--ep-gold)/0.08)]" : "border-border"}`}>
                <input type="radio" name="break-type" className="mt-1" checked={type === t.type} onChange={() => setType(t.type)} />
                <span><span className="block text-sm font-medium">{t.type}</span><span className="block text-xs text-muted-foreground">{ruleText(t)}</span></span>
              </label>
            ))}
          </div>
          <div>
            <label className={labelCls} htmlFor="brk-note">{rule?.requiresNote ? "Reason (required)" : "Note (optional)"}</label>
            <textarea id="brk-note" rows={2} maxLength={300} className={`${fieldCls} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={type === "Meeting at other office" ? "Which office / who you are meeting" : "e.g. Bank work"} />
          </div>
          <div className="flex justify-end gap-2">
            <button className={keyLine} onClick={onClose}>Cancel</button>
            <button className={keyInk} disabled={!ok || start.isPending} onClick={() => start.mutate()}><Play size={13} /> {start.isPending ? "Starting…" : "Start"}</button>
          </div>
        </div>
      </div>
    </div>
    </BodyPortal>
  );
}

/** Live timer for the running break and the reminder when its allowance is used up (then again every 10 minutes). */
export function useBreakReminder(open: PunchBreak | undefined, skewMs: number) {
  const [now, setNow] = useState(() => Date.now() + skewMs);
  const reminded = useRef<number>(-1);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now() + skewMs), 1000);
    return () => clearInterval(t);
  }, [open, skewMs]);

  const elapsed = open ? (now - new Date(open.start).getTime()) / 1000 : 0;
  const over = open && open.allowedSeconds != null ? Math.max(0, elapsed - open.allowedSeconds) : 0;
  useEffect(() => {
    if (!open || open.allowedSeconds == null || over <= 0) { reminded.current = -1; return; }
    const step = Math.floor(over / 600); // 0 the moment the limit passes, then every 10 minutes
    if (step === reminded.current) return;
    reminded.current = step;
    const text = step === 0 ? `Your ${open.type.toLowerCase()} allowance of ${fmtDur(open.allowedSeconds)} is over. Please end your break.` : `You are ${fmtDur(over)} over your allowed break time. Please end your break.`;
    toast.warning(text, { duration: 15000 });
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Break time is over", { body: text });
  }, [open, over]);
  return { elapsed, over };
}

export default function BreakPanel({ state, onChange }: { state: PunchState; onChange: (s: PunchState) => void }) {
  const cur = state.current;
  const [starting, setStarting] = useState(false);
  const types = useQuery({ queryKey: ["ep-break-types"], queryFn: getPortalBreakTypes, staleTime: 5 * 60_000, enabled: state.allowed.breakStart });
  const stop = useMutation({ mutationFn: portalBreakStop, onSuccess: onChange, onError: (e: Error) => toast.error(e.message) });

  const openBreak = cur?.breaks.find((b) => b.open);
  const skewMs = new Date(state.serverNow).getTime() - Date.now();
  const { elapsed, over } = useBreakReminder(openBreak, skewMs);
  if (!cur) {
    // Not punched in yet: the button is shown so it can be found, but a break can only start during a working day.
    return (
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Breaks, meetings at another office and other reasons are tracked once you punch in.</p>
        <button className={keyLine} disabled title="Punch in first"><Coffee size={13} /> Take a break</button>
      </div>
    );
  }

  const finished = cur.breaks.filter((b) => !b.open);
  return (
    <div className="px-4 py-3 space-y-3">
      {openBreak && (
        <div className={`flex flex-wrap items-center justify-between gap-3 p-3 border rounded-xl ${over > 0 ? "border-red-500/60 bg-red-500/10" : "border-border bg-muted/30"}`} role="status">
          <div className="flex items-center gap-3">
            {over > 0 ? <AlarmClock size={20} className="text-red-600 dark:text-red-400" /> : <Coffee size={20} />}
            <div>
              <p className="text-sm font-medium">{openBreak.type}{openBreak.note ? ` — ${openBreak.note}` : ""}</p>
              <p className="text-xs text-muted-foreground">
                {openBreak.allowedSeconds != null ? `${fmtDur(openBreak.allowedSeconds)} allowed` : "No time limit"}{!openBreak.deduct ? " · counts as work" : ""}
                {over > 0 && <span className="text-red-600 dark:text-red-400 font-semibold"> · {fmtDur(over)} extra</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-heading text-2xl font-bold tabular-nums">{clock(elapsed)}</span>
            <button className={keyInk} onClick={() => stop.mutate()} disabled={stop.isPending || isViewOnly()}><Pause size={13} /> {stop.isPending ? "Ending…" : "End break"}</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div><p className={labelCls}>Break time</p><p className="font-heading font-bold tabular-nums">{fmtDur(cur.breakSeconds)}</p></div>
          <div><p className={labelCls}>Official work out</p><p className="font-heading font-bold tabular-nums">{fmtDur(cur.officialSeconds)}</p></div>
          <div><p className={labelCls}>Extra time</p><p className={`font-heading font-bold tabular-nums ${cur.extraSeconds > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmtDur(cur.extraSeconds)}</p></div>
          {cur.netSeconds != null && <div><p className={labelCls}>Net working</p><p className="font-heading font-bold tabular-nums">{fmtDur(cur.netSeconds)}</p></div>}
        </div>
        {state.allowed.breakStart && <button className={keyLine} onClick={() => setStarting(true)} disabled={!types.data?.length || isViewOnly()}><Coffee size={13} /> Take a break</button>}
      </div>

      {finished.length > 0 && (
        <ul className="divide-y divide-border text-sm border border-border rounded-xl overflow-hidden">
          {finished.map((b) => (
            <li key={b.breakId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><span className="font-medium">{b.type}</span>{b.note ? <span className="text-muted-foreground"> — {b.note}</span> : null}
                <span className="text-muted-foreground tabular-nums"> · {fmtTime(b.start)}–{fmtTime(b.end)}</span></span>
              <span className="tabular-nums">{fmtDur(b.seconds)}{!b.deduct && <span className="text-muted-foreground"> (work)</span>}
                {b.overSeconds > 0 && <span className="text-red-600 dark:text-red-400 font-semibold"> · {fmtDur(b.overSeconds)} extra</span>}</span>
            </li>
          ))}
        </ul>
      )}

      {starting && types.data && <StartDialog types={types.data} onClose={() => setStarting(false)} onStarted={(s) => { setStarting(false); onChange(s); }} />}
    </div>
  );
}
