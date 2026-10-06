// Civil Work DPR overview — the same numbers the web app's CivilWorkDprDashboard shows, from the same
// endpoint (GET /api/civilworkdpr-dashboard): how much work is assigned, where it stands, and a
// 14-day assigned-vs-completed trend. Charts are hand-drawn with react-native-svg (see
// components/charts/*) since recharts has no RN equivalent.
import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Hammer, PauseCircle, RotateCcw, TrendingUp, CheckCircle2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { SectionLabel } from "@/components/home/SectionLabel";
import { DonutChart } from "@/components/charts/DonutChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { getCwdDashboard } from "@/api/cwdApi";
import { STATUS_COLOR } from "@/components/StatusPill";
import { usePageRights } from "@/hooks/usePageRights";

const ACCENT = "#0891b2";

type IconType = React.ComponentType<{ size?: number; color?: string }>;

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: IconType; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: `${color}30`, padding: 14, overflow: "hidden" }}>
      <View style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: 2.5, borderRadius: 2, backgroundColor: color }} />
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color, opacity: 0.9, textTransform: "uppercase", letterSpacing: 1.2, flex: 1, marginRight: 6 }}>
          {label}
        </Text>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${color}20`, borderWidth: 1, borderColor: `${color}40`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={12} color={color} />
        </View>
      </View>
      <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: IconType; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: `${ACCENT}30`, backgroundColor: colors.card, marginBottom: 14, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: `${ACCENT}20` }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: `${ACCENT}26`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={11} color={ACCENT} />
        </View>
        <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{title}</Text>
      </View>
      <View style={{ padding: 14 }}>{children}</View>
    </View>
  );
}

export default function DashboardScreen() {
  const rights = usePageRights("civilworkdpr-dashboard");
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({ queryKey: ["cwd-dashboard"], queryFn: getCwdDashboard, staleTime: 30_000, enabled: rights.canView });
  const d = q.data;

  const trend = useMemo(
    () => (d?.assignmentTimeline ?? []).map((p) => ({ date: p.date, amount: p.completed })),
    [d],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await q.refetch();
    setRefreshing(false);
  };

  if (!rights.canView) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 14 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: fonts.body.regular, fontSize: 12, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view the Civil Work DPR dashboard.
        </Text>
      </View>
    );
  }

  const w = d?.assignedWork;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      <SectionLabel>Civil Work DPR Overview</SectionLabel>

      {q.isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : q.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(q.error as Error).message}</Text>
      ) : w ? (
        <>
          <View style={{ gap: 10, marginBottom: 20 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Assigned Work" value={String(w.totalCount)} icon={ClipboardList} color={ACCENT} />
              <StatCard label="In Progress" value={String(w.inProgressCount)} icon={Hammer} color="#3b82f6" />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Completed" value={String(w.completedCount)} icon={CheckCircle2} color="#10b981" />
              <StatCard label="On Hold" value={String(w.holdCount)} icon={PauseCircle} color="#f59e0b" />
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <StatCard label="Rework" value={String(w.reworkCount)} icon={RotateCcw} color="#d946ef" />
              <StatCard label="Assigned Today" value={String(w.todayCount)} icon={ClipboardList} color="#6366f1" />
            </View>
          </View>

          <SectionLabel>Breakdown</SectionLabel>

          <ChartCard title="Work by Status" icon={ClipboardList}>
            {w.totalCount === 0 ? (
              <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 24 }}>
                No data yet
              </Text>
            ) : (
              <DonutChart
                data={[
                  { name: "Pending", value: w.pendingCount, color: STATUS_COLOR.PENDING },
                  { name: "In Progress", value: w.inProgressCount, color: STATUS_COLOR.IN_PROGRESS },
                  { name: "Hold", value: w.holdCount, color: STATUS_COLOR.HOLD },
                  { name: "Completed", value: w.completedCount, color: STATUS_COLOR.COMPLETED },
                  { name: "Approved", value: w.approvedCount, color: STATUS_COLOR.APPROVED },
                  { name: "Rework", value: w.reworkCount, color: STATUS_COLOR.REWORK },
                  { name: "Cancelled", value: w.cancelledCount, color: STATUS_COLOR.CANCELLED },
                ].filter((s) => s.value > 0)}
              />
            )}
          </ChartCard>

          <ChartCard title="Completed — Last 14 Days" icon={TrendingUp}>
            <TrendLineChart data={trend} color={ACCENT} />
          </ChartCard>
        </>
      ) : null}
    </ScrollView>
  );
}
