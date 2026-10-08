// Same navigation surface as the Finance & Material app's NavSheet.tsx: a pulsing floating trigger opens a
// bottom sheet with the signed-in user (profile / sign out / close), the module strip and that module's
// screens. This app is single-module, so the strip holds just Civil DPR, always selected.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, ArrowRightLeft, GitBranch, Hammer, FileBarChart, ShieldCheck, Grip, X, User, LogOut, Pickaxe, Users, FileClock } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

const ACCENT = "#0891b2";

type NavRoute = keyof Pick<MainStackParamList, "Dashboard" | "WorkTransfer" | "DependencyManagement" | "WorkAllocation" | "Reporting" | "QualityCheck" | "Attendance" | "Amendment">;
type NavItemDef = { route: NavRoute; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; params?: object; key: string };

const NAV_ITEMS: NavItemDef[] = [
  { key: "Dashboard",  route: "Dashboard",  label: "Dashboard",     icon: Home          },
  { key: "Allocation", route: "WorkAllocation", label: "Work Allocation", icon: Hammer },
  { key: "Transfer",   route: "WorkTransfer", label: "Work Transfer", icon: ArrowRightLeft },
  { key: "Reporting",  route: "Reporting",  label: "Work Reporting", icon: FileBarChart },
  { key: "Quality",    route: "QualityCheck", label: "Quality Check",  icon: ShieldCheck },
  { key: "Dependency", route: "DependencyManagement", label: "Dependency Management", icon: GitBranch },
  { key: "Attendance", route: "Attendance", label: "Attendance", icon: Users },
  { key: "Amendment",  route: "Amendment",  label: "Amendment",     icon: FileClock },
];

export function SidebarMenu() {
  // Current route, followed from the navigation container's state events. Dashboard is MainStack's initial
  // route, so it's right before the first event arrives.
  const [activeRoute, setActiveRoute] = useState("Dashboard");
  useEffect(() => {
    const sync = () => { if (navigationRef.isReady()) setActiveRoute(navigationRef.getCurrentRoute()?.name ?? "Dashboard"); };
    sync();
    return navigationRef.addListener("state", sync);
  }, []);
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // Pulsing halo behind the trigger (web MobileNav's animate-pulse glow).
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const openSheet = () => {
    setOpen(true);
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 16 }).start();
  };
  const closeSheet = () => {
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setOpen(false));
  };

  const go = (item: NavItemDef) => {
    closeSheet();
    // Same screen with a different filter (Activities → Quality Check) still has to navigate.
    if (navigationRef.isReady() && (item.route !== activeRoute || item.params)) {
      (navigationRef.navigate as (name: string, params?: object) => void)(item.route, item.params);
    }
  };
  const goProfile = () => {
    closeSheet();
    if (navigationRef.isReady()) navigationRef.navigate("Profile" as never);
  };

  const initials = (currentUser?.name ?? "?").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <>
      {/* Trigger */}
      <View style={{ position: "absolute", right: 20, bottom: insets.bottom + 20 }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, backgroundColor: ACCENT,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
          }}
        />
        <Pressable onPress={openSheet}>
          <View
            style={{
              flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16,
              backgroundColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
            }}
          >
            <Grip size={16} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>Module</Text>
          </View>
        </Pressable>
      </View>

      {/* One animated value drives both the backdrop and the sheet, so they move together. */}
      <Modal visible={open} transparent animationType="none" onRequestClose={closeSheet}>
        <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", opacity: slide }}>
          <Pressable style={{ flex: 1 }} onPress={closeSheet} />
          <Animated.View
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "85%", backgroundColor: colors.card,
              borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, overflow: "hidden",
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
            }}
          >
            <Pressable onPress={() => {}}>
              <View style={{ height: 3, backgroundColor: ACCENT }} />
              <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
              </View>

              {/* User row */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
                <View style={{ width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: ACCENT }}>
                  <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.bold }}>{initials}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{currentUser?.name}</Text>
                  <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>{currentUser?.email}</Text>
                </View>
                <Pressable onPress={goProfile} style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
                  <User size={15} color={colors.mutedForeground} />
                </Pressable>
                <Pressable
                  onPress={() => { closeSheet(); logout(); }}
                  style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: `${colors.destructive}4d` }}
                >
                  <LogOut size={15} color={colors.destructive} />
                </Pressable>
                <Pressable onPress={closeSheet} style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
                  <X size={15} color={colors.mutedForeground} />
                </Pressable>
              </View>

              {/* Module strip */}
              <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                <View
                  style={{
                    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8,
                    borderRadius: 8, borderWidth: 1, borderColor: ACCENT, backgroundColor: `${ACCENT}1f`,
                  }}
                >
                  <Pickaxe size={13} color={ACCENT} />
                  <Text style={{ color: ACCENT, fontSize: 11, fontFamily: fonts.heading.medium }}>Civil DPR</Text>
                  <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: ACCENT, marginLeft: 2 }} />
                </View>
              </View>
            </Pressable>

            {/* Module screens */}
            <ScrollView style={{ paddingHorizontal: 16, paddingTop: 4 }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
              {NAV_ITEMS.map((item) => {
                const active = item.route === activeRoute || (item.route === "QualityCheck" && activeRoute === "QcInspect") || (item.route === "WorkAllocation" && activeRoute === "AllocationForm");
                const Icon = item.icon;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => go(item)}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, marginBottom: 6,
                      borderWidth: 1, borderColor: active ? `${ACCENT}4d` : "transparent", backgroundColor: active ? `${ACCENT}1f` : "transparent",
                    }}
                  >
                    <Icon size={14} color={active ? ACCENT : colors.mutedForeground} />
                    <Text style={{ color: active ? ACCENT : colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium }}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
