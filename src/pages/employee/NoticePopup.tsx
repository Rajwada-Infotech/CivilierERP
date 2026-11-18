// Employee Portal (web): a new notice from HR pops up with a short chime. "Got it" marks it read; "Later" hides it for
// this browser session (it stays unread on the Dashboard / Notices). Checked every minute.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { getMyNotices, markNoticeRead, type MyNotice } from "@/api/employeeNoticeApi";
import { fmtDate, isViewOnly, keyInk, keyLine } from "./employeeUi";

const SEEN_KEY = "ep_notice_seen";
const seenIds = (): number[] => { try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; } };
const addSeen = (id: number) => { try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seenIds(), id])])); } catch { /* storage off */ } };

/** Two short tones made by the browser (no sound file). Browsers may block it until the page has been clicked once. */
function chime(important: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tones = important ? [880, 1320, 880, 1320] : [880, 1320];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.start(t); o.stop(t + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), tones.length * 200 + 200);
  } catch { /* no sound available */ }
}

export default function NoticePopup() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["ep-notices"], queryFn: getMyNotices, staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const read = useMutation({ mutationFn: markNoticeRead, onSuccess: () => qc.invalidateQueries({ queryKey: ["ep-notices"] }) });
  const [current, setCurrent] = useState<MyNotice | null>(null);
  const shown = useRef(new Set<number>(seenIds()));

  useEffect(() => {
    if (current || isViewOnly()) return;
    const next = (data ?? []).find((n) => !n.IsRead && !shown.current.has(n.NoticeId));
    if (!next) return;
    shown.current.add(next.NoticeId); addSeen(next.NoticeId);
    setCurrent(next);
    chime(next.Priority === "Important");
  }, [data, current]);

  if (!current) return null;
  const important = current.Priority === "Important";
  const close = (markRead: boolean) => { if (markRead) read.mutate(current.NoticeId); setCurrent(null); };
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[120] bg-black/55 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={current.Title}
        onKeyDown={(e) => { if (e.key === "Escape") close(false); }}>
        <div className={`ep-card w-full max-w-lg overflow-hidden shadow-2xl border-t-[6px] ${important ? "border-t-red-500" : "border-t-[hsl(var(--ep-gold))]"}`}>
          <div className="px-6 pt-5 pb-4 space-y-2">
            <p className={`flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.14em] ${important ? "text-red-600" : "text-muted-foreground"}`}>
              <Megaphone size={14} className={important ? "animate-pulse" : ""} /> {important ? "Important notice" : "New notice"}
            </p>
            <h2 className="font-heading text-2xl font-bold leading-tight">{current.Title}</h2>
            <p className="text-xs text-muted-foreground">{fmtDate(current.PublishFrom)} · {current.ForWhom} · {current.PostedBy ?? "HR"}</p>
          </div>
          <div className="px-6 pb-5 max-h-[50vh] overflow-y-auto"><p className="text-sm leading-relaxed whitespace-pre-wrap">{current.Body}</p></div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-foreground/10">
            <button className={keyLine} onClick={() => close(false)}>Later</button>
            <button className={keyInk} onClick={() => close(true)} autoFocus>Got it</button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}
