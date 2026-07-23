// RN port of src/pages/Home.tsx (web) — same data sources, same access-
// gating logic, same content, rebuilt as a mobile-appropriate single-
// column layout (web's own grid collapses to grid-cols-2 for module cards
// at its narrowest breakpoint anyway, so this isn't a re-imagining, just
// the same design at phone width). Framer-motion entrance choreography and
// the decorative blueprint-grid/crane background are dropped — see
// LoginScreen.tsx's file header for the same reasoning: no functional loss,
// heavy animation on every card entrance doesn't read as "polish" on a
// touch device the way it does with a mouse.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { MainStackParamList } from "@/navigation/MainStack";
import {
  HardHat, RefreshCw, AlertCircle, ShieldCheck, Users, BarChart3, IndianRupee,
  TrendingUp, CreditCard, Package, Warehouse, Wrench, Building2, FileText,
  Pickaxe, CheckCircle2, FileCheck, ShoppingCart, Megaphone, Ticket,
  TriangleAlert, Database, Hammer, Layers, LineChart, ClipboardList,
} from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { fetchHomeDashboard, type HomeDashboardData, type RecentGRN, type RecentPayment, type ApprovalInboxItem, type TaskSummary, type RecentOtherExpense } from "@/api/homeDashboardApi";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { GradientText } from "@/components/GradientText";
import { SectionLabel } from "@/components/home/SectionLabel";
import { ModuleCard, type StatRow } from "@/components/home/ModuleCard";
import { FeedItem, type FeedItemData } from "@/components/home/FeedItem";
import { useModuleAccess } from "@/navigation/moduleAccess";
import { FadeSlideIn } from "@/components/FadeSlideIn";

