// RN port of src/components/navbar/ReminderBell.tsx — the header's bell and its reminders panel, drawn on the sheet as
// the web draws it: the bell with a red count tag; a panel dropping from under the header (paper on the faint grid, an
// ink border with a hard offset shadow, a 3px strip along the top) that swells out of the bell like the web's genie.
// Its title block reads "CivilierERP · Reminders", the pending figure, the overdue count in red and a refresh key (it
// locks after a burst of taps, as on the web); squared filter tabs with a count each; the reminders split into Overdue /
// Due today / Coming up under ruled headings; numbered rows with the type's mark, the title, a line under it, a square
// due mark (red overdue, solid today, hatched later), how far off and the date, and the amount. A tap opens the
// reminder's register where this app has one; tapping outside closes the panel.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, Animated, Easing, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Svg, { Line } from "react-native-svg";
import { Bell, ClipboardList, FileWarning, HardHat, Landmark, Lock, Package, RefreshCw, ShoppingCart } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import type { MainStackParamList } from "@/navigation/MainStack";
import { IconKey, Press, motionOff } from "@/components/sheet/Sheet";
import { formatDay, formatRelative, useReminders, type ReminderItem, type ReminderType } from "./reminders";

const TYPE_META: Record<ReminderType, { icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>; label: string }> = {
  purchase_order: { icon: ShoppingCart, label: "PO" },
  work_order: { icon: HardHat, label: "WO" },
  tds: { icon: FileWarning, label: "TDS" },
  grn: { icon: Package, label: "GRN" },
  emi_installment: { icon: Lock, label: "EMI" },
  material_request: { icon: ClipboardList, label: "MR" },
  pdc: { icon: Landmark, label: "PDC" },
};
const TABS: ("all" | ReminderType)[] = ["all", "material_request", "purchase_order", "grn", "work_order", "pdc", "emi_installment", "tds"];

function Cap({ children, color = S.graphite, style }: { children: React.ReactNode; color?: string; style?: object }) {
  return <Text style={[{ fontFamily: fonts.heading.semibold, fontSize: 9.5, letterSpacing: 1.3, textTransform: "uppercase", color }, style]}>{children}</Text>;
}

/** The square due mark: red overdue, solid ink today, hatched still to come. */
function DueDot({ tone }: { tone: "red" | "solid" | "hatch" }) {
  return (
    <View style={{ width: 8, height: 8, borderWidth: 1, borderColor: tone === "red" ? S.red : S.ink, backgroundColor: tone === "red" ? S.red : tone === "solid" ? S.ink : "transparent", overflow: "hidden" }}>
      {tone === "hatch" && (
        <Svg width={8} height={8} style={{ position: "absolute" }}>
          <Line x1={-1} y1={3} x2={3} y2={-1} stroke={S.ink} strokeWidth={0.8} />
          <Line x1={-1} y1={7} x2={7} y2={-1} stroke={S.ink} strokeWidth={0.8} />
          <Line x1={3} y1={9} x2={9} y2={3} stroke={S.ink} strokeWidth={0.8} />
        </Svg>
      )}
    </View>
  );
}

function SpinIcon({ spinning }: { spinning: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning || motionOff("menus")) return;
    v.setValue(0);
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.bezier(0.15, 0, 0, 1), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spinning, v]);
  return (
    <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
      <RefreshCw size={13} color={S.ink} />
    </Animated.View>
  );
}

const Row = React.memo(function Row({ r, n, onPress }: { r: ReminderItem; n: number; onPress?: () => void }) {
  const meta = TYPE_META[r.type];
  const Icon = meta?.icon ?? Package;
  const tone = r.urgency === "overdue" ? "red" : r.urgency === "today" ? "solid" : "hatch";
  return (
    <Press
      onPress={onPress}
      disabled={!onPress}
      style={(pressed) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: S.ruleSoft,
        backgroundColor: pressed ? S.blueWash : "transparent",
        borderLeftWidth: 3,
        borderLeftColor: pressed ? S.ink : "transparent",
      })}
    >
      <Text style={{ width: 18, paddingTop: 8, fontFamily: fonts.heading.semibold, fontSize: 10, color: S.graphite }}>{String(n).padStart(2, "0")}</Text>
      <View style={{ width: 28, height: 28, borderWidth: 1, borderColor: S.rule, backgroundColor: S.paper, alignItems: "center", justifyContent: "center" }}>
        <Icon size={14} color={S.ink} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: S.ink }}>{r.title}</Text>
        {!!r.subtitle && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite, marginTop: 1 }}>{r.subtitle}</Text>}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
          <DueDot tone={tone} />
          <Cap color={tone === "red" ? S.red : S.ink}>{formatRelative(r.dueDate)}</Cap>
          <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite }}>{formatDay(r.dueDate)}</Text>
        </View>
      </View>
      {!!r.amount && <Text style={{ paddingTop: 1, fontFamily: fonts.heading.semibold, fontSize: 13, letterSpacing: -0.1, color: S.ink, fontVariant: ["tabular-nums"] }}>{`₹${Number(r.amount).toLocaleString("en-IN")}`}</Text>}
    </Press>
  );
});

