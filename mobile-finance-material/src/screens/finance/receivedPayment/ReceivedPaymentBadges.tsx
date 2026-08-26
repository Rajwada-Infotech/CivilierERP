// Mode badge for Received Payment's own mode vocabulary (Cash/Check/UPI/
// NEFT/RTGS/Card/EMI) — distinct from outbound Payment's ModeBadge (Cheque/
// Post-Dated Cheque/etc.), so not shared. StatusBadge IS shared from
// payment/PaymentBadges — both pages use the identical Draft/Pending/
// Approved/Rejected vocabulary.
import { View, Text } from "react-native";
import { fonts } from "@/theme/fonts";
import { colors } from "@/theme/colors";
import { MODE_COLOR } from "@/api/receivedPaymentApi";

export function ModeBadge({ mode }: { mode: string | null | undefined }) {
  const color = mode ? MODE_COLOR[mode] ?? colors.mutedForeground : colors.mutedForeground;
  return (
    <View
      className="flex-row items-center gap-1.5 px-2.5 py-0.5 rounded-full"
      style={{ borderWidth: 1, borderColor: `${color}40` }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{mode || "—"}</Text>
    </View>
  );
}
