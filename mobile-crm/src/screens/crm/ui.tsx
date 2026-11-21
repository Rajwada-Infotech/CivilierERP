// The kit every Civilier CRM screen is built from — Civilier Home's (mobile-maintenance src/customer/ui.tsx), so the
// two apps look and feel the same: depth by tone, not outlines (cards a step lighter than the page); the accent spent
// on what matters (the main figure, the one primary key, the current step); sentence-case titles, large figures,
// 44 px+ touch targets. Colours come from the theme (useBrand), so light / dark and the accent the person picks
// (More → Appearance) apply everywhere. Plus the CRM's own helpers: money and dates as the web CRM prints them, and
// the buyer's Call / WhatsApp keys.
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View,
  type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import { ChevronRight, MessageCircle, Phone, type LucideIcon } from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";

/** The accent the person picked (More → Appearance), live — see theme/colors.ts `accent`. */
export { accent as CRM } from "@/theme/colors";

/** Text / icons on a solid accent fill. */
export const ON_ACCENT = "#FFFFFF";
/** Room left under a tab's page for the floating tab bar (MainStack.tsx). */
export const TAB_BAR_CLEARANCE = 112;

// ── Formatting ───────────────────────────────────────────────────────────────
/** 05 Nov 2026 — the web CRM's date (CrmPossession.tsx fmtDate). A date the server sends already written out
 * ("Thu Nov 19", the booking journey) is shown as it is — read as a date it would lose its year. */
export const fmtDate = (d?: string | null) =>
  !d ? "—" : /^\d{4}-\d{2}-\d{2}/.test(d) ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : d;

/** Rupees to the paisa when there are paise, else whole rupees. */
export const money = (v: unknown) => {
  const n = Number(v) || 0;
  return formatINR(n, { decimals: Number.isInteger(n) ? 0 : 2 });
};

/** Text parts joined with " · "; empty parts (and the 0 / false a `flag && text` part gives) are left out. */
export const joinDot = (...parts: unknown[]) =>
  parts.filter((p) => (typeof p === "string" && p.trim() !== "") || (typeof p === "number" && p !== 0)).join(" · ");

/** A status code read as words: "PartiallyApplied" → "Partially Applied". */
export const words = (s?: string | null) => (s ? s.replace(/([a-z])([A-Z])/g, "$1 $2") : "");

// ── Tap ──────────────────────────────────────────────────────────────────────
/** A Pressable whose `style` may be a function of `{ pressed }` and still works on a phone (NativeWind drops a
 * function style on native Pressables). Tap tracks "pressed" itself and always hands Pressable a plain style. */
type TapStyle = StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
export function Tap({ style, onPressIn, onPressOut, ...rest }: Omit<PressableProps, "style"> & { style?: TapStyle }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      {...rest}
      onPressIn={(e: GestureResponderEvent) => { setPressed(true); onPressIn?.(e); }}
      onPressOut={(e: GestureResponderEvent) => { setPressed(false); onPressOut?.(e); }}
      style={typeof style === "function" ? style({ pressed }) : style}
    />
  );
}

// ── Page and cards ───────────────────────────────────────────────────────────
/** A scrolling page: the theme's page colour, 18 px sides, pull to refresh. `tab` leaves room for the tab bar. */
export function Page({ children, onRefresh, tab, gap = 0 }: { children: ReactNode; onRefresh?: () => Promise<unknown>; tab?: boolean; gap?: number }) {
  const b = useBrand();
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: b.surface }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: tab ? TAB_BAR_CLEARANCE : 36, gap }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? (
        <RefreshControl refreshing={busy} tintColor={b.accent} colors={[b.accent]} progressBackgroundColor={b.surfaceCard}
          onRefresh={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }} />
      ) : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** A card's look, shared so hand-built cards match the kit's exactly. */
export function useCardStyle() {
  const b = useBrand();
  return {
    borderRadius: 22, backgroundColor: b.surfaceCard,
    borderWidth: b.isDark ? 1 : 0, borderColor: b.border,
    shadowColor: "#0F111A", shadowOpacity: b.isDark ? 0 : 0.06, shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 }, elevation: b.isDark ? 0 : 2,
  } as const;
}

