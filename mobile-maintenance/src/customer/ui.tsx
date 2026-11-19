// UI kit for the Civilier Home customer screens.
// Design rules (from current banking / home-buyer app practice):
//  • depth by tone, not outlines — cards are a lighter surface than the page, with at most a hairline;
//  • the accent is spent on what matters (the main figure, the one primary button, the current step);
//  • sentence-case section titles, large figures, 44 px+ touch targets, no colour without a word beside it.
// Every export keeps its old name and props, so all screens pick the look up without changes.
import { useContext, useState, type ReactNode } from "react";
import { HeaderHeightContext } from "@react-navigation/elements";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle } from "react-native-svg";
import type { LucideIcon } from "lucide-react-native";
import { ChevronRight } from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";

// Static constants kept for backward-compat (screens that import ACCENT directly)
export const ACCENT      = "#C9A227";
export const ACCENT_SOFT = "rgba(201,162,39,0.15)";
/** Text/icon colour on a solid accent fill. */
export const ON_ACCENT   = "#14110A";

export const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** "Today", "Yesterday", "3 days ago", else the date. */
export function ago(at: string) {
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? `${days} days ago` : fmtDate(at);
}

export const money = (n: unknown) => formatINR(n as never, { decimals: 0 });

/** A person's or project's name as people write it: words stored in ALL CAPS ("SILVER WOODS") become "Silver Woods".
 * Codes are left alone — any word with a digit, "/" or "-" (P-120, TSTRSD/A/1002) — and so are names already typed in
 * mixed case. */
export const displayName = (v?: string | null) =>
  (v || "").trim().split(/\s+/).map((w) => (/^[A-Z][A-Z.']+$/.test(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(" ");

/** A Pressable whose `style` may be a function of `{ pressed }` — and still works on a phone. NativeWind (this app's
 * styling layer) drops a function style on native Pressables (web keeps it), which left buttons without their layout
 * or colour on devices. Tap tracks "pressed" itself and always hands Pressable a plain style. Use it instead of
 * Pressable everywhere in the customer screens. */
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

/** Room for the floating glass top bar: content starts below it and scrolls under it (0 where there is no header). */
export function useTopInset() {
  return useContext(HeaderHeightContext) ?? 0;
}

/** Clearance for the floating tab bar (CustomerStack.tsx), so the last card is never under it. */
export const TAB_BAR_CLEARANCE = 120;

// ── Page ─────────────────────────────────────────────────────────────────────
export function Page({ children, onRefresh }: { children: ReactNode; onRefresh?: () => Promise<unknown> }) {
  const b = useBrand();
  const top = useTopInset();
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: b.surface }}
      contentContainerStyle={{ paddingHorizontal: 18, paddingTop: top + 12, paddingBottom: TAB_BAR_CLEARANCE, gap: 18 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={busy}
            tintColor={b.gold}
            colors={[b.gold]}
            progressBackgroundColor={b.surfaceCard}
            progressViewOffset={top}
            onRefresh={async () => {
              setBusy(true);
              try { await onRefresh(); } finally { setBusy(false); }
            }}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

/** A card's look, shared so hand-built cards match Panel exactly. */
export function useCardStyle() {
  const b = useBrand();
  return {
    borderRadius: 24, backgroundColor: b.surfaceCard,
    borderWidth: b.isDark ? 1 : 0, borderColor: b.border,
    shadowColor: "#0F111A", shadowOpacity: b.isDark ? 0 : 0.06, shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 }, elevation: b.isDark ? 0 : 2,
  } as const;
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export function Panel({
  title, icon: Icon, right, children,
}: {
  title?: string; icon?: LucideIcon; right?: ReactNode; children: ReactNode;
}) {
  const b = useBrand();
  const card = useCardStyle();
  return (
    <View style={card}>
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingTop: 18 }}>
          {Icon ? (
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: b.goldSoft, alignItems: "center", justifyContent: "center" }}>
              <Icon size={16} color={b.gold} />
            </View>
          ) : null}
          <Text style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 16.5, letterSpacing: -0.2, color: b.textPrimary }}>
            {title}
          </Text>
          {right}
        </View>
      ) : null}
      <View style={{ padding: 18, gap: 14 }}>{children}</View>
    </View>
  );
}

