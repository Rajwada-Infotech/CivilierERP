// Shared stack header — mirrors mobile-supplier's TopHeader.tsx exactly:
// animated logo on the left, notification bell (badge =
// useMaintenanceAlerts().alerts.length) and profile avatar on the right. No
// hamburger/menu button — there's nothing behind it yet (see MainStack.tsx),
// and Dashboard/Notifications/Profile are all reachable without one.
import { createContext, useContext, useEffect, useRef, useState, type ComponentRef, type PropsWithChildren, type RefObject } from "react";
import { Animated, BackHandler, Easing, Image, View, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurTargetView, BlurView } from "expo-blur";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { Bell, Building2, Check, ChevronDown, ChevronLeft, FileSignature, FileText, HardHat, LogOut, Radio, Settings, UserRound, type LucideIcon } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { portal } from "@/api/customerPortalApi";
import { colors, sheet } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { useMaintenanceAlerts } from "@/hooks/useMaintenanceAlerts";
import { AnimatedLogo } from "@/components/AnimatedLogo";
import { navigate, navigationRef } from "./navigationRef";
import { useBrand } from "@/theme/ThemeContext";
import { useCustomer } from "@/customer/CustomerContext";
import { useNeedsYou } from "@/customer/todo";
import { displayName, Tap, AccentAvatar } from "@/customer/ui";

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
  const { currentUser } = useAuth();
  // A customer's header: back, the screen's title and their own profile. The staff header's alerts read staff
  // data, which a customer's sign-in can't (and mustn't) load.
  return currentUser?.kind === "customer" ? <CustomerHeader {...props} /> : <StaffHeader />;
}

/** A customer's header: back (on a page) or the logo (on a tab), the screen's name, and one button — their initials —
 * which opens the account menu (AccountDrawer): profile, settings, sign out. */
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
const AccountMenuCtx = createContext<{ account: () => void; nav: () => void; property: () => void }>({ account: noop, nav: noop, property: noop });
/** Opens the customer pop-ups: `account` (the avatar's menu), `nav` (the tab bar's Menu sheet), `property` (the
 * header's property picker). */
export const useCustomerMenus = () => useContext(AccountMenuCtx);

/** Wraps the customer screens so their pop-ups (the account menu, the Menu sheet) can sit over them as real frosted
 * glass: the screens render inside a BlurTargetView, which is what the pop-ups' BlurView blurs (Android needs that
 * target; iOS and web blur on their own). */
export function AccountMenuProvider({ children }: PropsWithChildren) {
  const target = useRef<ComponentRef<typeof View>>(null);
  const [open, setOpen] = useState<"account" | "nav" | "property" | null>(null);
  const close = () => setOpen(null);
  return (
    <AccountMenuCtx.Provider value={{ account: () => setOpen("account"), nav: () => setOpen("nav"), property: () => setOpen("property") }}>
      <BlurTargetView ref={target} style={{ flex: 1 }}>{children}</BlurTargetView>
      <AccountMenu open={open === "account"} onClose={close} target={target} />
      <NavMenuSheet open={open === "nav"} onClose={close} target={target} />
      <PropertyPicker open={open === "property"} onClose={close} target={target} />
    </AccountMenuCtx.Provider>
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

  const go = (route: string) => { onClose(); navigationRef.navigate(route as never); };
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
  const go = (route: string) => { onClose(); navigationRef.navigate(route as never); };
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

function StaffHeader() {
  const { currentUser } = useAuth();
  const { alerts } = useMaintenanceAlerts();
  const alertCount = alerts.length;

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: `${colors.border}80` }}
    >
      <View className="flex-row items-center justify-between px-4 py-2.5">
        <View className="flex-1 min-w-0">
          <AnimatedLogo iconSize={28} />
        </View>

        <View className="flex-row items-center gap-3">
          <Tap onPress={() => navigate("Notifications")} style={{ padding: 2 }}>
            <View>
              <Bell size={20} color={colors.foreground} />
              {alertCount > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -4,
                    minWidth: 15,
                    height: 15,
                    borderRadius: 8,
                    paddingHorizontal: 3,
                    backgroundColor: "#ef4444",
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1.5,
                    borderColor: colors.background,
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 9, fontFamily: fonts.heading.bold, lineHeight: 11 }}>
                    {alertCount > 9 ? "9+" : alertCount}
                  </Text>
                </View>
              )}
            </View>
          </Tap>

          <Tap onPress={() => navigate("Profile")}>
            <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: ACCENT }}>
              <Text style={{ color: "#1a1a1a", fontSize: 11, fontFamily: fonts.heading.bold }}>
                {initialsOf(currentUser?.name)}
              </Text>
            </View>
          </Tap>
        </View>
      </View>
    </SafeAreaView>
  );
}