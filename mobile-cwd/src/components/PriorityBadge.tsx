// Activity Priority (Low / High / Urgent / Very Urgent), in the sheet's capitals: the urgent two in red.
import { Text } from "react-native";
import { fonts } from "@/theme/fonts";
import { sheet as S } from "@/theme/colors";
import type { AssignmentPriority } from "@/api/cwdApi";

export const PRIORITY_COLOR: Record<AssignmentPriority, string> = {
  Low: S.graphite,
  High: S.ink,
  Urgent: S.red,
  "Very Urgent": S.red,
};

export function PriorityBadge({ priority }: { priority?: AssignmentPriority | null }) {
  if (!priority || !PRIORITY_COLOR[priority]) return null;
  const c = PRIORITY_COLOR[priority];
  return <Text style={{ fontSize: 9, fontFamily: fonts.heading.semibold, color: c, textTransform: "uppercase", letterSpacing: 1 }}>{priority}</Text>;
}
