// Activity Priority pill (Low / High / Urgent / Very Urgent) — same colours as the web's PriorityBadge.
import { Text, View } from "react-native";
import { fonts } from "@/theme/fonts";
import type { AssignmentPriority } from "@/api/cwdApi";

export const PRIORITY_COLOR: Record<AssignmentPriority, string> = {
  Low: "#64748b",
  High: "#f59e0b",
  Urgent: "#f97316",
  "Very Urgent": "#ef4444",
};

export function PriorityBadge({ priority }: { priority?: AssignmentPriority | null }) {
  if (!priority || !PRIORITY_COLOR[priority]) return null;
  const c = PRIORITY_COLOR[priority];
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 999, backgroundColor: `${c}26` }}>
      <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: c, textTransform: "uppercase", letterSpacing: 0.3 }}>{priority}</Text>
    </View>
  );
}
