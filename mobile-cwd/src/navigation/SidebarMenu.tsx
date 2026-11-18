// The Menu sheet on the drawing sheet, as the Admin app's NavSheet draws it: a filled ink Menu key at the bottom right
// opens a sheet that rises under an ink rule with who is signed in (Profile, Sign out and Close keys), then this app's
// pages as ruled rows, the open one filled ink. The key steps aside on form pages, whose Save bar sits along the bottom.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, ArrowRightLeft, GitBranch, Hammer, FileBarChart, ShieldCheck, Grip, X, User, LogOut, Users, FileClock, Tags, ClipboardList } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Press } from "@/components/sheet/Sheet";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

type NavRoute = keyof Pick<MainStackParamList, "Dashboard" | "WorkTransfer" | "DependencyManagement" | "WorkAllocation" | "Reporting" | "QualityCheck" | "Attendance" | "Amendment" | "Reports" | "TagMaster">;
type NavItemDef = { route: NavRoute; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; also?: string[] };

const NAV_ITEMS: NavItemDef[] = [
  { route: "Dashboard", label: "Dashboard", icon: Home },
  { route: "WorkAllocation", label: "Work Allocation", icon: Hammer, also: ["AllocationForm"] },
  { route: "WorkTransfer", label: "Work Transfer", icon: ArrowRightLeft },
  { route: "Reporting", label: "Work Reporting", icon: FileBarChart },
  { route: "QualityCheck", label: "Quality Check", icon: ShieldCheck, also: ["QcInspect"] },
  { route: "DependencyManagement", label: "Dependency Management", icon: GitBranch },
  { route: "Attendance", label: "Attendance", icon: Users },
  { route: "Amendment", label: "Amendment", icon: FileClock },
  { route: "Reports", label: "Reports", icon: ClipboardList },
  { route: "TagMaster", label: "DPR Tag Master", icon: Tags },
];

// Form pages have their own Save bar along the bottom; the Menu key would sit on it.
const FORM_ROUTES = new Set<string>(["AllocationForm", "QcInspect"]);

export function SidebarMenu() {
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const [open, setOpen] = useState(false);
  // Current route, followed from the navigation container's state events. Dashboard is MainStack's initial route.
  const [activeRoute, setActiveRoute] = useState("Dashboard");
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sync = () => { if (navigationRef.isReady()) setActiveRoute(navigationRef.getCurrentRoute()?.name ?? "Dashboard"); };
    sync();
    return navigationRef.addListener("state", sync);
  }, []);

  const openSheet = () => {
    setOpen(true);
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 16 }).start();
  };
  const closeSheet = () => {
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setOpen(false));
  };
  const go = (route: string) => {
    closeSheet();
    if (navigationRef.isReady() && route !== activeRoute) navigationRef.navigate(route as never);
  };

  const initials = (currentUser?.name ?? "?").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <>
      {!FORM_ROUTES.has(activeRoute) && (
        <View style={{ position: "absolute", right: 16, bottom: insets.bottom + 16 }}>
          <Press
            onPress={openSheet}
            style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, minHeight: 44, backgroundColor: S.ink, borderWidth: 1, borderColor: S.ink, opacity: pressed ? 0.85 : 1, elevation: 6 })}
          >
            <Grip size={15} color={S.paper} />
            <Text style={{ color: S.paper, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>Menu</Text>
          </Press>
        </View>
      )}

      {/* animationType="none": `slide` alone drives the backdrop and the sheet, so the two move together. */}
      <Modal visible={open} transparent animationType="none" onRequestClose={closeSheet}>
        <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", opacity: slide }}>
          <Pressable style={{ flex: 1 }} onPress={closeSheet} />
          <Animated.View
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "85%", backgroundColor: S.paper,
              borderTopWidth: 1.5, borderTopColor: S.ink, overflow: "hidden",
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
            }}
          >
            <Pressable onPress={() => {}}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: S.rule }}>
                <View style={{ width: 36, height: 36, borderWidth: 1.5, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: S.ink, fontSize: 12, fontFamily: fonts.heading.bold, letterSpacing: 0.5 }}>{initials}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{currentUser?.name}</Text>
                  <Text numberOfLines={1} style={{ color: S.graphite, fontSize: 11, fontFamily: fonts.body.regular }}>{currentUser?.email}</Text>
                </View>
                {[
                  { key: "profile", Icon: User, ink: S.ink, onPress: () => go("Profile") },
                  { key: "logout", Icon: LogOut, ink: S.red, onPress: () => { closeSheet(); logout(); } },
                  { key: "close", Icon: X, ink: S.ink, onPress: closeSheet },
                ].map(({ key, Icon, ink, onPress }) => (
                  <Press
                    key={key}
                    onPress={onPress}
                    style={(pressed) => ({ width: 34, height: 34, borderWidth: 1, borderColor: ink, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? S.blueWash : "transparent" })}
                  >
                    <Icon size={15} color={ink} />
                  </Press>
                ))}
              </View>
              <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: S.graphite }}>CivilierERP · Civil Work DPR</Text>
              </View>
            </Pressable>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {NAV_ITEMS.map((item) => {
                  const active = item.route === activeRoute || !!item.also?.includes(activeRoute);
                  const Icon = item.icon;
                  return (
                    <Press
                      key={item.route}
                      onPress={() => go(item.route)}
                      style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: active ? S.ink : pressed ? S.blueWash : "transparent" })}
                    >
                      <Icon size={16} color={active ? S.paper : S.ink} />
                      <Text style={{ flex: 1, color: active ? S.paper : S.ink, fontSize: 13, fontFamily: active ? fonts.body.semibold : fonts.body.medium }}>{item.label}</Text>
                    </Press>
                  );
                })}
              </View>
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
