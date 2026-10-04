import { useMemo } from "react";
import { FlatList, View, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getTaskPerformanceReport } from "@/api/followupApi";
import { ACCENT, QueryState } from "@/components/formKit";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

interface TagRow { tag: string; total: number; completed: number; pending: number; ongoing: number; overdue: number; avg: number }

export default function TagPerformanceScreen() {
  const q = useQuery({ queryKey: ["task-performance"], queryFn: getTaskPerformanceReport });
  const rows = useMemo<TagRow[]>(() => {
    const m = new Map<string, { total: number; completed: number; pending: number; ongoing: number; overdue: number; sum: number }>();
    const today = new Date(new Date().toDateString());
    for (const r of q.data ?? []) {
      const prog = Number(r.EffectiveProgress ?? r.Progress ?? 0);
      const tags = r.Tags?.length ? r.Tags.map((t) => t.Name) : ["(Untagged)"];
      for (const name of tags) {
        const a = m.get(name) ?? { total: 0, completed: 0, pending: 0, ongoing: 0, overdue: 0, sum: 0 };
        a.total++;
        a.sum += prog;
        if (r.Status === "Closed") a.completed++;
        else if (r.Status === "Active" || r.Status === "Hold") {
          if (prog > 0) a.ongoing++; else a.pending++;
          if (r.TaskDueDate && new Date(r.TaskDueDate) < today) a.overdue++;
        }
        m.set(name, a);
      }
    }
    return [...m.entries()]
      .map(([tag, a]) => ({ tag, total: a.total, completed: a.completed, pending: a.pending, ongoing: a.ongoing, overdue: a.overdue, avg: a.total ? a.sum / a.total : 0 }))
      .sort((x, y) => y.total - x.total);
  }, [q.data]);

  const stat = (label: string, v: number | string, color: string = colors.foreground) => (
    <View style={{ flex: 1 }}>
      <Text style={{ color, fontSize: 15, fontFamily: fonts.heading.bold }}>{v}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>{label}</Text>
    </View>
  );

  return (
    <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} isEmpty={!rows.length} emptyLabel="No tagged tasks" onRetry={() => q.refetch()}>
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 16 }}
        data={rows}
        keyExtractor={(r) => r.tag}
        renderItem={({ item: r }) => (
          <View className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}cc`, borderWidth: 1, borderColor: `${colors.border}99` }}>
            <Text style={{ color: ACCENT, fontSize: 13, fontFamily: fonts.heading.semibold, marginBottom: 8 }}>{r.tag}</Text>
            <View className="flex-row">
              {stat("Total", r.total)}
              {stat("Done", r.completed, "#3b82f6")}
              {stat("Ongoing", r.ongoing, ACCENT)}
              {stat("Pending", r.pending, "#f59e0b")}
              {stat("Overdue", r.overdue, "#ef4444")}
            </View>
            <View className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.muted }}>
              <View style={{ width: `${Math.round(r.avg)}%`, height: "100%", backgroundColor: ACCENT }} />
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 3 }}>
              Avg progress {Math.round(r.avg)}% · Completion {r.total ? Math.round((r.completed / r.total) * 100) : 0}%
            </Text>
          </View>
        )}
      />
    </QueryState>
  );
}
