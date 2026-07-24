// RN port of VehicleInOut.tsx's viewingRec modal — Details tab only for
// v1. Deferred vs. web: the "Supplier" chat tab (OrderChat — PO-scoped
// messaging, out of scope), the stacked PO-preview sub-modal (shown here as
// a plain PO-number field instead), the per-line quality debit-note flow,
// and Print.
import { useQuery } from "@tanstack/react-query";
import { View, Text, Modal, Pressable, ScrollView, Image, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Truck, Paperclip, FileText } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getVehicleInOut, type VehicleInOutRecord } from "@/api/vehicleInOutApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function VehicleInOutDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const { data: rec, isLoading } = useQuery<VehicleInOutRecord>({
    queryKey: ["vehicle-in-out-detail", recordId],
    queryFn: () => getVehicleInOut(recordId!),
    enabled: recordId != null,
  });

  if (recordId == null) return null;

  return (
    <Modal visible={recordId != null} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#3b82f626" }}>
              <Truck size={14} color="#3b82f6" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Vehicle In/Out</Text>
              {!!rec?.DocNo && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{rec.DocNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !rec ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <View className="flex-row items-center gap-2 mb-4">
              <ApprovalStatusChain table="VehicleInOut" recordId={rec.VehicleInOutID} />
            </View>

            <View className="rounded-2xl flex-row items-center gap-2.5 px-4 py-3 mb-4" style={{ borderWidth: 1, borderColor: `${colors.primary}33`, backgroundColor: `${colors.primary}0d` }}>
              <Truck size={14} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: 14, fontFamily: fonts.heading.bold }}>{rec.VehicleNo || "—"}</Text>
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <Field label="Doc Date" value={fmtDate(rec.DocDate)} />
              <Field label="Financial Year" value={rec.FinYear || "—"} />
              <Field label="Company" value={rec.CompanyName || "—"} />
              <Field label="Project" value={rec.ProjectName || "—"} />
              <Field label="Supplier" value={rec.SupplierName || "—"} />
              <Field label="PO No" value={rec.PONumber || "—"} />
              <Field label="Entry Time" value={fmtDateTime(rec.EntryTime)} />
              <Field label="Exit Time" value={rec.ExitTime ? fmtDateTime(rec.ExitTime) : "Not yet exited"} />
              <Field label="Challan No" value={rec.ChallanNo || "—"} />
            </View>

            {!!rec.Items?.length && (
              <View className="mt-2 mb-2">
                <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Received Items (This Lot)
                </Text>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  {rec.Items.map((it, i) => (
                    <View key={it.VehicleInOutItemID} className="flex-row items-center justify-between px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flex: 1, marginRight: 8 }}>{it.ItemName || "—"}</Text>
                      <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.semibold }}>{it.ReceivedQty} {it.UomName || ""}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {!!rec.Attachments?.length && (
              <View className="mt-2 mb-2">
                <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Attachments
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {rec.Attachments.map((a) => (
                    <View key={a.id} className="rounded-lg overflow-hidden" style={{ width: 72, height: 72, borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}40` }}>
                      {a.mimeType?.startsWith("image/") ? (
                        <Image source={{ uri: a.url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                      ) : (
                        <View className="flex-1 items-center justify-center">
                          <FileText size={20} color={colors.mutedForeground} />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {!!rec.Remarks && (
              <View className="mt-2">
                <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Remarks</Text>
                <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                  <Text style={{ color: colors.foreground, fontSize: 12 }}>{rec.Remarks}</Text>
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
