import { memo } from "react";
// One activity as a ruled row of the register: name and status, where it is, a progress bar, engineers, dates and the
// timeline hint. A soft rule under each row; pressed, it washes blue.
import { Text, View } from "react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { StatusPill, displayStatus, STATUS_COLOR } from "@/components/StatusPill";
import { timelineMessage, type ActivityAssignment } from "@/api/cwdApi";
import { PriorityBadge } from "@/components/PriorityBadge";
import { Press } from "@/components/sheet/Sheet";
import { dependencyAutoName } from "@/utils/dependencyAutoName";

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");

function ActivityRowView({ a, onPress }: { a: ActivityAssignment; onPress: () => void }) {
  const shown = displayStatus(a.status, a.resumedAt);
  const pct = Math.max(0, Math.min(100, a.progressPercent ?? 0));
  const hint = timelineMessage(a);
  const autoName = dependencyAutoName({ flatName: a.flatName, alias: a.alias, roomName: a.roomName, storey: a.storey, activityName: a.activityName });
  return (
    <Press
      onPress={onPress}
      style={(pressed) => ({ paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : S.paper })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.semibold, color: S.ink }} numberOfLines={2}>
          {a.sequenceNo != null ? `${a.sequenceNo}. ` : ""}{a.activityName ?? "Activity"}
        </Text>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <StatusPill status={shown} />
          <PriorityBadge priority={a.priority} />
          {!!a.tagName && (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1.5, borderWidth: 1, borderColor: S.rule }}>
              <Text style={{ fontSize: 9, fontFamily: fonts.heading.semibold, letterSpacing: 0.8, textTransform: "uppercase", color: S.ink2 }}>{a.tagName}</Text>
            </View>
          )}
        </View>
      </View>
      {!!autoName && <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: S.blue, marginTop: 3 }} numberOfLines={2}>{autoName}</Text>}
      {!!a.scopePath && (
        <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: S.graphite, marginTop: 3 }} numberOfLines={2}>
          {[a.projectName, a.scopePath].filter(Boolean).join(" · ")}
        </Text>
      )}
      <View style={{ height: 6, backgroundColor: S.line15, marginTop: 10 }}>
        <View style={{ width: `${pct}%`, height: 6, backgroundColor: STATUS_COLOR[shown] ?? S.ink }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 7, gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 11.5, fontFamily: fonts.body.regular, color: S.ink2 }} numberOfLines={1}>{a.engineerNames || "No engineer"}</Text>
        <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.medium, color: S.graphite, fontVariant: ["tabular-nums"] }}>
          {pct}% · {fmtDate(a.startDate)} → {fmtDate(a.endDate)}
        </Text>
      </View>
      {!!hint && <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: S.blue, marginTop: 6 }}>{hint}</Text>}
    </Press>
  );
}

/** Memoised on the row's data: a list re-render (search, refetch of other rooms) doesn't redraw unchanged rows. */
export const ActivityRow = memo(ActivityRowView, (p, n) => p.a === n.a);
