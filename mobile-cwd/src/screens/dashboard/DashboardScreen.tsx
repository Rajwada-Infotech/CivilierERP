// Civil Work DPR dashboard — built to answer "what needs me right now?" before "how are we doing?":
//   1. Hero: overall progress of live work, completion rate, and this week's finished work vs last week.
//   2. Needs attention: overdue · due in 2 days · rework · on hold — tap one to open exactly that list.
//   3. Quality & approval queues.
//   4. The pipeline: where every live activity sits, in one bar.
//   5. Most overdue activities, progress by project, engineer workload, today's site labour, 14-day trend.
// Every number comes from GET /api/civilworkdpr-dashboard and counts each activity's CURRENT attempt only
// (a reworked activity isn't counted twice), scoped to the signed-in user's projects by the server.
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeCheck, CalendarClock, CheckCircle2, ChevronRight,
  HardHat, Hourglass, PauseCircle, RotateCcw, ShieldCheck, TrendingUp, Users,
} from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { RadialGauge } from "@/components/charts/RadialGauge";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { STATUS_COLOR, STATUS_LABEL } from "@/components/StatusPill";
import { getCwdDashboard, type CwdDashboard } from "@/api/cwdApi";
import { usePageRights } from "@/hooks/usePageRights";

const ACCENT = "#0891b2";
const RED = "#ef4444";
const AMBER = "#f59e0b";
const FUCHSIA = "#d946ef";
const VIOLET = "#8b5cf6";
const TEAL = "#14b8a6";

type IconType = React.ComponentType<{ size?: number; color?: string }>;
type Nav = { navigate: (name: string, params?: object) => void };

const card = { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border } as const;

function Title({ children, action, onAction }: { children: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 3, height: 13, borderRadius: 2, backgroundColor: ACCENT }} />
        <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1.8 }}>{children}</Text>
      </View>
      {action && onAction && (
        <Pressable onPress={onAction} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: ACCENT }}>{action}</Text>
          <ChevronRight size={12} color={ACCENT} />
        </Pressable>
      )}
    </View>
  );
}

// A tappable count tile: coloured edge, big number, plain-language caption.
function Tile({ label, value, caption, icon: Icon, color, onPress, quiet }: {
  label: string; value: number; caption: string; icon: IconType; color: string; onPress?: () => void; quiet?: boolean;
}) {
  const live = value > 0 && !quiet;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={{ ...card, flex: 1, padding: 14, overflow: "hidden", borderColor: live ? `${color}55` : colors.border }}
    >
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: live ? color : colors.border }} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color: live ? color : colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1 }}>{label}</Text>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: `${color}${live ? "22" : "12"}`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={13} color={live ? color : colors.mutedForeground} />
        </View>
      </View>
      <Text style={{ fontSize: 28, fontFamily: fonts.heading.bold, color: live ? colors.foreground : colors.mutedForeground, fontVariant: ["tabular-nums"], lineHeight: 32 }}>{value}</Text>
      <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>{caption}</Text>
    </TouchableOpacity>
  );
}

