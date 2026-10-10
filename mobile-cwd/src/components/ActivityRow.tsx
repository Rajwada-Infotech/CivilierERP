import { memo } from "react";
// One activity as a card — name, status, location, progress bar, engineers, dates and the timeline hint.
import { Pressable, Text, View } from "react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { StatusPill, displayStatus, STATUS_COLOR } from "@/components/StatusPill";
import { timelineMessage, type ActivityAssignment } from "@/api/cwdApi";
import { PriorityBadge } from "@/components/PriorityBadge";
import { dependencyAutoName } from "@/utils/dependencyAutoName";

const ACCENT = "#0891b2";

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

function ActivityRowView({ a, onPress }: { a: ActivityAssignment; onPress: () => void }) {
  const shown = displayStatus(a.status, a.resumedAt);
  const pct = Math.max(0, Math.min(100, a.progressPercent ?? 0));
  const hint = timelineMessage(a);
  const autoName = dependencyAutoName({ flatName: a.flatName, alias: a.alias, roomName: a.roomName, storey: a.storey, activityName: a.activityName });
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }} numberOfLines={2}>
          {a.sequenceNo != null ? `${a.sequenceNo}. ` : ""}{a.activityName ?? "Activity"}
        </Text>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <StatusPill status={shown} />
          <PriorityBadge priority={a.priority} />
        </View>
      </View>
      {!!autoName && (
        <Text style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: ACCENT, marginTop: 3 }} numberOfLines={2}>{autoName}</Text>
      )}
      {!!a.scopePath && (
        <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 3 }} numberOfLines={2}>
          {[a.projectName, a.scopePath].filter(Boolean).join(" · ")}
        </Text>
      )}
      <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.muted, marginTop: 10, overflow: "hidden" }}>
        <View style={{ width: `${pct}%`, height: 5, borderRadius: 3, backgroundColor: STATUS_COLOR[shown] ?? ACCENT }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }} numberOfLines={1}>
          {a.engineerNames || "No engineer"}
        </Text>
        <Text style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>
          {pct}% · {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
        </Text>
      </View>
      {!!hint && <Text style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: ACCENT, marginTop: 6 }}>{hint}</Text>}
    </Pressable>
  );
}

/** Memoised on the row's data: a list re-render (search, refetch of other rooms) doesn't redraw unchanged rows. */
export const ActivityRow = memo(ActivityRowView, (p, n) => p.a === n.a);
