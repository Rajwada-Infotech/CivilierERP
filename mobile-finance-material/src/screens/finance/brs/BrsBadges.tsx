// RN port of Brs.tsx's TypePill / ClearBadge / PayStatusBadge — bespoke to
// this page on web too (not shared with Payment/ReceivedPayment badges),
// so kept local here rather than folded into payment/PaymentBadges.tsx.
import { View, Text } from "react-native";
import { ArrowDownLeft, ArrowUpRight, Ban, ShieldCheck } from "lucide-react-native";
import { fonts } from "@/theme/fonts";
import { colors } from "@/theme/colors";

export function TypePill({ type }: { type: "PAYMENT" | "RECEIVED" }) {
  const isReceived = type === "RECEIVED";
  const color = isReceived ? "#10b981" : "#f43f5e";
  const Icon = isReceived ? ArrowDownLeft : ArrowUpRight;
  return (
    <View className="flex-row items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}>
      <Icon size={9} color={color} strokeWidth={2.5} />
      <Text style={{ color, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{isReceived ? "Received" : "Payment"}</Text>
    </View>
  );
}

export function ClearBadge({ cleared, bounced }: { cleared: boolean; bounced: boolean }) {
  const color = bounced ? "#dc2626" : cleared ? "#059669" : "#d97706";
  const label = bounced ? "Bounced" : cleared ? "Clear" : "Unclear";
  return (
    <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ backgroundColor: `${color}1f`, borderWidth: 1, borderColor: `${color}40` }}>
      {bounced ? <Ban size={10} color={color} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}
      <Text style={{ color, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{label}</Text>
    </View>
  );
}

const PAY_STATUS_COLOR: Record<string, string> = {
  Draft: "#64748b",
  Pending: "#d97706",
  Approved: "#059669",
  Rejected: "#dc2626",
};

export function PayStatusBadge({ status }: { status: string | null }) {
  const s = status || "Draft";
  const color = PAY_STATUS_COLOR[s] ?? colors.mutedForeground;
  return (
    <View className="flex-row items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}>
      {s === "Approved" && <ShieldCheck size={9} color={color} />}
      <Text style={{ color, fontSize: 9.5, fontFamily: fonts.body.medium }}>{s}</Text>
    </View>
  );
}
