// RN port of StatusBadge.tsx + ModeBadge (FormFields.tsx) scoped to the
// Draft/Pending/Approved/Rejected + payment-mode + DisplayStatus vocab this
// screen actually needs — small pill components shared by the list cards
// and the detail modal.
import { View, Text } from "react-native";
import { FileEdit, Clock, CheckCircle2, XCircle } from "lucide-react-native";
import { fonts } from "@/theme/fonts";
import { colors } from "@/theme/colors";
import { MODE_COLOR, STATUS_COLOR, DISPLAY_STATUS_COLOR } from "@/api/newPaymentApi";

const STATUS_ICON: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  Draft: FileEdit,
  Pending: Clock,
  Approved: CheckCircle2,
  Rejected: XCircle,
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status || "Draft";
  const color = STATUS_COLOR[s] ?? "#64748b";
  const Icon = STATUS_ICON[s] ?? FileEdit;
  return (
    <View
      className="flex-row items-center gap-1 px-2 py-0.5 rounded-md"
      style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}
    >
      <Icon size={10} color={color} />
      <Text style={{ color, fontSize: 10.5, fontFamily: fonts.body.medium }}>{s}</Text>
    </View>
  );
}

export function DisplayStatusBadge({ status }: { status: string | null | undefined }) {
  const s = status || "—";
  const color = DISPLAY_STATUS_COLOR[s] ?? colors.mutedForeground;
  return (
    <View
      className="items-center justify-center px-2 py-0.5 rounded"
      style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}
    >
      <Text style={{ color, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{s}</Text>
    </View>
  );
}

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