/** A titled card (the old CRM "section"): an optional icon chip, the title, something on the right, then the rows. */
export function Section({ title, icon: Icon, right, children }: { title: string; icon?: LucideIcon; right?: ReactNode; children: ReactNode }) {
  const b = useBrand();
  const card = useCardStyle();
  return (
    <View style={[card, { marginBottom: 12 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 16 }}>
        {Icon ? (
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: b.accentSoft, alignItems: "center", justifyContent: "center" }}>
            <Icon size={16} color={b.accent} />
          </View>
        ) : null}
        <Text style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 16, letterSpacing: -0.2, color: b.textPrimary }}>{title}</Text>
        {right}
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>{children}</View>
    </View>
  );
}

/** A title above free-standing content (tiles, a list of cards). */
export function Heading({ title, right }: { title: string; right?: ReactNode }) {
  const b = useBrand();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4, marginTop: 4 }}>
      <Text style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 17, letterSpacing: -0.2, color: b.textPrimary }}>{title}</Text>
      {right}
    </View>
  );
}

/** A label and its value on one line. */
export function Kv({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: string }) {
  const b = useBrand();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingVertical: 7 }}>
      <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{label}</Text>
      <Text style={{ flexShrink: 1, flex: 1, textAlign: "right", fontSize: strong ? 15.5 : 14, fontFamily: strong ? fonts.heading.semibold : fonts.body.medium, color: tone || b.textPrimary, fontVariant: ["tabular-nums"] }}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </Text>
    </View>
  );
}

/** A figure tile: a label, a large figure, a line under it. Tap it when it leads somewhere. */
export function Figure({ label, value, tone, sub, onPress }: { label: string; value: string; tone?: string; sub?: string; onPress?: () => void }) {
  const b = useBrand();
  const c = tone || b.accent;
  return (
    <Tap disabled={!onPress} onPress={onPress}
      style={({ pressed }) => ({ flex: 1, borderRadius: 18, padding: 14, gap: 4, backgroundColor: b.surfaceCard,
        borderWidth: b.isDark ? 1 : 0, borderColor: b.border, opacity: pressed ? 0.75 : 1 })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
        <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}</Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 19, fontFamily: fonts.heading.semibold, letterSpacing: -0.3, color: b.textPrimary, fontVariant: ["tabular-nums"] }}>{value}</Text>
      {sub ? <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
    </Tap>
  );
}

/** A row that opens something: an optional icon chip, a title and a line under it, something on the right. */
export function LinkRow({ title, sub, right, onPress, icon: Icon, tone }: {
  title: string; sub?: string; right?: ReactNode; onPress?: () => void;
  icon?: React.ComponentType<{ size?: number; color?: string }>; tone?: string;
}) {
  const b = useBrand();
  const c = tone || b.accent;
  return (
    <Tap disabled={!onPress} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 9, opacity: pressed ? 0.6 : 1 })}>
      {Icon ? (
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: `${c}24`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={18} color={c} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{title}</Text>
        {sub ? <Text numberOfLines={2} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
      </View>
      {right}
      {onPress ? <ChevronRight size={18} color={b.textFaint} /> : null}
    </Tap>
  );
}

/** A grouped list of places to go, like a phone's own Settings: icon chip, label, a line under it, a badge. */
export interface MenuItem { key: string; label: string; sub?: string; icon: LucideIcon; tint?: string; badge?: number; onPress: () => void }
export function MenuGroup({ items }: { items: MenuItem[] }) {
  const b = useBrand();
  const card = useCardStyle();
  return (
    <View style={[card, { overflow: "hidden" }]}>
      {items.map((m, i) => (
        <Tap key={m.key} onPress={m.onPress}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 62, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
          <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: `${m.tint || b.accent}24` }}>
            <m.icon size={19} color={m.tint || b.accent} />
          </View>
          <View style={{ flex: 1, gap: 2, paddingVertical: 12, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: b.border, alignSelf: "stretch", justifyContent: "center" }}>
            <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{m.label}</Text>
            {m.sub ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{m.sub}</Text> : null}
          </View>
          {m.badge ? (
            <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: b.danger, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontFamily: fonts.heading.semibold, fontSize: 11.5 }}>{m.badge > 99 ? "99+" : m.badge}</Text>
            </View>
          ) : null}
          <ChevronRight size={18} color={b.textFaint} />
        </Tap>
      ))}
    </View>
  );
}

// ── Small parts ──────────────────────────────────────────────────────────────
export const Empty = ({ text }: { text: string }) => {
  const b = useBrand();
  return <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: b.textSecondary, paddingVertical: 10 }}>{text}</Text>;
};

