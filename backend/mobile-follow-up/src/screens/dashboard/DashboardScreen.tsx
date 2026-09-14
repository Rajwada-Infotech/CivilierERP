// Landing screen for the Follow-Up app. Shows a quick task snapshot (from
// /api/task-master/followup-board) plus shortcuts into each Follow-Up
// section. Deliberately lean — the module's real screens live behind these
// cards and get built out one at a time (same approach mobile-maintenance
// started with).
import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, AlertCircle, ListChecks, ClipboardList, CheckCircle2, XCircle,
  ArrowLeftRight, BarChart3, Tag, FileText, MessageSquareX, Repeat,
  Clock, ChevronRight, ShieldCheck, Users,
} from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { useAuth } from "@/auth/AuthContext";
import { useModuleAccess } from "@/navigation/moduleAccess";
import { getFollowUpBoard, type Task } from "@/api/followupApi";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { GradientText } from "@/components/GradientText";
import { SectionLabel } from "@/components/home/SectionLabel";
import { FadeSlideIn } from "@/components/FadeSlideIn";

const ACCENT = moduleAccents.followup;

function isOverdue(t: Task) {
  const d = t.NextFollowUpAt ?? t.DueDate;
  return d ? new Date(d).getTime() < Date.now() : false;
}
function isDueToday(t: Task) {
  const d = t.NextFollowUpAt ?? t.DueDate;
  if (!d) return false;
  const dt = new Date(d);
  const now = new Date();
  return dt.toDateString() === now.toDateString();
}

type Shortcut = {
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  nav: keyof MainStackParamList;
};

