// Parts the Balance Sheet, Profit & Loss and Balance Enquiry pages share, on the drawing sheet as the web draws them:
// a wrapping row of period keys, the statement's letterhead, ruled statement lines (a group line opens its ledger
// heads), a negative figure in brackets and red, and the PDF share every report offers in place of the web's print.
import { View, Text, Alert } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Label, Press } from "@/components/sheet/Sheet";

/** ₹ in whole rupees, Indian grouping — the web's formatINR. */
export const inr = (v: unknown) => `₹${Math.round(Math.abs(Number(v) || 0)).toLocaleString("en-IN")}`;
/** A figure as a statement writes it: a negative one in brackets. */
export const signed = (v: number) => (v < -0.005 ? `(${inr(v)})` : inr(v));
export const isNeg = (v: number) => v < -0.005;

export function dmy(d?: string | null, month: "short" | "long" = "short") {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month, year: "numeric" });
}

export const isoToday = () => new Date().toISOString().slice(0, 10);
/** The Indian financial year a date falls in: its starting calendar year. */
export const fyStartYear = (now = new Date()) => (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);

/** Period keys that wrap onto a second line on a narrow phone: each a square key, the chosen one filled ink. */
export function KeyRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Press
            key={o.value}
            onPress={() => onChange(o.value)}
            style={(pressed) => ({ paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: S.ink, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
          >
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: on ? S.paper : S.graphite }}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/** The statement's letterhead: the company in capitals, the statement's name, its date line, the rupee note. */
export function Letterhead({ kicker, company, statement, period, note }: { kicker?: string | null; company: string | null; statement: string; period: string; note: string }) {
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: S.ink, alignItems: "center", gap: 4 }}>
      {!!kicker && <Label style={{ textAlign: "center", marginBottom: 4 }}>{kicker}</Label>}
      <Text style={{ fontFamily: fonts.heading.bold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", color: S.ink, textAlign: "center" }}>{company || "Consolidated: all companies"}</Text>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase", color: S.ink, marginTop: 4, textAlign: "center" }}>{statement}</Text>
      {!!period && <Body size={12} color={S.graphite} style={{ textAlign: "center" }}>{period}</Body>}
      <Body size={10} color={S.graphite} style={{ textAlign: "center" }}>{note}</Body>
    </View>
  );
}

/** A section's capital heading inside a statement. */
export function SectionHead({ children, roman, ruled }: { children: string; roman?: string; ruled?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        gap: 8,
        paddingTop: ruled ? 10 : 14,
        paddingBottom: ruled ? 10 : 4,
        borderTopWidth: ruled ? 1 : 0,
        borderBottomWidth: ruled ? 1 : 0,
        borderColor: S.ink,
      }}
    >
      {!!roman && <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11, color: S.graphite }}>{`${roman}.`}</Text>}
      <Text style={{ flex: 1, fontFamily: fonts.heading.bold, fontSize: ruled ? 12 : 11, letterSpacing: 1.3, textTransform: "uppercase", color: S.ink }}>{children}</Text>
    </View>
  );
}

type LineKind = "line" | "sub" | "soft" | "total";

/**
 * One statement line: label left, figure right. "line" is a ruled entry, "sub" a sub-total on an ink rule, "soft" a
 * sub-total on a light rule, "total" the closing figure on a heavy rule. With heads it opens to list them.
 */
