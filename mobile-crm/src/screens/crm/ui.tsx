// The small kit every CRM screen shares: dates and money as the web CRM prints them, a section card, label / value
// rows and a figure tile. One place, so the screens look and read alike.
import { Alert, Linking, View, Text, Pressable } from "react-native";
import { ChevronRight, MessageCircle, Phone } from "lucide-react-native";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";

export const CRM = moduleAccents.crm;

/** 05 Nov 2026 — the web CRM's date (CrmPossession.tsx fmtDate). */
export const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/** Rupees to the paisa when there are paise, else whole rupees. */
export const money = (v: unknown) => {
  const n = Number(v) || 0;
  return formatINR(n, { decimals: Number.isInteger(n) ? 0 : 2 });
};

/** Text parts joined with " · "; empty parts (and the 0 / false a `flag && text` part gives) are left out. */
export const joinDot = (...parts: unknown[]) =>
  parts.filter((p) => (typeof p === "string" && p.trim() !== "") || (typeof p === "number" && p !== 0)).join(" · ");

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1.4 }}>{title}</Text>
        {right}
      </View>
      <View style={{ paddingHorizontal: 14, paddingVertical: 6 }}>{children}</View>
    </View>
  );
}

export function Kv({ label, value, strong, tone }: { label: string; value: React.ReactNode; strong?: boolean; tone?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ flexShrink: 1, textAlign: "right", fontSize: 12.5, fontFamily: strong ? fonts.heading.bold : fonts.body.medium, color: tone || colors.foreground, fontVariant: ["tabular-nums"] }}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </Text>
    </View>
  );
}

export function Figure({ label, value, tone, sub, onPress }: { label: string; value: string; tone?: string; sub?: string; onPress?: () => void }) {
  const c = tone || CRM;
  return (
    <Pressable disabled={!onPress} onPress={onPress}
      style={({ pressed }) => ({ flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: `${c}30`, padding: 12, opacity: pressed ? 0.8 : 1 })}>
      <Text numberOfLines={1} style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color: c, textTransform: "uppercase", letterSpacing: 1 }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: colors.foreground, marginTop: 6, fontVariant: ["tabular-nums"] }}>{value}</Text>
      {sub ? <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>{sub}</Text> : null}
    </Pressable>
  );
}

export function LinkRow({ title, sub, right, onPress, icon: Icon, tone = CRM }: {
  title: string; sub?: string; right?: React.ReactNode; onPress?: () => void;
  icon?: React.ComponentType<{ size?: number; color?: string }>; tone?: string;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, opacity: pressed ? 0.7 : 1 })}>
      {Icon ? (
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: `${tone}1f`, alignItems: "center", justifyContent: "center" }}>
          <Icon size={15} color={tone} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{title}</Text>
        {sub ? <Text numberOfLines={2} style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {right}
      {onPress ? <ChevronRight size={16} color={colors.mutedForeground} /> : null}
    </Pressable>
  );
}

export const Empty = ({ text }: { text: string }) => (
  <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, paddingVertical: 10 }}>{text}</Text>
);

/** The digits to dial: an Indian 10-digit number gets +91; a number already carrying its country code is kept. */
const dialDigits = (mobile: string) => {
  const d = String(mobile).replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d.replace(/^0+/, "");
};
const openLink = (url: string) => Linking.openURL(url).catch(() => Alert.alert("Can't open", "This phone has no app for that."));

/** Call and WhatsApp keys for a buyer's mobile number — on cards, bookings, customers and tickets. */
export function ContactKeys({ mobile, compact }: { mobile?: string | null; compact?: boolean }) {
  if (!mobile || String(mobile).replace(/\D/g, "").length < 10) return null;
  const size = compact ? 30 : 38;
  const key = (Icon: typeof Phone, tone: string, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: size, paddingHorizontal: compact ? 0 : 14, width: compact ? size : undefined,
        justifyContent: "center", borderRadius: size / 2, backgroundColor: `${tone}1f`, borderWidth: 1, borderColor: `${tone}55`, opacity: pressed ? 0.7 : 1 })}>
      <Icon size={compact ? 14 : 16} color={tone} />
      {compact ? null : <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: tone }}>{label}</Text>}
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {key(Phone, "#3b82f6", "Call", () => openLink(`tel:+${dialDigits(mobile)}`))}
      {key(MessageCircle, "#22c55e", "WhatsApp", () => openLink(`https://wa.me/${dialDigits(mobile)}`))}
    </View>
  );
}

/** A full-width action key (Log welcome call, Submit payment…). */
export function ActionKey({ label, icon: Icon, onPress, tone = CRM, outline }: {
  label: string; icon?: React.ComponentType<{ size?: number; color?: string }>; onPress: () => void; tone?: string; outline?: boolean;
}) {
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12,
        backgroundColor: outline ? "transparent" : tone, borderWidth: 1, borderColor: outline ? `${tone}66` : tone, opacity: pressed ? 0.75 : 1 })}>
      {Icon ? <Icon size={15} color={outline ? tone : "#fff"} /> : null}
      <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: outline ? tone : "#fff" }}>{label}</Text>
    </Pressable>
  );
}
