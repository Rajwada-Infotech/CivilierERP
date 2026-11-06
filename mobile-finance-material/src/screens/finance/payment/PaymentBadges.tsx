// The payment's status and mode as the drawing sheet marks them, shared by the list rows and the detail view: a
// status is the sheet's square mark (solid approved, hatched waiting, red rejected, empty draft), a mode is a small
// ink-ruled capital label.
import { View, Text } from "react-native";
import { fonts } from "@/theme/fonts";
import { sheet as S } from "@/theme/colors";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status || "Draft";
  return <SheetMark text={s} tone={/draft/i.test(s) ? "draft" : statusTone(s)} />;
}

/** The payment's own running state (Cleared, Bounced, Pending clearance, …). */
export function DisplayStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <SheetMark text="—" tone="none" />;
  const tone = /bounce|reject|cancel|fail|stop/i.test(status) ? "stopped" : /clear|paid|approved|posted|success/i.test(status) ? "done" : /partial/i.test(status) ? "moving" : "waiting";
  return <SheetMark text={status} tone={tone} />;
}

export function ModeBadge({ mode }: { mode: string | null | undefined }) {
  return (
    <View style={{ borderWidth: 1, borderColor: S.line40, paddingHorizontal: 7, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={{ color: S.ink, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>{mode || "—"}</Text>
    </View>
  );
}
