import { FlatList, View, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getEntryTypeDocReport } from "@/api/followupApi";
import { ACCENT, Pill, QueryState, STATUS_COLOR, fmtDate } from "@/components/formKit";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export default function EntryTypeDocReportScreen() {
  const q = useQuery({ queryKey: ["entry-type-doc-report"], queryFn: getEntryTypeDocReport });
  const muted = { color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular } as const;
  return (
    <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} isEmpty={!q.data?.length} emptyLabel="No follow-ups" onRetry={() => q.refetch()}>
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 16 }}
        data={q.data ?? []}
        keyExtractor={(r) => String(r.FollowUpId)}
        renderItem={({ item: r }) => (
          <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}cc`, borderWidth: 1, borderColor: `${colors.border}99` }}>
            <View className="flex-row items-center justify-between">
              <Text style={{ color: ACCENT, fontSize: 12, fontFamily: fonts.heading.semibold }}>{r.EntryTypeLabel ?? "—"} · {r.DocumentLabel ?? r.DocumentId}</Text>
              <Pill label={r.TaskStatus} color={STATUS_COLOR[r.TaskStatus] ?? colors.mutedForeground} />
            </View>
            <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular, marginTop: 3 }}>{r.Subject}</Text>
            <Text style={{ ...muted, marginTop: 4 }}>
              {r.FollowUpUserName ?? "—"} · {fmtDate(r.FollowUpDate, true)}{r.ProjectName ? ` · ${r.ProjectName}` : ""}
            </Text>
          </View>
        )}
      />
    </QueryState>
  );
}
