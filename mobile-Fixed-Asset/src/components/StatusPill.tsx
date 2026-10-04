// Shared status badge + colour map for every Fixed Asset workflow state.
import { View, Text } from "react-native";
import { fonts } from "@/theme/fonts";

export const STATUS_COLOR: Record<string, string> = {
  // record / generic
  Active: "#10b981",
  Pending: "#f59e0b",
  Sold: "#3b82f6",
  Scrapped: "#ef4444",
  "Under Maintenance": "#8b5cf6",
  Deleted: "#818898",
  // tagging / import
  Tagged: "#10b981",
  Done: "#10b981",
  Reversed: "#ef4444",
  Cancelled: "#818898",
  // maintenance
  Draft: "#f59e0b",
  Posted: "#10b981",
  // assignment
  Current: "#10b981",
  Superseded: "#818898",
  // quality check
  Good: "#10b981",
  Average: "#f59e0b",
  Defective: "#ef4444",
  Repairing: "#8b5cf6",
  Completed: "#10b981",
  Overdue: "#ef4444",
};

export function StatusPill({ label, tone, size = "sm" }: { label: string; tone?: string; size?: "sm" | "md" }) {
  const c = tone || STATUS_COLOR[label] || "#818898";
  const pad = size === "md" ? { paddingHorizontal: 9, paddingVertical: 3 } : { paddingHorizontal: 6, paddingVertical: 1.5 };
  return (
    <View style={{ backgroundColor: `${c}1f`, borderRadius: 999, ...pad }}>
      <Text style={{ fontSize: size === "md" ? 10.5 : 9, fontFamily: fonts.heading.bold, color: c }}>{label}</Text>
    </View>
  );
}