function Bar({ value, color, height = 6 }: { value: number; color: string; height?: number }) {
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: colors.muted, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height, backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function DashboardScreen() {
  const rights = usePageRights("civilworkdpr-dashboard");
  const qcRights = usePageRights("civilworkdpr-quality-check");
  const { currentUser } = useAuth();
  const navigation = useNavigation<Nav>();
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({ queryKey: ["cwd-dashboard"], queryFn: getCwdDashboard, staleTime: 30_000, refetchInterval: 60_000, enabled: rights.canView });
  const d = q.data;

  const trend = useMemo(() => (d?.assignmentTimeline ?? []).map((p) => ({ date: p.date, amount: p.completed })), [d]);
  const openList = (filter: string) => navigation.navigate("Activities", { filter });

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

  const onRefresh = async () => {
    setRefreshing(true);
    await q.refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      {q.isLoading ? (
        <View style={{ paddingVertical: 80, alignItems: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : q.error || !d ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(q.error as Error)?.message || "Couldn't load the dashboard."}</Text>
      ) : (
        <Content d={d} firstName={(currentUser?.name ?? "").split(" ")[0]} trend={trend} openList={openList} showQc={qcRights.canView} />
      )}
    </ScrollView>
  );
}

function Content({ d, firstName, trend, openList, showQc }: {
  d: CwdDashboard; firstName: string; trend: { date: string; amount: number }[]; openList: (f: string) => void; showQc: boolean;
}) {
  const navigation = useNavigation<Nav>();
  const by = d.current.byStatus;
  const n = (s: keyof typeof by) => by[s] ?? 0;
  const ins = d.insights;
  const progress = ins.avgProgress ?? 0;
  const delta = ins.doneThisWeek - ins.doneLastWeek;
  const allClear = ins.overdue + ins.dueSoon + n("REWORK") + n("HOLD") === 0;

  const pipeline = (["PENDING", "ALLOCATED", "IN_PROGRESS", "HOLD", "REWORK", "COMPLETED", "APPROVED"] as const)
    .map((s) => ({ key: s, count: n(s) }))
    .filter((p) => p.count > 0);
  const pipelineTotal = pipeline.reduce((a, p) => a + p.count, 0);

  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <LinearGradient colors={["#0b2a33", "#0e3b49", "#0b2a33"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 20, padding: 18, borderWidth: 1, borderColor: `${ACCENT}44` }}>
        <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: "rgba(165,243,252,0.75)" }}>
          {greeting()}{firstName ? `, ${firstName}` : ""}
        </Text>
        <Text style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: "#ecfeff", marginTop: 2 }}>
          {d.current.active} live {d.current.active === 1 ? "activity" : "activities"} on site
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 14 }}>
          <RadialGauge progress={progress / 100} size={104} strokeWidth={11} color="#22d3ee" trackColor="rgba(255,255,255,0.10)" centerValue={`${progress}%`} centerLabel="progress" />
          <View style={{ flex: 1, gap: 12 }}>
            <View>
              <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color: "rgba(165,243,252,0.6)", textTransform: "uppercase", letterSpacing: 1.2 }}>Completion rate</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                <Text style={{ fontSize: 22, fontFamily: fonts.heading.bold, color: "#ecfeff" }}>{d.current.completionRate}%</Text>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: "rgba(165,243,252,0.6)" }}>of all work</Text>
              </View>
              <View style={{ marginTop: 5 }}><Bar value={d.current.completionRate} color="#22d3ee" height={5} /></View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: delta >= 0 ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)", flexDirection: "row", alignItems: "center", gap: 3 }}>
                {delta >= 0 ? <ArrowUpRight size={11} color="#34d399" /> : <ArrowDownRight size={11} color="#f87171" />}
                <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.bold, color: delta >= 0 ? "#34d399" : "#f87171" }}>{delta > 0 ? `+${delta}` : delta}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 10.5, fontFamily: fonts.body.regular, color: "rgba(236,254,255,0.8)" }}>
                {ins.doneThisWeek} finished this week · {ins.doneLastWeek} last week
              </Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* ── Needs attention ────────────────────────────────────────────────── */}
      <Title>Needs attention</Title>
      {allClear ? (
        <View style={{ ...card, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, borderColor: "#10b98155" }}>
          <CheckCircle2 size={22} color="#10b981" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Everything is on track</Text>
            <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 1 }}>Nothing overdue, due soon, on hold or sent back for rework.</Text>
          </View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Tile label="Overdue" value={ins.overdue} caption="past their end date" icon={AlertTriangle} color={RED} onPress={() => openList("OVERDUE")} />
            <Tile label="Due soon" value={ins.dueSoon} caption="finish within 2 days" icon={CalendarClock} color={AMBER} onPress={() => openList("DUE_SOON")} />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Tile label="Rework" value={n("REWORK")} caption="sent back by QC" icon={RotateCcw} color={FUCHSIA} onPress={() => openList("REWORK")} />
            <Tile label="On hold" value={n("HOLD")} caption="paused, clock running" icon={PauseCircle} color={AMBER} onPress={() => openList("HOLD")} />
          </View>
        </View>
      )}

      {/* ── Queues ─────────────────────────────────────────────────────────── */}
      {showQc && (
        <>
          <Title>Quality &amp; approval</Title>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Tile label="Awaiting QC" value={ins.awaitingQc} caption="completed, not yet checked" icon={ShieldCheck} color={VIOLET} onPress={() => navigation.navigate("QualityCheck")} />
            <Tile label="To approve" value={ins.awaitingApproval} caption="QC passed" icon={BadgeCheck} color={TEAL} onPress={() => openList("COMPLETED")} />
          </View>
        </>
      )}

      {/* ── Pipeline ───────────────────────────────────────────────────────── */}
      <Title action="All activities" onAction={() => openList("ALL")}>Work pipeline</Title>
      <View style={{ ...card, padding: 14 }}>
        {pipelineTotal === 0 ? (
          <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 12 }}>No allocated work yet.</Text>
        ) : (
          <>
            <View style={{ flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", gap: 2 }}>
              {pipeline.map((p) => (<View key={p.key} style={{ flex: p.count, backgroundColor: STATUS_COLOR[p.key] }} />))}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12, rowGap: 8 }}>
              {pipeline.map((p) => (
                <Pressable key={p.key} onPress={() => openList(p.key)} style={{ width: "50%", flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS_COLOR[p.key] }} />
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, flex: 1 }}>{STATUS_LABEL[p.key]}</Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.heading.bold, color: colors.foreground, marginRight: 12, fontVariant: ["tabular-nums"] }}>{p.count}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>

      {/* ── Most overdue ───────────────────────────────────────────────────── */}
      {d.overdueList.length > 0 && (
        <>
          <Title action="See all" onAction={() => openList("OVERDUE")}>Most overdue</Title>
          <View style={{ ...card, overflow: "hidden" }}>
            {d.overdueList.map((o, i) => (
              <TouchableOpacity
                key={o.rungId}
                activeOpacity={0.7}
                onPress={() => navigation.navigate("ActivityDetail", { rungId: o.rungId })}
                style={{ padding: 13, flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}
              >
                <View style={{ minWidth: 46, alignItems: "center", paddingVertical: 5, borderRadius: 10, backgroundColor: `${RED}18` }}>
                  <Text style={{ fontSize: 15, fontFamily: fonts.heading.bold, color: RED, fontVariant: ["tabular-nums"] }}>{o.daysOverdue}</Text>
                  <Text style={{ fontSize: 8.5, fontFamily: fonts.heading.bold, color: RED, textTransform: "uppercase" }}>{o.daysOverdue === 1 ? "day" : "days"}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{o.activityName ?? "Activity"}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 1 }}>
                    {[o.projectName, o.scopePath].filter(Boolean).join(" · ")}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 1 }}>
                    {o.engineerNames || "No engineer"} · {o.progressPercent}% done
                  </Text>
                </View>
                <ChevronRight size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* ── Projects ───────────────────────────────────────────────────────── */}
      {d.projects.length > 0 && (
        <>
          <Title>Progress by project</Title>
          <View style={{ ...card, padding: 14, gap: 16 }}>
            {d.projects.map((p) => (
              <View key={p.name}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{p.name}</Text>
                  {p.overdue > 0 && (
                    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: `${RED}18` }}>
                      <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color: RED }}>{p.overdue} overdue</Text>
                    </View>
                  )}
                  <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{p.avgProgress}%</Text>
                </View>
                <Bar value={p.avgProgress} color={p.overdue > 0 ? AMBER : ACCENT} />
                <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 5 }}>
                  {p.done} of {p.total} activities done · {p.inProgress} in progress
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* ── Engineers ──────────────────────────────────────────────────────── */}
      {d.engineerLoad.length > 0 && (
        <>
          <Title>Engineer workload</Title>
          <View style={{ ...card, padding: 14, gap: 12 }}>
            {d.engineerLoad.map((e) => {
              const max = Math.max(...d.engineerLoad.map((x) => x.active), 1);
              return (
                <View key={e.name} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: `${ACCENT}22`, alignItems: "center", justifyContent: "center" }}>
                    <HardHat size={14} color={ACCENT} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{e.name}</Text>
                      <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>
                        {e.active} live{e.overdue > 0 ? ` · ` : ""}
                        {e.overdue > 0 && <Text style={{ color: RED }}>{e.overdue} overdue</Text>}
                      </Text>
                    </View>
                    <Bar value={(e.active / max) * 100} color={e.overdue > 0 ? AMBER : ACCENT} height={5} />
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* ── Site today ─────────────────────────────────────────────────────── */}
      <Title>On site today</Title>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Tile label="Skilled" value={d.labour.skilledToday} caption="labour logged" icon={HardHat} color={ACCENT} quiet />
        <Tile label="Unskilled" value={d.labour.unskilledToday} caption="labour logged" icon={Users} color="#6366f1" quiet />
        <Tile label="Crews" value={d.labour.crewsToday} caption="reporting today" icon={Hourglass} color={TEAL} quiet />
      </View>

      {/* ── Trend ──────────────────────────────────────────────────────────── */}
      <Title>Completed — last 14 days</Title>
      <View style={{ ...card, padding: 14 }}>
        <TrendLineChart data={trend} color={ACCENT} formatValue={(v) => String(Math.round(v))} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
          <TrendingUp size={12} color={colors.mutedForeground} />
          <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
            {d.assignmentTimeline.reduce((a, p) => a + p.completed, 0)} completed · {d.assignmentTimeline.reduce((a, p) => a + p.assigned, 0)} newly allocated
          </Text>
        </View>
      </View>
    </>
  );
}
