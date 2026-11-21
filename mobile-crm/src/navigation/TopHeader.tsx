// The app's header and its pop-ups — Civilier Home's (mobile-maintenance src/navigation/TopHeader.tsx):
//   TopHeader          the logo (on a tab) or a round back key (on a page), the screen's name, the bell (unread CRM
//                      notifications + Maintenance alerts) and the person's initials (the account menu);
//   NotificationsMenu  the bell's drop-down: the latest CRM notifications (tap one to open what it is about) and the
//                      Maintenance alerts, "Mark all read", and the way to all of them;
//   AccountMenu        a glass card from the initials (Civilier Home's): who is signed in, My profile, Settings (the
//                      theme is set there), Sign out;
//   NavMenuSheet       the tab bar's Menu: the Approval Inbox, Customer 360, Service Tickets and Construction Updates
//                      (crmRegisters.ts MENU_LISTS) — each for staff with a right on it.
// Nothing is offered twice on one screen: notifications are the bell's, the account pages the avatar's.
// ShellMenusProvider holds which pop-up is open; useShellMenus() opens one (the tab bar's Menu key uses `nav`).
import { createContext, useContext, useEffect, useRef, useState, type ComponentRef, type PropsWithChildren, type RefObject } from "react";
import { Animated, BackHandler, Easing, Image, Text, View } from "react-native";
import { BlurTargetView, BlurView } from "expo-blur";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bell, BellRing, CheckCircle2, ChevronLeft, ChevronRight, Clock, Inbox, LogOut, Settings, UserRound, type LucideIcon } from "lucide-react-native";
import { useMaintenanceAlerts } from "@/hooks/useMaintenanceAlerts";
import { MENU_LISTS, registerByKey } from "@/screens/crm/crmRegisters";
import { fetchInbox } from "@/api/approvalInboxApi";
import { useAuth } from "@/auth/AuthContext";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import { AccentAvatar, Tap } from "@/screens/crm/ui";
import { fmtRelative, useBellCount, useCrmNotifications, useNotificationActions } from "@/screens/notifications/NotificationsScreen";
import { navigate } from "./navigationRef";

const initialsOf = (name?: string) => (name ?? "?").split(" ").filter(Boolean).map((n) => n[0]).join("").toUpperCase().slice(0, 2);
export const roleText = (r?: string) => (r || "").split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** Approvals waiting for this person — the inbox's own list (same query key), so the counts and the inbox agree. */
export function useApprovalsWaiting() {
  const { canAccessPage } = useAuth();
  const q = useQuery({ queryKey: ["approval-inbox"], queryFn: fetchInbox, enabled: canAccessPage("approval-inbox"), staleTime: 30_000 });
  return (q.data ?? []).filter((i) => i._canAct !== false).length;
}
/** The Menu key's badge: approvals waiting (what the Menu opens has waiting). */
export function useMenuCount() {
  return useApprovalsWaiting();
}

const noop = () => undefined;
const MenusCtx = createContext<{ account: () => void; nav: () => void; alerts: () => void }>({ account: noop, nav: noop, alerts: noop });
/** Opens the pop-ups: `account` (the initials' menu), `nav` (the tab bar's Menu), `alerts` (the bell's drop-down). */
export const useShellMenus = () => useContext(MenusCtx);

/** Wraps the signed-in screens so the pop-ups sit over them as frosted glass (Android blurs a BlurTargetView). */
export function ShellMenusProvider({ children }: PropsWithChildren) {
  const target = useRef<ComponentRef<typeof View>>(null);
  const [open, setOpen] = useState<"account" | "nav" | "alerts" | null>(null);
  const close = () => setOpen(null);
  return (
    <MenusCtx.Provider value={{ account: () => setOpen("account"), nav: () => setOpen("nav"), alerts: () => setOpen("alerts") }}>
      <BlurTargetView ref={target} style={{ flex: 1 }}>{children}</BlurTargetView>
      <NotificationsMenu open={open === "alerts"} onClose={close} target={target} />
      <AccountMenu open={open === "account"} onClose={close} target={target} />
      <NavMenuSheet open={open === "nav"} onClose={close} target={target} />
    </MenusCtx.Provider>
  );
}

