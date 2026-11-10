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
  FileCheck2, Package, Ship, ClipboardList, RotateCcw,
  ArchiveRestore, TrendingUp, ArrowLeftRight as SwapIcon, Repeat,
  ClipboardEdit, Landmark, PiggyBank,
} from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { sheet as S } from "@/theme/colors";
import { Press } from "@/components/sheet/Sheet";
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

/** The module a screen belongs to: its dashboard, or any page in its menu tree (null for neither). */
function moduleOfRoute(route: string): string | null {
  for (const [mod, dash] of Object.entries(MODULE_ROUTES)) if (dash === route) return mod;
  for (const [mod, tree] of Object.entries(MODULE_NAV_TREES)) {
    for (const item of tree ?? []) {
      if (item.kind === "leaf" ? item.nav === route : item.children.some((c) => c.nav === route)) return mod;
    }
  }
  return null;
}

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
// group: Trial Balance, Balance Sheet, Profit & Loss, Balance Enquiry). Every leaf opens its own screen.
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
    children: [
      { label: "Trial Balance", icon: Scale, nav: "TrialBalance" },
      { label: "Balance Sheet", icon: Landmark, nav: "BalanceSheet" },
      { label: "Profit & Loss", icon: TrendingUp, nav: "ProfitLoss" },
      { label: "Balance Enquiry", icon: PiggyBank, nav: "BalanceEnquiry" },
    ],
  },
];

// RN port of materialNavItems (MaterialSidebar.ts) — same tree, same order,
// same 9 entries (no "Suppliers" leaf — that doesn't exist on web's
// Material sidebar and was mobile-only drift, removed). Leaves without a
// `nav`
// would have no mobile screen and alert instead; every leaf now has one.
const MATERIAL_NAV_TREE: NavTree = [
  { kind: "leaf", label: "Material Dashboard", icon: LayoutDashboard, nav: "MaterialDashboard" },
  {
    kind: "group",
    label: "Transaction",
    icon: Receipt,
    children: [
      { label: "Material Request", icon: ClipboardList, nav: "MaterialRequest" },
      { label: "Quotation", icon: FileCheck2, nav: "Quotation" },
      { label: "Purchase Order", icon: FileText, nav: "PurchaseOrder" },
      { label: "Vehicle In/Out", icon: Ship, nav: "VehicleInOut" },
      { label: "GRN", icon: Package, nav: "GRN" },
      { label: "Issues", icon: ArchiveRestore, nav: "MaterialIssues" },
      { label: "Issue Return", icon: RotateCcw, nav: "MaterialIssueReturn" },
    ],
  },
  { kind: "leaf", label: "Short Close", icon: ArchiveRestore, nav: "ShortClose" },
  { kind: "leaf", label: "L1 Chart", icon: TrendingUp, nav: "L1Chart" },
  { kind: "leaf", label: "Stock", icon: SwapIcon, nav: "Stock" },
  { kind: "leaf", label: "Transfer", icon: Repeat, nav: "StockTransfer" },
  { kind: "leaf", label: "Debit Note", icon: ClipboardEdit, nav: "DebitNote" },
];

/** Pages that are forms: the menu key is hidden there. */
const FORM_ROUTES = new Set<string>(["PaymentForm", "ReceivedPaymentForm", "JournalVoucherForm", "NewContract", "NewInvoice", "MaterialRequestForm", "QuotationForm", "DebitNoteForm", "StockTransferForm", "IssueReturnForm", "MaterialIssueForm", "GRNForm", "VehicleInOutForm", "PurchaseOrderForm"]);

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

  useEffect(() => {
    const unsub = navigationRef.addListener?.("state", () => {
      const name = navigationRef.getCurrentRoute()?.name;
      setActiveRoute(name);
      // The selected module follows the screen that is open: the home dashboard clears it (it used to stay on Finance
      // or Material after going back home), a module's own page selects that module. Screens of neither (Profile,
      // Notifications) leave it as it was.
      if (name === "Dashboard") setActiveModuleId(null);
      else if (name) {
        const owner = moduleOfRoute(name);
        if (owner) setActiveModuleId(owner);
      }
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

  // The full-page forms have their own Save bar along the bottom; the menu key would sit on it, so it steps aside there.
  const onForm = !!activeRoute && FORM_ROUTES.has(activeRoute);

  const comingLater = (label: string) => Alert.alert(label, `The ${label} screen isn't built on mobile yet. Use the web app for now.`);

  return (
    <>
      {/* The menu key: a filled ink key, square, at the bottom right (not on a form page). */}
      {!onForm && (
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
          <Text style={{ color: S.paper, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>Modules</Text>
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

              {/* Modules: ink segments, the open one filled. */}
              {visibleModules.length > 0 && (
                <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 8 }}>
                  <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: S.graphite }}>Module</Text>
                  <View style={{ flexDirection: "row", borderWidth: 1, borderColor: S.ink }}>
                    {visibleModules.map((m, i) => {
                      const isActive = activeModuleId === m.id;
                      return (
                        <Press
                          key={m.id}
                          onPress={() => goModule(m.id)}
                          style={(pressed) => ({
                            flex: 1,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            minHeight: 40,
                            borderLeftWidth: i ? 1 : 0,
                            borderLeftColor: S.ink,
                            backgroundColor: isActive ? S.ink : pressed ? S.blueWash : "transparent",
                          })}
                        >
                          <m.icon size={13} color={isActive ? S.paper : S.ink} />
                          <Text style={{ color: isActive ? S.paper : S.ink, fontSize: 10.5, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>{m.label}</Text>
                        </Press>
                      );
                    })}
                  </View>
                </View>
              )}
            </Pressable>

            {/* Only the selected module's own tree shows, as on the web. */}
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}>
              {activeModuleId && MODULE_NAV_TREES[activeModuleId] && (
                <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                  {MODULE_NAV_TREES[activeModuleId]!.map((item) => {
                    if (item.kind === "leaf") {
                      return row(item.label, item.label, item.icon, !!item.nav && activeRoute === item.nav, () => (item.nav ? go(item.nav) : comingLater(item.label)));
                    }
                    const isExpanded = expandedGroup === item.label;
                    return (
                      <View key={item.label}>
                        <Press
                          onPress={() => setExpandedGroup(isExpanded ? null : item.label)}
                          style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                        >
                          <item.icon size={16} color={S.ink} />
                          <Text style={{ flex: 1, color: S.ink, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>{item.label}</Text>
                          <ChevronRight size={14} color={S.graphite} style={{ transform: [{ rotate: isExpanded ? "90deg" : "0deg" }] }} />
                        </Press>
                        {isExpanded && (
                          <View style={{ marginLeft: 20, borderLeftWidth: 1, borderLeftColor: S.ink }}>
                            {item.children.map((child) =>
                              row(`${item.label}/${child.label}`, child.label, child.icon, !!child.nav && activeRoute === child.nav, () => (child.nav ? go(child.nav) : comingLater(child.label)), true),
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}
