// RN port of DebitNoteMaster.tsx's generic MasterPage view modal — a flat
// field list, no tabs (web has none either).
import { useQuery } from "@tanstack/react-query";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, ClipboardMinus } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getDebitNoteById, type DebitNote } from "@/api/debitNoteApi";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function DebitNoteDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const { data: note, isLoading } = useQuery<DebitNote>({
    queryKey: ["dn-detail", recordId],
    queryFn: () => getDebitNoteById(recordId!),
    enabled: recordId != null,
  });

  if (recordId == null) return null;

  return (
    <Modal visible={recordId != null} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#dc262626" }}>
              <ClipboardMinus size={14} color="#dc2626" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Debit Note</Text>
              {!!note?.DocNo && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{note.DocNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !note ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <View className="flex-row items-center gap-2 mb-4">
              <View
                className="px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: note.is_active ? "#0596691a" : "#dc26261a",
                  borderWidth: 1, borderColor: note.is_active ? "#05966940" : "#dc262640",
                }}
              >
                <Text style={{ color: note.is_active ? "#059669" : "#dc2626", fontSize: 10.5, fontFamily: fonts.heading.semibold }}>
                  {note.is_active ? "Active" : "Inactive"}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <Field label="Company" value={note.company_name || "—"} />
              <Field label="Project" value={note.project_name || "—"} />
              <Field label="Supplier" value={note.supplier_name || "—"} />
              <Field label="Debit Date" value={fmtDate(note.DebitDate)} />
              <Field label="Total Amount" value={note.TotalAmount != null ? note.TotalAmount.toFixed(2) : "0.00"} />
              <Field label="Created By" value={note.created_by_name || "—"} />
            </View>

            {!!note.Reason && (
              <View className="rounded-xl px-3 py-2.5 mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Reason</Text>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{note.Reason}</Text>
              </View>
            )}

            {!!note.items?.length && (
              <View className="mb-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>
                  Line Items ({note.items.length})
                </Text>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  {note.items.map((it, i) => (
                    <View key={i} className="px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                      <View className="flex-row items-center justify-between">
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flex: 1, marginRight: 8 }}>{it.Description}</Text>
                        <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.semibold }}>{(it.Amount ?? 0).toFixed(2)}</Text>
                      </View>
                      {(it.Quantity != null || it.Rate != null) && (
                        <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 2 }}>
                          {it.Quantity ?? "—"} {it.UOMSymbol || ""} × {it.Rate ?? "—"}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