// ── Section (a title above free-standing content) ────────────────────────────
export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  const b = useBrand();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4 }}>
        <Text style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 17, letterSpacing: -0.2, color: b.textPrimary }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────
export function Row({ label, value, strong, tone, sub, indent }: {
  label: string; value: ReactNode; strong?: boolean; tone?: string;
  /** A short explanation under the label. */
  sub?: string | null;
  /** A part of the row above (e.g. one plot's share of the price). */
  indent?: boolean;
}) {
  const b = useBrand();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingLeft: indent ? 14 : 0 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: indent ? 13 : 14, fontFamily: fonts.body.regular, color: b.textSecondary }}>
          {label}
        </Text>
        {sub ? <Text style={{ fontSize: 12, lineHeight: 17, fontFamily: fonts.body.regular, color: b.textFaint }}>{sub}</Text> : null}
      </View>
      <Text
        style={{
          fontSize: strong ? 16.5 : 14.5,
          fontFamily: strong ? fonts.heading.semibold : fonts.body.medium,
          color: tone || b.textPrimary,
          fontVariant: ["tabular-nums"],
          textAlign: "right", flex: 1,
        }}
      >
        {value as string}
      </Text>
    </View>
  );
}

// ── Bar ───────────────────────────────────────────────────────────────────────
export function Bar({ pct, color }: { pct: number; color?: string }) {
  const b = useBrand();
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: b.surfaceGlass, overflow: "hidden" }}>
      <View style={{ height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: 3, backgroundColor: color || b.gold }} />
    </View>
  );
}

// ── Ring (circular progress) ─────────────────────────────────────────────────
export function Ring({ pct, size = 96, stroke = 9, color, track, children }: {
  pct: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode;
}) {
  const b = useBrand();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track || b.surfaceGlass} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color || b.gold} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p / 100)} />
      </Svg>
      {children}
    </View>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
export function Button({
  label, onPress, icon: Icon, kind = "solid", disabled, busy,
}: {
  label: string; onPress: () => void; icon?: LucideIcon;
  kind?: "solid" | "line"; disabled?: boolean; busy?: boolean;
}) {
  const b = useBrand();
  const solid = kind === "solid";
  const fg = solid ? ON_ACCENT : b.textPrimary;
  const inner = (
    <>
      {busy ? <ActivityIndicator size="small" color={fg} /> : Icon ? <Icon size={17} color={fg} /> : null}
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15.5, color: fg }}>{label}</Text>
    </>
  );
  const row = { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, paddingVertical: 14, paddingHorizontal: 22 } as const;
  return (
    <Tap
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => ({
        borderRadius: 16, overflow: "hidden",
        backgroundColor: solid ? undefined : b.surfaceGlass,
        opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.985 : 1 }],
        ...(solid ? { shadowColor: b.gold, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 } : {}),
      })}
    >
      {solid ? (
        <LinearGradient colors={b.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={row}>{inner}</LinearGradient>
      ) : (
        <View style={row}>{inner}</View>
      )}
    </Tap>
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

// ── Muted / Loading / ErrorText ───────────────────────────────────────────────
export function Muted({ children }: { children: ReactNode }) {
  const b = useBrand();
  return (
    <Text style={{ fontSize: 14.5, lineHeight: 21, fontFamily: fonts.body.regular, color: b.textSecondary }}>
      {children}
    </Text>
  );
}

export function Loading() {
  const b = useBrand();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ height: 150, borderRadius: 24, backgroundColor: b.surfaceCard }} />
      {[0.8, 0.6].map((op, i) => (
        <View key={i} style={{ height: 18, width: `${70 - i * 20}%`, borderRadius: 9, backgroundColor: b.surfaceCard, opacity: op }} />
      ))}
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const b = useBrand();
  return (
    <View style={{ borderRadius: 18, backgroundColor: b.dangerSoft, padding: 16 }}>
      <Text style={{ color: b.danger, fontFamily: fonts.body.medium, fontSize: 14 }}>
        {error instanceof Error ? error.message : "Could not load"}
      </Text>
    </View>
  );
}

