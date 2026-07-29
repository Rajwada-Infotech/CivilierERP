// Small RN port of src/components/StatusBadge.tsx (web) — trimmed to the
// statuses the Approval Inbox actually surfaces (Pending items by
// definition, but a row can flash Approved/Rejected right before it's
// optimistically removed).
import { View, Text } from "react-native";
import { Clock, CheckCircle2, XCircle, FileEdit, SendHorizonal } from "lucide-react-native";
import { fonts } from "@/theme/fonts";

const STATUS_CONFIG: Record<string, { color: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  Draft: { color: "#94a3b8", icon: FileEdit },
  Issued: { color: "#3b82f6", icon: SendHorizonal },
  Pending: { color: "#f59e0b", icon: Clock },
  Approved: { color: "#10b981", icon: CheckCircle2 },
  Rejected: { color: "#ef4444", icon: XCircle },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const cfg = STATUS_CONFIG[status ?? ""] ?? { color: "#94a3b8", icon: Clock };
  const Icon = cfg.icon;
  return (
    <View className="flex-row items-center gap-1 px-2 py-1 rounded-full" style={{ backgroundColor: `${cfg.color}1f` }}>
      <Icon size={9} color={cfg.color} />
      <Text style={{ color: cfg.color, fontSize: 10, fontFamily: fonts.heading.semibold }}>{status || "Unknown"}</Text>
    </View>
  );
}