export function Muted({ children }: { children: ReactNode }) {
  const b = useBrand();
  return <Text style={{ fontSize: 13, lineHeight: 19, fontFamily: fonts.body.regular, color: b.textSecondary }}>{children}</Text>;
}

export function ErrorText({ error }: { error: unknown }) {
  const b = useBrand();
  return (
    <View style={{ borderRadius: 16, backgroundColor: b.dangerSoft, padding: 14 }}>
      <Text style={{ color: b.danger, fontFamily: fonts.body.medium, fontSize: 13.5 }}>{error instanceof Error ? error.message : String(error || "Could not load")}</Text>
    </View>
  );
}

export function Loading() {
  const b = useBrand();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ height: 140, borderRadius: 22, backgroundColor: b.surfaceCard }} />
      <ActivityIndicator color={b.accent} style={{ paddingVertical: 12 }} />
    </View>
  );
}

/** A status as a soft pill: a tone from its meaning (done green, waiting amber, stopped red, closed grey), or `tone`. */
export function Pill({ label, tone }: { label: string; tone?: string }) {
  const b = useBrand();
  const l = label.toLowerCase();
  const t = tone ? { bg: `${tone}24`, fg: tone }
    : /cancel|void|closed|expired|inactive|not ready|unit changed|waived/.test(l) ? { bg: b.surfaceGlass, fg: b.textSecondary }
    : /overdue|reject|fail|bounce|disput|blocked|past sla|not reach|switched off/.test(l) ? { bg: b.dangerSoft, fg: b.danger }
    : /approved|confirmed|done|complet|registered|paid|resolved|welcomed|applied$|acknowledged|ready|converted/.test(l) ? { bg: b.successSoft, fg: b.success }
    : /pending|progress|due|open|draft|demanded|partial|unapplied|submitted|callback|voicemail|busy|not called|assigned|reopened|checklist|notice|handover/.test(l) ? { bg: b.warningSoft, fg: b.warning }
    : { bg: b.accentSoft, fg: b.accent };
  return (
    <View style={{ borderRadius: 100, backgroundColor: t.bg, paddingHorizontal: 10, paddingVertical: 3.5, alignSelf: "flex-start" }}>
      <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: t.fg }}>{words(label)}</Text>
    </View>
  );
}

/** A thin progress bar. */
export function Bar({ pct, color }: { pct: number; color?: string }) {
  const b = useBrand();
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: b.surfaceGlass, overflow: "hidden" }}>
      <View style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: 3, backgroundColor: color || b.accent }} />
    </View>
  );
}

/** Circular progress. */
export function Ring({ pct, size = 96, stroke = 9, color, track, children }: { pct: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode }) {
  const b = useBrand();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track || b.surfaceGlass} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color || b.accent} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p / 100)} />
      </Svg>
      {children}
    </View>
  );
}

/** A person's initials in a round accent-gradient badge — the header button, the account menu, the profile. */
export function AccentAvatar({ text, size = 40 }: { text: string; size?: number }) {
  const b = useBrand();
  return (
    <LinearGradient colors={b.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: ON_ACCENT, fontSize: Math.round(size * 0.34), fontFamily: fonts.heading.semibold }}>{text}</Text>
    </LinearGradient>
  );
}

// ── Keys ─────────────────────────────────────────────────────────────────────
/** The page's main key (accent gradient) or a quieter one (`kind="line"`). */
export function Button({ label, onPress, icon: Icon, kind = "solid", disabled, busy }: {
  label: string; onPress: () => void; icon?: LucideIcon; kind?: "solid" | "line"; disabled?: boolean; busy?: boolean;
}) {
  const b = useBrand();
  const solid = kind === "solid";
  const fg = solid ? ON_ACCENT : b.textPrimary;
  const inner = (
    <>
      {busy ? <ActivityIndicator size="small" color={fg} /> : Icon ? <Icon size={17} color={fg} /> : null}
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: fg }}>{label}</Text>
    </>
  );
  const row = { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, paddingVertical: 13, paddingHorizontal: 20 } as const;
  return (
    <Tap onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => ({
        borderRadius: 16, overflow: "hidden", backgroundColor: solid ? undefined : b.surfaceGlass,
        opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }],
        ...(solid ? { shadowColor: b.accent, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 } : {}),
      })}>
      {solid ? <LinearGradient colors={b.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={row}>{inner}</LinearGradient> : <View style={row}>{inner}</View>}
    </Tap>
  );
}

