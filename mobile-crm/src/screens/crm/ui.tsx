// The small kit every CRM screen shares: dates and money as the web CRM prints them, a section card, label / value
// rows and a figure tile. One place, so the screens look and read alike.
import { View, Text, Pressable } from "react-native";
import { ChevronRight } from "lucide-react-native";
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

export function LinkRow({ title, sub, right, onPress }: { title: string; sub?: string; right?: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, opacity: pressed ? 0.7 : 1 })}>
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
