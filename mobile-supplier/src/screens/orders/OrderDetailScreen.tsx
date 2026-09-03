// RN port of the order-detail popup + "mark as supplied" + chat flow from
// src/pages/supplier/SupplierLanding.tsx (web) — view a PO's items and
// totals, mark it supplied with an optional challan number (toggleable
// back off, same as the web checkbox), see how the delivery date compared
// to what was expected, and chat with procurement about the order.
// POItems is a raw JSON array on the backend (see supplierPortalApi.ts's
// SupplierOrderDetail type), rendered generically rather than assuming a
// fixed shape.
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Building2,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Clock,
  CreditCard,
  FolderKanban,
  Percent,
  Tag,
  Truck,
} from "lucide-react-native";
import * as spApi from "@/api/supplierPortalApi";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { OrderChat } from "@/components/OrderChat";
import type { MainStackParamList } from "@/navigation/MainStack";

type Props = NativeStackScreenProps<MainStackParamList, "OrderDetail">;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtMoney = (n?: number | null) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");

// Expected - Supplied, in whole days. Positive = delivered before the
// expected date, negative = delivered after it. Same math as web's
// deliveryDeltaDays in SupplierLanding.tsx.
function deliveryDeltaDays(expected?: string | null, supplied?: string | null): number | null {
  if (!expected || !supplied) return null;
  const e = new Date(expected); e.setHours(0, 0, 0, 0);
  const s = new Date(supplied); s.setHours(0, 0, 0, 0);
  return Math.round((e.getTime() - s.getTime()) / 86_400_000);
}

function DeliveryBadge({ expected, supplied }: { expected?: string | null; supplied?: string | null }) {
  const delta = deliveryDeltaDays(expected, supplied);
  if (delta == null) return null;
  const label = delta === 0 ? "Delivered on time" : delta > 0 ? `Delivered ${delta}d early` : `Delivered ${Math.abs(delta)}d late`;
  const color = delta >= 0 ? "#6ee7b7" : "#fbbf24";
  return <Text style={{ fontSize: 10, fontFamily: fonts.body.medium, color }}>{label}</Text>;
}

const SOURCE_COLORS: Record<string, string> = {
  Direct: "#818898",
  "Material Request": "#60a5fa",
  Quotation: "#c084fc",
  "Work Done": "#6ee7b7",
  "Work Order": "#f59e0b",
};