// Same three groups the nav menu (NavSheet) shows — Transactions / Reports /
// Setup — surfaced on the landing screen so every Follow-Up destination is
// visible without opening the menu.
const GROUPS: Array<{ label: string; items: Shortcut[] }> = [
  {
    label: "Transactions",
    items: [
      { label: "Follow-Up Board", icon: ListChecks, nav: "FollowUpDashboard" },
      { label: "Tasks", icon: Repeat, nav: "TaskList" },
      { label: "Task Master", icon: ClipboardList, nav: "TaskMaster" },
      { label: "Close Task", icon: CheckCircle2, nav: "CloseTask" },
      { label: "Cancelled Tasks", icon: XCircle, nav: "CancelledTasks" },
      { label: "Task Transfer", icon: ArrowLeftRight, nav: "TaskTransfer" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Task Performance Report", icon: BarChart3, nav: "TaskPerformance" },
      { label: "Tag Performance Report", icon: Tag, nav: "TagPerformance" },
      { label: "Entry Type & Document Report", icon: FileText, nav: "EntryTypeDocReport" },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Department Master", icon: Users, nav: "DepartmentMaster" },
      { label: "Tag Master", icon: Tag, nav: "TagMaster" },
      { label: "Cancel Template", icon: MessageSquareX, nav: "CancelTemplate" },
    ],
  },
];

export default function DashboardScreen() {
  const { currentUser } = useAuth();
  const { role, privileged, followup } = useModuleAccess();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);

  const firstName = currentUser?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data, isLoading, isError, refetch, isFetching } = useQuery<Task[]>({
    queryKey: ["followup-board"],
    queryFn: getFollowUpBoard,
    enabled: followup,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });

  const stats = useMemo(() => {
    const tasks = data ?? [];
    return [
      { label: "Open tasks", value: tasks.length, color: ACCENT, icon: ListChecks },
      { label: "Overdue", value: tasks.filter(isOverdue).length, color: "#ef4444", icon: AlertCircle },
      { label: "Due today", value: tasks.filter(isDueToday).length, color: "#f59e0b", icon: Clock },
    ];
  }, [data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <View className="flex-row items-center justify-end gap-2 mb-3">
        <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} className="p-1.5">
          {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={13} color={`${colors.mutedForeground}80`} />}
        </Pressable>
      </View>

      <FadeSlideIn delay={0}>
        <View className="mb-1">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 28, lineHeight: 34 }}>
            {greeting},
          </Text>
          <GradientText style={{ fontFamily: fonts.heading.bold, fontSize: 28, lineHeight: 34 }} colors={["#0d9488", "#14b8a6", "#5eead4"]}>
            {`${firstName}.`}
          </GradientText>
        </View>
      </FadeSlideIn>
      <FadeSlideIn delay={90}>
        <Text style={{ color: colors.mutedForeground, fontSize: 14, lineHeight: 20, marginTop: 4, fontFamily: fonts.body.regular }}>
          Your task follow-up workspace — what's open, overdue and due today.
        </Text>
      </FadeSlideIn>

      <FadeSlideIn delay={160}>
        <View className="mt-3 flex-row">
          <View
            className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{
              backgroundColor: privileged ? `${ACCENT}14` : `${colors.muted}80`,
              borderWidth: 1,
              borderColor: privileged ? `${ACCENT}40` : colors.border,
            }}
          >
            {privileged ? <ShieldCheck size={10} color={ACCENT} /> : <Users size={10} color={colors.mutedForeground} />}
            <Text
              style={{
                color: privileged ? ACCENT : colors.mutedForeground,
                fontSize: 10,
                fontFamily: fonts.heading.semibold,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {role.replace(/_/g, " ") || "user"}
            </Text>
          </View>
        </View>
      </FadeSlideIn>

      {!followup ? (
        <View className="mt-8 rounded-xl p-8 items-center" style={{ backgroundColor: `${colors.card}66`, borderWidth: 1, borderColor: `${colors.border}66` }}>
          <ShieldCheck size={28} color={`${colors.mutedForeground}4d`} />
          <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 12 }}>
            No Follow-Up access assigned.
          </Text>
          <Text style={{ color: `${colors.mutedForeground}66`, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
            Contact your administrator to get Follow-Up permissions.
          </Text>
        </View>
      ) : (
        <>
          {isError && (
            <View
              className="mt-4 flex-row items-center gap-2 px-4 py-2.5 rounded-xl"
              style={{ backgroundColor: `${colors.destructive}1a`, borderWidth: 1, borderColor: `${colors.destructive}33` }}
            >
              <AlertCircle size={13} color={colors.destructive} />
              <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>
                Could not reach the server.
              </Text>
            </View>
          )}

          {/* Task snapshot */}
          <View className="mt-8">
            <SectionLabel>Task snapshot</SectionLabel>
            <View className="rounded-2xl p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
              {isLoading ? (
                <View className="py-4 items-center"><ActivityIndicator color={ACCENT} /></View>
              ) : (
                stats.map((s, i) => (
                  <View key={s.label} className="flex-row items-center justify-between" style={{ marginBottom: i < stats.length - 1 ? 16 : 0 }}>
                    <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
                      <View className="p-1.5 rounded-lg" style={{ backgroundColor: `${s.color}22` }}>
                        <s.icon size={12} color={s.color} />
                      </View>
                      <Text numberOfLines={1} style={{ color: `${colors.mutedForeground}a6`, fontSize: 11, fontFamily: fonts.body.medium }}>
                        {s.label}
                      </Text>
                    </View>
                    <Text style={{ color: s.color, fontFamily: fonts.heading.bold, fontSize: 15 }}>{s.value}</Text>
                  </View>
                ))
              )}
            </View>
          </View>

          {/* All Follow-Up destinations, grouped like the nav menu */}
          {GROUPS.map((group, gi) => (
            <View key={group.label} className="mt-6">
              <SectionLabel>{group.label}</SectionLabel>
              {group.items.map((sc, i) => (
                <FadeSlideIn key={sc.nav} delay={160 + (gi * 4 + i) * 40} distance={10}>
                  <Pressable
                    onPress={() => navigation.navigate(sc.nav)}
                    className="flex-row items-center gap-3 rounded-2xl px-4 py-3 mb-2"
                    style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}
                  >
                    <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${ACCENT}1f` }}>
                      <sc.icon size={16} color={ACCENT} />
                    </View>
                    <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold, flex: 1 }}>
                      {sc.label}
                    </Text>
                    <ChevronRight size={16} color={`${colors.mutedForeground}80`} />
                  </Pressable>
                </FadeSlideIn>
              ))}
            </View>
          ))}
        </>
      )}

      <View className="mt-10 items-center gap-1.5">
        <Text style={{ color: `${colors.mutedForeground}40`, fontSize: 10, fontFamily: fonts.heading.semibold, letterSpacing: 2 }}>
          CIVILIER ERP · {new Date().getFullYear()}
        </Text>
      </View>
    </ScrollView>
  );
}