function fmtDay(d?: string) {
  if (!d) return undefined;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? undefined : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const notBuiltYet = (title: string) =>
  Alert.alert(title, `The ${title} module isn't built on mobile yet — use the web app for now.`);

export default function DashboardScreen() {
  const { currentUser } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const { role, privileged, isAdmin, isDba, access } = useModuleAccess();

  const firstName = currentUser?.name?.split(" ")[0] ?? "there";

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<HomeDashboardData>({
    queryKey: ["home-dashboard", role, access.finance, access.material, access.engineering],
    queryFn: () => fetchHomeDashboard(isAdmin, access),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });

  const { data: civilDpr } = useQuery({
    queryKey: ["home-civilworkdpr"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/civilworkdpr-dashboard");
      if (!res.ok) throw new Error("Failed to fetch Civil Work DPR stats");
      return res.json().catch(() => ({}));
    },
    enabled: access.civilworkdpr,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const fin = data?.finance;
  const mat = data?.material;
  const adm = data?.admin;
  const tick = data?.tickets;
  const eng = data?.engineering;
  const fol = data?.followup;
  const sal = data?.sales;
  const pendingApprovals = data?.pendingApprovals ?? [];

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  const activityFeed: FeedItemData[] = useMemo(() => {
    const feed: FeedItemData[] = [];
    if (access.material) {
      (data?.material?.recentGRNs ?? []).slice(0, 2).forEach((g: RecentGRN) => {
        feed.push({ label: `GRN ${g.GRNNo}`, sub: g.SupplierName ?? "—", icon: Package, color: "#10b981", time: fmtDay(g.GRNDate) });
      });
    }
    if (access.material) {
      (data?.recentOtherExpenses ?? []).forEach((e: RecentOtherExpense) => {
        feed.push({
          label: `${e.EDocNo} (Other Expense)`,
          sub: e.ESupplierName ?? "—",
          icon: FileText,
          color: "#06b6d4",
          time: fmtDay(e.EDocDate),
        });
      });
    }
    if (access.finance) {
      (data?.finance?.recentPayments ?? []).slice(0, 2).forEach((p: RecentPayment) => {
        feed.push({
          label: `₹${Number(p.PAmount ?? 0).toLocaleString("en-IN")} via ${p.PMode ?? "—"}`,
          sub: p.PProject ?? p.PPaymentName ?? "—",
          icon: IndianRupee,
          color: "#f59e0b",
          time: fmtDay(p.PDate),
        });
      });
    }
    if (access.approvals) {
      pendingApprovals.slice(0, 2).forEach((a: ApprovalInboxItem) => {
        feed.push({ label: `${a.ModuleLabel} ${a.Reference}`, sub: "Pending approval", icon: FileCheck, color: "#ef4444", time: fmtDay(a.RecordDate) });
      });
    }
    (data?.recentTasks ?? []).slice(0, 2).forEach((t: TaskSummary) => {
      feed.push({ label: t.title, sub: `${t.priority} · ${t.status}`, icon: ClipboardList, color: "#8b5cf6", time: fmtDay(t.dueDate) });
    });
    return feed.slice(0, 7);
  }, [data, access, pendingApprovals]);

  const keyNumbers = useMemo(() => {
    const items = [
      access.finance && {
        label: "Total payments (₹)",
        value: isLoading ? null : Math.round((fin?.payments?.totalAmount ?? 0) / 100000),
        suffix: "L", prefix: "₹", color: "#10b981", icon: IndianRupee,
      },
      (access.material || access.finance) && {
        label: "Open PO value (₹)",
        value: isLoading ? null : Math.round((mat?.purchaseOrders?.openValue ?? fin?.purchaseOrders?.openValue ?? 0) / 100000),
        suffix: "L", prefix: "₹", color: "#f59e0b", icon: Layers,
      },
      access.engineering && {
        label: "BOQ certified (₹)",
        value: isLoading ? null : Math.round((eng?.workDone?.certifiedAmount ?? 0) / 100000),
        suffix: "L", prefix: "₹", color: "#8b5cf6", icon: LineChart,
      },
      access.finance && {
        label: "Supplier count",
        value: isLoading ? null : (fin?.parties?.supplierCount ?? 0),
        color: "#06b6d4", icon: Building2,
      },
      access.ticket && !access.finance && !access.material && {
        label: "Open tickets",
        value: isLoading ? null : (tick?.pending ?? 0) + (tick?.inProgress ?? 0),
        color: "#f97316", icon: Ticket,
      },
      access.engineering && !access.finance && {
        label: "Active projects",
        value: isLoading ? null : (eng?.projects?.active ?? 0),
        color: "#10b981", icon: Building2,
      },
    ].filter(Boolean) as Array<{ label: string; value: number | null; suffix?: string; prefix?: string; color: string; icon: any }>;
    return items;
  }, [access, isLoading, fin, mat, eng, tick]);

  const hasAnyAccess = Object.values(access).some(Boolean);

  // Staggered module-card entrance delay, same idea as Home.tsx's
  // cardIdx-based nextDelay() — a fresh counter per render so cards fade
  // in one after another instead of all at once.
  let cardIdx = 0;
  const nextCardDelay = () => 300 + cardIdx++ * 45;

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Last-updated + refresh — branding now lives in the shared TopHeader */}
      <View className="flex-row items-center justify-end gap-2 mb-3">
        {lastUpdated && (
          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 10, fontFamily: fonts.body.regular }}>{lastUpdated}</Text>
        )}
        <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} className="p-1.5">
          {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={13} color={`${colors.mutedForeground}80`} />}
        </Pressable>
      </View>

      {/* Greeting — GradientText uses MaskedView, which RN can't reliably
          nest inside a <Text> (unlike CSS's bg-clip:text span on web), so
          the highlighted name renders as its own block below the line. */}
      <FadeSlideIn delay={0}>
        <View className="mb-1">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 30, lineHeight: 36 }}>
            {greeting},
          </Text>
          <GradientText style={{ fontFamily: fonts.heading.bold, fontSize: 30, lineHeight: 36 }} colors={["#6467f2", "#a78bfa", "#22d3ee"]}>
            {`${firstName}.`}
          </GradientText>
        </View>
      </FadeSlideIn>
      <FadeSlideIn delay={90}>
        <Text style={{ color: colors.mutedForeground, fontSize: 14, lineHeight: 20, marginTop: 4, fontFamily: fonts.body.regular }}>
          {privileged
            ? "Everything live across procurement, finance, engineering and sales — in one place."
            : role === "engineer"
              ? "Your engineering, follow-up and ticket workspace — live and in one place."
              : "Your workspace overview — all your accessible modules in one place."}
        </Text>
      </FadeSlideIn>

      {/* Role badge */}
      <FadeSlideIn delay={160}>
        <View className="mt-3 flex-row">
          <View
            className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{
              backgroundColor: privileged ? `${colors.primary}14` : `${colors.muted}80`,
              borderWidth: 1,
              borderColor: privileged ? `${colors.primary}40` : colors.border,
            }}
          >
            {privileged ? <ShieldCheck size={10} color={colors.primary} /> : <Users size={10} color={colors.mutedForeground} />}
            <Text
              style={{
                color: privileged ? colors.primary : colors.mutedForeground,
                fontSize: 10,
                fontFamily: fonts.heading.semibold,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {role.replace(/_/g, " ")}
            </Text>
          </View>
        </View>
      </FadeSlideIn>

      {isError && (
        <View
          className="mt-4 flex-row items-center gap-2 px-4 py-2.5 rounded-xl"
          style={{ backgroundColor: `${colors.destructive}1a`, borderWidth: 1, borderColor: `${colors.destructive}33` }}
        >
          <AlertCircle size={13} color={colors.destructive} />
          <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>
            Could not reach the server — showing cached data.
          </Text>
        </View>
      )}

      {/* Module cards */}
      <View className="mt-8 mb-2">
        <SectionLabel>{hasAnyAccess ? "Operations at a glance" : "Your workspace"}</SectionLabel>

        <View className="flex-row flex-wrap justify-between">
          {access.finance && (
            <ModuleCard
              title="Finance" icon={BarChart3} accent={moduleAccents.finance} loading={isLoading} delay={nextCardDelay()}
              onPress={() => navigation.navigate("FinanceDashboard")}
              stats={[
                { label: "Total payments", value: fin?.payments?.totalCount ?? 0, accent: moduleAccents.finance },
                { label: "Paid this month (₹L)", value: Math.round((fin?.payments?.thisMonthAmount ?? 0) / 100000), accent: "#10b981", icon: TrendingUp },
                { label: "Open POs", value: fin?.purchaseOrders?.openCount ?? 0, accent: "#f59e0b" },
                { label: "Cheque lots", value: fin?.cheques?.pendingCount ?? 0, accent: fin?.cheques?.pendingCount ? "#ef4444" : undefined, icon: CreditCard },
              ] as StatRow[]}
            />
          )}

          {access.material && (
            <ModuleCard
              title="Material" icon={Package} accent={moduleAccents.material} loading={isLoading} delay={nextCardDelay()}
              onPress={() => navigation.navigate("MaterialDashboard")}
              stats={[
                { label: "GRNs this month", value: mat?.grns?.thisMonth ?? 0, accent: moduleAccents.material },
                { label: "Open POs", value: mat?.purchaseOrders?.open ?? 0, accent: "#f59e0b" },
                { label: "Total items", value: mat?.items?.count ?? 0, accent: "#06b6d4", icon: Warehouse },
                { label: "Today's GRNs", value: mat?.grns?.today ?? 0, accent: mat?.grns?.today ? "#10b981" : undefined },
              ] as StatRow[]}
            />
          )}

          {access.engineering && (
            <ModuleCard
              title="Engineering" icon={Wrench} accent={moduleAccents.engineering} loading={isLoading} delay={nextCardDelay()}
              onPress={() => notBuiltYet("Engineering")}
              stats={[
                { label: "Open work orders", value: eng?.workOrders?.open ?? 0, accent: moduleAccents.engineering },
                { label: "Active projects", value: eng?.projects?.active ?? 0, accent: "#10b981", icon: Building2 },
                { label: "Work done pending", value: eng?.workDone?.pending ?? 0, accent: eng?.workDone?.pending ? "#f59e0b" : undefined },
                { label: "BOQ approved", value: eng?.boq?.approved ?? 0, accent: "#06b6d4", icon: FileText },
              ] as StatRow[]}
            />
          )}

          {access.civilworkdpr && (
            <ModuleCard
              title="Civil DPR" icon={Pickaxe} accent={moduleAccents.civilworkdpr} loading={isLoading} delay={nextCardDelay()}
              badge={civilDpr?.progress?.pendingReviewCount}
              onPress={() => notBuiltYet("Civil Work DPR")}
              stats={[
                { label: "Active activities", value: civilDpr?.activities?.activeCount ?? 0, accent: moduleAccents.civilworkdpr },
                { label: "Workers assigned", value: civilDpr?.allocations?.workerCount ?? 0, accent: "#3b82f6", icon: HardHat },
                { label: "Pending review", value: civilDpr?.progress?.pendingReviewCount ?? 0, accent: civilDpr?.progress?.pendingReviewCount ? "#f59e0b" : undefined },
                { label: "Labour on site today", value: civilDpr?.labour?.totalToday ?? 0, accent: "#10b981", icon: Users },
              ] as StatRow[]}
            />
          )}

          {access.followup && (
            <ModuleCard
              title="Follow-Up" icon={Users} accent={moduleAccents.followup} loading={isLoading} delay={nextCardDelay()}
              badge={fol?.pendingNOCs}
              onPress={() => notBuiltYet("Follow-Up")}
              stats={[
                { label: "Applications", value: fol?.applications ?? 0, accent: moduleAccents.followup },
                { label: "Confirmed bookings", value: fol?.confirmedBookings ?? 0, accent: "#10b981", icon: CheckCircle2 },
                { label: "Active agreements", value: fol?.activeAgreements ?? 0, accent: "#f59e0b" },
                { label: "Handovers due", value: fol?.scheduledHandovers ?? 0, accent: fol?.scheduledHandovers ? "#ef4444" : undefined },
              ] as StatRow[]}
            />
          )}

          {access.approvals && (
            <ModuleCard
              title="Approvals" icon={FileCheck} accent={moduleAccents.approvals} loading={isLoading} delay={nextCardDelay()}
              badge={pendingApprovals.length}
              onPress={() => notBuiltYet("Approvals")}
              stats={[
                { label: "Awaiting action", value: pendingApprovals.length, accent: pendingApprovals.length ? "#f59e0b" : undefined },
                { label: "Modules affected", value: new Set(pendingApprovals.map((a) => a.Module)).size, accent: "#8b5cf6" },
                { label: "PO approvals", value: pendingApprovals.filter((a) => a.Module === "PurchaseOrders").length },
                { label: "GRN approvals", value: pendingApprovals.filter((a) => a.Module === "GoodsReceiptNotes").length },
              ] as StatRow[]}
            />
          )}

          {access.sales && (
            <ModuleCard
              title="Sales" icon={ShoppingCart} accent={moduleAccents.sales} loading={isLoading} delay={nextCardDelay()}
              onPress={() => notBuiltYet("Sales")}
              stats={[
                { label: "Total orders", value: sal?.total ?? 0, accent: moduleAccents.sales },
                { label: "Approved", value: sal?.approved ?? 0, accent: "#10b981", icon: CheckCircle2 },
                { label: "Pending approval", value: sal?.pendingApproval ?? 0, accent: sal?.pendingApproval ? "#f59e0b" : undefined },
                {
                  label: "This month", accent: "#06b6d4", icon: TrendingUp,
                  value: (() => { const a = sal?.thisMonthAmount ?? 0; return a === 0 ? "₹0" : a < 100000 ? `₹${(a / 1000).toFixed(1)}K` : `₹${(a / 100000).toFixed(1)}L`; })(),
                },
              ] as StatRow[]}
            />
          )}

          {access.salesAutomation && (
            <ModuleCard title="Sales Auto" icon={Megaphone} accent={moduleAccents.salesAutomation} loading={isLoading} delay={nextCardDelay()} onPress={() => notBuiltYet("Sales Automation")} stats={[]} />
          )}

          {access.ticket && (
            <ModuleCard
              title="Tickets" icon={Ticket} accent={moduleAccents.ticket} loading={isLoading} delay={nextCardDelay()}
              badge={tick?.urgent}
              onPress={() => notBuiltYet("Tickets")}
              stats={[
                { label: "Open", value: (tick?.pending ?? 0) + (tick?.inProgress ?? 0), accent: moduleAccents.ticket },
                { label: "Urgent", value: tick?.urgent ?? 0, accent: tick?.urgent ? "#f97316" : undefined, icon: TriangleAlert },
                { label: "Resolved", value: tick?.resolved ?? 0, accent: "#10b981", icon: CheckCircle2 },
                { label: "Resolution %", value: `${tick?.resolvedPct ?? 0}%`, accent: "#06b6d4" },
              ] as StatRow[]}
            />
          )}

          {access.admin && !isDba && (
            <ModuleCard
              title="Admin" icon={ShieldCheck} accent={moduleAccents.admin} loading={isLoading} delay={nextCardDelay()}
              onPress={() => notBuiltYet("Admin")}
              stats={[
                { label: "Total users", value: adm?.stats?.totalUsers ?? 0, accent: moduleAccents.admin },
                { label: "Active users", value: adm?.stats?.activeUsers ?? 0, accent: "#10b981", icon: Users },
                { label: "Roles", value: adm?.stats?.totalRoles ?? 0, accent: "#06b6d4" },
                { label: "Work orders open", value: eng?.workOrders?.open ?? 0, accent: "#f59e0b", icon: Hammer },
              ] as StatRow[]}
            />
          )}

          {access.dba && (
            <ModuleCard
              title="DBA Console" icon={Database} accent={moduleAccents.dba} loading={isLoading} delay={nextCardDelay()}
              onPress={() => notBuiltYet("DBA Console")}
              stats={[
                { label: "Total users", value: adm?.stats?.totalUsers ?? 0, accent: moduleAccents.dba },
                { label: "Active users", value: adm?.stats?.activeUsers ?? 0, accent: "#3b82f6" },
                { label: "Roles", value: adm?.stats?.totalRoles ?? 0 },
                { label: "Open tickets", value: (tick?.pending ?? 0) + (tick?.inProgress ?? 0), accent: "#f97316", icon: Ticket },
              ] as StatRow[]}
            />
          )}

          {!hasAnyAccess && (
            <View className="w-full rounded-xl p-8 items-center" style={{ backgroundColor: `${colors.card}66`, borderWidth: 1, borderColor: `${colors.border}66` }}>
              <ShieldCheck size={28} color={`${colors.mutedForeground}4d`} />
              <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 12 }}>
                No module access assigned.
              </Text>
              <Text style={{ color: `${colors.mutedForeground}66`, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 4 }}>
                Contact your administrator to get module permissions.
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Key numbers */}
      {hasAnyAccess && keyNumbers.length > 0 && (
        <FadeSlideIn delay={cardIdx * 45 + 320}>
          <View className="mt-4">
            <SectionLabel>Key numbers</SectionLabel>
            <View className="rounded-2xl p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
              {keyNumbers.map((item, i) => (
                <FadeSlideIn key={i} delay={cardIdx * 45 + 400 + i * 60} distance={10}>
                  <View className="flex-row items-center justify-between" style={{ marginBottom: i < keyNumbers.length - 1 ? 16 : 0 }}>
                    <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
                      <View className="p-1.5 rounded-lg" style={{ backgroundColor: `${item.color}22` }}>
                        <item.icon size={12} color={item.color} />
                      </View>
                      <Text numberOfLines={1} style={{ color: `${colors.mutedForeground}a6`, fontSize: 11, fontFamily: fonts.body.medium, flexShrink: 1 }}>
                        {item.label}
                      </Text>
                    </View>
                    <Text style={{ color: item.color, fontFamily: fonts.heading.bold, fontSize: 15 }}>
                      {item.value == null ? "—" : `${item.prefix ?? ""}${item.value}${item.suffix ?? ""}`}
                    </Text>
                  </View>
                </FadeSlideIn>
              ))}
            </View>
          </View>
        </FadeSlideIn>
      )}

      {/* Recent activity */}
      {hasAnyAccess && (
        <FadeSlideIn delay={cardIdx * 45 + 420}>
          <View className="mt-6">
            <SectionLabel>Recent activity</SectionLabel>
            <View className="rounded-2xl px-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
              {isLoading ? (
                <View className="py-6 items-center">
                  <ActivityIndicator color={colors.mutedForeground} />
                </View>
              ) : activityFeed.length === 0 ? (
                <Text className="py-8 text-center" style={{ color: `${colors.mutedForeground}66`, fontSize: 13, fontFamily: fonts.body.regular }}>
                  No recent activity.
                </Text>
              ) : (
                activityFeed.map((item, i) => (
                  <FadeSlideIn key={i} delay={cardIdx * 45 + 500 + i * 50} distance={10}>
                    <FeedItem item={item} isLast={i === activityFeed.length - 1} />
                  </FadeSlideIn>
                ))
              )}
            </View>
          </View>
        </FadeSlideIn>
      )}

      {/* Footer */}
      <FadeSlideIn delay={cardIdx * 45 + 650} distance={8}>
        <View className="mt-10 items-center gap-1.5">
          <View className="flex-row items-center gap-3">
            <View style={{ width: 40, height: 1, backgroundColor: `${colors.border}66` }} />
            <Text style={{ color: `${colors.mutedForeground}40`, fontSize: 10, fontFamily: fonts.heading.semibold, letterSpacing: 2 }}>
              CIVILIER ERP · {new Date().getFullYear()}
            </Text>
            <View style={{ width: 40, height: 1, backgroundColor: `${colors.border}66` }} />
          </View>
          <Text style={{ color: `${colors.mutedForeground}33`, fontSize: 9, fontFamily: fonts.heading.semibold, letterSpacing: 3 }}>
            CRAFTED BY RAJWADA INFOTECH
          </Text>
        </View>
      </FadeSlideIn>
    </ScrollView>
  );
}