// ── ListRow ───────────────────────────────────────────────────────────────────
export function ListRow({
  title, sub, right, pill, onPress,
}: {
  title: string; sub?: string | null; right?: string; pill?: ReactNode; onPress?: () => void;
}) {
  const b = useBrand();
  return (
    <Tap
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52,
        paddingVertical: 10, borderRadius: 14, opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15.5, color: b.textPrimary }}>{title}</Text>
          {pill}
        </View>
        {sub ? <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
      </View>
      {right ? (
        <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary, fontVariant: ["tabular-nums"] }}>{right}</Text>
      ) : null}
      {onPress ? <ChevronRight size={18} color={b.textFaint} /> : null}
    </Tap>
  );
}

// ── MenuGroup (an inset grouped list, like a phone's own Settings) ───────────
export interface MenuItem { key: string; label: string; sub?: string; icon: LucideIcon; tint?: string; badge?: number; onPress: () => void }
export function MenuGroup({ items }: { items: MenuItem[] }) {
  const b = useBrand();
  const card = useCardStyle();
  return (
    <View style={[card, { overflow: "hidden" }]}>
      {items.map((m, i) => (
        <Tap key={m.key} onPress={m.onPress}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 66, backgroundColor: pressed ? b.surfaceGlass : "transparent" })}>
          <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center",
            // A hex tint gets a soft wash of itself; any other colour (rgba) sits on the neutral glass.
            backgroundColor: (m.tint || b.gold).startsWith("#") ? `${m.tint || b.gold}24` : b.surfaceGlass }}>
            <m.icon size={19} color={m.tint || b.gold} />
          </View>
          <View style={{ flex: 1, gap: 2, paddingVertical: 12, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: b.border, alignSelf: "stretch", justifyContent: "center" }}>
            <Text style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{m.label}</Text>
            {m.sub ? <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>{m.sub}</Text> : null}
          </View>
          {m.badge ? (
            <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: b.danger, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontFamily: fonts.heading.semibold, fontSize: 11.5 }}>{m.badge}</Text>
            </View>
          ) : null}
          <ChevronRight size={18} color={b.textFaint} />
        </Tap>
      ))}
    </View>
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
export function Divider() {
  const b = useBrand();
  return <View style={{ height: 1, backgroundColor: b.border }} />;
}

// ── Pill ──────────────────────────────────────────────────────────────────────
function pillTone(label: string, b: ReturnType<typeof useBrand>) {
  const l = label.toLowerCase();
  if (/cancelled|void|later|refunded|moved|adjustment|waived|closed|expired|sold/.test(l))
    return { bg: b.surfaceGlass, fg: b.textSecondary };
  if (/overdue|rejected|failed|bounced|not accepted/.test(l))
    return { bg: b.dangerSoft, fg: b.danger };
  if (/booked|confirmed|approved|done|completed|registered|paid|resolved|counted|covered/.test(l))
    return { bg: b.successSoft, fg: b.success };
  if (/pending|in progress|processing|due|open|verif|received/.test(l))
    return { bg: b.warningSoft, fg: b.warning };
  return { bg: b.goldSoft, fg: b.gold };
}

export function Pill({ label }: { label: string; tone?: string }) {
  const b = useBrand();
  const { bg, fg } = pillTone(label, b);
  return (
    <View style={{ borderRadius: 100, backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: fg }}>{label}</Text>
    </View>
  );
}

