// The "drawing sheet" look of the web app (src/components/sheet/Sheet.tsx and the control tokens in
// src/pages/CRM/customers/config.tsx), for React Native: one ink-bordered sheet of paper on a faint grid, a title block,
// lettered details, capital labels, figures in Sora, square corners everywhere, status drawn as a small square mark.
// Colours come from src/theme/colors.ts (the web's default theme), fonts from src/theme/fonts.ts.
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, Line, Path, Pattern, Rect } from "react-native-svg";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

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

/** The sheet: paper on a grid, a 1.5 ink border, and a hairline outline standing off it (the web's outline-offset). */
export const SheetFrame: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ children, style }) => (
  <View style={[{ margin: 8, padding: 4, borderWidth: 1, borderColor: S.rule }, style]}>
    <View style={{ backgroundColor: S.paper, borderWidth: 1.5, borderColor: S.ink, overflow: "hidden" }}>
      <Grid />
      {children}
    </View>
  </View>
);

/** Eyebrow, title, subtitle and an optional action: the head of a sheet. */
export const TitleBlock: React.FC<{ eyebrow: string; title: string; subtitle?: string; action?: React.ReactNode }> = ({ eyebrow, title, subtitle, action }) => (
  <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <Label>{eyebrow}</Label>
        <Text style={{ fontFamily: fonts.heading.bold, fontSize: 26, lineHeight: 28, letterSpacing: -0.8, color: S.ink }}>{title}</Text>
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
  <View style={[{ borderTopWidth: 1, borderTopColor: S.rule, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18 }, style]}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <Tag>{tag}</Tag>
      <Label color={S.ink}>{title}</Label>
      <View style={{ flex: 1, height: 1, backgroundColor: S.rule }} />
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
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { backgroundColor: S.blueWash }, style]}>
      {children}
    </Pressable>
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
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        { minHeight: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: border, backgroundColor: pressed && !filled ? S.blueWash : bg, opacity: disabled ? 0.4 : pressed && filled ? 0.85 : 1 },
        style,
      ]}
    >
      {icon}
      {children ?? <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", color: fg }}>{label}</Text>}
    </Pressable>
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
export const Input = React.forwardRef<TextInput, TextInputProps & { right?: React.ReactNode }>(function Input({ right, style, onFocus, onBlur, ...props }, ref) {
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
