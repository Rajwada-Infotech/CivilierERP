// GRN receipt-progress detail — no dedicated single-order endpoint exists
// (see supplierPortalApi.ts's getSupplierGrnSummary: it already returns
// every order's items[] in one call), so this refetches the same summary
// list Dashboard uses and finds the one order by purchaseOrderId, rather
// than adding a redundant backend route.
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Building2, CheckCircle2, Clock } from "lucide-react-native";
import * as spApi from "@/api/supplierPortalApi";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { OrderChat } from "@/components/OrderChat";
import type { MainStackParamList } from "@/navigation/MainStack";

type Props = NativeStackScreenProps<MainStackParamList, "ReceiptDetail">;

export default function ReceiptDetailScreen({ route }: Props) {
  const { purchaseOrderId } = route.params;
  const { currentUser } = useAuth();

  const grnQ = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
  });
  const order = grnQ.data?.find((o) => o.purchaseOrderId === purchaseOrderId);

  if (grnQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: "#0c0c12" }}>
        <ActivityIndicator color="#818898" />
      </View>
    );
  }
  if (!order) {
    return (
      <View className="flex-1 items-center justify-center gap-2" style={{ backgroundColor: "#0c0c12" }}>
        <AlertCircle size={22} color="#818898" />
        <Text style={{ color: "#818898", fontFamily: fonts.body.regular, fontSize: 13 }}>Couldn't load this receipt.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: "#0c0c12" }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", padding: 16, marginBottom: 16 }}>
        <View className="flex-row items-center flex-wrap gap-2 mb-1.5">
          <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: "#6ee7b7" }}>
            {order.docNo ?? order.purchaseOrderNo}
          </Text>
          {order.isFullyReceived ? (
            <Pill icon={CheckCircle2} label="Fully Received" color="#6ee7b7" bg="rgba(16,185,129,0.10)" />
          ) : (
            <Pill icon={Clock} label={`${order.totalRemaining} remaining`} color="#f59e0b" bg="rgba(245,158,11,0.10)" />
          )}
        </View>
        {order.companyName && (
          <View className="flex-row items-center gap-1 mt-1">
            <Building2 size={11} color="#818898" />
            <Text style={{ fontSize: 12, color: "#818898", fontFamily: fonts.body.regular }}>{order.companyName}</Text>
          </View>
        )}
      </View>

      <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#818898", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 }}>
        Items ({order.items.length})
      </Text>

      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: "#272735", overflow: "hidden" }}>
        <View className="flex-row" style={{ backgroundColor: "#181822", paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ flex: 2, fontSize: 10, fontFamily: fonts.heading.semibold, color: "#818898", textTransform: "uppercase" }}>Item</Text>
          <Text style={{ flex: 1, fontSize: 10, fontFamily: fonts.heading.semibold, color: "#818898", textTransform: "uppercase", textAlign: "right" }}>Ordered</Text>
          <Text style={{ flex: 1, fontSize: 10, fontFamily: fonts.heading.semibold, color: "#818898", textTransform: "uppercase", textAlign: "right" }}>Received</Text>
        </View>
        {order.items.map((it, i) => {
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
              <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.body.regular, color: "#c7cbd4", textAlign: "right" }}>
                {it.orderedQty} {it.uom ?? ""}
              </Text>
              <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.heading.semibold, color: done ? "#6ee7b7" : "#e7e9ef", textAlign: "right" }}>
                {it.receivedQty} {it.uom ?? ""}
              </Text>
            </View>
          );
        })}
      </View>

      <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: "#818898", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 16, marginBottom: 10 }}>
        Discuss this order
      </Text>
      {currentUser && <OrderChat poId={purchaseOrderId} currentUserId={Number(currentUser.id)} />}
    </ScrollView>
  );
}

function Pill({ icon: Icon, label, color, bg }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; color: string; bg: string }) {
  return (
    <View className="flex-row items-center gap-1" style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 }}>
      <Icon size={10} color={color} />
      <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color }}>{label}</Text>
    </View>
  );
}