// ── Label ─────────────────────────────────────────────────────────────────────
export function Label({ children, color }: { children: ReactNode; color?: string }) {
  const b = useBrand();
  return (
    <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: color || b.textSecondary }}>
      {children}
    </Text>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

/** The deep, accent-tinted card (same in light and dark) — the home card, profile header. Text inside is light. */
export function HeroSurface({ children, padding = 22 }: { children: ReactNode; padding?: number }) {
  const b = useBrand();
  return (
    <View style={{ borderRadius: 28, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 }}>
      <LinearGradient colors={[b.heroFrom, b.heroMid, b.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding }}>
        <LinearGradient pointerEvents="none" colors={[b.goldSoft, "transparent"]} start={{ x: 1, y: 0 }} end={{ x: 0.4, y: 0.6 }}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: "rgba(255,255,255,0.10)" }} />
        {children}
      </LinearGradient>
    </View>
  );
}
/** Text colours for use on a HeroSurface. */
export const ON_HERO = { primary: "#FFFFFF", secondary: "rgba(255,255,255,0.68)", faint: "rgba(255,255,255,0.42)", glass: "rgba(255,255,255,0.10)" };

export function HeroCard({
  eyebrow, name, sub, badge, children,
}: {
  eyebrow?: string; name: string; sub?: string; badge?: string; children?: ReactNode;
}) {
  return (
    <HeroSurface>
      <View style={{ gap: 6 }}>
        {eyebrow ? <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>{eyebrow}</Text> : null}
        <Text style={{ fontSize: 24, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.4, lineHeight: 30 }}>{name}</Text>
        {sub ? <Text style={{ fontSize: 14, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>{sub}</Text> : null}
        {badge ? <Pill label={badge} /> : null}
        {children ? <View style={{ marginTop: 10 }}>{children}</View> : null}
      </View>
    </HeroSurface>
  );
}

export function StatRow({ items }: {
  items: { label: string; value: string; sub?: string; gold?: boolean; onPress?: () => void }[];
}) {
  const b = useBrand();
  // Two across at most: four figures squeezed into one row broke "₹15,00,000" and the labels mid-word on a phone.
  const wrap = items.length > 2;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {items.map((item) => (
        <Tap
          key={item.label}
          onPress={item.onPress}
          disabled={!item.onPress}
          style={({ pressed }) => ({
            flexGrow: 1, flexShrink: 1, flexBasis: wrap ? "45%" : 0, borderRadius: 18,
            backgroundColor: item.gold ? b.goldSoft : b.surfaceGlass, opacity: pressed ? 0.7 : 1,
            padding: 14, gap: 4,
          })}
        >
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{item.label}</Text>
          <Text style={{ fontSize: 19, fontFamily: fonts.heading.semibold, letterSpacing: -0.3, color: item.gold ? b.gold : b.textPrimary, fontVariant: ["tabular-nums"] }}>
            {item.value}
          </Text>
          {item.sub ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>{item.sub}</Text> : null}
        </Tap>
      ))}
    </View>
  );
}

export function ActionBanner({
  title, sub, tone, onPress, cta,
}: {
  title: string; sub?: string; tone?: "gold" | "red" | "green"; onPress?: () => void; cta?: string;
}) {
  const b = useBrand();
  const c =
    tone === "red"   ? { bg: b.dangerSoft,  text: b.danger  } :
    tone === "green" ? { bg: b.successSoft, text: b.success } :
                       { bg: b.goldSoft,    text: b.gold    };
  return (
    <Tap
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        borderRadius: 18, backgroundColor: c.bg, opacity: pressed ? 0.75 : 1,
        padding: 16, flexDirection: "row", alignItems: "center", gap: 12,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: c.text }}>{title}</Text>
        {sub ? <Text style={{ fontSize: 13.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
      </View>
      {cta || onPress ? <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 14, color: c.text }}>{cta ?? "Open ›"}</Text> : null}
    </Tap>
  );
}
