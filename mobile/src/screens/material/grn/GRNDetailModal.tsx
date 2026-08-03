// RN port of GRN.tsx's view modal — Details tab only (no equivalent to
// PO/VIO mobile ports for the extra tabs either, so consistent scoping).
// Deferred vs. web: the Posting tab (GL journal preview + auto-post —
// kept web-only, same call as outbound Payment never auto-posting from
// mobile), the per-line quality debit-note button, DocumentChainPanel,
// LinkedExpenseBookings, and the RemainingItemsPanel's "New GRN for
// Remaining" quick action (use the main list's "+ New" + PO picker's own
// "Create GRN for Remaining Items" button instead).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, PackageCheck } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { getGRNById, type GRNRecord } from "@/api/grnApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: mono ? colors.primary : colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function GRNDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const { data: grn, isLoading } = useQuery<GRNRecord>({
    queryKey: ["grn-detail", recordId],
    queryFn: () => getGRNById(recordId!),
    enabled: recordId != null,
  });

  const items = grn?.GRNItems ?? [];
  const subtotal = useMemo(() => items.reduce((s, i) => s + (i.totalAmount || 0), 0), [items]);
  const gstTotal = useMemo(() => items.reduce((s, i) => s + (i.gstAmount || 0), 0), [items]);
  const grandTotal = subtotal + gstTotal;
  const poTotal = Number(grn?.POTotalAmount ?? 0);
  const balance = poTotal - grandTotal;

  const gstByRate = useMemo(() => {
    const map = new Map<number, number>();
    for (const i of items) {
      const pct = Number(i.gstPct || 0);
      const amt = Number(i.gstAmount || 0);
      if (pct > 0 && amt > 0) map.set(pct, (map.get(pct) ?? 0) + amt);
    }
    return Array.from(map.entries());
  }, [items]);

  if (recordId == null) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
              <PackageCheck size={14} color="#10b981" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>GRN</Text>
              {!!(grn?.DocNo || grn?.GRNNo) && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{grn.DocNo || grn.GRNNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !grn ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <View className="flex-row items-center gap-2 mb-4">
              <ApprovalStatusChain table="GoodsReceiptNotes" recordId={grn.GRNID} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <Field label="Doc No" value={grn.DocNo || grn.GRNNo || "—"} mono />
              <Field label="GRN Date" value={fmtDate(grn.GRNDate)} />
              <Field label="Company" value={grn.CompanyName || "—"} />
              <Field label="Project" value={grn.ProjectName || "—"} />
              <Field label="PO No" value={grn.PONumber || "—"} />
              <Field label="Supplier" value={grn.SupplierName || "—"} />
              {!!grn.SourceTransferDocNo && <Field label="Source Transfer" value={grn.SourceTransferDocNo} />}
              {!!grn.SourceMRDocNo && <Field label="Source MR" value={grn.SourceMRDocNo} />}
            </View>

            {items.length > 0 && (
              <View className="mb-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>
                  Received Items ({items.length})
                </Text>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  {items.map((it, i) => (
                    <View key={i} className="px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                      <View className="flex-row items-center justify-between mb-1">
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.semibold, flex: 1, marginRight: 8 }}>{it.itemName || "—"}</Text>
                        <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{formatINR(it.totalAmount)}</Text>
                      </View>
                      <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>
                        Ordered {it.orderedQty} · Received {it.receivedQty} · Pending {it.remainingQty} {it.uom || ""}
                      </Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 1 }}>
                        {it.quantity} {it.uom} × {formatINR(it.rate)}{it.gstPct ? ` · ${it.gstPct}% GST` : ""}
                      </Text>
                    </View>
                  ))}
                  <View className="px-3 py-2.5" style={{ borderTopWidth: 2, borderTopColor: `${colors.primary}40`, backgroundColor: `${colors.primary}0d` }}>
                    <View className="flex-row items-center justify-between">
                      <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>GRN Total (received)</Text>
                      <Text style={{ color: colors.primary, fontSize: 13, fontFamily: fonts.heading.bold }}>{formatINR(grandTotal)}</Text>
                    </View>
                  </View>
                  {poTotal > 0 && (
                    <>
                      <View className="flex-row items-center justify-between px-3 py-2" style={{ backgroundColor: `${colors.muted}30`, borderTopWidth: 1, borderTopColor: `${colors.border}60` }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>PO Value (incl. GST)</Text>
                        <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.semibold }}>{formatINR(poTotal)}</Text>
                      </View>
                      <View className="flex-row items-center justify-between px-3 py-2" style={{ backgroundColor: balance > 0.005 ? "#d9770615" : "#05966915" }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>Balance on PO</Text>
                        <Text style={{ color: balance > 0.005 ? "#d97706" : "#059669", fontSize: 11.5, fontFamily: fonts.heading.bold }}>
                          {balance > 0.005 ? formatINR(balance) : "Fully received"}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              </View>
            )}

            {gstByRate.length > 0 && (
              <View className="mb-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>GST Breakdown</Text>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  <View className="flex-row items-center justify-between px-3.5 py-2.5" style={{ backgroundColor: `${colors.muted}20` }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Subtotal (before GST)</Text>
                    <Text style={{ color: colors.foreground, fontSize: 12 }}>{formatINR(subtotal)}</Text>
                  </View>
                  {gstByRate.map(([rate, amount]) => (
                    <View key={rate} className="flex-row items-center justify-between px-3.5 py-2.5" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}60` }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>GST {rate}%</Text>
                      <Text style={{ color: "#d97706", fontSize: 12 }}>+{formatINR(amount)}</Text>
                    </View>
                  ))}
                  <View className="flex-row items-center justify-between px-3.5 py-3" style={{ backgroundColor: "#05966915", borderTopWidth: 2, borderTopColor: "#05966940" }}>
                    <Text style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>Grand Total (incl. GST)</Text>
                    <Text style={{ color: "#059669", fontSize: 13, fontFamily: fonts.heading.bold }}>{formatINR(grandTotal)}</Text>
                  </View>
                </View>
              </View>
            )}

            {!!grn.Remarks && (
              <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Remarks</Text>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{grn.Remarks}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
