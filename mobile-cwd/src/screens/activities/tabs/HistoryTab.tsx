// Every attempt ever made on this activity — the current one and any sent back for rework, with the reason.
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Check, RotateCcw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { STATUS_LABEL } from "@/components/StatusPill";
import { getAssignmentAttempts } from "@/api/cwdApi";
import { ACCENT, Empty, ErrorText, Loading } from "./ui";

const SOURCE: Record<string, string> = { QC: "Quality Check", APPROVAL: "Approval" };

export function HistoryTab({ rungId }: { rungId: number }) {
  const q = useQuery({ queryKey: ["cwd-attempts", rungId], queryFn: () => getAssignmentAttempts(rungId) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorText error={q.error} />;
  const attempts = q.data ?? [];
  if (!attempts.length) return <Empty text="No history yet." />;
  return (
    <View>
      {attempts.map((a, i) => (
        <View key={a.assignmentId} style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ alignItems: "center" }}>
            <View style={{ width: 22, height: 22, borderWidth: 1.5, alignItems: "center", justifyContent: "center", borderColor: S.ink, backgroundColor: a.isCurrent ? S.ink : "transparent" }}>
              {a.isCurrent && <Check size={12} color={S.paper} strokeWidth={3} />}
            </View>
            {i < attempts.length - 1 && <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: S.rule }} />}
          </View>
          <View style={{ flex: 1, paddingBottom: 18 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: S.ink }}>
              Attempt {a.attemptNo}{a.isCurrent ? "  ·  Current" : ""}
              <Text style={{ fontFamily: fonts.body.regular, color: S.graphite }}>  ·  {STATUS_LABEL[a.status] ?? a.status}</Text>
            </Text>
            <Text style={{ fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular, marginTop: 2 }}>
              {a.engineerNames || "Unassigned"}{a.startDate ? ` · Started ${new Date(a.startDate).toLocaleDateString("en-IN")}` : ""}
            </Text>
            {!!a.reworkReason && (
              <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                <RotateCcw size={11} color={S.red} style={{ marginTop: 2 }} />
                <Text style={{ flex: 1, fontSize: 11.5, color: S.red, fontFamily: fonts.body.regular }}>Sent back for rework via {SOURCE[a.reworkSource || ""] || "unknown"}: {a.reworkReason}</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