export function TopHeader({ navigation, options, route, back }: NativeStackHeaderProps) {
  const b = useBrand();
  const { currentUser } = useAuth();
  const menus = useShellMenus();
  const bell = useBellCount();
  // Home greets the person in the page itself, so its header carries the app's name.
  const title = route.name === "Home" ? "Civilier CRM" : typeof options.title === "string" ? options.title : route.name;
  const round = { width: 40, height: 40, borderRadius: 20, backgroundColor: b.surfaceGlass, borderWidth: 1, borderColor: b.border, alignItems: "center", justifyContent: "center" } as const;
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: b.border, backgroundColor: b.surface }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: "transparent" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12, minHeight: 58 }}>
          {back ? (
            <Tap onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back" style={round}>
              <ChevronLeft size={20} color={b.textPrimary} />
            </Tap>
          ) : (
            <Image source={require("../../assets/branding/Civilier.png")} style={{ width: 30, height: 30 }} resizeMode="contain" />
          )}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary, letterSpacing: -0.3 }}>{title}</Text>
          <Tap onPress={menus.alerts} accessibilityRole="button" hitSlop={6}
            accessibilityLabel={bell ? `Notifications, ${bell} new` : "Notifications"}
            style={({ pressed }) => ({ ...round, opacity: pressed ? 0.7 : 1 })}>
            <Bell size={19} color={b.textPrimary} />
            {bell > 0 ? (
              <View style={{ position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
                backgroundColor: b.danger, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: b.surface }}>
                <Text style={{ color: "#fff", fontSize: 10, fontFamily: fonts.heading.semibold }}>{bell > 9 ? "9+" : bell}</Text>
              </View>
            ) : null}
          </Tap>
          <Tap onPress={menus.account} accessibilityRole="button" accessibilityLabel="Open account menu" hitSlop={6}
            style={({ pressed }) => ({ borderRadius: 20, opacity: pressed ? 0.8 : 1 })}>
            <AccentAvatar text={initialsOf(currentUser?.name)} />
          </Tap>
        </View>
      </SafeAreaView>
    </View>
  );
}

/** Fade + slide for a pop-up; hardware back closes it. */
function usePopup(open: boolean, onClose: () => void) {
  const t = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) setShown(true);
    Animated.timing(t, { toValue: open ? 1 : 0, duration: open ? 220 : 150, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => { if (!open) setShown(false); });
  }, [open, t]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);
  return { t, shown };
}

function Glass({ target, radius, children }: { target: RefObject<ComponentRef<typeof View> | null>; radius: number; children: React.ReactNode }) {
  const b = useBrand();
  const edge = b.isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.7)";
  const fill = b.isDark ? "rgba(24,22,36,0.93)" : "rgba(255,255,255,0.94)";
  return (
    <View style={{ borderRadius: radius, overflow: "hidden", borderWidth: 1, borderColor: edge }}>
      <BlurView intensity={60} tint={b.isDark ? "dark" : "light"} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ backgroundColor: fill }}>{children}</View>
    </View>
  );
}

function AccountMenu({ open, onClose, target }: { open: boolean; onClose: () => void; target: RefObject<ComponentRef<typeof View> | null> }) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const { currentUser, logout } = useAuth();
  const { t, shown } = usePopup(open, onClose);
  if (!shown) return null;
  const go = (route: "Profile" | "Settings") => { onClose(); navigate(route); };
  const rows: { key: string; label: string; icon: LucideIcon; onPress: () => void }[] = [
    { key: "profile", label: "My profile", icon: UserRound, onPress: () => go("Profile") },
    { key: "settings", label: "Settings", icon: Settings, onPress: () => go("Settings") },
  ];
  const line = <View style={{ height: 1, backgroundColor: b.border, marginHorizontal: 14 }} />;
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.25)", opacity: t }}>
        <Tap style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View style={{
        position: "absolute", top: insets.top + 56, right: 14, width: 264, opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
        borderRadius: 22, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
      }}>
        <Glass target={target} radius={22}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
            <AccentAvatar text={initialsOf(currentUser?.name)} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{currentUser?.name}</Text>
              <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{roleText(currentUser?.role)}</Text>
            </View>
          </View>
          {line}
          <View style={{ padding: 6 }}>
            {rows.map((it) => (
              <Tap key={it.key} onPress={it.onPress} accessibilityRole="menuitem"
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 14, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                <it.icon size={19} color={b.textPrimary} />
                <Text style={{ fontSize: 15, fontFamily: fonts.body.medium, color: b.textPrimary }}>{it.label}</Text>
              </Tap>
            ))}
          </View>
          {line}
          <View style={{ padding: 6 }}>
            <Tap onPress={() => { onClose(); void logout(); }} accessibilityRole="menuitem"
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 11, borderRadius: 14, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
              <LogOut size={19} color={b.danger} />
              <Text style={{ fontSize: 15, fontFamily: fonts.body.medium, color: b.danger }}>Sign out</Text>
            </Tap>
          </View>
        </Glass>
      </Animated.View>
    </View>
  );
}

