// The customer's stack header: back (on a page) or the logo (on a tab), the screen's name, the bell (what needs them
// and recent updates) and their initials (profile, settings, sign out). See CustomerHeader below.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentRef, type PropsWithChildren, type RefObject } from "react";
import { Animated, BackHandler, Easing, Image, ScrollView, View, Text, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurTargetView, BlurView } from "expo-blur";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Bell, BellRing, Building2, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileSignature, FileText, HardHat, LogOut, Radio, Settings, UserRound, type LucideIcon } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { portal } from "@/api/customerPortalApi";
import { colors, sheet } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { navigate, navigationRef, openCustomerScreen } from "./navigationRef";
import { useBrand } from "@/theme/ThemeContext";
import { useCustomer } from "@/customer/CustomerContext";
import { useNeedsYou } from "@/customer/todo";
import { ago, displayName, Tap, AccentAvatar } from "@/customer/ui";

const ACCENT = "#65a30d";

function initialsOf(name?: string) {
  return (name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TopHeader(props: NativeStackHeaderProps) {
  return <CustomerHeader {...props} />;
}

/** A customer's header: back (on a page) or the logo (on a tab), the screen's name, the bell — what needs them and
 * recent updates (NotificationsMenu) — and their initials, which open the account menu: profile, settings, sign out. */
function CustomerHeader({ navigation, options, route, back }: NativeStackHeaderProps) {
  const { currentUser } = useAuth();
  const { me, app, homes } = useCustomer();
  const b = useBrand();
  const menus = useContext(AccountMenuCtx);
  const openMenu = menus.account;
  // Which property this page is about, and a way to switch — on property pages, when there is more than one to pick
  // from (Home has its own switcher; customer-wide pages and a single bill have no property to switch).
  const choices = homes.length + (app?.Lifecycle === "Past" ? 1 : 0);
  const showProperty = PROPERTY_PAGES.has(route.name) && choices > 1 && !!app;
  const isHome = route.name === "CustomerHome";
  // Home greets the customer by name in the page itself, so its header carries the app's name instead of "Home".
  const title = isHome ? "Civilier Home" : options.title ?? route.name;
  const round = { width: 40, height: 40, borderRadius: 20, backgroundColor: b.surfaceGlass, borderWidth: 1, borderColor: b.border, alignItems: "center", justifyContent: "center" } as const;
  // Glass: the bar floats over the page (headerTransparent, CustomerStack.tsx) and pages scroll under it. iOS and web
  // blur what passes beneath; Android shows the same see-through frosted fill (the bar sits inside the area the
  // account menu blurs, and a blur can't sit inside its own target).
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: b.border }}>
      <BlurView intensity={40} tint={b.isDark ? "dark" : "light"} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: b.chrome }} />
    <SafeAreaView edges={["top"]} style={{ backgroundColor: "transparent" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, gap: 12, minHeight: 58 }}>
        {back ? (
          <Tap onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={round}>
            <ChevronLeft size={20} color={b.textPrimary} />
          </Tap>
        ) : (
          <Image source={require("../../assets/branding/Civilier.png")} style={{ width: 30, height: 30 }} resizeMode="contain" />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: -0.3 }}>{title}</Text>
          {showProperty && app ? (
            <Tap onPress={menus.property} accessibilityRole="button" accessibilityLabel={`Property: ${propertyName(app)}. Change property`} hitSlop={6}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
              <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.gold, flexShrink: 1 }}>
                {propertyName(app)}{app.Lifecycle === "Past" ? ` · ${app.StateLabel}` : ""}
              </Text>
              <ChevronDown size={14} color={b.gold} />
            </Tap>
          ) : null}
        </View>
        <Tap onPress={menus.alerts} accessibilityRole="button" hitSlop={6}
          accessibilityLabel={menus.alertCount ? `Notifications, ${menus.alertCount} new` : "Notifications"}
          style={({ pressed }) => ({ ...round, opacity: pressed ? 0.7 : 1 })}>
          <Bell size={19} color={b.textPrimary} />
          {menus.alertCount > 0 ? (
            <View style={{ position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
              backgroundColor: b.danger, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: b.surface }}>
              <Text style={{ color: "#fff", fontSize: 10, fontFamily: fonts.heading.semibold }}>{menus.alertCount > 9 ? "9+" : menus.alertCount}</Text>
            </View>
          ) : null}
        </Tap>
        <Tap onPress={openMenu} accessibilityRole="button" accessibilityLabel="Open account menu" hitSlop={6}
          style={({ pressed }) => ({ borderRadius: 20, opacity: pressed ? 0.8 : 1 })}>
          {/* Same name as the menu shows: the customer record first, the sign-in name until it loads. */}
          <AccentAvatar text={initialsOf(me.data?.Name || currentUser?.name)} />
        </Tap>
      </View>
    </SafeAreaView>
    </View>
  );
}

