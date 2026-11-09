// The "drawing sheet" look of the web app (src/components/sheet/Sheet.tsx and the control tokens in
// src/pages/CRM/customers/config.tsx), for React Native: one ink-bordered sheet of paper on a faint grid, a title block,
// lettered details, capital labels, figures in Sora, square corners everywhere, status drawn as a small square mark.
// Colours come from src/theme/colors.ts (the web's default theme), fonts from src/theme/fonts.ts.
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, Line, Path, Pattern, Rect } from "react-native-svg";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

// ── Motion (web: SHEET_BASE's crm-rise / crm-title / crm-rule / crm-grow / crm-draw) ─────────────────────────

/** The web's cubic-bezier(.2,.7,.2,1). */
export const EASE = Easing.bezier(0.2, 0.7, 0.2, 1);

// prefers-reduced-motion: the phone's "Remove animations" setting. Read once; every animation below checks it.
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => {
    reduceMotion = !!v;
  })
  .catch(() => {});

// The profile's Settings → Animations switches (the web's uiPrefs): what moves, on this phone only. "menus" is the bell's
// genie, "pages" the rise / fade / draw of pages and figures, "counts" the dashboards' numbers counting up.
export type UiPrefs = { menus: boolean; pages: boolean; counts: boolean };
const PREFS_KEY = "ui_prefs";
let uiPrefs: UiPrefs = { menus: true, pages: true, counts: true };
const prefListeners = new Set<(p: UiPrefs) => void>();
SecureStore.getItemAsync(PREFS_KEY)
  .then((raw) => {
    if (!raw) return;
    uiPrefs = { ...uiPrefs, ...JSON.parse(raw) };
    prefListeners.forEach((l) => l(uiPrefs));
  })
  .catch(() => {});
export function setUiPrefs(patch: Partial<UiPrefs>) {
  uiPrefs = { ...uiPrefs, ...patch };
  prefListeners.forEach((l) => l(uiPrefs));
  SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(uiPrefs)).catch(() => {});
}
export function useUiPrefs(): UiPrefs {
  const [p, setP] = useState(uiPrefs);
  useEffect(() => {
    prefListeners.add(setP);
    setP(uiPrefs);
    return () => void prefListeners.delete(setP);
  }, []);
  return p;
}

/** True when this kind of animation should not play: the phone asks for reduced motion, or it is switched off. */
export const motionOff = (kind: keyof UiPrefs = "pages") => reduceMotion || !uiPrefs[kind];

/** A value that runs 0 → 1 once on mount (or straight to 1 when motion is off). */
export function useEnter(duration: number, delay = 0, easing = EASE) {
  const v = useRef(new Animated.Value(motionOff() ? 1 : 0)).current;
  useEffect(() => {
    if (motionOff()) return;
    const a = Animated.timing(v, { toValue: 1, duration, delay, easing, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [v, duration, delay, easing]);
  return v;
}

/** crm-rise: a block rises 14px into place, .55s; the sheet staggers its parts 60ms apart (to .42s). */
export const Rise: React.FC<{ index?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ index = 0, children, style }) => {
  const v = useEnter(550, Math.min(index, 7) * 60);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }, style]}>{children}</Animated.View>;
};

/** crm-grow: a bar grows from its left end, .9s. Give it the bar's own style (height, background). */
export const Grow: React.FC<{ style?: StyleProp<ViewStyle>; delay?: number; children?: React.ReactNode }> = ({ style, delay = 0, children }) => {
  const v = useEnter(900, delay);
  return <Animated.View style={[{ transformOrigin: "left", transform: [{ scaleX: v }] }, style]}>{children}</Animated.View>;
};

/** Several styles as one plain object, for Press's style functions. */
const one = (...styles: StyleProp<ViewStyle>[]): ViewStyle => StyleSheet.flatten(styles) as ViewStyle;

/** A Pressable whose look follows being pressed. On the phone NativeWind's Pressable wrapper drops a `style` (or
 * children) given as a function, so this keeps its own pressed state and hands Pressable plain values. Use it
 * wherever the style depends on `pressed`. */