export function StLine({
  label, amount, kind = "line", indent = 0, prefix, note, aside, strong, muted, open, onPress, color,
}: {
  label: string; amount?: number | null; kind?: LineKind; indent?: number; prefix?: string; note?: string; aside?: string;
  strong?: boolean; muted?: boolean; open?: boolean; onPress?: () => void; color?: string;
}) {
  const total = kind === "total";
  const bold = strong || kind === "sub" || total;
  const neg = amount != null && isNeg(amount);
  return (
    <Press
      onPress={onPress}
      disabled={!onPress}
      style={(pressed) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingVertical: total ? 11 : 8,
        paddingLeft: indent * 12,
        borderTopWidth: kind === "line" ? 0 : total ? 2 : 1,
        borderTopColor: kind === "soft" ? S.rule : S.ink,
        borderBottomWidth: kind === "line" ? 1 : total ? 1 : 0,
        borderBottomColor: total ? S.ink : S.ruleSoft,
        backgroundColor: open || pressed ? S.blueWash : "transparent",
      })}
    >
      {prefix ? <Text style={{ width: 24, fontFamily: fonts.heading.semibold, fontSize: 10.5, color: S.graphite, marginTop: 1 }}>{prefix}</Text> : null}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 5 }}>
        {onPress ? (open ? <ChevronDown size={12} color={S.ink} style={{ marginTop: 2 }} /> : <ChevronRight size={12} color={S.ink} style={{ marginTop: 2 }} />) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontFamily: total ? fonts.heading.bold : bold ? fonts.body.semibold : fonts.body.medium,
              fontSize: total ? 11 : 12.5,
              letterSpacing: total ? 1.2 : 0,
              textTransform: total ? "uppercase" : "none",
              color: color ?? (muted ? S.graphite : S.ink),
            }}
          >
            {label}
          </Text>
          {!!note && <Body size={10.5} color={S.graphite} style={{ marginTop: 2 }}>{note}</Body>}
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {amount != null && (
          <Text style={{ fontFamily: bold ? fonts.heading.bold : fonts.heading.semibold, fontSize: total ? 13.5 : 12.5, color: color ?? (neg ? S.red : muted ? S.graphite : S.ink), fontVariant: ["tabular-nums"] }}>
            {signed(amount)}
          </Text>
        )}
        {!!aside && <Text style={{ fontFamily: fonts.heading.medium, fontSize: 10.5, color: S.graphite, marginTop: 2, fontVariant: ["tabular-nums"] }}>{aside}</Text>}
      </View>
    </Press>
  );
}

/** A group's ledger heads, under an ink rule on the left. */
export function HeadsList({ heads, indent = 0 }: { heads: { id: number | null; name: string; amount: number }[]; indent?: number }) {
  return (
    <View style={{ marginLeft: indent * 12 + 18, marginVertical: 6, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: S.ink, gap: 5 }}>
      {heads.map((h, i) => (
        <View key={`${h.id ?? h.name}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
          <Text style={{ flex: 1, fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>{h.name}</Text>
          <Text style={{ fontFamily: fonts.heading.medium, fontSize: 11.5, color: isNeg(h.amount) ? S.red : S.ink, fontVariant: ["tabular-nums"] }}>{signed(h.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Print-safe HTML shared as a PDF: the phone's stand-in for the web's Print and Export keys. */
export async function sharePdf(title: string, subtitle: string, bodyHtml: string) {
  const html = `<html><head><meta charset="utf-8" /><style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; padding: 20px; }
    h1 { font-size: 16px; margin: 0 0 2px; text-transform: uppercase; letter-spacing: 1px; text-align: center; }
    h2 { font-size: 11px; color: #555; margin: 0 0 14px; font-weight: normal; text-align: center; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 5px 4px; border-bottom: 1px solid #e5e5e5; font-size: 10px; text-align: left; vertical-align: top; }
    th { text-transform: uppercase; color: #555; font-size: 9px; border-bottom: 1px solid #111; }
    .amt { text-align: right; white-space: nowrap; }
    .sec td { font-weight: 700; text-transform: uppercase; letter-spacing: .5px; padding-top: 12px; border-bottom: 1px solid #111; }
    .sub td { font-weight: 700; border-top: 1px solid #111; }
    .tot td { font-weight: 700; border-top: 2px solid #111; border-bottom: 1px solid #111; }
    .head td { color: #555; padding-left: 22px; }
  </style></head><body><h1>${esc(title)}</h1><h2>${esc(subtitle)}</h2>${bodyHtml}</body></html>`;
  try {
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: title });
    else await Print.printAsync({ uri });
  } catch (e: any) {
    Alert.alert("Export failed", e?.message ?? `Could not make the ${title} PDF.`);
  }
}

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** One HTML table row: the label, then each figure right-aligned. */
export const htmlRow = (cls: string, label: string, ...amounts: (string | number | null | undefined)[]) =>
  `<tr${cls ? ` class="${cls}"` : ""}><td>${esc(label)}</td>${amounts.map((a) => `<td class="amt">${a == null ? "" : esc(typeof a === "number" ? signed(a) : a)}</td>`).join("")}</tr>`;