/** Pages that show one property's data (the customer's chosen application). Home is one too, but switches in-page. */
// (My bookings lists every booking, so it is customer-wide and not here.)
const PROPERTY_PAGES = new Set(["CustomerPayments", "CustomerBills", "CustomerRequests", "CustomerConstruction", "CustomerDocuments", "CustomerActivity"]);
/** A property as the customer knows it: "P-120 · Silver Woods". */
const propertyName = (a: { UnitNo: string | null; ApplicationNo: string; ProjectName: string | null; InterestedProject: string | null }) =>
  [a.UnitNo || a.ApplicationNo, displayName(a.ProjectName || a.InterestedProject)].filter(Boolean).join(" · ");

const noop = () => undefined;
const AccountMenuCtx = createContext<{ account: () => void; nav: () => void; property: () => void; alerts: () => void; alertCount: number }>(
  { account: noop, nav: noop, property: noop, alerts: noop, alertCount: 0 });
/** Opens the customer pop-ups: `account` (the avatar's menu), `nav` (the tab bar's Menu sheet), `property` (the
 * header's property picker), `alerts` (the bell's notifications); `alertCount` is the bell's badge. */
export const useCustomerMenus = () => useContext(AccountMenuCtx);

/** Wraps the customer screens so their pop-ups (the account menu, the Menu sheet) can sit over them as real frosted
 * glass: the screens render inside a BlurTargetView, which is what the pop-ups' BlurView blurs (Android needs that
 * target; iOS and web blur on their own). */
export function AccountMenuProvider({ children }: PropsWithChildren) {
  const target = useRef<ComponentRef<typeof View>>(null);
  const [open, setOpen] = useState<"account" | "nav" | "property" | "alerts" | null>(null);
  const close = () => setOpen(null);
  const alerts = useAlerts();
  return (
    <AccountMenuCtx.Provider value={{ account: () => setOpen("account"), nav: () => setOpen("nav"), property: () => setOpen("property"),
      alerts: () => setOpen("alerts"), alertCount: alerts.count }}>
      <BlurTargetView ref={target} style={{ flex: 1 }}>{children}</BlurTargetView>
      <NotificationsMenu open={open === "alerts"} onClose={close} target={target} alerts={alerts} />
      <AccountMenu open={open === "account"} onClose={close} target={target} />
      <NavMenuSheet open={open === "nav"} onClose={close} target={target} />
      <PropertyPicker open={open === "property"} onClose={close} target={target} />
    </AccountMenuCtx.Provider>
  );
}

const SEEN_KEY = "civ_customer_updates_seen_at";
/** What the bell shows: everything that needs the customer (all homes; the server's one rule, crmPortal.js needsYou)
 * and the chosen property's latest updates. Updates newer than the last time the bell was opened count as new. */