export const Press: React.FC<
  Omit<PressableProps, "style" | "children"> & {
    style?: (pressed: boolean) => StyleProp<ViewStyle>;
    children?: React.ReactNode | ((pressed: boolean) => React.ReactNode);
  }
> = ({ style, children, onPressIn, onPressOut, ...rest }) => {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={StyleSheet.flatten(style?.(pressed)) as ViewStyle}
    >
      {typeof children === "function" ? children(pressed) : children}
    </Pressable>
  );
};

// ── Type ─────────────────────────────────────────────────────────────────────

/** A capital label: Sora semibold 10, tracked out, graphite. */
export const Label: React.FC<{ children: React.ReactNode; color?: string; style?: StyleProp<TextStyle> }> = ({ children, color = S.graphite, style }) => (
  <Text
    style={[{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color }, style]}
  >
    {children}
  </Text>
);

/** A number worth reading first: Sora semibold, tight, tabular. */
export const Figure: React.FC<{ children: React.ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle> }> = ({ children, size = 26, color = S.ink, style }) => (
  <Text
    style={[
      { fontFamily: fonts.heading.semibold, fontSize: size, lineHeight: size * 1.05, letterSpacing: -size * 0.02, color, fontVariant: ["tabular-nums"] },
      style,
    ]}
  >
    {children}
  </Text>
);

/** Body text on the sheet. */
export const Body: React.FC<{ children: React.ReactNode; size?: number; color?: string; weight?: "regular" | "medium" | "semibold"; style?: StyleProp<TextStyle> }> = ({ children, size = 13, color = S.ink, weight = "regular", style }) => (
  <Text style={[{ fontFamily: fonts.body[weight], fontSize: size, color, fontVariant: ["tabular-nums"] }, style]}>{children}</Text>
);

// ── Frame ────────────────────────────────────────────────────────────────────

/** The faint 24px grid behind the paper. */
const Grid: React.FC = () => (
  <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }} width="100%" height="100%">
    <Defs>
      <Pattern id="sheet-grid" width={24} height={24} patternUnits="userSpaceOnUse">
        <Path d="M24 0 H0 V24" fill="none" stroke={S.grid} strokeWidth={1} />
      </Pattern>
    </Defs>
    <Rect width="100%" height="100%" fill="url(#sheet-grid)" />
  </Svg>
);

/** The sheet: paper on a grid, a 1.5 ink border, and a hairline outline standing off it (the web's outline-offset).
 * Its parts rise into place one after another, as the web's `.sheet-in` does; `still` turns that off. */
export const SheetFrame: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle>; still?: boolean }> = ({ children, style, still }) => (
  <View style={[{ margin: 5, padding: 3, borderWidth: 1, borderColor: S.rule }, style]}>
    <View style={{ backgroundColor: S.paper, borderWidth: 1.5, borderColor: S.ink, overflow: "hidden" }}>
      <Grid />
      {still
        ? children
        : React.Children.toArray(children).map((child, i) => (
            <Rise key={(child as React.ReactElement)?.key ?? i} index={i}>
              {child}
            </Rise>
          ))}
    </View>
  </View>
);

/** crm-title: a sheet's title slides up a third of a line and fades in, .8s. */
export const TitleText: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 26 }) => {
  const v = useEnter(800);
  return (
    <Animated.Text
      style={{
        fontFamily: fonts.heading.bold,
        fontSize: size,
        lineHeight: size * 1.08,
        letterSpacing: -size * 0.03,
        color: S.ink,
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [size * 0.35, 0] }) }],
      }}
    >
      {children}
    </Animated.Text>
  );
};

/** Eyebrow, title, subtitle and an optional action: the head of a sheet. */
export const TitleBlock: React.FC<{ eyebrow: string; title: string; subtitle?: string; action?: React.ReactNode }> = ({ eyebrow, title, subtitle, action }) => (
  <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <Label>{eyebrow}</Label>
        <TitleText size={26}>{title}</TitleText>
        {!!subtitle && <Body size={13} color={S.ink2}>{subtitle}</Body>}
      </View>
      {action}
    </View>
  </View>
);

/** A hairline across the sheet. */
export const Rule: React.FC<{ soft?: boolean; ink?: boolean; style?: StyleProp<ViewStyle> }> = ({ soft, ink, style }) => (
  <View style={[{ height: 1, backgroundColor: ink ? S.ink : soft ? S.ruleSoft : S.rule }, style]} />
);

