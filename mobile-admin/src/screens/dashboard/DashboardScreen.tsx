// Admin app's dashboard shell — single-module version of mobile/'s
// DashboardScreen.tsx (which aggregates every module's stats). This app IS
// the Admin module, so it goes straight to GET /api/admin-dashboard
// (backend/routes/adminDashboard.js) instead of the cross-module
// home-dashboard endpoint. Non-admin roles (anyone who somehow lands here
// without super_admin/admin) get a plain access-denied state instead of
// the stat cards.
import { useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertCircle, ShieldCheck, Users, UserCheck, Layers } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/auth/adminAccess";
import { fetchAdminDashboard, type AdminDashboardData } from "@/api/adminDashboardApi";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { GradientText } from "@/components/GradientText";
import { SectionLabel } from "@/components/home/SectionLabel";
import { FadeSlideIn } from "@/components/FadeSlideIn";

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: number | string; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string }) {
  return (
    <View
      className="flex-1 min-w-[45%] rounded-2xl p-4"
      style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View className="flex-row items-center justify-between mb-3">
        <View className="p-1.5 rounded-lg" style={{ backgroundColor: `${accent}22` }}>
          <Icon size={14} color={accent} />
        </View>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 22 }}>{value}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const { currentUser } = useAuth();
  const isAdmin = useIsAdmin();
  const [refreshing, setRefreshing] = useState(false);

  const firstName = currentUser?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery<AdminDashboardData>({
    queryKey: ["admin-dashboard"],
    queryFn: fetchAdminDashboard,
    enabled: isAdmin,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

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
      <View className="flex-row items-center justify-end gap-2 mb-3">
        {lastUpdated && (
          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 10, fontFamily: fonts.body.regular }}>{lastUpdated}</Text>
        )}
        <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} className="p-1.5">
          {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={13} color={`${colors.mutedForeground}80`} />}
        </Pressable>
      </View>

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
          Users, roles and platform controls — in one place.
        </Text>
      </FadeSlideIn>

      <FadeSlideIn delay={160}>
        <View className="mt-3 flex-row">
          <View
            className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{ backgroundColor: `${colors.primary}14`, borderWidth: 1, borderColor: `${colors.primary}40` }}
          >
            <ShieldCheck size={10} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 10, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 1 }}>
              {(currentUser?.role ?? "").replace(/_/g, " ")}
            </Text>
          </View>
        </View>
      </FadeSlideIn>

      {!isAdmin ? (
        <View className="mt-8 rounded-xl p-8 items-center" style={{ backgroundColor: `${colors.card}66`, borderWidth: 1, borderColor: `${colors.border}66` }}>
          <ShieldCheck size={28} color={`${colors.mutedForeground}4d`} />
          <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 12, textAlign: "center" }}>
            This app is for Admin accounts only.
          </Text>
          <Text style={{ color: `${colors.mutedForeground}66`, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
            Contact your administrator if you believe this is a mistake.
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
                Could not reach the server — showing cached data.
              </Text>
            </View>
          )}

          <View className="mt-8 mb-2">
            <SectionLabel>Platform at a glance</SectionLabel>
            {isLoading ? (
              <View className="py-10 items-center">
                <ActivityIndicator color={colors.mutedForeground} />
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-3">
                <StatCard label="Total users" value={data?.stats.totalUsers ?? 0} icon={Users} accent="#a855f7" />
                <StatCard label="Active users" value={data?.stats.activeUsers ?? 0} icon={UserCheck} accent="#10b981" />
                <StatCard label="Roles" value={data?.stats.totalRoles ?? 0} icon={Layers} accent="#06b6d4" />
              </View>
            )}
          </View>

          {data?.recentUsers && data.recentUsers.length > 0 && (
            <FadeSlideIn delay={200}>
              <View className="mt-4">
                <SectionLabel>Recently added users</SectionLabel>
                <View className="rounded-2xl px-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
                  {data.recentUsers.map((u, i) => (
                    <View
                      key={u.id}
                      className="flex-row items-center justify-between py-3"
                      style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: `${colors.border}66` }}
                    >
                      <View className="flex-1 min-w-0 pr-2">
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>{u.name}</Text>
                        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>{u.email}</Text>
                      </View>
                      <View
                        className="px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: u.discontinue ? `${colors.destructive}1a` : "#10b9811a" }}
                      >
                        <Text style={{ color: u.discontinue ? colors.destructive : "#10b981", fontSize: 10, fontFamily: fonts.heading.semibold }}>
                          {u.discontinue ? "Inactive" : "Active"}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </FadeSlideIn>
          )}
        </>
      )}

      <FadeSlideIn delay={500} distance={8}>
        <View className="mt-10 items-center gap-1.5">
          <View className="flex-row items-center gap-3">
            <View style={{ width: 40, height: 1, backgroundColor: `${colors.border}66` }} />
            <Text style={{ color: `${colors.mutedForeground}40`, fontSize: 10, fontFamily: fonts.heading.semibold, letterSpacing: 2 }}>
              CIVILIER ERP ADMIN · {new Date().getFullYear()}
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