function useAlerts() {
  const { appId } = useCustomer();
  const needs = useNeedsYou();
  const feed = useQuery({ queryKey: ["portal-activity", appId], queryFn: () => portal.activity(appId as number), enabled: appId != null });
  const [seenAt, setSeenAt] = useState<number | null>(null);
  useEffect(() => { AsyncStorage.getItem(SEEN_KEY).then((v) => setSeenAt(v ? Number(v) : 0)).catch(() => setSeenAt(0)); }, []);
  const updates = [...(feed.data || [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);
  const isNew = (at: string) => seenAt != null && new Date(at).getTime() > seenAt;
  const markSeen = useCallback(() => {
    const now = Date.now();
    setSeenAt(now);
    AsyncStorage.setItem(SEEN_KEY, String(now)).catch(() => undefined);
  }, []);
  const todo = needs.data || [];
  return { todo, updates, isNew, markSeen, loading: needs.isLoading, count: todo.length + updates.filter((u) => isNew(u.at)).length };
}

/** The bell's drawer — the same glass card as the account menu, wider: what needs the customer (each opens the page
 * that does it, on the property it is about), then the latest updates and the way to all of them. */
function NotificationsMenu({ open, onClose, target, alerts }: {
  open: boolean; onClose: () => void; target: RefObject<ComponentRef<typeof View> | null>; alerts: ReturnType<typeof useAlerts>;
}) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { apps, homes, appId, setAppId } = useCustomer();
  const t = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);
  // What was new when the drawer opened stays marked while it is open; closing it marks everything seen.
  const [newAt, setNewAt] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setShown(true);
      setNewAt(new Set(alerts.updates.filter((u) => alerts.isNew(u.at)).map((u) => u.at)));
    }
    Animated.timing(t, { toValue: open ? 1 : 0, duration: open ? 200 : 150, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => { if (!open) setShown(false); });
    if (!open && shown) alerts.markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, t]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);
  if (!shown) return null;

  const nameOf = (id: number | null) => {
    const a = id == null ? null : (apps.data || []).find((x) => x.ApplicationId === id);
    return a ? [a.UnitNo || a.ApplicationNo, displayName(a.ProjectName || a.InterestedProject)].filter(Boolean).join(" · ") : "";
  };
  /** Open the page that does it, on the property it is about. */
  const act = (x: (typeof alerts.todo)[number]) => {
    if (x.applicationId && x.applicationId !== appId) setAppId(x.applicationId);
    onClose();
    openCustomerScreen(x.route);
  };
  const go = (route: string) => { onClose(); openCustomerScreen(route); };
  const glassEdge = b.isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.7)";
  // Denser than the account menu: its rows are sentences, which must read cleanly over whatever page is behind.
  const glassFill = b.isDark ? "rgba(24,22,36,0.94)" : "rgba(255,255,255,0.95)";
  const heading = (text: string) => (
    <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: b.textSecondary, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 }}>{text}</Text>
  );

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.25)", opacity: t }}>
        <Tap style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close notifications" />
      </Animated.View>
      <Animated.View style={{
        position: "absolute", top: insets.top + 56, right: 14, width: Math.min(340, width - 28),
        opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
        borderRadius: 22, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
      }}>
        <View style={{ borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: glassEdge }}>
          <BlurView intensity={60} tint={b.isDark ? "dark" : "light"} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ backgroundColor: glassFill }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
              <BellRing size={18} color={b.gold} />
              <Text style={{ flex: 1, fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Notifications</Text>
            </View>
            <View style={{ height: 1, backgroundColor: glassEdge, marginHorizontal: 14 }} />
            <ScrollView style={{ maxHeight: height * 0.62 }} contentContainerStyle={{ padding: 6 }}>
              {/* What needs them — every home */}
              {alerts.todo.length ? heading("Needs your attention") : null}
              {alerts.todo.map((x) => (
                <Tap key={`${x.applicationId}-${x.kind}-${x.label}`} onPress={() => act(x)} accessibilityRole="menuitem"
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 14,
                    backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: x.urgent ? b.danger : b.gold }} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={{ fontSize: 14.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{x.label}</Text>
                    {x.sub ? <Text style={{ fontSize: 12.5, lineHeight: 17, fontFamily: fonts.body.regular, color: b.textSecondary }}>{x.sub}</Text> : null}
                    {homes.length > 1 && nameOf(x.applicationId) ? (
                      <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.gold }}>{nameOf(x.applicationId)}</Text>
                    ) : null}
                  </View>
                  <ChevronRight size={17} color={b.textFaint} style={{ marginTop: 2 }} />
                </Tap>
              ))}
              {!alerts.todo.length && !alerts.loading ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 12 }}>
                  <CheckCircle2 size={18} color={b.success} />
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.body.medium, color: b.textPrimary }}>Nothing needs you right now</Text>
                </View>
              ) : null}

              {/* What happened lately — the chosen property */}
              {alerts.updates.length ? (
                <>
                  <View style={{ height: 1, backgroundColor: glassEdge, marginHorizontal: 8, marginVertical: 4 }} />
                  {heading(homes.length > 1 && appId != null ? `Recent updates · ${nameOf(appId)}` : "Recent updates")}
                  {alerts.updates.map((u, i) => (
                    <View key={`${u.at}-${i}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 10, paddingVertical: 9 }}>
                      <Radio size={16} color={newAt.has(u.at) ? b.gold : b.textFaint} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text numberOfLines={2} style={{ fontSize: 14, fontFamily: newAt.has(u.at) ? fonts.body.semibold : fonts.body.regular, color: b.textPrimary }}>{u.title}</Text>
                        <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                          {[newAt.has(u.at) ? "New" : null, ago(u.at), u.detail].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                    </View>
                  ))}
                </>
              ) : null}
            </ScrollView>
            <View style={{ height: 1, backgroundColor: glassEdge, marginHorizontal: 14 }} />
            <Tap onPress={() => go("CustomerActivity")} accessibilityRole="menuitem"
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13,
                backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
              <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.gold }}>See all updates</Text>
              <ChevronRight size={16} color={b.gold} />
            </Tap>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** The rest of the Customer Portal — every page the bottom bar has no room for, grouped as the web portal's sidebar
 * groups them (PortalLayout.tsx NAV_GROUPS). No page appears in two menus: Home, Payments, Bills and Help are on the
 * bar; My profile and Settings are in the avatar's account menu (AccountMenu). */
const NAV_SECTIONS: { title: string; items: { route: string; label: string; icon: LucideIcon; deedBadge?: boolean }[] }[] = [
  { title: "My property", items: [
    { route: "CustomerBooking", label: "My bookings", icon: Building2 },
    { route: "CustomerConstruction", label: "Construction", icon: HardHat },
  ] },
  { title: "Documents", items: [
    { route: "CustomerDocuments", label: "Agreement", icon: FileText },
    { route: "CustomerTransferDeed", label: "Transfer deed", icon: FileSignature, deedBadge: true },
  ] },
  { title: "Updates", items: [
    { route: "CustomerActivity", label: "Updates & approvals", icon: Radio },
  ] },
];

/** The header's property picker: every live home (and the past one being viewed), what needs you on each, and the
 * current one ticked. Choosing one switches every property page at once (they all read the chosen application). */
function PropertyPicker({ open, onClose, target }: { open: boolean; onClose: () => void; target: RefObject<ComponentRef<typeof View> | null> }) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const { homes, app, appId, setAppId } = useCustomer();
  const needs = useNeedsYou();
  const t = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) setShown(true);
    Animated.timing(t, { toValue: open ? 1 : 0, duration: open ? 200 : 150, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => { if (!open) setShown(false); });
  }, [open, t]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);
  if (!shown) return null;

  const list = app?.Lifecycle === "Past" ? [...homes, app] : homes;
  const countFor = (id: number) => (needs.data || []).filter((x) => x.applicationId === id).length;
  const glassEdge = b.isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.7)";
  const glassFill = b.isDark ? "rgba(24,22,36,0.93)" : "rgba(255,255,255,0.93)";

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.3)", opacity: t }}>
        <Tap style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close property list" />
      </Animated.View>
      <Animated.View style={{
        position: "absolute", top: insets.top + 62, left: 14, right: 14,
        opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
        borderRadius: 22, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
      }}>
        <View style={{ borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: glassEdge }}>
          <BlurView intensity={60} tint={b.isDark ? "dark" : "light"} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ backgroundColor: glassFill, padding: 8 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: b.textSecondary, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 }}>Show this page for</Text>
            {list.map((a) => {
              const on = a.ApplicationId === appId;
              const n = countFor(a.ApplicationId);
              return (
                <Tap key={a.ApplicationId} onPress={() => { setAppId(a.ApplicationId); onClose(); }} accessibilityRole="menuitem" accessibilityState={{ selected: on }}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 14,
                    backgroundColor: on ? b.goldSoft : pressed ? b.surfaceGlass : "transparent" })}>
                  <Building2 size={19} color={on ? b.gold : b.textSecondary} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{a.UnitNo || a.ApplicationNo}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                      {[displayName(a.ProjectName || a.InterestedProject), a.StateLabel, a.IsCoApplicant ? "Joint applicant" : null].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  {n ? (
                    <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: b.gold, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11.5, color: "#14110A" }}>{n}</Text>
                    </View>
                  ) : null}
                  {on ? <Check size={18} color={b.gold} /> : null}
                </Tap>
              );
            })}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** The tab bar's Menu: a glass sheet that rises above the bar with the pages above as tiles. */
function NavMenuSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: RefObject<ComponentRef<typeof View> | null> }) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const deeds = useQuery({ queryKey: ["portal-transfer-deeds"], queryFn: portal.transferDeeds, enabled: open });
  const deedTodo = (deeds.data || []).reduce((n, v) => n + v.todo, 0);
  const t = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) setShown(true);
    Animated.timing(t, { toValue: open ? 1 : 0, duration: open ? 230 : 160, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => { if (!open) setShown(false); });
  }, [open, t]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);
  if (!shown) return null;

  const go = (route: string) => { onClose(); openCustomerScreen(route); };
  const glassEdge = b.isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.7)";
  const glassFill = b.isDark ? "rgba(24,22,36,0.93)" : "rgba(255,255,255,0.93)";
  // Sits just above the floating tab bar (CustomerStack.tsx: 68 tall, lifted by the safe area + 6).
  const bottom = Math.max(insets.bottom, 10) + 6 + 68 + 10;

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)", opacity: t }}>
        <Tap style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View style={{
        position: "absolute", left: 14, right: 14, bottom,
        opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        borderRadius: 26, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
      }}>
        <View style={{ borderRadius: 26, overflow: "hidden", borderWidth: 1, borderColor: glassEdge }}>
          <BlurView intensity={60} tint={b.isDark ? "dark" : "light"} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ backgroundColor: glassFill, padding: 16, gap: 14 }}>
            {NAV_SECTIONS.map((sec) => (
              <View key={sec.title} style={{ gap: 8 }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: b.textSecondary, paddingHorizontal: 2 }}>{sec.title}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {sec.items.map((it) => {
                    const badge = it.deedBadge ? deedTodo : 0;
                    return (
                      <Tap key={it.route} onPress={() => go(it.route)} accessibilityRole="menuitem" accessibilityLabel={it.label}
                        style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 7, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 16,
                          backgroundColor: pressed ? b.goldSoft : b.surfaceGlass })}>
                        <View>
                          <it.icon size={21} color={b.gold} />
                          {badge > 0 ? (
                            <View style={{ position: "absolute", top: -6, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: b.danger, alignItems: "center", justifyContent: "center" }}>
                              <Text style={{ color: "#fff", fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{badge}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{it.label}</Text>
                      </Tap>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** The account menu: a small glass card that grows out of the initials button. Who is signed in, then Profile,
 * Settings, Sign out. Tapping outside or the back button closes it. */
function AccountMenu({ open, onClose, target }: { open: boolean; onClose: () => void; target: RefObject<ComponentRef<typeof View> | null> }) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const { me } = useCustomer();
  const t = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) setShown(true);
    Animated.timing(t, { toValue: open ? 1 : 0, duration: open ? 200 : 150, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => { if (!open) setShown(false); });
  }, [open, t]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);
  if (!shown) return null;

  const name = displayName(me.data?.Name || currentUser?.name) || "Customer";
  const contact = me.data?.Email || me.data?.Mobile || "";
  const go = (route: string) => { onClose(); openCustomerScreen(route); };
  const items: { key: string; label: string; icon: LucideIcon; onPress: () => void; danger?: boolean }[] = [
    { key: "profile", label: "My profile", icon: UserRound, onPress: () => go("CustomerProfile") },
    { key: "settings", label: "Settings", icon: Settings, onPress: () => go("CustomerSettings") },
    { key: "logout", label: "Sign out", icon: LogOut, danger: true, onPress: () => { onClose(); void logout(); } },
  ];
  const glassEdge = b.isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.7)";
  // Dense enough to read even where the blur can't run (older Android, web) — the frosted look, never see-through text.
  const glassFill = b.isDark ? "rgba(26,24,38,0.82)" : "rgba(255,255,255,0.84)";

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.25)", opacity: t }}>
        <Tap style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View style={{
        position: "absolute", top: insets.top + 56, right: 14, width: 248,
        opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
        borderRadius: 22, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
      }}>
        <View style={{ borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: glassEdge }}>
          {/* The blur sits behind; the frosted fill is its own layer on top (BlurView replaces its own background colour). */}
          <BlurView intensity={60} tint={b.isDark ? "dark" : "light"} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ backgroundColor: glassFill }}>
            {/* Who is signed in */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
              <AccentAvatar text={initialsOf(name)} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{name}</Text>
                {contact ? <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{contact}</Text> : null}
              </View>
            </View>
            <View style={{ height: 1, backgroundColor: glassEdge, marginHorizontal: 14 }} />
            {/* Menu */}
            <View style={{ padding: 6 }}>
              {items.map((it) => (
                <Tap key={it.key} onPress={it.onPress} accessibilityRole="menuitem"
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 14,
                    backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                  <it.icon size={19} color={it.danger ? b.danger : b.textPrimary} />
                  <Text style={{ fontSize: 15, fontFamily: fonts.body.medium, color: it.danger ? b.danger : b.textPrimary }}>{it.label}</Text>
                </Tap>
              ))}
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}