/** The lettered circle that starts a detail's heading. */
export const Tag: React.FC<{ children: string }> = ({ children }) => (
  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper, alignItems: "center", justifyContent: "center" }}>
    <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11, color: S.ink }}>{children}</Text>
  </View>
);

/** One lettered section of a sheet: a rule above, then "A — TITLE ————— note". */
export const Detail: React.FC<{ tag: string; title: string; note?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ tag, title, note, children, style }) => (
  <View style={[{ borderTopWidth: 1, borderTopColor: S.rule, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 18 }, style]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <Tag>{tag}</Tag>
      <Label color={S.ink}>{title}</Label>
      <Grow delay={250} style={{ flex: 1, height: 1, backgroundColor: S.rule }} />
      {typeof note === "string" ? <Label>{note}</Label> : note}
    </View>
    {children}
  </View>
);

/** A row of a ruled schedule: a soft hairline underneath; tap to open when given onPress. */
export const Row: React.FC<{ children: React.ReactNode; onPress?: () => void; last?: boolean; style?: StyleProp<ViewStyle> }> = ({ children, onPress, last, style }) => {
  const base: ViewStyle = { paddingVertical: 11, paddingHorizontal: 2, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Press onPress={onPress} style={(pressed) => one(base, pressed && { backgroundColor: S.blueWash }, style)}>
      {children}
    </Press>
  );
};

// ── Status ───────────────────────────────────────────────────────────────────

/** Solid is settled, hatched is waiting on someone, half-filled is under way, red has stopped, empty is a draft. */
export type MarkTone = "done" | "waiting" | "moving" | "stopped" | "draft";
export const markInk = (tone: MarkTone) => (tone === "stopped" ? S.red : tone === "draft" ? S.graphite : S.ink);

export const MarkSquare: React.FC<{ tone: MarkTone }> = ({ tone }) => {
  const ink = markInk(tone);
  return (
    <View style={{ width: 9, height: 9, borderWidth: 1, borderColor: ink, overflow: "hidden", backgroundColor: tone === "stopped" ? S.red : tone === "done" ? S.blue : "transparent" }}>
      {tone === "moving" && <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: S.ink }} />}
      {tone === "waiting" && (
        <Svg width={9} height={9} style={{ position: "absolute", top: 0, left: 0 }}>
          <Line x1={-1} y1={4} x2={4} y2={-1} stroke={S.ink} strokeWidth={1} />
          <Line x1={-1} y1={8} x2={8} y2={-1} stroke={S.ink} strokeWidth={1} />
          <Line x1={3} y1={10} x2={10} y2={3} stroke={S.ink} strokeWidth={1} />
          <Line x1={7} y1={10} x2={10} y2={7} stroke={S.ink} strokeWidth={1} />
        </Svg>
      )}
    </View>
  );
};

/** Status on a sheet: a square mark and a word in capitals; "none" is a dash. */
export const SheetMark: React.FC<{ text: string; tone: MarkTone | "none" }> = ({ text, tone }) => {
  if (tone === "none") return <Text style={{ color: S.graphite, fontSize: 12 }}>—</Text>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <MarkSquare tone={tone} />
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: markInk(tone) }}>{text}</Text>
    </View>
  );
};

export const statusTone = (status: string): "done" | "waiting" | "stopped" =>
  /reject|cancel|delete|bounce|fail/i.test(status) ? "stopped" : /approved|posted|success|cleared|closed|accepted|paid/i.test(status) ? "done" : "waiting";

// ── Controls ─────────────────────────────────────────────────────────────────

