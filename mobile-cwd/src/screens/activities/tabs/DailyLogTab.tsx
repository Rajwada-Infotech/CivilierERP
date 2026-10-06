// The logbook: one entry per day this activity was reported on, newest first — progress moved, every update
// and remark of the day, and that day's Before / After photos (fetched only when the day is opened).
import { useMemo, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronRight, Trash2, TrendingUp } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { deleteDailyLogEntry, getActivityPhotos, getDailyLog, getProgressLog, type ActivityPhotoMeta, type DailyLogEntry, type ProgressLogEntry } from "@/api/cwdApi";
import { PhotoThumb, PhotoViewer } from "./PhotosTab";
import { ACCENT, Empty, ErrorText, Loading, card, fmtClock, fmtDay, todayYmd } from "./ui";

const RECENT_OPEN = 5;
const dayKey = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

function DayPhotos({ rungId, logDate }: { rungId: number; logDate: string }) {
  const [open, setOpen] = useState<ActivityPhotoMeta | null>(null);
  const q = useQuery({ queryKey: ["cwd-day-photos", rungId, logDate], queryFn: () => getActivityPhotos(rungId, logDate) });
  if (q.isLoading) return <Loading />;
  const data = q.data;
  if (!data || data.before.length + data.after.length === 0) return <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>No photos logged this day</Text>;
  return (
    <View style={{ gap: 10 }}>
      {([["Before", data.before], ["After", data.after]] as const).map(([label, photos]) => (
        <View key={label}>
          <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label} · {photos.length}</Text>
          {photos.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {photos.map((p) => <PhotoThumb key={p.id} rungId={rungId} photo={p} onOpen={() => setOpen(p)} />)}
            </View>
          )}
        </View>
      ))}
      <PhotoViewer rungId={rungId} photo={open} onClose={() => setOpen(null)} />
    </View>
  );
}

export function DailyLogTab({ rungId, canEdit }: { rungId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const logQ = useQuery({ queryKey: ["cwd-daily-log", rungId], queryFn: () => getDailyLog(rungId) });
  const progQ = useQuery({ queryKey: ["cwd-log", rungId], queryFn: () => getProgressLog(rungId) });
  const [openSet, setOpenSet] = useState<Set<string> | null>(null); // null = the most recent days open

  const updatesByDay = useMemo(() => {
    const m = new Map<string, ProgressLogEntry[]>();
    [...(progQ.data ?? [])].reverse().forEach((e) => { const k = dayKey(e.loggedAt); m.set(k, [...(m.get(k) ?? []), e]); });
    return m;
  }, [progQ.data]);

  const remove = useMutation({
    mutationFn: (e: DailyLogEntry) => deleteDailyLogEntry(rungId, e.id),
    onSuccess: () => { toast.success("Daily log entry deleted"); qc.invalidateQueries({ queryKey: ["cwd-daily-log", rungId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (logQ.isLoading) return <Loading />;
  if (logQ.error) return <ErrorText error={logQ.error} />;
  const entries = logQ.data ?? [];
  if (!entries.length) return <Empty text="No daily entries yet — saving progress or a remark today creates one." />;

  const today = todayYmd();
  const isOpen = (e: DailyLogEntry, i: number) => (openSet ? openSet.has(dayKey(e.logDate)) : i < RECENT_OPEN);
  const toggle = (e: DailyLogEntry, i: number) => {
    const next = new Set(openSet ?? entries.filter((_x, j) => j < RECENT_OPEN).map((x) => dayKey(x.logDate)));
    const k = dayKey(e.logDate);
    if (isOpen(e, i)) next.delete(k); else next.add(k);
    setOpenSet(next);
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>{entries.length} day{entries.length === 1 ? "" : "s"} logged</Text>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <TouchableOpacity onPress={() => setOpenSet(new Set(entries.map((e) => dayKey(e.logDate))))}><Text style={{ fontSize: 11, color: ACCENT, fontFamily: fonts.heading.semibold }}>Expand all</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setOpenSet(new Set())}><Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: fonts.heading.semibold }}>Collapse all</Text></TouchableOpacity>
        </View>
      </View>

      {entries.map((e, i) => {
        const key = dayKey(e.logDate);
        const open = isOpen(e, i);
        const updates = updatesByDay.get(key) ?? [];
        const before = entries[i + 1]?.progressPercent ?? 0; // previous logged day (newest first)
        const after = e.progressPercent;
        const moved = after != null ? after - before : null;
        return (
          <View key={e.id} style={{ ...card, padding: 0, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => toggle(e, i)} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
                <ChevronRight size={14} color={colors.mutedForeground} style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{fmtDay(key)}{key === today ? "  ·  Today" : ""}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 3 }}>
                    {after != null && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <TrendingUp size={11} color={colors.mutedForeground} />
                        <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: colors.foreground }}>{moved ? `${before}% → ${after}%` : `${after}%`}</Text>
                        {moved ? <Text style={{ fontSize: 11, color: moved > 0 ? "#10b981" : "#f59e0b", fontFamily: fonts.body.medium }}>({moved > 0 ? "+" : ""}{moved})</Text> : <Text style={{ fontSize: 11, color: colors.mutedForeground }}>no change</Text>}
                      </View>
                    )}
                    {e.photoCount > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                        <Camera size={11} color={colors.mutedForeground} />
                        <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>{e.photoCount}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
              {canEdit && (
                <TouchableOpacity
                  onPress={() => Alert.alert("Delete this daily log entry?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate(e) }])}
                  style={{ padding: 12 }}
                >
                  <Trash2 size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>

            {open && (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: 12 }}>
                <View style={{ gap: 8 }}>
                  <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1 }}>Updates</Text>
                  {updates.length > 0 ? updates.map((u) => (
                    <View key={u.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                        <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: colors.foreground }}>
                          {u.fromProgressPercent != null && u.toProgressPercent != null ? `${u.fromProgressPercent}% → ${u.toProgressPercent}%` : "Remark"}
                        </Text>
                        <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>{fmtClock(u.loggedAt)}{u.loggedBy ? ` · ${u.loggedBy}` : ""}</Text>
                      </View>
                      {!!u.remarks && <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: fonts.body.regular, marginTop: 4 }}>{u.remarks}</Text>}
                    </View>
                  )) : e.remarks ? (
                    <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: fonts.body.regular }}>{e.remarks}</Text>
                  ) : (
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>No remarks or progress changes recorded</Text>
                  )}
                </View>
                <DayPhotos rungId={rungId} logDate={key} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
