// Resale / buy-back case monitor — stage-by-stage progress checklist.
// Endpoint: GET /api/crm/resales/:id/case
//   → { case, stages[{key,label,ok,state,blockers,detail,checks[]}], seller, documents, currentStage }
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react-native";
import { crmGet, type Row } from "@/api/crmApi";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Kv, Pill, Section, fmtDate, money, words } from "./ui";

type Check = { label: string; ok: boolean; hint?: string | null };
type Stage = { key: string; label: string; ok: boolean; state: "done" | "current" | "waiting" | "stopped"; blockers: string[]; detail: string | null; na?: boolean; checks: Check[] };
type CaseData = {
  case: Row;
  stages: Stage[];
  seller: Row;
  documents: Row[];
  currentStage: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  Draft:     "#94a3b8",
  Pending:   "#f59e0b",
  Approved:  "#3b82f6",
  Rejected:  "#ef4444",
  Cancelled: "#ef4444",
  Completed: "#10b981",
};

function StageRow({ stage }: { stage: Stage }) {
  const b = useBrand();
  const isCurrent = stage.state === "current";
  const isDone = stage.state === "done";
  const isStopped = stage.state === "stopped";

  const iconColor = isDone ? b.success : isCurrent ? b.accent : isStopped ? b.danger : b.textFaint;
  const Icon = isDone ? CheckCircle2 : isCurrent ? Clock : isStopped ? XCircle : Circle;

  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: b.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon size={16} color={iconColor} />
        <Text style={{ flex: 1, fontSize: 13, fontFamily: isCurrent ? fonts.heading.semibold : fonts.body.medium, color: b.textPrimary }}>
          {stage.label}
        </Text>
        {isDone ? (
          <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.success }}>Done</Text>
        ) : isCurrent ? (
          <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.accent }}>Now</Text>
        ) : isStopped ? (
          <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.danger }}>Stopped</Text>
        ) : (
          <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Waiting</Text>
        )}
      </View>

      {stage.detail ? (
        <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary, marginLeft: 26, marginTop: 2 }}>
          {stage.detail}
        </Text>
      ) : null}

      {/* Blockers for the current stage */}
      {isCurrent && stage.blockers.length > 0 ? (
        <View style={{ marginLeft: 26, marginTop: 6, gap: 4 }}>
          {stage.blockers.map((bl, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
              <Text style={{ fontSize: 12, color: b.warning, marginTop: 1 }}>•</Text>
              <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.body.regular, color: b.textPrimary }}>{bl}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Checks for the current stage */}
      {isCurrent && stage.checks.length > 0 ? (
        <View style={{ marginLeft: 26, marginTop: 8, gap: 6 }}>
          {stage.checks.map((ch, i) => (
            <View key={i} style={{ gap: 1 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                {ch.ok ? (
                  <CheckCircle2 size={13} color={b.success} />
                ) : (
                  <Circle size={13} color={b.textFaint} />
                )}
                <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.regular, color: ch.ok ? b.textSecondary : b.textPrimary }}>
                  {ch.label}
                </Text>
              </View>
              {ch.hint && !ch.ok ? (
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint, marginLeft: 21 }}>{ch.hint}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function CrmResaleScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmResale">>();
  const { resaleId } = params;
  const b = useBrand();

  const q = useQuery<CaseData>({
    queryKey: ["crm-resale-case", resaleId],
    queryFn: () => crmGet(`/api/crm/resales/${resaleId}/case`),
  });

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator color={b.accent} />
      </View>
    );
  }
  if (q.error || !q.data) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>
          {q.error ? (q.error as Error).message : "Not found"}
        </Text>
      </View>
    );
  }

  const { case: c, stages, documents } = q.data;
  const statusColor = STATUS_COLOR[c.Status as string] ?? b.textSecondary;
  const isResale = c.Kind !== "BuyBack";
  const resaleGain = Number(c.AgreedValue ?? 0) - Number(c.OriginalValue ?? 0);
  const feeTotal = Number(c.FeeTotal ?? 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

      {/* Overview */}
      <Section title={isResale ? "Resale" : "Buy-back"}>
        <Kv label="Property" value={c.Property as string} />
        {c.BookingNo ? <Kv label="Booking" value={c.BookingNo as string} /> : null}
        <Kv label={isResale ? "Seller" : "Owner"} value={(c.FromName || "—") as string} />
        {isResale && c.ToName ? <Kv label="New buyer" value={c.ToName as string} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
          <Pill label={words(c.Status as string)} tone={statusColor} />
        </View>
        {c.CreatedAt ? <Kv label="Opened" value={fmtDate(c.CreatedAt)} /> : null}
        {c.CompletedAt ? <Kv label="Completed" value={fmtDate(c.CompletedAt)} /> : null}
        {c.RejectionNote ? (
          <View style={{ backgroundColor: b.dangerSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.danger }}>{c.RejectionNote as string}</Text>
          </View>
        ) : null}
      </Section>

      {/* Money */}
      {(Number(c.AgreedValue) > 0 || feeTotal > 0) ? (
        <Section title="Money">
          {Number(c.OriginalValue) > 0 ? <Kv label="Original price" value={money(c.OriginalValue)} /> : null}
          {Number(c.AgreedValue) > 0 ? <Kv label="Agreed transfer value" value={money(c.AgreedValue)} /> : null}
          {resaleGain > 0 ? <Kv label="Seller's gain" value={money(resaleGain)} /> : null}
          {feeTotal > 0 ? <Kv label="Developer transfer fee" value={money(feeTotal)} /> : null}
        </Section>
      ) : null}

      {/* Stages */}
      <Section title="Progress">
        <View>
          {stages.filter((s) => !s.na).map((stage) => (
            <StageRow key={stage.key} stage={stage} />
          ))}
        </View>
      </Section>

      {/* Documents */}
      {documents.length > 0 ? (
        <Section title="Documents">
          <View style={{ gap: 6 }}>
            {documents.map((doc) => (
              <View key={doc.Id as number} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
                {doc.Status === "Verified" ? (
                  <CheckCircle2 size={14} color={b.success} />
                ) : (
                  <Clock size={14} color={b.warning} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>
                    {doc.DocumentTypeLabel as string || words(doc.DocumentType as string)}
                  </Text>
                  {doc.Remarks ? (
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{doc.Remarks as string}</Text>
                  ) : null}
                </View>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: doc.Status === "Verified" ? b.success : b.warning }}>
                  {doc.Status as string}
                </Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

    </ScrollView>
  );
}
