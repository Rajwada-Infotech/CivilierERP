import { useMemo, useState } from "react";
import { FlatList, View, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getTaskPerformanceReport } from "@/api/followupApi";
import { Chip, Pill, QueryState, STATUS_COLOR, fmtDate } from "@/components/formKit";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const FILTERS = ["All", "Active", "Hold", "Closed", "Cancel"] as const;

export default function TaskPerformanceScreen() {
  const [f, setF] = useState<(typeof FILTERS)[number]>("All");
  const q = useQuery({ queryKey: ["task-performance"], queryFn: getTaskPerformanceReport });
  const rows = useMemo(() => (q.data ?? []).filter((r) => f === "All" || r.Status === f), [q.data, f]);
  const muted = { color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular } as const;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View className="flex-row flex-wrap px-4 pt-3">
        {FILTERS.map((x) => <Chip key={x} label={x} active={f === x} onPress={() => setF(x)} />)}
      </View>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} isEmpty={!rows.length} emptyLabel="No tasks" onRetry={() => q.refetch()}>
        <FlatList
          contentContainerStyle={{ padding: 16, paddingTop: 4 }}
          data={rows}
          keyExtractor={(r) => String(r.Id)}
          renderItem={({ item: r }) => (
            <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}cc`, borderWidth: 1, borderColor: `${colors.border}99` }}>
              <View className="flex-row items-center justify-between">
                <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{r.TaskNo}</Text>
                <Pill label={r.Status} color={STATUS_COLOR[r.Status] ?? colors.mutedForeground} />
              </View>
              <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular, marginTop: 3 }}>{r.Subject}</Text>
              <Text style={{ ...muted, marginTop: 4 }}>{r.FollowerName ?? "—"}{r.ProjectName ? ` · ${r.ProjectName}` : ""}</Text>
              <Text style={muted}>
                Due {fmtDate(r.TaskDueDate)} · {Math.round(Number(r.EffectiveProgress ?? r.Progress ?? 0))}% · {r.FollowUpAttendCount} follow-ups
                {r.DelayDays ? ` · ${r.DelayDays}d delay` : ""}
              </Text>
              {r.Tags?.length ? <Text style={muted}>Tags: {r.Tags.map((t) => t.Name).join(", ")}</Text> : null}
            </View>
          )}
        />
      </QueryState>
    </View>
  );
}