/** A key in a row of keys (Log welcome call, Pay…): the accent fill, or `outline` for the quieter ones. */
export function ActionKey({ label, icon: Icon, onPress, tone, outline }: {
  label: string; icon?: React.ComponentType<{ size?: number; color?: string }>; onPress: () => void; tone?: string; outline?: boolean;
}) {
  const b = useBrand();
  const c = tone || b.accent;
  return (
    <Tap onPress={onPress}
      style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 14,
        backgroundColor: outline ? `${c}1f` : c, opacity: pressed ? 0.75 : 1 })}>
      {Icon ? <Icon size={16} color={outline ? c : ON_ACCENT} /> : null}
      <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: outline ? c : ON_ACCENT }}>{label}</Text>
    </Tap>
  );
}

/** A soft banner that asks for something (approvals waiting, unread notifications): tap to open it. */
export function ActionBanner({ title, sub, tone = "accent", icon: Icon, onPress, cta }: {
  title: string; sub?: string; tone?: "accent" | "red" | "green" | "amber"; icon?: LucideIcon; onPress?: () => void; cta?: string;
}) {
  const b = useBrand();
  const c = tone === "red" ? { bg: b.dangerSoft, fg: b.danger } : tone === "green" ? { bg: b.successSoft, fg: b.success }
    : tone === "amber" ? { bg: b.warningSoft, fg: b.warning } : { bg: b.accentSoft, fg: b.accent };
  return (
    <Tap disabled={!onPress} onPress={onPress}
      style={({ pressed }) => ({ borderRadius: 18, backgroundColor: c.bg, opacity: pressed ? 0.75 : 1, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 })}>
      {Icon ? <Icon size={20} color={c.fg} /> : null}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: c.fg }}>{title}</Text>
        {sub ? <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
      </View>
      {onPress ? <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13.5, color: c.fg }}>{cta ?? "Open ›"}</Text> : null}
    </Tap>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
/** The deep card (the same purple in light and dark, like Civilier Home's) — Home's top card. Text on it is light. */
export function HeroSurface({ children, padding = 20 }: { children: ReactNode; padding?: number }) {
  const b = useBrand();
  return (
    <View style={{ borderRadius: 26, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 }}>
      <LinearGradient colors={[b.heroFrom, b.heroMid, b.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding }}>
        <LinearGradient pointerEvents="none" colors={[b.accentSoft, "transparent"]} start={{ x: 1, y: 0 }} end={{ x: 0.4, y: 0.6 }}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: "rgba(255,255,255,0.10)" }} />
        {children}
      </LinearGradient>
    </View>
  );
}
/** Text colours for use on a HeroSurface. */
export const ON_HERO = { primary: "#FFFFFF", secondary: "rgba(255,255,255,0.68)", faint: "rgba(255,255,255,0.42)", glass: "rgba(255,255,255,0.10)" };

// ── Contact ──────────────────────────────────────────────────────────────────
/** The digits to dial: an Indian 10-digit number gets +91; a number already carrying its country code is kept. */
const dialDigits = (mobile: string) => {
  const d = String(mobile).replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d.replace(/^0+/, "");
};
const openLink = (url: string) => Linking.openURL(url).catch(() => Alert.alert("Can't open", "This phone has no app for that."));

/** Call and WhatsApp keys for a buyer's mobile number — on cards, bookings, customers and tickets. */
export function ContactKeys({ mobile, compact }: { mobile?: string | null; compact?: boolean }) {
  const b = useBrand();
  if (!mobile || String(mobile).replace(/\D/g, "").length < 10) return null;
  const size = compact ? 34 : 42;
  const key = (Icon: typeof Phone, tone: string, label: string, onPress: () => void) => (
    <Tap onPress={onPress} accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 7, height: size, paddingHorizontal: compact ? 0 : 16, width: compact ? size : undefined,
        justifyContent: "center", borderRadius: size / 2, backgroundColor: `${tone}22`, opacity: pressed ? 0.7 : 1 })}>
      <Icon size={compact ? 15 : 17} color={tone} />
      {compact ? null : <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: tone }}>{label}</Text>}
    </Tap>
  );
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {key(Phone, b.isDark ? "#60A5FA" : "#2563EB", "Call", () => openLink(`tel:+${dialDigits(mobile)}`))}
      {key(MessageCircle, b.success, "WhatsApp", () => openLink(`https://wa.me/${dialDigits(mobile)}`))}
    </View>
  );
}
