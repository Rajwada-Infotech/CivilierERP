// Ownership change detail — current owner → new owner, deed reference, approval.
// Endpoint: GET /api/crm/ownership-changes/:id  → flat row (SELECT_CHANGE fields)
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { crmGet, type Row } from "@/api/crmApi";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Kv, Pill, Section, fmtDate, money, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Draft:     "#94a3b8",
  Pending:   "#f59e0b",
  Approved:  "#10b981",
  Rejected:  "#ef4444",
  Cancelled: "#ef4444",
};

export default function CrmOwnershipChangeScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmOwnershipChange">>();
  const { changeId } = params;
  const b = useBrand();

  const q = useQuery<Row>({
    queryKey: ["crm-ownership-change", changeId],
    queryFn: () => crmGet(`/api/crm/ownership-changes/${changeId}`),
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

  const r = q.data;
  const statusColor = STATUS_COLOR[r.Status as string] ?? b.textSecondary;
  const isApproved = r.Status === "Approved";
  const isRejected = r.Status === "Rejected";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

      {/* Identity */}
      <Section title="Ownership Change">
        <Kv label="Change no." value={r.ChangeNo as string} />
        <Kv label="Property" value={[r.Property, r.ProjectName].filter(Boolean).join(" · ")} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
          <Pill label={words(r.Status as string)} tone={statusColor} />
        </View>
        {r.CreatedAt ? <Kv label="Opened" value={fmtDate(r.CreatedAt)} /> : null}
      </Section>

      {/* Owners */}
      <Section title="Owners">
        <View style={{ gap: 10 }}>
          <View>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textFaint, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Current owner
            </Text>
            <Kv label="Name" value={(r.FromName || "—") as string} />
            {r.FromMobile ? <Kv label="Mobile" value={r.FromMobile as string} /> : null}
          </View>
          <View style={{ height: 1, backgroundColor: b.border }} />
          <View>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textFaint, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
              New owner
            </Text>
            <Kv label="Name" value={(r.ToName || "—") as string} />
            {r.ToMobile ? <Kv label="Mobile" value={r.ToMobile as string} /> : null}
            {r.ToPan ? <Kv label="PAN" value={r.ToPan as string} /> : null}
            {r.ToApplicationNo ? <Kv label="Application" value={r.ToApplicationNo as string} /> : null}
            {Number(r.CoOwnerCount) > 0 ? (
              <Kv label="Co-owners" value={`${r.CoOwnerCount}`} />
            ) : null}
          </View>
        </View>
      </Section>

      {/* Sale deed reference */}
      {(r.DeedNo || r.DeedDate || r.RegOffice) ? (
        <Section title="Sale Deed">
          {r.DeedNo ? <Kv label="Reg. no." value={r.DeedNo as string} /> : null}
          {r.DeedDate ? <Kv label="Date" value={fmtDate(r.DeedDate)} /> : null}
          {r.RegOffice ? <Kv label="Sub-Registrar office" value={r.RegOffice as string} /> : null}
          {r.ConsiderationValue ? <Kv label="Sale value" value={money(r.ConsiderationValue)} /> : null}
        </Section>
      ) : null}

      {/* Approval */}
      {(isApproved || isRejected) ? (
        <Section title={isApproved ? "Approved" : "Rejected"}>
          {r.ApprovedByName ? <Kv label="By" value={r.ApprovedByName as string} /> : null}
          {r.ApprovedAt ? <Kv label="On" value={fmtDate(r.ApprovedAt)} /> : null}
          {isRejected && r.RejectionNote ? (
            <View style={{ backgroundColor: b.dangerSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.danger }}>{r.RejectionNote as string}</Text>
            </View>
          ) : null}
        </Section>
      ) : null}

      {/* Notes */}
      {r.Notes ? (
        <Section title="Notes">
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textPrimary }}>{r.Notes as string}</Text>
        </Section>
      ) : null}

    </ScrollView>
  );
}
