// Renders a general-ledger journal entry (Account / Dr·Cr / Amount) plus an
// optional block of computed figures. Shared by the Fixed Asset Record
// depreciation card and the Maintenance posting preview. The JE table is the
// one place horizontal scroll is allowed — it lives in its own container.
import { View, Text, ScrollView } from "react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";

export interface GlEntry {
  account: string;
  debit?: number;
  credit?: number;
}

export function PostingPreviewCard({
  title = "Journal Entry",
  entries,
  figures,
  note,
}: {
  title?: string;
  entries: GlEntry[];
  figures?: { label: string; value: string; hint?: string }[];
  note?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
      }}
    >
      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.bold, letterSpacing: 1.2, textTransform: "uppercase" }}>
        {title}
      </Text>

      {figures && figures.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {figures.map((f) => (
            <View key={f.label} style={{ backgroundColor: `${colors.muted}80`, borderRadius: 10, padding: 8, minWidth: "45%", flexGrow: 1 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>{f.label}</Text>
              <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold, marginTop: 2 }}>{f.value}</Text>
              {f.hint && <Text style={{ color: "#5c6270", fontSize: 9, fontFamily: fonts.body.regular, marginTop: 1 }}>{f.hint}</Text>}
            </View>
          ))}
        </View>
      )}

      {entries.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
          <View style={{ minWidth: 300 }}>
            <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={[hCell, { flex: 2 }]}>Account</Text>
              <Text style={[hCell, { width: 54, textAlign: "center" }]}>Dr/Cr</Text>
              <Text style={[hCell, { width: 96, textAlign: "right" }]}>Amount</Text>
            </View>
            {entries.map((e, i) => (
              <View key={i} style={{ flexDirection: "row", paddingVertical: 7, borderBottomWidth: i < entries.length - 1 ? 1 : 0, borderBottomColor: `${colors.border}80` }}>
                <Text style={{ flex: 2, color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.regular }}>{e.account}</Text>
                <View style={{ width: 54, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: e.debit ? "#3b82f6" : "#f59e0b" }}>
                    {e.debit ? "Dr" : "Cr"}
                  </Text>
                </View>
                <Text style={{ width: 96, textAlign: "right", color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium }}>
                  {formatINR(e.debit || e.credit || 0, { decimals: 2 })}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {note && (
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 10 }}>{note}</Text>
      )}
    </View>
  );
}

const hCell = { color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.bold, letterSpacing: 0.5, textTransform: "uppercase" as const };