// The web's genie (navPanelStyles.ts): the panel swells out of the bell on two springs — the height leads, the width
// follows a beat behind — from a tenth of its size, rising 12px as it goes and fading in over the first fifth; closing
// bumps it a touch (1.03 × 0.985) and pops it back into the bell in 280ms. The bell itself squashes and stretches as it
// opens. Same spring constants as the web (ζ 0.74 / ω 16 for the width, ζ 0.66 / ω 19 for the height), run on the native
// driver. Only scale, translate and opacity move, and the panel is drawn to a texture while it moves, so no row is
// re-laid out per frame; the refresh waits until the panel has settled, and only the first rows are drawn until then.
const SPRING_X = { stiffness: 16 * 16, damping: 2 * 0.74 * 16, mass: 1 };
const SPRING_Y = { stiffness: 19 * 19, damping: 2 * 0.66 * 19, mass: 1 };
const START = 0.1;
const FIRST_ROWS = 8;

export function ReminderBell() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { reminders, loading, refresh, locked } = useReminders();
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const [filter, setFilter] = useState<"all" | ReminderType>("all");
  const [bell, setBell] = useState<{ x: number; y: number } | null>(null);
  const bellRef = useRef<React.ComponentRef<typeof View>>(null);
  const sx = useRef(new Animated.Value(START)).current;
  const sy = useRef(new Animated.Value(START)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const rub = useRef(new Animated.Value(0)).current;
  const refreshAfter = useRef(false);
  const closing = useRef(false);

  const settle = () => {
    setSettled(true);
    if (refreshAfter.current) {
      refreshAfter.current = false;
      refresh();
    }
  };

  // Started when the modal is actually on screen, not from an effect, so the first frame is already the small bubble.
  const playOpen = () => {
    if (motionOff("menus")) {
      sx.setValue(1);
      sy.setValue(1);
      fade.setValue(1);
      return settle();
    }
    sx.setValue(START);
    sy.setValue(START);
    fade.setValue(0);
    Animated.parallel([
      Animated.spring(sx, { toValue: 1, ...SPRING_X, useNativeDriver: true }),
      Animated.spring(sy, { toValue: 1, ...SPRING_Y, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 124, easing: Easing.linear, useNativeDriver: true }),
    ]).start(settle);
  };

  const close = () => {
    if (!open || closing.current) return;
    if (motionOff("menus")) return setOpen(false);
    closing.current = true;
    const ease = Easing.bezier(0.55, 0, 0.75, 0.35);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(sx, { toValue: 1.03, duration: 56, easing: ease, useNativeDriver: true }),
        Animated.timing(sx, { toValue: START, duration: 224, easing: ease, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(sy, { toValue: 0.985, duration: 56, easing: ease, useNativeDriver: true }),
        Animated.timing(sy, { toValue: START, duration: 224, easing: ease, useNativeDriver: true }),
      ]),
      Animated.sequence([Animated.delay(56), Animated.timing(fade, { toValue: 0, duration: 224, easing: ease, useNativeDriver: true })]),
    ]).start(() => {
      closing.current = false;
      setOpen(false);
    });
  };

  const openPanel = () => {
    bellRef.current?.measureInWindow((x, y, w, h) => setBell({ x: x + w / 2, y: y + h / 2 }));
    setSettled(false);
    refreshAfter.current = true;
    closing.current = false;
    sx.setValue(START);
    sy.setValue(START);
    fade.setValue(0);
    setOpen(true);
    if (!motionOff("menus")) {
      rub.setValue(0);
      Animated.timing(rub, { toValue: 1, duration: 520, easing: Easing.bezier(0.34, 0.2, 0.3, 1), useNativeDriver: true }).start();
    }
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    reminders.forEach((r) => m.set(r.type, (m.get(r.type) ?? 0) + 1));
    return m;
  }, [reminders]);
  const overdue = reminders.filter((r) => r.urgency === "overdue").length;
  const shown = filter === "all" ? reminders : reminders.filter((r) => r.type === filter);
  const sections = [
    { key: "overdue", title: "Overdue", items: shown.filter((r) => r.urgency === "overdue") },
    { key: "today", title: "Due today", items: shown.filter((r) => r.urgency === "today") },
    { key: "later", title: "Coming up", items: shown.filter((r) => r.urgency === "soon" || r.urgency === "upcoming") },
  ];
  // Tabs only for the kinds this user has reminders of (plus All), so a short list isn't buried in empty tabs.
  const tabs = TABS.filter((t) => t === "all" || (counts.get(t) ?? 0) > 0);
  let rowNo = 0;

  const panelWidth = Math.min(width - 24, 440);
  const top = insets.top + 62;
  const panelLeft = width - 12 - panelWidth;
  // The bell as a point on the panel: the bubble grows out of it.
  const origin = bell ? `${Math.round(bell.x - panelLeft)}px ${Math.round(bell.y - top)}px` : `${panelWidth - 63}px -34px`;

  return (
    <>
      <View ref={bellRef} collapsable={false}>
        <IconKey onPress={() => (open ? close() : openPanel())}>
          <Animated.View
            style={{
              transform: [
                { scaleX: rub.interpolate({ inputRange: [0, 0.22, 0.46, 0.68, 0.86, 1], outputRange: [1, 1.22, 0.9, 1.07, 0.98, 1] }) },
                { scaleY: rub.interpolate({ inputRange: [0, 0.22, 0.46, 0.68, 0.86, 1], outputRange: [1, 0.88, 1.14, 0.96, 1.02, 1] }) },
              ],
            }}
          >
            <Bell size={17} color={S.ink} />
          </Animated.View>
          {reminders.length > 0 && (
            <View style={{ position: "absolute", top: -6, right: -6, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: S.red, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#ffffff", fontSize: 9, fontFamily: fonts.heading.semibold, fontVariant: ["tabular-nums"] }}>{reminders.length > 99 ? "99+" : reminders.length}</Text>
            </View>
          )}
        </IconKey>
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={close} onShow={playOpen} statusBarTranslucent hardwareAccelerated>
        <Pressable style={{ flex: 1 }} onPress={close}>
          <Animated.View
            renderToHardwareTextureAndroid={!settled}
            shouldRasterizeIOS={!settled}
            style={{
              position: "absolute",
              top,
              left: panelLeft,
              width: panelWidth,
              opacity: fade,
              transformOrigin: origin,
              transform: [
                { translateY: sy.interpolate({ inputRange: [START, 1], outputRange: [-12, 0], extrapolate: "extend" }) },
                { scaleX: sx },
                { scaleY: sy },
              ],
            }}
          >
            {/* The web's hard offset shadow: an ink block 6px down and right, behind the sheet. */}
            <View style={{ position: "absolute", top: 6, left: 6, right: -6, bottom: -6, backgroundColor: S.ink, opacity: 0.14 }} />
            <Pressable onPress={() => {}} style={{ backgroundColor: S.paper, borderWidth: 1.5, borderColor: S.ink, borderTopWidth: 3, overflow: "hidden" }}>
              {/* Title block */}
              <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, borderBottomWidth: 1.5, borderBottomColor: S.ink }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Cap>CivilierERP · Reminders</Cap>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 28, lineHeight: 30, letterSpacing: -0.6, color: S.ink, fontVariant: ["tabular-nums"] }}>{reminders.length}</Text>
                    <Cap>pending</Cap>
                    {overdue > 0 && <Cap color={S.red}>{`· ${overdue} overdue`}</Cap>}
                  </View>
                </View>
                <Pressable
                  onPress={refresh}
                  disabled={loading || locked}
                  style={{ width: 28, height: 28, borderWidth: 1, borderColor: locked ? S.red : S.ink, alignItems: "center", justifyContent: "center", opacity: loading || locked ? 0.6 : 1 }}
                >
                  {locked ? <Lock size={13} color={S.red} /> : <SpinIcon spinning={loading} />}
                </Pressable>
              </View>

              {/* Filter tabs, each with its count */}
              {tabs.length > 1 && (
                <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.rule }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: S.ink }}>
                      {tabs.map((t, i) => {
                        const on = filter === t;
                        return (
                          <Pressable
                            key={t}
                            onPress={() => setFilter(t)}
                            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderLeftWidth: i ? 1 : 0, borderLeftColor: S.ink, backgroundColor: on ? S.ink : "transparent" }}
                          >
                            <Cap color={on ? S.paper : S.graphite}>{t === "all" ? "All" : TYPE_META[t].label}</Cap>
                            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9.5, color: on ? S.paper : S.graphite, opacity: 0.75 }}>{t === "all" ? reminders.length : counts.get(t) ?? 0}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              )}

              <ScrollView style={{ maxHeight: Math.min(height * 0.6, 440) }} nestedScrollEnabled>
                {shown.length === 0 ? (
                  <View style={{ margin: 16, padding: 22, borderWidth: 1, borderStyle: "dashed", borderColor: S.rule, alignItems: "center", gap: 4 }}>
                    <Cap color={S.ink}>{loading && reminders.length === 0 ? "Reading…" : "All caught up"}</Cap>
                    <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>{loading && reminders.length === 0 ? "Fetching your reminders." : "No reminders to show right now."}</Text>
                  </View>
                ) : (
                  sections.map((sec) =>
                    sec.items.length === 0 ? null : (
                      <View key={sec.key}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
                          <Cap color={sec.key === "overdue" ? S.red : S.ink}>{sec.title}</Cap>
                          <View style={{ flex: 1, height: 1, backgroundColor: S.rule }} />
                          <Cap>{sec.items.length}</Cap>
                        </View>
                        {sec.items.map((r) => {
                          rowNo += 1;
                          if (!settled && rowNo > FIRST_ROWS) return null;
                          return (
                            <Row
                              key={r.id}
                              r={r}
                              n={rowNo}
                              onPress={
                                r.screen
                                  ? () => {
                                      closing.current = false;
                                      setOpen(false);
                                      navigation.navigate(r.screen as never);
                                    }
                                  : undefined
                              }
                            />
                          );
                        })}
                      </View>
                    ),
                  )
                )}
              </ScrollView>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

