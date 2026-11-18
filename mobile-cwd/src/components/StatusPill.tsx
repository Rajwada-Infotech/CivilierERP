// Status of a Civil Work DPR activity, drawn as the sheet draws status (web: SheetMark): a small square mark and the word
// in capitals. Settled work is solid blue, work under way half-filled, waiting hatched, stopped red, not started empty.
// STATUS_COLOR gives each status its sheet tone, for the bars and dots that colour by status.
import { View, Text } from "react-native";
import { fonts } from "@/theme/fonts";
import { sheet as S } from "@/theme/colors";
import { MarkSquare, type MarkTone } from "@/components/sheet/Sheet";
import type { AssignmentStatus } from "@/api/cwdApi";

export const STATUS_TONE: Record<string, MarkTone> = {
  PENDING: "draft",
  ALLOCATED: "waiting",
  IN_PROGRESS: "moving",
  RESUMED: "moving",
  HOLD: "waiting",
  CANCELLED: "stopped",
  APPROVED: "done",
  REWORK: "stopped",
  COMPLETED: "done",
};

export const STATUS_COLOR: Record<string, string> = {
  PENDING: S.line40,
  ALLOCATED: S.graphite,
  IN_PROGRESS: S.ink,
  RESUMED: S.ink,
  HOLD: S.graphite,
  CANCELLED: S.red,
  APPROVED: S.blue,
  REWORK: S.red,
  COMPLETED: S.blue,
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

// `status` is an activity status key; `label` + `tone` are for the shared detail/list components, which pass a ready-made
// label and colour instead (drawn as a filled square in that colour).
export function StatusPill({ status, label: labelProp, tone, size = "sm" }: { status?: string; label?: string; tone?: string; size?: "sm" | "md" }) {
  const label = labelProp ?? STATUS_LABEL[status ?? ""] ?? status ?? "";
  const mark = STATUS_TONE[status ?? ""];
  const ink = tone ?? (mark === "stopped" ? S.red : mark === "draft" ? S.graphite : S.ink);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {tone || !mark ? <View style={{ width: 9, height: 9, borderWidth: 1, borderColor: ink, backgroundColor: tone ?? "transparent" }} /> : <MarkSquare tone={mark} />}
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: size === "md" ? 10 : 9, letterSpacing: 1, textTransform: "uppercase", color: ink }}>{label}</Text>
    </View>
  );
}
