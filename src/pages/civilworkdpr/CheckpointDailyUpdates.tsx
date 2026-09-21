import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, CalendarDays, Check, Loader2, Trash2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  deleteCheckpointUpdate,
  fetchCheckpointUpdatePhoto,
  getCheckpointUpdates,
  saveCheckpointUpdate,
  type CheckpointUpdate,
} from "@/api/dependencyActivityAssignmentApi";
import { CameraCaptureDialog } from "./CameraCaptureDialog";

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar date as YYYY-MM-DD (never via toISOString — that shifts the day in IST). */
export const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmt = (s: string) => fromYmd(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function UpdatePhoto({ update }: { update: CheckpointUpdate }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    if (!update.hasPhoto) return;
    fetchCheckpointUpdatePhoto(update.id)
      .then((u) => {
        if (cancelled) URL.revokeObjectURL(u);
        else {
          revoked = u;
          setUrl(u);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [update.id, update.hasPhoto]);
  if (!update.hasPhoto) return null;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={`Update for ${update.date}`} className="h-14 w-20 rounded-md object-cover border border-border" />
    </a>
  ) : (
    <div className="h-14 w-20 rounded-md border border-border bg-muted/40 animate-pulse" />
  );
}

/**
 * Daily-update control for a checkpoint flagged "daily" in Work Checkpoint Master:
 * a calendar dropdown (days with an update are marked) plus a live-camera button
 * that logs the photo against the chosen date. Everything saves immediately.
 */
export function CheckpointDailyUpdates({
  checkpointId,
  startDate,
}: {
  /** Row id of the saved checkpoint; undefined until the assignment has been saved. */
  checkpointId?: number;
  startDate?: string;
}) {
  const qc = useQueryClient();
  const today = useMemo(() => toYmd(new Date()), []);
  const [date, setDate] = useState(today);
  const [calOpen, setCalOpen] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [note, setNote] = useState("");

  const key = ["checkpoint-updates", checkpointId];
  const { data: updates = [] } = useQuery({
    queryKey: key,
    queryFn: () => getCheckpointUpdates(checkpointId as number),
    enabled: !!checkpointId,
  });
  const byDate = useMemo(() => new Map(updates.map((u) => [u.date, u])), [updates]);
  const current = byDate.get(date);
  const logged = useMemo(() => updates.map((u) => fromYmd(u.date)), [updates]);

  const save = useMutation({
    mutationFn: (photo: Blob) => saveCheckpointUpdate(checkpointId as number, { date, photo, note: note.trim() || undefined }),
    onSuccess: (r) => {
      toast.success(r.replaced ? `Photo for ${fmt(date)} replaced` : `Update for ${fmt(date)} saved`);
      setCamOpen(false);
      setNote("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteCheckpointUpdate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!checkpointId) {
    return (
      <p className="text-[11px] text-muted-foreground italic">Save the allocation, then reopen it — you can then log a daily photo update here.</p>
    );
  }

  return (
    <div className="mt-1.5 rounded-lg border border-dashed border-cyan-500/30 bg-cyan-500/5 p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-cyan-500/50"
              aria-label="Choose update date"
            >
              <CalendarDays size={12} className="text-cyan-600 dark:text-cyan-400" />
              {date === today ? "Today · " : ""}
              {fmt(date)}
              {current && <Check size={11} className="text-emerald-500" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0 z-[1001]">
            <Calendar
              mode="single"
              selected={fromYmd(date)}
              onSelect={(d) => {
                if (d) {
                  setDate(toYmd(d));
                  setCalOpen(false);
                }
              }}
              disabled={(d) => toYmd(d) > today || (!!startDate && toYmd(d) < startDate.slice(0, 10))}
              modifiers={{ logged }}
              modifiersClassNames={{ logged: "[&_button]:bg-emerald-500/20 [&_button]:font-semibold [&_button]:text-emerald-700 dark:[&_button]:text-emerald-300" }}
              defaultMonth={fromYmd(date)}
            />
            <p className="px-3 pb-2 text-[10px] text-muted-foreground">Green days already have an update.</p>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => setCamOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
          title={current ? "Retake today's photo" : "Take a photo now"}
        >
          <Camera size={12} /> {current?.hasPhoto ? "Retake" : "Take photo"}
        </button>

        <span className="text-[11px] text-muted-foreground ml-auto">
          {updates.length === 0 ? "No updates yet" : `${updates.length} day${updates.length === 1 ? "" : "s"} logged`}
        </span>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Note for this photo (optional)"
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
      />

      {current && (
        <div className="flex items-center gap-2.5">
          <UpdatePhoto update={current} />
          <div className="flex-1 min-w-0 text-[11px] text-muted-foreground">
            <p className="text-foreground font-medium">{fmt(current.date)}</p>
            {current.note && <p className="truncate">{current.note}</p>}
            {current.createdBy && <p className="truncate">by {current.createdBy}</p>}
          </div>
          <button
            type="button"
            onClick={() => remove.mutate(current.id)}
            disabled={remove.isPending}
            className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
            title="Remove this day's update"
          >
            {remove.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        </div>
      )}

      <CameraCaptureDialog
        open={camOpen}
        title={`Photo for ${fmt(date)}`}
        saving={save.isPending}
        onCancel={() => setCamOpen(false)}
        onConfirm={(photo) => save.mutate(photo)}
      />
    </div>
  );
}
