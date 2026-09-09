// Shared task list used by the Follow-Up screens (Tasks / Close Task /
// Cancelled Tasks). Pull-to-refresh, loading / error / empty states, and a
// compact card per task — TaskNo, subject, assignee, due date, a priority
// pill and a progress bar.
import { useState } from "react";
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Inbox } from "lucide-react-native";
import type { Task } from "@/api/followupApi";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ACCENT = moduleAccents.followup;

const PRIORITY_COLOR: Record<string, string> = {
  High: "#ef4444",
  Medium: "#f59e0b",
  Low: "#10b981",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function TaskCard({ task }: { task: Task }) {
  const progress = Math.max(0, Math.min(100, Number(task.EffectiveProgress ?? task.Progress ?? 0)));
  const pColor = PRIORITY_COLOR[task.Priority ?? ""] ?? colors.mutedForeground;
  return (
    <View
      className="rounded-2xl p-3.5 mb-2.5"
      style={{ backgroundColor: `${colors.card}cc`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View className="flex-row items-center justify-between">
        <Text style={{ color: ACCENT, fontSize: 11, fontFamily: fonts.heading.semibold }}>{task.TaskNo}</Text>
        {task.Priority ? (
          <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${pColor}22` }}>
            <Text style={{ color: pColor, fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {task.Priority}
            </Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold, marginTop: 4 }}>
        {task.Subject}
      </Text>
      <View className="flex-row items-center justify-between mt-2">
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, flex: 1 }}>
          {task.AssigneeName ?? "Unassigned"}
          {task.CaseProjectName ? ` · ${task.CaseProjectName}` : ""}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium }}>
          Due {fmtDate(task.DueDate)}
        </Text>
      </View>
      <View className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `${colors.muted}` }}>
        <View style={{ width: `${progress}%`, height: "100%", backgroundColor: ACCENT }} />
      </View>
    </View>
  );
}

export function TaskList({
  queryKey,
  queryFn,
  emptyLabel = "No tasks",
}: {
  queryKey: string;
  queryFn: () => Promise<Task[]>;
  emptyLabel?: string;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery<Task[]>({
    queryKey: [queryKey],
    queryFn,
    staleTime: 60 * 1000,
    retry: 2,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center gap-2 px-8" style={{ backgroundColor: colors.background }}>
        <AlertCircle size={22} color={colors.destructive} />
        <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: fonts.body.medium }}>Could not load tasks.</Text>
        <Pressable onPress={() => refetch()} className="mt-2 px-4 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
      data={data ?? []}
      keyExtractor={(t) => String(t.Id)}
      renderItem={({ item }) => <TaskCard task={item} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
      ListEmptyComponent={
        <View className="flex-1 items-center justify-center gap-2 py-24">
          <Inbox size={26} color={`${colors.mutedForeground}66`} />
          <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.regular }}>{emptyLabel}</Text>
        </View>
      }
    />
  );
}
