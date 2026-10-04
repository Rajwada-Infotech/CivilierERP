// RN port of the web app's MobileNav.tsx pattern — a floating trigger that
// opens a full nav panel. This app is Follow-Up-only, so instead of a
// module strip the sheet shows every Follow-Up destination at once, grouped
// into Transactions / Reports / Setup (matching the web Follow-Up sidebar +
// Reports catalog + Setup fly-out). Every group is always expanded — the
// point is that all three sections are visible together.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Grip, X, User, LogOut, LayoutDashboard, ListChecks, ClipboardList,
  CheckCircle2, XCircle, ArrowLeftRight, BarChart3, Tag, FileText,
  Users, MessageSquareX, Repeat,
} from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

const ACCENT = "#0d9488";

type NavLeaf = {
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  nav: keyof MainStackParamList;
};
type NavGroup = { label: string; items: NavLeaf[] };

// Mirrors the three web surfaces for Follow-Up:
//   Transactions → FollowupSidebar.ts
//   Reports      → Reports.tsx "followup" section
//   Setup        → TopNavbar.tsx followupSetupItems
const GROUPS: NavGroup[] = [
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

export function NavSheet() {
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string | undefined>("Dashboard");
  const slide = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = navigationRef.addListener?.("state", () => {
      setActiveRoute(navigationRef.getCurrentRoute()?.name);
    });
    return unsub;
  }, []);

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

  const go = (nav: keyof MainStackParamList) => {
    if (navigationRef.isReady()) navigationRef.navigate(nav as never);
    closeSheet();
  };

  const initials = (currentUser?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const Leaf = ({ item }: { item: NavLeaf }) => {
    const active = activeRoute === item.nav;
    return (
      <Pressable
        onPress={() => go(item.nav)}
        className="flex-row items-center gap-3 px-3 py-2.5 rounded-xl mb-1"
        style={{
          backgroundColor: active ? `${ACCENT}1f` : "transparent",
          borderWidth: 1,
          borderColor: active ? `${ACCENT}4d` : "transparent",
        }}
      >
        <item.icon size={15} color={active ? ACCENT : colors.mutedForeground} />
        <Text style={{ color: active ? ACCENT : colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium }}>
          {item.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      {/* FAB trigger */}
      <View style={{ position: "absolute", right: 20, bottom: insets.bottom + 20 }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 20,
            backgroundColor: ACCENT,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
          }}
        />
        <Pressable onPress={openSheet}>
          <View
            className="flex-row items-center gap-2 px-4 py-3 rounded-2xl"
            style={{
              backgroundColor: ACCENT,
              shadowColor: ACCENT,
              shadowOpacity: 0.5,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            }}
          >
            <Grip size={16} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>Menu</Text>
          </View>
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={closeSheet}>
        <Animated.View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", opacity: slide }}>
          <Pressable style={{ flex: 1 }} onPress={closeSheet} />
          <Animated.View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: "88%",
              backgroundColor: colors.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
            }}
          >
            <View style={{ height: 3, backgroundColor: ACCENT }} />

            {/* Drag handle */}
            <View className="items-center pt-2 pb-1">
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
            </View>

            {/* Header row */}
            <View className="flex-row items-center gap-2.5 px-4 py-3">
              <View className="w-9 h-9 rounded-lg items-center justify-center" style={{ backgroundColor: ACCENT }}>
                <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.bold }}>{initials}</Text>
              </View>
              <View className="flex-1 min-w-0">
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>
                  {currentUser?.name}
                </Text>
                <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
                  {currentUser?.email}
                </Text>
              </View>
              <Pressable
                onPress={() => go("Profile")}
                className="w-8 h-8 rounded-lg items-center justify-center"
                style={{ borderWidth: 1, borderColor: colors.border }}
              >
                <User size={15} color={colors.mutedForeground} />
              </Pressable>
              <Pressable
                onPress={() => { closeSheet(); logout(); }}
                className="w-8 h-8 rounded-lg items-center justify-center"
                style={{ borderWidth: 1, borderColor: `${colors.destructive}4d` }}
              >
                <LogOut size={15} color={colors.destructive} />
              </Pressable>
              <Pressable
                onPress={closeSheet}
                className="w-8 h-8 rounded-lg items-center justify-center"
                style={{ borderWidth: 1, borderColor: colors.border }}
              >
                <X size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <ScrollView
              style={{ paddingHorizontal: 16, paddingTop: 4 }}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Dashboard — standalone entry above the groups */}
              <Leaf item={{ label: "Dashboard", icon: LayoutDashboard, nav: "Dashboard" }} />

              {GROUPS.map((group) => (
                <View key={group.label} className="mt-3">
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 10,
                      fontFamily: fonts.heading.bold,
                      textTransform: "uppercase",
                      letterSpacing: 1.5,
                      marginBottom: 6,
                      marginLeft: 4,
                    }}
                  >
                    {group.label}
                  </Text>
                  {group.items.map((item) => (
                    <Leaf key={item.nav} item={item} />
                  ))}
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
