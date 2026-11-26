// The menu: a floating key at the bottom right that opens a sheet with who is signed in (Profile, Sign out, Close) and
// the pages of the user's interface (Guard, Security Admin or Resident; see securityRole.ts).
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Grip, X, User, LogOut, LayoutDashboard, UserPlus, Users, Ticket, Clock, Map, ScrollText, ShieldCheck, Phone, MessageSquareWarning } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { sheet as S } from "@/theme/colors";
import { Press } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";
import { useSecurityView, VIEW_LABEL } from "./securityRole";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

type NavLeaf = { label: string; icon: React.ComponentType<{ size?: number; color?: string }>; nav: keyof MainStackParamList };
const DASHBOARD: NavLeaf = { label: "Dashboard", icon: LayoutDashboard, nav: "Dashboard" };
/** Each interface's pages, in the order they're used. */
const PAGES_BY_VIEW: Record<string, NavLeaf[]> = {
  guard: [
    DASHBOARD,
    { label: "New visitor", icon: UserPlus, nav: "NewVisitor" },
    { label: "Visitors today", icon: Users, nav: "VisitorsList" },
    { label: "Expected guests", icon: Ticket, nav: "ExpectedGuests" },
    { label: "My shift", icon: Clock, nav: "MyShift" },
  ],
  admin: [
    DASHBOARD,
    { label: "Live map", icon: Map, nav: "LiveMap" },
    { label: "Visitor log", icon: ScrollText, nav: "VisitorLog" },
    { label: "Guards on duty", icon: ShieldCheck, nav: "GuardsOnDuty" },
    { label: "Complaints", icon: MessageSquareWarning, nav: "AdminComplaints" },
  ],
  customer: [
    DASHBOARD,
    { label: "Visitors", icon: Users, nav: "VisitorsList" },
    { label: "Guest passes", icon: Ticket, nav: "Passes" },
    { label: "Call the gate", icon: Phone, nav: "CallGate" },
    { label: "Complain about a guard", icon: MessageSquareWarning, nav: "Complaints" },
  ],
};
/** Forms: the menu key steps aside so it doesn't sit on the form's own keys. */
// Only the full-screen call hides it: its end-call keys sit where the menu key would, and leaving mid-call drops the call.
const FORM_ROUTES = new Set<string>(["Call"]);

export function NavSheet() {
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const { view } = useSecurityView();
  const [open, setOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string | undefined>("Dashboard");
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = navigationRef.addListener?.("state", () => {
      setActiveRoute(navigationRef.getCurrentRoute()?.name);
    });
    return unsub;
  }, []);

  const openSheet = () => {
    setOpen(true);
    // Spring, not timing — a fixed-duration ease always looks slightly
    // mechanical for a sheet the user just summoned; a light spring settles
    // with a touch of natural overshoot, closer to how iOS/Android's own
    // sheets move.
    Animated.spring(slide, {
      toValue: 1,
      useNativeDriver: true,
      bounciness: 6,
      speed: 16,
    }).start();
  };
  const closeSheet = () => {
    // Closing stays a plain ease-in timing (no bounce) — a spring overshoot
    // on the way OUT would read as the sheet "coming back", not dismissing.
    Animated.timing(slide, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setOpen(false));
  };

  const go = (name: keyof MainStackParamList) => {
    if (navigationRef.isReady()) navigationRef.navigate(name as never);
    closeSheet();
  };

  const initials = (currentUser?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const row = (key: string, label: string, Icon: React.ComponentType<{ size?: number; color?: string }>, active: boolean, onPress: () => void, indent = false) => (
    <Press
      key={key}
      onPress={onPress}
      style={(pressed) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: indent ? 10 : 12,
        borderBottomWidth: 1,
        borderBottomColor: S.ruleSoft,
        backgroundColor: active ? S.ink : pressed ? S.blueWash : "transparent",
      })}
    >
      <Icon size={indent ? 14 : 16} color={active ? S.paper : indent ? S.graphite : S.ink} />
      <Text style={{ flex: 1, color: active ? S.paper : indent ? S.ink2 : S.ink, fontSize: indent ? 12.5 : 13, fontFamily: active ? fonts.body.semibold : fonts.body.medium }}>{label}</Text>
    </Press>
  );

  return (
    <>
      {/* The menu key: a filled ink key, square, at the bottom right, on every page but the call. */}
      {!(activeRoute && FORM_ROUTES.has(activeRoute)) && (
      <View style={{ position: "absolute", right: 16, bottom: insets.bottom + 16 }}>
        <Press
          onPress={openSheet}
          style={(pressed) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 16,
            minHeight: 44,
            backgroundColor: S.ink,
            borderWidth: 1,
            borderColor: S.ink,
            opacity: pressed ? 0.85 : 1,
            elevation: 6,
          })}
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
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: "85%",
              backgroundColor: S.paper,
              borderTopWidth: 1.5,
              borderTopColor: S.ink,
              overflow: "hidden",
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
            }}
          >
            <Pressable onPress={() => {}}>
              {/* Who is signed in, with Profile, Sign out and Close keys. */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: S.rule }}>
                <View style={{ width: 36, height: 36, borderWidth: 1.5, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: S.ink, fontSize: 12, fontFamily: fonts.heading.bold, letterSpacing: 0.5 }}>{initials}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{currentUser?.name}</Text>
                  <Text numberOfLines={1} style={{ color: S.graphite, fontSize: 11, fontFamily: fonts.body.regular }}>{currentUser?.email}</Text>
                </View>
                {[
                  ...(currentUser?.kind === "customer" ? [] : [{ key: "profile", Icon: User, ink: S.ink, onPress: () => go("Profile") }]),
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

              {view && (
                <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }}>
                  <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: S.graphite }}>{VIEW_LABEL[view]}</Text>
                </View>
              )}
            </Pressable>

            {/* The pages of this interface. */}
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {(PAGES_BY_VIEW[view ?? ""] ?? [DASHBOARD]).map((p) => row(p.label, p.label, p.icon, activeRoute === p.nav, () => go(p.nav)))}
              </View>
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
