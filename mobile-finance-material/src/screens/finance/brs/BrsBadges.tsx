// Brs.tsx's TypePill / ClearBadge / PayStatusBadge, drawn as the sheet draws them: a type is an ink-ruled capital label
// with its direction (in / out), clearance and status are the sheet's square marks (solid clear, hatched unclear, red
// bounced). Bespoke to this page on web too, so kept local.
import { View, Text } from "react-native";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react-native";
import { fonts } from "@/theme/fonts";
import { sheet as S } from "@/theme/colors";
import { SheetMark, statusTone } from "@/components/sheet/Sheet";

export function TypePill({ type }: { type: "PAYMENT" | "RECEIVED" }) {
  const isReceived = type === "RECEIVED";
  const Icon = isReceived ? ArrowDownLeft : ArrowUpRight;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: S.line40, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Icon size={10} color={S.ink} strokeWidth={2.5} />
      <Text style={{ color: S.ink, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>{isReceived ? "Received" : "Payment"}</Text>
    </View>
  );
}

export function ClearBadge({ cleared, bounced }: { cleared: boolean; bounced: boolean }) {
  return <SheetMark text={bounced ? "Bounced" : cleared ? "Clear" : "Unclear"} tone={bounced ? "stopped" : cleared ? "done" : "waiting"} />;
}

export function PayStatusBadge({ status }: { status: string | null }) {
  const s = status || "Draft";
  return <SheetMark text={s} tone={/draft/i.test(s) ? "draft" : statusTone(s)} />;
}
