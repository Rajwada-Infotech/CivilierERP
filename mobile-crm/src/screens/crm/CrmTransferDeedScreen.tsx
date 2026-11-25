// Transfer deed detail — step-by-step workflow monitor for resale deed execution.
// Endpoint: GET /api/crm/transfer-deeds/:id
//   → { deed, parties, documents, payment, registry, history, steps[{key,label,ok,state,checks[]}] }
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react-native";
import { crmGet, type Row } from "@/api/crmApi";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Kv, Pill, Section, fmtDate, money, words } from "./ui";

type Check = { label: string; ok: boolean; hint?: string | null; party?: string; docId?: number; status?: string };
type Step  = { key: string; label: string; ok: boolean; state: "done" | "current" | "waiting" | "stopped"; checks: Check[] };
type DeedData = {
  deed: Row;
  parties: string[];
  documents: Row[];
  payment: Row | null;
  registry: Row | null;
  steps: Step[];
};

const STATUS_COLOR: Record<string, string> = {
  Draft:          "#94a3b8",
  UnderReview:    "#f59e0b",
  LegalApproved:  "#3b82f6",
  PartiesApproved: "#3b82f6",
  DateApproved:   "#3b82f6",
  DutyPaid:       "#8b5cf6",
  Executed:       "#10b981",
  Registered:     "#10b981",
  Cancelled:      "#ef4444",
};

function StepRow({ step }: { step: Step }) {
  const b = useBrand();
  const isDone    = step.state === "done";
  const isCurrent = step.state === "current";
  const isStopped = step.state === "stopped";
  const iconColor = isDone ? b.success : isCurrent ? b.accent : isStopped ? b.danger : b.textFaint;
  const Icon = isDone ? CheckCircle2 : isCurrent ? Clock : isStopped ? XCircle : Circle;

  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: b.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon size={16} color={iconColor} />
        <Text style={{ flex: 1, fontSize: 13, fontFamily: isCurrent ? fonts.heading.semibold : fonts.body.medium, color: b.textPrimary }}>
          {step.label}
        </Text>
        {isDone ? (
          <Text style={{ fontSize: 11.5, color: b.success, fontFamily: fonts.body.regular }}>Done</Text>
        ) : isCurrent ? (
          <Text style={{ fontSize: 11.5, color: b.accent, fontFamily: fonts.heading.semibold }}>Now</Text>
        ) : isStopped ? (
          <Text style={{ fontSize: 11.5, color: b.danger, fontFamily: fonts.body.regular }}>Stopped</Text>
        ) : (
          <Text style={{ fontSize: 11.5, color: b.textFaint, fontFamily: fonts.body.regular }}>Waiting</Text>
        )}
      </View>

      {/* Checks for the current step */}
      {isCurrent && step.checks.length > 0 ? (
        <View style={{ marginLeft: 26, marginTop: 8, gap: 6 }}>
          {step.checks.map((ch, i) => (
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
                <Text style={{ fontSize: 11.5, color: b.textFaint, fontFamily: fonts.body.regular, marginLeft: 21 }}>{ch.hint}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function CrmTransferDeedScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmTransferDeed">>();
  const { deedId } = params;
  const b = useBrand();

  const q = useQuery<DeedData>({
    queryKey: ["crm-transfer-deed", deedId],
    queryFn: () => crmGet(`/api/crm/transfer-deeds/${deedId}`),
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

  const { deed: d, documents, payment, registry, steps } = q.data;
  const statusColor = STATUS_COLOR[d.Status as string] ?? b.textSecondary;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

      {/* Identity */}
      <Section title="Transfer Deed">
        {d.DeedNo ? <Kv label="Deed no." value={d.DeedNo as string} /> : null}
        <Kv label="Property" value={d.Property as string} />
        <Kv label="Seller" value={(d.SellerName || "—") as string} />
        {d.BuyerName ? <Kv label="Buyer" value={d.BuyerName as string} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
          <Pill label={words(d.StatusLabel as string || d.Status as string)} tone={statusColor} />
        </View>
        {d.LegalExecutiveName ? <Kv label="Legal executive" value={d.LegalExecutiveName as string} /> : null}
        {d.DeedDate ? <Kv label="Signing date" value={fmtDate(d.DeedDate)} /> : null}
        {d.ExecutedAt ? <Kv label="Executed" value={fmtDate(d.ExecutedAt)} /> : null}
        {d.CreatedAt ? <Kv label="Opened" value={fmtDate(d.CreatedAt)} /> : null}
      </Section>

      {/* Stamp duty */}
      {payment ? (
        <Section title="Stamp duty">
          <Kv label="Payable by" value={words(payment.PayableBy as string)} />
          <Kv label="Stamp duty" value={money(payment.StampDuty)} />
          <Kv label="Registration fee" value={money(payment.RegistrationFee)} />
          {payment.PaidRef ? <Kv label="Payment ref." value={payment.PaidRef as string} /> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Payment</Text>
            <Pill label={words(payment.Status as string)} tone={payment.Status === "Confirmed" ? b.success : b.warning} />
          </View>
        </Section>
      ) : null}

      {/* Sub-registrar */}
      {registry ? (
        <Section title="Sub-Registrar">
          <Kv label="Office" value={registry.Office as string} />
          <Kv label="Appointment" value={fmtDate(registry.ScheduledAt)} />
          {registry.RegNo ? <Kv label="Reg. no." value={registry.RegNo as string} /> : null}
        </Section>
      ) : null}

      {/* Steps */}
      <Section title="Progress">
        <View>
          {steps.map((s) => (
            <StepRow key={s.key} step={s} />
          ))}
        </View>
      </Section>

      {/* Documents */}
      {documents.length > 0 ? (
        <Section title="Documents">
          <View style={{ gap: 6 }}>
            {documents.map((doc) => (
              <View key={doc.Id as number} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
                {doc.Status === "Verified" ? (
                  <CheckCircle2 size={14} color={b.success} />
                ) : doc.Status === "Uploaded" ? (
                  <Clock size={14} color={b.warning} />
                ) : (
                  <Circle size={14} color={b.textFaint} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>
                    {doc.Label as string || words(doc.DocumentType as string)}
                  </Text>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>
                    {doc.Party as string}
                  </Text>
                </View>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: doc.Status === "Verified" ? b.success : doc.Status === "Uploaded" ? b.warning : b.textFaint }}>
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