/** The tab bar's Menu: a short list of places, each with what waits there. */
function NavMenuSheet({ open, onClose, target }: { open: boolean; onClose: () => void; target: RefObject<ComponentRef<typeof View> | null> }) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const { canAccessPage } = useAuth();
  const waiting = useApprovalsWaiting();
  const { t, shown } = usePopup(open, onClose);
  if (!shown) return null;

  const rows: { key: string; label: string; sub: string; icon: LucideIcon; badge: number; open: () => void }[] = [
    ...(canAccessPage("approval-inbox") ? [{ key: "approvals", label: "Approval Inbox", sub: waiting ? `${waiting} waiting for you` : "Nothing waiting for you", icon: Inbox, badge: waiting, open: () => navigate("Approvals") }] : []),
    ...MENU_LISTS.map((k) => registerByKey(k)!).filter((r) => r.pages.some((p) => canAccessPage(p))).map((r) => ({
      key: r.key, label: r.label, sub: r.about, icon: r.icon, badge: 0, open: () => navigate("CrmRegister", { register: r.key }),
    })),
  ];
  // Sits just above the floating tab bar (MainStack.tsx: 68 tall, lifted by the safe area + 6).
  const bottom = Math.max(insets.bottom, 10) + 6 + 68 + 10;

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)", opacity: t }}>
        <Tap style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View style={{
        position: "absolute", left: 14, right: 14, bottom, opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        borderRadius: 26, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
      }}>
        <Glass target={target} radius={26}>
          <View style={{ padding: 8 }}>
            {rows.map((r, i) => (
              <Tap key={r.key} onPress={() => { onClose(); r.open(); }} accessibilityRole="menuitem" accessibilityLabel={r.label}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 18,
                  backgroundColor: pressed ? b.surfaceGlass : "transparent", borderTopWidth: i ? 1 : 0, borderTopColor: b.border })}>
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center" }}>
                  <r.icon size={20} color={b.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{r.label}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{r.sub}</Text>
                </View>
                {r.badge ? (
                  <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: b.danger, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 11.5, fontFamily: fonts.heading.semibold }}>{r.badge > 99 ? "99+" : r.badge}</Text>
                  </View>
                ) : null}
                <ChevronRight size={18} color={b.textFaint} />
              </Tap>
            ))}
          </View>
        </Glass>
      </Animated.View>
    </View>
  );
}

const MA_ICON = { reading_due: Clock, not_checked_in: AlertTriangle, info: Bell } as const;

/** The bell's drop-down — Civilier Home's glass card under the bell: the latest CRM notifications (new ones marked;
 * tap one to open what it is about), the Maintenance alerts, "Mark all read", and the way to all of them. */
function NotificationsMenu({ open, onClose, target }: { open: boolean; onClose: () => void; target: RefObject<ComponentRef<typeof View> | null> }) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const crmQ = useCrmNotifications();
  const { markAllRead, open: openOne } = useNotificationActions();
  const { alerts } = useMaintenanceAlerts();
  const { t, shown } = usePopup(open, onClose);
  if (!shown) return null;

  const items = crmQ.data ?? [];
  const unread = items.filter((n) => !n.isRead).length;
  const latest = items.slice(0, 6);
  const heading = (text: string) => (
    <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: b.textSecondary, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 }}>{text}</Text>
  );
  const line = <View style={{ height: 1, backgroundColor: b.border, marginHorizontal: 14 }} />;

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.25)", opacity: t }}>
        <Tap style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close notifications" />
      </Animated.View>
      <Animated.View style={{
        position: "absolute", top: insets.top + 56, left: 14, right: 14, opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
        borderRadius: 22, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 14,
      }}>
        <Glass target={target} radius={22}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
            <BellRing size={18} color={b.accent} />
            <Text style={{ flex: 1, fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Notifications</Text>
            {unread > 0 ? (
              <Tap onPress={markAllRead} hitSlop={8} accessibilityRole="button">
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.accent }}>Mark all read</Text>
              </Tap>
            ) : null}
          </View>
          {line}
          <View style={{ padding: 6 }}>
            {latest.length === 0 && alerts.length === 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 12 }}>
                <CheckCircle2 size={18} color={b.success} />
                <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.body.medium, color: b.textPrimary }}>Nothing needs you right now</Text>
              </View>
            ) : null}
            {latest.length ? heading(unread ? `CRM · ${unread} unread` : "CRM") : null}
            {latest.map((n) => (
              <Tap key={n.id} onPress={() => { onClose(); openOne(n); }} accessibilityRole="menuitem"
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 14, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: n.isRead ? "transparent" : b.accent }} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: n.isRead ? fonts.body.regular : fonts.body.semibold, color: b.textPrimary }}>{n.title}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>{[fmtRelative(n.createdAt), n.body].filter(Boolean).join(" · ")}</Text>
                </View>
                <ChevronRight size={16} color={b.textFaint} style={{ marginTop: 2 }} />
              </Tap>
            ))}
            {alerts.length ? (
              <>
                {latest.length ? <View style={{ height: 1, backgroundColor: b.border, marginHorizontal: 8, marginVertical: 4 }} /> : null}
                {heading(`Maintenance · ${alerts.length}`)}
                {alerts.slice(0, 3).map((a) => {
                  const Icon = MA_ICON[a.type] ?? Bell;
                  return (
                    <Tap key={a.id} onPress={() => { onClose(); navigate(a.route as never, a.params as never); }} accessibilityRole="menuitem"
                      style={({ pressed }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 14, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
                      <Icon size={16} color={b.warning} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.body.medium, color: b.textPrimary }}>{a.title}</Text>
                        <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>{a.subtitle}</Text>
                      </View>
                    </Tap>
                  );
                })}
              </>
            ) : null}
          </View>
          {line}
          <Tap onPress={() => { onClose(); navigate("Notifications"); }} accessibilityRole="menuitem"
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.accent }}>See all notifications</Text>
            <ChevronRight size={16} color={b.accent} />
          </Tap>
        </Glass>
      </Animated.View>
    </View>
  );
}
