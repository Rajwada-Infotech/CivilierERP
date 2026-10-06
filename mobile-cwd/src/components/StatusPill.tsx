// Shared status badge + colour map for every Civil Work DPR activity state — the same colours as the
// web app's ASSIGNMENT_STATUS_META, so a status looks the same on both.
import { View, Text } from "react-native";
import { fonts } from "@/theme/fonts";
import type { AssignmentStatus } from "@/api/cwdApi";

export const STATUS_COLOR: Record<string, string> = {
  PENDING: "#64748b",
  ALLOCATED: "#6366f1",
  IN_PROGRESS: "#3b82f6",
  RESUMED: "#14b8a6",
  HOLD: "#f59e0b",
  CANCELLED: "#ef4444",
  APPROVED: "#14b8a6",
  REWORK: "#d946ef",
  COMPLETED: "#10b981",
};

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  ALLOCATED: "Allocated",
  IN_PROGRESS: "In Progress",
  RESUMED: "Resumed",
  HOLD: "Hold",
  CANCELLED: "Cancelled",
  APPROVED: "Approved",
  REWORK: "Rework",
  COMPLETED: "Completed",
};

/** The status to show: an In Progress activity that was put back after a hold reads "Resumed". */
export function displayStatus(status: AssignmentStatus, resumedAt?: string | null): string {
  return status === "IN_PROGRESS" && resumedAt ? "RESUMED" : status;
}

// `status` is an activity status key; `label` + `tone` are for the shared detail/list components, which
// pass a ready-made label and colour instead.
export function StatusPill({
  status,
  label: labelProp,
  tone,
  size = "sm",
}: {
  status?: string;
  label?: string;
  tone?: string;
  size?: "sm" | "md";
}) {
  const c = tone || STATUS_COLOR[status ?? ""] || "#818898";
  const label = labelProp ?? STATUS_LABEL[status ?? ""] ?? status ?? "";
  const pad = size === "md" ? { paddingHorizontal: 9, paddingVertical: 3 } : { paddingHorizontal: 6, paddingVertical: 1.5 };
  return (
    <View style={{ backgroundColor: `${c}1f`, borderRadius: 999, ...pad }}>
      <Text style={{ fontSize: size === "md" ? 10.5 : 9, fontFamily: fonts.heading.bold, color: c, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </Text>
    </View>
  );
}