/** Segmented keys with an ink border; the chosen one is filled ink. */
export function Seg<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", alignSelf: "flex-start", borderWidth: 1, borderColor: S.ink }}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: on ? S.ink : "transparent", borderLeftWidth: i ? 1 : 0, borderLeftColor: S.ink }}
          >
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: on ? S.paper : S.graphite }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type KeyTone = "ink" | "line" | "red";
/** A key (button): filled ink, ink outline, or red. Capital Sora label; square. */
// Keys and rows whose look follows being pressed use Press (above), never Pressable with a style function: on the
// phone NativeWind's wrapper drops a function style, and keys lose their borders, rows their flexDirection.
export const Key: React.FC<{
  children?: React.ReactNode;
  label?: string;
  onPress?: () => void;
  disabled?: boolean;
  tone?: KeyTone;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}> = ({ children, label, onPress, disabled, tone = "line", icon, style }) => {
  const filled = tone !== "line";
  const bg = tone === "ink" ? S.ink : tone === "red" ? S.red : "transparent";
  const border = tone === "red" ? S.red : S.ink;
  const fg = tone === "ink" ? S.paper : tone === "red" ? "#ffffff" : S.ink;
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      style={(pressed) =>
        one(
        { minHeight: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: border, backgroundColor: pressed && !filled ? S.blueWash : bg, opacity: disabled ? 0.4 : pressed && filled ? 0.85 : 1 },
        style,
        )
      }
    >
      {icon}
      {children ?? <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: fg }}>{label}</Text>}
    </Press>
  );
};

/** A field: capital label above, the control under it. */
export const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ label, required, children, style }) => (
  <View style={[{ gap: 6 }, style]}>
    <Label>
      {label}
      {required && <Text style={{ color: S.red }}> *</Text>}
    </Label>
    {children}
  </View>
);

/** A text input: square, a 40% ink border that goes full ink on focus, paper inside. */
export const Input = React.forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps & { right?: React.ReactNode }>(function Input({ right, style, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: focused ? S.ink : S.line40, backgroundColor: S.paper }}>
      <TextInput
        ref={ref}
        placeholderTextColor={S.faint}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        // outlineWidth 0: the wrapper's border is the focus mark; the browser's own ring (web) would sit inside it.
        style={[{ flex: 1, minHeight: 44, paddingHorizontal: 10, fontFamily: fonts.body.regular, fontSize: 14, color: S.ink, outlineWidth: 0 }, style]}
        {...props}
      />
      {right}
    </View>
  );
});

/** A message in the sheet's red: square, a red rule, no fill beyond a wash. */
export const Notice: React.FC<{ children: React.ReactNode; tone?: "red" | "ink" }> = ({ children, tone = "red" }) => (
  <View style={{ borderWidth: 1, borderColor: tone === "red" ? S.red : S.ink, backgroundColor: tone === "red" ? S.redWash : "transparent", paddingHorizontal: 12, paddingVertical: 9 }}>
    <Text style={{ fontFamily: fonts.body.medium, fontSize: 13, color: tone === "red" ? S.red : S.ink }}>{children}</Text>
  </View>
);

/** A grey bar that pulses while something loads. */
export const Skel: React.FC<{ h?: number; w?: number | `${number}%` }> = ({ h = 14, w = "100%" }) => {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (motionOff()) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true }), Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ height: h, width: w, marginBottom: 10, backgroundColor: S.ruleSoft, opacity: v }} />;
};

// ── Numbers ──────────────────────────────────────────────────────────────────

