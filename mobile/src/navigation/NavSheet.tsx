// RN port of the web app's MobileNav.tsx pattern — a floating trigger that
// opens a full nav panel, instead of a persistent tab bar. Tapping a module
// chip both navigates straight to that module's dashboard (if it has one)
// AND switches which module's nav tree renders in the sheet — same
// two-part behaviour as web's MobileNav (setActiveModule + navigate to
// meta.route, then the nav list renders getModuleNavItems() for whichever
// module is active). The tree is keyed by module id in MODULE_NAV_TREES so
// it's strictly context-aware: only the selected module's tree ever
// renders, mirroring web's per-module sidebar swap exactly. Every leaf
// besides Finance Dashboard alerts "not built on mobile yet" — this just
// registers where each one will live as pages get ported one at a time.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Grip, X, User, LogOut, ChevronRight,
  LayoutDashboard, FileText, ArrowLeftRight, BookText, Search,
  Receipt, Wallet, ArrowRightLeft, ArrowDownToLine, BookOpen, Scale,
  Truck, FileCheck2, Package, Ship, ClipboardList, RotateCcw,
  ArchiveRestore, TrendingUp, ArrowLeftRight as SwapIcon, Repeat,
  ClipboardEdit, Cpu,
} from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useModuleAccess, MODULE_LIST } from "./moduleAccess";
import { navigationRef } from "./navigationRef";
import type { MainStackParamList } from "./MainStack";

// Which route each module chip lands on, so the strip can highlight the
// one the user is currently viewing, and so tapping the chip can jump
// straight there. Modules with no screen yet (e.g. Material) simply have
// no entry, so the chip just switches the nav tree below instead.
const MODULE_ROUTES: Partial<Record<string, keyof MainStackParamList>> = {
  finance: "FinanceDashboard",
  material: "MaterialDashboard",
};

type NavLeaf = { kind: "leaf"; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; nav?: keyof MainStackParamList };
type NavGroup = {
  kind: "group";
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  children: Array<{ label: string; icon: React.ComponentType<{ size?: number; color?: string }>; nav?: keyof MainStackParamList }>;
};
type NavTree = Array<NavLeaf | NavGroup>;

// RN port of buildFinanceNavItems (FinanceSidebar.ts) — same tree, same
// order (Dashboard, Contract, Transaction group, Journal Voucher, Query
// group). "Finance Dashboard" navigates for real; every other leaf alerts.
const FINANCE_NAV_TREE: NavTree = [
  { kind: "leaf", label: "Finance Dashboard", icon: LayoutDashboard, nav: "FinanceDashboard" },
  { kind: "leaf", label: "Contract", icon: FileText, nav: "Contract" },
  {
    kind: "group",
    label: "Transaction",
    icon: ArrowLeftRight,
    children: [
      { label: "Invoice", icon: Receipt, nav: "Invoice" },
      { label: "Payment", icon: Wallet, nav: "Payment" },
      { label: "On A/C Adjustment", icon: ArrowRightLeft, nav: "OnAccountAdjustment" },
      { label: "Received Payment", icon: ArrowDownToLine, nav: "ReceivedPayment" },
      { label: "BRS", icon: BookOpen, nav: "Brs" },
    ],
  },
  { kind: "leaf", label: "Journal Voucher", icon: BookText, nav: "JournalVoucher" },
  {
    kind: "group",
    label: "Query",
    icon: Search,
    children: [{ label: "Trial Balance", icon: Scale, nav: "TrialBalance" }],
  },
];

// RN port of materialNavItems (MaterialSidebar.ts) — same tree, same order.
// No mobile screen exists yet for any of these, so every leaf alerts.
const MATERIAL_NAV_TREE: NavTree = [
  { kind: "leaf", label: "Material Dashboard", icon: LayoutDashboard, nav: "MaterialDashboard" },
  {
    kind: "group",
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "Material Request", icon: ClipboardList },
      { label: "Quotation", icon: FileCheck2 },
      { label: "Purchase Order", icon: FileText },
      { label: "Vehicle In/Out", icon: Ship },
      { label: "GRN", icon: Package },
      { label: "Issues", icon: ArchiveRestore },
      { label: "Issue Return", icon: RotateCcw },
    ],
  },
  { kind: "leaf", label: "Short Close", icon: ArchiveRestore },
  { kind: "leaf", label: "L1 Chart", icon: TrendingUp },
  { kind: "leaf", label: "Stock", icon: SwapIcon },
  { kind: "leaf", label: "Transfer", icon: Repeat },
  { kind: "leaf", label: "Debit Note", icon: ClipboardEdit },
  { kind: "leaf", label: "Amendment", icon: ClipboardEdit },
  { kind: "leaf", label: "Fixed Asset Record", icon: Cpu },
  { kind: "leaf", label: "Suppliers", icon: Truck },
];

const MODULE_NAV_TREES: Partial<Record<string, NavTree>> = {
  finance: FINANCE_NAV_TREE,
  material: MATERIAL_NAV_TREE,
};

