// RN port of src/pages/supplier/SupplierCreditNotes.tsx (web) — rose/red
// accent (matches web's own choice for this section, distinct from the
// rest of the app's emerald), since a credit note represents a deduction
// (rejected/short-received goods), not something to celebrate green.
import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ReceiptText, AlertTriangle } from "lucide-react-native";
import * as spApi from "@/api/supplierPortalApi";
import { fonts } from "@/theme/fonts";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n))}`;
const fmtPercent1 = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function CreditNotesScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const notesQ = useQuery({
    queryKey: ["supplier-credit-notes"],
    queryFn: spApi.getSupplierCreditNotes,
    staleTime: 5 * 60_000,
  });
  const notes = notesQ.data ?? [];

  const totalAmount = useMemo(
    () => notes.filter((n) => n.Status !== "Cancelled").reduce((s, n) => s + Number(n.Amount || 0), 0),
    [notes],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await notesQ.refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: "#0c0c12" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fca5a5" />}
    >
      {/* Hero */}
      <View style={{ borderRadius: 16, borderWidth: 1, borderColor: "rgba(159,18,57,0.4)", backgroundColor: "rgba(76,5,25,0.25)", padding: 16, marginBottom: 16 }}>
        <View className="flex-row items-center gap-2 mb-1">
          <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: "rgba(244,63,94,0.12)", alignItems: "center", justifyContent: "center" }}>
            <ReceiptText size={15} color="#fda4af" />
          </View>
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: "#e7e9ef" }}>Credit Notes</Text>
        </View>
        <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: "#818898" }}>
          Deductions for short-received or rejected quantities
        </Text>
        <View className="flex-row items-end justify-between" style={{ marginTop: 12 }}>
          <View>
            <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: "#818898", textTransform: "uppercase", letterSpacing: 1 }}>
              Total deducted
            </Text>
            <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: "#fda4af", marginTop: 2 }}>{fmt(totalAmount)}</Text>
          </View>
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898" }}>
            {notes.length} note{notes.length !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>

      {notesQ.isLoading && (
        <View className="flex-row items-center justify-center gap-2" style={{ height: 96 }}>
          <ActivityIndicator color="#818898" />
          <Text style={{ color: "#818898", fontSize: 13, fontFamily: fonts.body.regular }}>Loading credit notes…</Text>
        </View>
      )}

      {!notesQ.isLoading && notes.length === 0 && (
        <View
          className="items-center justify-center gap-3"
          style={{ paddingVertical: 48, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "#272735" }}
        >
          <ReceiptText size={26} color="rgba(129,136,152,0.4)" />
          <View className="items-center">
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>No credit notes</Text>
            <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginTop: 2 }}>
              Nothing deducted for short-receipt or rejection yet.
            </Text>
          </View>
        </View>
      )}

      <View style={{ gap: 10 }}>
        {notes.map((n) => {
          const cancelled = n.Status === "Cancelled";
          return (
            <View
              key={n.DebitNoteId}
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: cancelled ? "#272735" : "rgba(244,63,94,0.25)",
                backgroundColor: "#15151e",
                padding: 14,
                opacity: cancelled ? 0.55 : 1,
              }}
            >
              <View className="flex-row items-start justify-between gap-3 mb-1.5">
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: "#fda4af" }}>{n.DocNo}</Text>
                <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: cancelled ? "#818898" : "#fda4af" }}>
                  −{fmt(n.Amount)}
                </Text>
              </View>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: "#e7e9ef" }}>{n.ItemName ?? "—"}</Text>
              <View className="flex-row flex-wrap gap-x-4 mt-2" style={{ borderTopWidth: 1, borderTopColor: "#272735", paddingTop: 8 }}>
                <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898" }}>{fmtDate(n.DebitDate)}</Text>
                {n.RejectedQty != null && (
                  <View className="flex-row items-center gap-1">
                    <AlertTriangle size={10} color="#818898" />
                    <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898" }}>
                      {n.RejectedQty} {n.UomName ?? ""} rejected ({fmtPercent1(n.PercentBad)})
                    </Text>
                  </View>
                )}
                {n.PONumber && (
                  <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898" }}>PO {n.PONumber}</Text>
                )}
              </View>
              {n.Reason && (
                <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", marginTop: 6, fontStyle: "italic" }}>
                  {n.Reason}
                </Text>
              )}
              {cancelled && (
                <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: "#818898", marginTop: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                  Cancelled
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