export const n0 = (v: unknown) => Number(v) || 0;
export const fmtInt = (v: unknown) => n0(v).toLocaleString("en-IN");
/** ₹ amounts as the sheet writes them: ₹1.20 Cr, ₹4.5 L, ₹12 K. */
export const fmtMoney = (v: unknown) => {
  const n = n0(v);
  if (n >= 1_00_00_000) return { num: (n / 1_00_00_000).toFixed(2), unit: "Cr" };
  if (n >= 1_00_000) return { num: (n / 1_00_000).toFixed(1), unit: "L" };
  if (n >= 1_000) return { num: (n / 1_000).toFixed(0), unit: "K" };
  return { num: n.toFixed(0), unit: "" };
};
export const money = (v: unknown) => {
  const m = fmtMoney(v);
  return `₹${m.num}${m.unit ? ` ${m.unit}` : ""}`;
};
/** Exact rupees with paise, for a document's own figures. */
export const rupees = (v: unknown) => `₹${n0(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Figures and keys used across this app's screens ─────────────────────────

export type StatCell = { label: string; value: React.ReactNode; red?: boolean; onPress?: () => void; /** spans the whole row */ wide?: boolean };

/** Figures in a ruled grid (2 columns by default): capital label over the number; a cell with onPress opens something. */
export const StatGrid: React.FC<{ items: StatCell[]; cols?: 1 | 2 | 3; loading?: boolean; size?: number }> = ({ items, cols = 2, loading, size = 20 }) => (
  <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderLeftWidth: 1, borderColor: S.rule }}>
    {items.map((st) => {
      const body = (
        <>
          <Label>{st.label}</Label>
          {loading ? <Skel h={size} w="60%" /> : typeof st.value === "string" || typeof st.value === "number" ? <Figure size={size} color={st.red ? S.red : S.ink}>{st.value}</Figure> : st.value}
        </>
      );
      const cell: ViewStyle = { width: st.wide ? "100%" : `${100 / cols}%`, padding: 12, gap: 6, borderRightWidth: 1, borderBottomWidth: 1, borderColor: S.rule };
      return st.onPress ? (
        <Press key={st.label} onPress={st.onPress} style={(pressed) => one(cell, pressed && { backgroundColor: S.blueWash })}>
          {body}
        </Press>
      ) : (
        <View key={st.label} style={cell}>
          {body}
        </View>
      );
    })}
  </View>
);

/** A small square key that holds one icon (refresh, view, delete…); red for a destructive one. */
export const IconKey: React.FC<{ onPress?: () => void; children: React.ReactNode; red?: boolean; size?: number; disabled?: boolean }> = ({ onPress, children, red, size = 34, disabled }) => (
  <Press
    onPress={onPress}
    disabled={disabled}
    hitSlop={4}
    style={(pressed) => ({ width: size, height: size, borderWidth: 1, borderColor: red ? S.red : S.ink, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? (red ? S.redWash : S.blueWash) : "transparent", opacity: disabled ? 0.4 : 1 })}
  >
    {children}
  </Press>
);


// ── Drawing parts (web: .hatch, Dimension, tables) ───────────────────────────

/** The web's .hatch: 135° hairlines 6px apart in the hatch tone, filling its box. Put it inside a sized View. */
export const Hatch: React.FC<{ id?: string }> = ({ id = "hatch" }) => (
  <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%" pointerEvents="none">
    <Defs>
      <Pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <Line x1={0} y1={0} x2={0} y2={6} stroke={S.hatch} strokeWidth={1} />
      </Pattern>
    </Defs>
    <Rect width="100%" height="100%" fill={`url(#${id})`} />
  </Svg>
);

/** A small legend square: solid blue, hatched, or a short ink line. */
export const Swatch: React.FC<{ kind: "solid" | "hatch" | "line" | "red"; label: string }> = ({ kind, label }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    {kind === "line" ? (
      <View style={{ width: 14, height: 2, backgroundColor: S.ink }} />
    ) : (
      <View style={{ width: 10, height: 10, backgroundColor: kind === "solid" ? S.blue : kind === "red" ? S.red : "transparent", borderWidth: kind === "hatch" ? 1 : 0, borderColor: S.ink, overflow: "hidden" }}>
        {kind === "hatch" && <Hatch id={`sw-${label}`} />}
      </View>
    )}
    <Label>{label}</Label>
  </View>
);

/** A dimension line: a measured span with end ticks and its value written on it. */
export const Dimension: React.FC<{ text: string; color?: string }> = ({ text, color = S.graphite }) => (
  <View style={{ height: 22, marginTop: 6, justifyContent: "flex-start" }}>
    <View style={{ marginTop: 6, height: 1, backgroundColor: color }}>
      <View style={{ position: "absolute", left: 0, top: -4, width: 1, height: 9, backgroundColor: color }} />
      <View style={{ position: "absolute", right: 0, top: -4, width: 1, height: 9, backgroundColor: color }} />
    </View>
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, alignItems: "center" }}>
      <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 10, color, backgroundColor: S.paper, paddingHorizontal: 6, marginTop: 6 }}>{text}</Text>
    </View>
  </View>
);

export type Col<T> = { title: string; width: number; num?: boolean; render: (row: T) => React.ReactNode };

/** The sheet's table: capital headers over an ink rule, soft rules between rows, numbers right-aligned; it scrolls
 * sideways when it is wider than the phone (the web's overflow-x: auto with a min-width). */