export function NavSheet() {
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const { access } = useModuleAccess();
  const [open, setOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string | undefined>("Dashboard");
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = navigationRef.addListener?.("state", () => {
      setActiveRoute(navigationRef.getCurrentRoute()?.name);
    });
    return unsub;
  }, []);

  // Pulsing glow behind the FAB — RN port of the web trigger's
  // `animate-pulse` blurred halo (MobileNav.tsx). Symmetric out/in ease
  // instead of the old "grow then snap back to 0 instantly" — the instant
  // reset was a visible flash at the end of every cycle.
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

  const goModule = (id: string) => {
    setActiveModuleId(id);
    setExpandedGroup(null);
    const route = MODULE_ROUTES[id];
    if (route) {
      closeSheet();
      if (navigationRef.isReady()) navigationRef.navigate(route as never);
      return;
    }
    // No dashboard screen for this module yet — just switch which nav tree
    // shows below, same as web swapping activeModule without a route change.
  };

  const visibleModules = MODULE_LIST.filter((m) => (m.id === "finance" || m.id === "material") && access[m.id]);
  const initials = (currentUser?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

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
            backgroundColor: colors.primary,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
          }}
        />
        <Pressable onPress={openSheet}>
          <View
            className="flex-row items-center gap-2 px-4 py-3 rounded-2xl"
            style={{
              backgroundColor: colors.primary,
              shadowColor: colors.primary,
              shadowOpacity: 0.5,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 8,
            }}
          >
            <Grip size={16} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>Module</Text>
          </View>
        </Pressable>
      </View>

      {/* animationType="none" — the Modal's own built-in fade used to run
          alongside our `slide`-driven translate/opacity, two independent
          animations racing each other on every open/close. Now `slide` is
          the single source of truth for both the backdrop dim and the
          sheet's motion, so they move in lockstep. */}
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
              backgroundColor: colors.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
              transform: [
                {
                  translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }),
                },
              ],
            }}
          >
            <Pressable onPress={() => {}}>
              <View style={{ height: 3, backgroundColor: colors.primary }} />

              {/* Drag handle */}
              <View className="items-center pt-2 pb-1">
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
              </View>

              {/* Header row */}
              <View className="flex-row items-center gap-2.5 px-4 py-3">
                <View
                  className="w-9 h-9 rounded-lg items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
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
                  onPress={() => {
                    closeSheet();
                    logout();
                  }}
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

              {/* Module strip */}
              {visibleModules.length > 0 && (
                <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
                  {visibleModules.map((m) => {
                    // Single source of truth: whichever module's tree is
                    // selected. Mixing this with a route check (finance)
                    // let both chips light up at once — the moment you
                    // switched to Material without navigating anywhere,
                    // activeRoute was still "FinanceDashboard" from before,
                    // so Finance stayed lit too.
                    const isActive = activeModuleId === m.id;
                    return (
                      <Pressable
                        key={m.id}
                        onPress={() => goModule(m.id)}
                        className="flex-1 flex-row items-center justify-center gap-1.5 px-3 py-2 rounded-lg"
                        style={{
                          borderWidth: 1,
                          borderColor: isActive ? m.accent : colors.border,
                          backgroundColor: isActive ? `${m.accent}1f` : "transparent",
                        }}
                      >
                        <m.icon size={13} color={isActive ? m.accent : m.accent} />
                        <Text style={{ color: isActive ? m.accent : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>
                          {m.label}
                        </Text>
                        {isActive && (
                          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: m.accent, marginLeft: 2 }} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </Pressable>

            {/* Module nav — strictly scoped to the currently selected
                module; nothing renders here until a module chip is tapped,
                and only that module's own tree ever shows. */}
            <ScrollView style={{ paddingHorizontal: 16, paddingTop: 4 }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
              {activeModuleId && MODULE_NAV_TREES[activeModuleId] && (() => {
                const tree = MODULE_NAV_TREES[activeModuleId]!;
                const accent = MODULE_LIST.find((m) => m.id === activeModuleId)?.accent ?? colors.primary;
                return tree.map((item) => {
                  if (item.kind === "leaf") {
                    const active = item.nav ? activeRoute === item.nav : false;
                    return (
                      <Pressable
                        key={item.label}
                        onPress={() => (item.nav ? go(item.nav) : Alert.alert(item.label, `The ${item.label} screen isn't built on mobile yet — use the web app for now.`))}
                        className="flex-row items-center gap-3 px-3 py-3 rounded-xl mb-1.5"
                        style={{
                          backgroundColor: active ? `${accent}1f` : "transparent",
                          borderWidth: 1,
                          borderColor: active ? `${accent}4d` : "transparent",
                        }}
                      >
                        <item.icon size={16} color={active ? accent : colors.mutedForeground} />
                        <Text style={{ color: active ? accent : colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  }

                  const isExpanded = expandedGroup === item.label;
                  return (
                    <View key={item.label} className="mb-1.5">
                      <Pressable
                        onPress={() => setExpandedGroup(isExpanded ? null : item.label)}
                        className="flex-row items-center gap-3 px-3 py-3 rounded-xl"
                        style={{ backgroundColor: isExpanded ? `${colors.muted}80` : "transparent", borderWidth: 1, borderColor: isExpanded ? colors.border : "transparent" }}
                      >
                        <item.icon size={16} color={colors.mutedForeground} />
                        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold, flex: 1 }}>{item.label}</Text>
                        <ChevronRight
                          size={14}
                          color={colors.mutedForeground}
                          style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }}
                        />
                      </Pressable>
                      {isExpanded && (
                        <View style={{ marginLeft: 20, marginTop: 4, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: `${accent}40` }}>
                          {item.children.map((child) => {
                            const childActive = child.nav ? activeRoute === child.nav : false;
                            return (
                              <Pressable
                                key={child.label}
                                onPress={() => (child.nav ? go(child.nav) : Alert.alert(child.label, `The ${child.label} screen isn't built on mobile yet — use the web app for now.`))}
                                className="flex-row items-center gap-2.5 px-3 py-2.5 rounded-lg"
                              >
                                <child.icon size={14} color={childActive ? accent : colors.mutedForeground} />
                                <Text style={{ color: childActive ? accent : colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.body.medium }}>{child.label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                });
              })()}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
