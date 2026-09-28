// Shared task list used by the Follow-Up screens (Follow-Up Board / Tasks /
// Task Master / Close Task / Cancelled Tasks). Pull-to-refresh, loading /
// error / empty states, and a tappable card per task — TaskNo, subject,
// assignee, due date, a priority pill and a progress bar. Tapping a card
// opens the task detail; `canCreate` adds a floating "New Task" button.
import { useState } from "react";
import { View, Text, FlatList, RefreshControl, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Plus } from "lucide-react-native";
import type { Task } from "@/api/followupApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { useModuleAccess } from "@/navigation/moduleAccess";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ACCENT, PRIORITY_COLOR, STATUS_COLOR, Pill, QueryState, fmtDate } from "@/components/formKit";

function TaskCard({ task, onPress }: { task: Task; onPress: () => void }) {
  const progress = Math.max(0, Math.min(100, Number(task.EffectiveProgress ?? task.Progress ?? 0)));
  const pColor = PRIORITY_COLOR[task.Priority ?? ""] ?? colors.mutedForeground;
  const overdue =
    !!task.DueDate && (task.Status === "Active" || task.Status === "Hold") && new Date(task.DueDate) < new Date(new Date().toDateString());
  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl p-3.5 mb-2.5"
      style={{ backgroundColor: `${colors.card}cc`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View className="flex-row items-center justify-between">
        <Text style={{ color: ACCENT, fontSize: 11, fontFamily: fonts.heading.semibold }}>{task.TaskNo}</Text>
        <View className="flex-row items-center gap-1.5">
          {task.Status && task.Status !== "Active" ? <Pill label={task.Status} color={STATUS_COLOR[task.Status] ?? colors.mutedForeground} /> : null}
          {task.Priority ? <Pill label={task.Priority} color={pColor} /> : null}
        </View>
      </View>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold, marginTop: 4 }}>
        {task.Subject}
      </Text>
      <View className="flex-row items-center justify-between mt-2">
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, flex: 1 }}>
          {task.AssigneeName ?? "Unassigned"}
          {task.CaseProjectName ? ` · ${task.CaseProjectName}` : ""}
        </Text>
        <Text style={{ color: overdue ? "#ef4444" : colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium }}>
          Due {fmtDate(task.DueDate)}
        </Text>
      </View>
      <View className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `${colors.muted}` }}>
        <View style={{ width: `${progress}%`, height: "100%", backgroundColor: ACCENT }} />
      </View>
    </Pressable>
  );
}

export function TaskList({
  queryKey,
  queryFn,
  emptyLabel = "No tasks",
  canCreate = false,
}: {
  queryKey: string;
  queryFn: () => Promise<Task[]>;
  emptyLabel?: string;
  canCreate?: boolean;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { privileged } = useModuleAccess();
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery<Task[]>({
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        isEmpty={!data?.length}
        emptyLabel={emptyLabel}
        onRetry={() => refetch()}
      >
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 96, flexGrow: 1 }}
          data={data ?? []}
          keyExtractor={(t) => String(t.Id)}
          renderItem={({ item }) => <TaskCard task={item} onPress={() => navigation.navigate("TaskDetail", { id: item.Id })} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        />
      </QueryState>
      {canCreate && privileged ? (
        <Pressable
          onPress={() => navigation.navigate("TaskForm")}
          className="absolute flex-row items-center gap-1.5 px-4 py-3 rounded-full"
          style={{ right: 16, bottom: 24, backgroundColor: ACCENT }}
        >
          <Plus size={18} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>New Task</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