export function SheetTable<T>({ rows, cols, keyOf, onRowPress }: { rows: T[]; cols: Col<T>[]; keyOf: (r: T, i: number) => string | number; onRowPress?: (r: T) => void }) {
  const [avail, setAvail] = useState(0);
  const total = cols.reduce((n, c) => n + c.width, 0);
  // Narrower than the space it has: widen every column in proportion, so the table runs edge to edge.
  const k = avail > total ? avail / total : 1;
  const w = (c: Col<T>) => Math.floor(c.width * k);
  return (
    <View onLayout={(e) => setAvail(e.nativeEvent.layout.width)}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: S.ink, paddingBottom: 8 }}>
            {cols.map((c, ci) => (
              <View key={c.title} style={{ width: w(c), paddingRight: ci === cols.length - 1 ? 0 : 10, alignItems: c.num ? "flex-end" : "flex-start" }}>
                <Label>{c.title}</Label>
              </View>
            ))}
          </View>
          {rows.map((r, i) => {
            const cells = cols.map((c, ci) => (
              <View key={c.title} style={{ width: w(c), paddingRight: ci === cols.length - 1 ? 0 : 10, alignItems: c.num ? "flex-end" : "flex-start", justifyContent: "center" }}>
                {c.render(r)}
              </View>
            ));
            const st: ViewStyle = { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft };
            return onRowPress ? (
              <Press key={keyOf(r, i)} onPress={() => onRowPress(r)} style={(pressed) => one(st, pressed && { backgroundColor: S.blueWash })}>
                {cells}
              </Press>
            ) : (
              <View key={keyOf(r, i)} style={st}>
                {cells}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/** The web's dashed-underlined link label. */
export const LinkLabel: React.FC<{ children: string; onPress?: () => void; color?: string }> = ({ children, onPress, color = S.ink }) => (
  <Press onPress={onPress} hitSlop={8} style={(pressed) => ({ alignSelf: "flex-start", borderBottomWidth: 1, borderStyle: "dashed", borderBottomColor: pressed ? S.blue : S.graphite })}>
    {(pressed) => <Label color={pressed ? S.blue : color}>{children}</Label>}
  </Press>
);

// ── Tick (web: material/dashboard/shared.tsx) ─────────────────────────────────

const TICK_EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** A number that counts up when it first appears, and runs from the old value to the new one when it changes (the
 * dashboards re-read on a timer). Still when motion is off. Whole numbers while running, the exact value at rest.
 * Renders text, so put it inside a <Text>. */
export function Tick({ value, format = fmtInt }: { value: number; format?: (n: number) => string }) {
  const from = useRef(0);
  const [v, setV] = useState(() => (motionOff("counts") ? value : 0));
  useEffect(() => {
    if (motionOff("counts")) {
      from.current = value;
      setV(value);
      return;
    }
    const start = from.current;
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / 900);
      const x = start + (value - start) * TICK_EASE(k);
      from.current = x;
      setV(k >= 1 ? value : x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(v === value ? value : Math.round(v))}</>;
}

// ── crm-draw: a chart line draws itself along its length, 1.4s ease-out ────────

export const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The dash offset for a line of the given length: runs from the whole length to 0 on mount (0 at once when motion
 * is off). Use with strokeDasharray={`${len} ${len}`} on an AnimatedPath. */
export function useDraw(len: number) {
  const v = useRef(new Animated.Value(motionOff() ? 0 : len)).current;
  useEffect(() => {
    if (motionOff()) return;
    v.setValue(len);
    const a = Animated.timing(v, { toValue: 0, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [v, len]);
  return v;
}

// ── Working pages (web: SheetShell + .statrow, components/sheet/Sheet.tsx) ─────

/** The shell for a working page (lists, forms): the sheet's frame and title block around the page's own content,
 * which sits in one ruled cell below. The parts rise in as on the web. */
export const SheetShell: React.FC<{ eyebrow: string; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }> = ({ eyebrow, title, subtitle, action, children }) => (
  <SheetFrame>
    <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18, gap: 12 }}>
      <View style={{ gap: 8 }}>
        <Label>{eyebrow}</Label>
        <TitleText size={26}>{title}</TitleText>
        {!!subtitle && <Body size={13} color={S.ink2}>{subtitle}</Body>}
      </View>
      {action}
    </View>
    <View style={{ borderTopWidth: 1, borderTopColor: S.rule, paddingHorizontal: 14, paddingTop: 18, paddingBottom: 20, gap: 20 }}>{children}</View>
  </SheetFrame>
);

/** The web's .statrow at phone width: figures two to a row, a capital label, the figure, a line under it. With an odd
 * number of figures the first takes the whole first row (it is the headline: a total), so the rest pair up evenly and
 * every divider lines up. Long figures shrink to fit their cell rather than being cut. */
export const StatRow: React.FC<{ items: { label: string; value: React.ReactNode; note?: string; red?: boolean }[] }> = ({ items }) => {
  const lead = items.length % 2 === 1;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 16 }}>
      {items.map((x, i) => {
        const wide = lead && i === 0;
        const right = !wide && (lead ? i % 2 === 0 : i % 2 === 1);
        return (
          <View
            key={x.label}
            style={{
              width: wide ? "100%" : "50%",
              paddingLeft: right ? 14 : 0,
              paddingRight: wide || right ? 0 : 14,
              borderLeftWidth: right ? 1 : 0,
              borderLeftColor: S.rule,
              paddingBottom: wide ? 14 : 0,
              borderBottomWidth: wide ? 1 : 0,
              borderBottomColor: S.rule,
            }}
          >
            <Label>{x.label}</Label>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              style={{ fontFamily: fonts.heading.semibold, fontSize: wide ? 28 : 22, letterSpacing: -0.4, color: x.red ? S.red : S.ink, marginTop: 8, fontVariant: ["tabular-nums"] }}
            >
              {x.value}
            </Text>
            {!!x.note && <Body size={11.5} color={S.graphite} style={{ marginTop: 5 }}>{x.note}</Body>}
          </View>
        );
      })}
    </View>
  );
};

/** The register's search box: a square sheet input with a search mark and a clear key. */
export const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <Input
    value={value}
    onChangeText={onChange}
    placeholder={placeholder}
    autoCorrect={false}
    right={
      <Pressable onPress={() => onChange("")} disabled={!value} hitSlop={8} style={{ paddingHorizontal: 12, height: 44, justifyContent: "center" }}>
        <Text style={{ color: value ? S.ink : S.faint, fontSize: 13 }}>{value ? "✕" : "⌕"}</Text>
      </Pressable>
    }
  />
);

/** A register's heading over its table: the name in capitals, the count under it, an ink rule below. */
export const RegisterHead: React.FC<{ title: string; count: number; unit?: [string, string] }> = ({ title, count, unit = ["record", "records"] }) => (
  <View style={{ borderBottomWidth: 1, borderBottomColor: S.ink, paddingBottom: 10 }}>
    <Label color={S.ink}>{title}</Label>
    <Body size={12} color={S.graphite} style={{ marginTop: 3 }}>
      {count.toLocaleString("en-IN")} {count === 1 ? unit[0] : unit[1]}
    </Body>
  </View>
);


/** A boxed part of a working page (web: Card with an ink border): its title in capitals over an ink rule. */
export const Panel: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ title, icon, children, style }) => (
  <View style={[{ borderWidth: 1, borderColor: S.ink }, style]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: S.ink }}>
      {icon}
      <Label color={S.ink}>{title}</Label>
    </View>
    <View style={{ padding: 12, gap: 14 }}>{children}</View>
  </View>
);

/** Labelled values two to a row: a capital label over each value; `wide` takes the whole row. */
export const InfoGrid: React.FC<{ items: { label: string; value: React.ReactNode; wide?: boolean }[] }> = ({ items }) => (
  <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 14 }}>
    {items.map((x) => (
      <View key={x.label} style={{ width: x.wide ? "100%" : "50%", paddingRight: 10, gap: 4 }}>
        <Label>{x.label}</Label>
        {typeof x.value === "string" || typeof x.value === "number" ? <Body size={13.5}>{x.value}</Body> : x.value}
      </View>
    ))}
  </View>
);