export default function OrderDetailScreen({ route }: Props) {
  const { id } = route.params;
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [challanNumber, setChallanNumber] = useState("");
  const [acking, setAcking] = useState(false);

  const detailQ = useQuery({
    queryKey: ["supplier-order-detail", id],
    queryFn: () => spApi.getSupplierOrderDetail(id),
  });
  const detail = detailQ.data;

  const grnQ = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
  });
  const receivedOrder = grnQ.data?.find((o) => o.purchaseOrderId === id);

  const setAcknowledged = async (acknowledged: boolean, challan?: string) => {
    setAcking(true);
    try {
      await spApi.acknowledgeSupplierOrder(id, acknowledged, challan);
      if (acknowledged) setChallanNumber("");
      queryClient.invalidateQueries({ queryKey: ["supplier-order-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["supplier-orders"] });
    } catch (err: any) {
      Alert.alert("Failed", err?.message ?? "Something went wrong.");
    } finally {
      setAcking(false);
    }
  };

  if (detailQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: "#0c0c12" }}>
        <ActivityIndicator color="#818898" />
      </View>
    );
  }
  if (!detail) {
    return (
      <View className="flex-1 items-center justify-center gap-2" style={{ backgroundColor: "#0c0c12" }}>
        <AlertCircle size={22} color="#818898" />
        <Text style={{ color: "#818898", fontFamily: fonts.body.regular, fontSize: 13 }}>Couldn't load this order.</Text>
      </View>
    );
  }

  const items: any[] = Array.isArray(detail.POItems) ? detail.POItems : [];

  // Same math as web's OrderDetailDialog: split into CGST+SGST unless the
  // GST type is explicitly inter-state (IGST), in which case it's one line.
  const subtotal = detail.SubtotalAmount ?? 0;
  const gstRate = detail.GstRate ?? 0;
  const gstAmt = subtotal * (gstRate / 100);
  const isIGST = (detail.GstType ?? "").toUpperCase().includes("IGST");
  const total = detail.TotalAmount ?? subtotal + gstAmt;
  const sourceColor = SOURCE_COLORS[detail.SourceLabel] ?? "#818898";

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: "#0c0c12" }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", padding: 16, marginBottom: 16 }}>
        <View className="flex-row items-center flex-wrap gap-2 mb-1.5">
          <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: "#6ee7b7" }}>
            {detail.DocNo ?? detail.PurchaseOrderNo}
          </Text>
          <View style={{ backgroundColor: "rgba(16,185,129,0.10)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 }}>
            <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: "#6ee7b7" }}>{detail.Status}</Text>
          </View>
          {detail.SourceLabel && (
            <View style={{ backgroundColor: `${sourceColor}1a`, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 }}>
              <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: sourceColor, textTransform: "uppercase", letterSpacing: 0.4 }}>
                {detail.SourceLabel}
              </Text>
            </View>
          )}
        </View>

        {/* ── Metadata rows ──────────────────────────────────────────── */}
        <View style={{ gap: 6, marginTop: 8 }}>
          <DetailRow icon={Building2} label="Company" value={detail.CompanyName} />
          <DetailRow icon={FolderKanban} label="Project" value={detail.ProjectName} />
          <DetailRow icon={CalendarDays} label="PO Date" value={detail.PODate ? fmtDate(detail.PODate) : null} />
          <DetailRow icon={CalendarDays} label="Expected By" value={detail.ExpectedDeliveryDate ? fmtDate(detail.ExpectedDeliveryDate) : null} />
          <DetailRow icon={CreditCard} label="Payment Terms" value={detail.PaymentTerms} />
          <DetailRow icon={Percent} label="GST" value={detail.GstType ? `${detail.GstType}${gstRate ? ` · ${gstRate}%` : ""}` : null} />
        </View>

        {detail.Remarks ? (
          <View style={{ borderRadius: 10, backgroundColor: "#0c0c12", borderWidth: 1, borderColor: "#272735", padding: 10, marginTop: 10 }}>
            <View className="flex-row items-center gap-1.5 mb-1">
              <Tag size={10} color="#818898" />
              <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: "#818898", textTransform: "uppercase", letterSpacing: 0.6 }}>Remarks</Text>
            </View>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: "#c7cbd4" }}>{detail.Remarks}</Text>
          </View>
        ) : null}

        <View style={{ borderTopWidth: 1, borderTopColor: "#272735", marginTop: 12, paddingTop: 12, gap: 4 }}>
          <TotalRow label="Subtotal" value={fmtMoney(subtotal)} />
          {isIGST ? (
            <TotalRow label={`IGST (${gstRate}%)`} value={fmtMoney(gstAmt)} />
          ) : (
            <>
              <TotalRow label={`CGST (${gstRate / 2}%)`} value={fmtMoney(gstAmt / 2)} />
              <TotalRow label={`SGST (${gstRate / 2}%)`} value={fmtMoney(gstAmt / 2)} />
            </>
          )}
          <TotalRow label="Total" value={fmtMoney(total)} bold />
        </View>
      </View>

      {/* ── Mark as supplied ────────────────────────────────────────── */}
      {!detail.SupplierAcknowledged ? (
        <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)", backgroundColor: "rgba(245,158,11,0.06)", padding: 16, marginBottom: 16 }}>
          <View className="flex-row items-center gap-2 mb-2">
            <Truck size={14} color="#f59e0b" />
            <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#fbbf24" }}>Mark as supplied</Text>
          </View>
          <TextInput
            value={challanNumber}
            onChangeText={setChallanNumber}
            placeholder="Challan / DC number (optional)"
            placeholderTextColor="rgba(148,163,184,0.4)"
            style={{
              borderRadius: 8, borderWidth: 1, borderColor: "#272735", backgroundColor: "#0c0c12",
              color: "#e7e9ef", paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, marginBottom: 6,
            }}
          />
          <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: "#818898", marginBottom: 10 }}>
            Today's date will be recorded as the supplied date.
          </Text>
          <Pressable
            disabled={acking}
            onPress={() => setAcknowledged(true, challanNumber.trim() || undefined)}
            style={{ borderRadius: 10, paddingVertical: 12, alignItems: "center", backgroundColor: "#f59e0b", opacity: acking ? 0.5 : 1 }}
          >
            <Text style={{ color: "#1c1400", fontSize: 13, fontFamily: fonts.body.semibold }}>
              {acking ? "Saving…" : "Confirm supplied"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          disabled={acking}
          onPress={() =>
            Alert.alert("Unmark supplied?", "This will clear the supplied date and challan number.", [
              { text: "Cancel", style: "cancel" },
              { text: "Unmark", style: "destructive", onPress: () => setAcknowledged(false) },
            ])
          }
          style={{ borderRadius: 12, borderWidth: 1, borderColor: "rgba(16,185,129,0.22)", backgroundColor: "rgba(16,185,129,0.06)", padding: 14, marginBottom: 16, opacity: acking ? 0.5 : 1 }}
        >
          <View className="flex-row items-center gap-2">
            <CheckSquare size={16} color="#6ee7b7" />
            <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#6ee7b7" }}>Supplied</Text>
          </View>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: "#e7e9ef", marginTop: 4 }}>
            {fmtDate(detail.SuppliedDate)}
            {detail.ChallanNumber ? ` · Challan ${detail.ChallanNumber}` : ""}
          </Text>
          <View style={{ marginTop: 2 }}>
            <DeliveryBadge expected={detail.ExpectedDeliveryDate} supplied={detail.SuppliedDate} />
          </View>
          <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: "#818898", marginTop: 6 }}>
            Tap to unmark
          </Text>
        </Pressable>
      )}

      <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#818898", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
        Items ({items.length})
      </Text>
      <View style={{ gap: 10, marginBottom: 16 }}>
        {items.map((it, i) => (
          <View key={it.itemId ?? i} style={{ borderRadius: 12, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", padding: 14 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>
              {it.itemDescription ?? it.description ?? "Item"}
            </Text>
            <View className="flex-row items-center justify-between" style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 11, color: "#818898", fontFamily: fonts.body.regular }}>
                {it.quantity} {it.unit ?? ""} × ₹{Number(it.rate ?? 0).toLocaleString("en-IN")}
              </Text>
              <Text style={{ fontSize: 12, color: "#e7e9ef", fontFamily: fonts.heading.semibold }}>
                ₹{Number(it.amount ?? 0).toLocaleString("en-IN")}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* ── Received by customer ────────────────────────────────────── */}
      {receivedOrder && (
        <>
          <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#818898", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
            Received by customer
          </Text>
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: "#272735", overflow: "hidden", marginBottom: 16 }}>
            <View
              className="flex-row items-center gap-2"
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: receivedOrder.isFullyReceived ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
              }}
            >
              {receivedOrder.isFullyReceived ? <CheckCircle2 size={12} color="#6ee7b7" /> : <Clock size={12} color="#f59e0b" />}
              <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: receivedOrder.isFullyReceived ? "#6ee7b7" : "#fbbf24" }}>
                {receivedOrder.isFullyReceived ? "Fully received" : `${receivedOrder.totalRemaining} unit(s) remaining`}
              </Text>
            </View>
            {receivedOrder.items.map((it, i) => {
              const done = it.remainingQty <= 0;
              return (
                <View
                  key={it.itemId ?? i}
                  className="flex-row items-center"
                  style={{ paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#272735", backgroundColor: "#15151e" }}
                >
                  <View style={{ flex: 2 }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: "#e7e9ef" }} numberOfLines={2}>
                      {it.itemName}
                    </Text>
                    {!done && (
                      <Text style={{ fontSize: 10, fontFamily: fonts.body.regular, color: "#f59e0b", marginTop: 2 }}>
                        {it.remainingQty} {it.uom ?? ""} pending
                      </Text>
                    )}
                  </View>
                  <Text style={{ flex: 1, fontSize: 11, fontFamily: fonts.body.regular, color: "#818898", textAlign: "right" }}>
                    {it.orderedQty} {it.uom ?? ""} ordered
                  </Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.heading.semibold, color: done ? "#6ee7b7" : "#e7e9ef", textAlign: "right" }}>
                    {it.receivedQty} {it.uom ?? ""}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* ── Chat ─────────────────────────────────────────────────────── */}
      <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#818898", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
        Discuss this order
      </Text>
      {currentUser && <OrderChat poId={id} currentUserId={Number(currentUser.id)} />}
    </ScrollView>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  value?: string | null;
}) {
  if (!value) return null;
  // Short values (dates, a company name) read fine inline; some fields
  // (Payment Terms especially) can hold a full paragraph of contract text,
  // which needs its own line to wrap instead of fighting the label for
  // space in a two-column row.
  const long = value.length > 28;
  if (long) {
    return (
      <View style={{ gap: 3 }}>
        <View className="flex-row items-center gap-1.5">
          <Icon size={11} color="#818898" />
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898" }}>{label}</Text>
        </View>
        <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: "#c7cbd4", lineHeight: 17 }}>{value}</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-1.5">
        <Icon size={11} color="#818898" />
        <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: "#818898" }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: "#c7cbd4", flexShrink: 1, textAlign: "right", marginLeft: 8 }}>
        {value}
      </Text>
    </View>
  );
}

function TotalRow({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: "#818898" }}>{label}</Text>
      <Text style={{ fontSize: bold ? 14 : 12, fontFamily: bold ? fonts.heading.bold : fonts.body.medium, color: bold ? "#e7e9ef" : "#c7cbd4" }}>
        {value}
      </Text>
    </View>
  );
}
