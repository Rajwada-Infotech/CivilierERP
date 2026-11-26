// Legal Milestones tracker screen — shows the full legal journey of a booking:
// Agreement → AFS Registration → NOC → Possession & Handover → Sale Deed → Mutation.
// Directly navigates to the specific operational screens for each phase.
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Lock, Scale, ScrollText, ShieldCheck, KeyRound, FileText, UserCog } from "lucide-react-native";
import { crmGet, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, CRM, Kv, Pill, Section, fmtDate, joinDot } from "./ui";

const API = "/api/crm/legal-milestones";

export default function CrmLegalMilestoneScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmLegalMilestone">>();
  const { bookingId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage } = useAuth();

  const q = useQuery<Row>({
    queryKey: ["crm-legal-milestone-booking", bookingId],
    queryFn: () => crmGet(`${API}/booking/${bookingId}`),
  });

  const t = q.data;

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator size="large" color={CRM} />
      </View>
    );
  }

  if (q.isError || !t) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: b.surface }}>
        <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: b.danger, textAlign: "center" }}>
          {q.error instanceof Error ? q.error.message : "Legal journey tracker not found"}
        </Text>
      </View>
    );
  }

  const done = (key: string) => t[`D_${key}`] === 1 || t[key] === 1;
  const locked = (key: string) => t[`L_${key}`] === 1;

  const sections = [
    {
      title: "1. Agreement for Sale (AFS)",
      icon: ScrollText,
      status: t.AgreementStatus || (done("agrExecuted") ? "Executed" : "In Progress"),
      isDone: done("agrExecuted"),
      actionLabel: "Open Agreement",
      go: () => nav.navigate("CrmAgreement", { bookingId, title: t.AgreementNo || t.ApplicantName || "Agreement" }),
      items: [
        { label: "Document Collection", isDone: done("agrPapers") },
        { label: "Internal Approvals", isDone: done("agrSenior") },
        { label: "Customer Approval", isDone: done("agrCustomer") },
        { label: "Signing & Execution", isDone: done("agrExecuted") },
      ],
    },
    {
      title: "2. AFS Registration (Sub-Registrar)",
      icon: Scale,
      status: t.AfsRegStatus || (done("afsReg") ? "Registered" : "Pending"),
      isDone: done("afsReg"),
      actionLabel: "View in Agreement",
      go: () => nav.navigate("CrmAgreement", { bookingId, title: t.AgreementNo || "Agreement" }),
      items: [
        { label: "Query Payment (Stamp Duty & Reg. Fee)", isDone: done("afsQP") || t.AfsQPStatus === "Confirmed" },
        { label: "Sub-Registrar Appointment", isDone: done("afsReg") || t.AfsRegStatus === "Completed" },
      ],
    },
    {
      title: "3. No Objection Certificate (NOC)",
      icon: ShieldCheck,
      status: t.NocStatus || (done("noc") ? "Issued" : "Pending"),
      isDone: done("noc"),
      actionLabel: "Open NOC",
      go: () => nav.navigate("CrmNoc", { bookingId, title: t.NocNo || "NOC" }),
      items: [
        { label: t.NocType ? `${t.NocType} NOC` : "Developer / Bank NOC", isDone: done("noc") },
      ],
    },
    {
      title: "4. Possession & Handover",
      icon: KeyRound,
      status: t.HandoverStatus || (done("handover") ? "Completed" : t.NoticeStatus || "Pending"),
      isDone: done("handover"),
      actionLabel: "Open Possession",
      go: () => nav.navigate("CrmPossession", { bookingId, title: t.BookingNo || "Possession" }),
      items: [
        { label: "Pre-Possession Inspection Checklist", isDone: done("checklist") || t.PrePossessionStatus === "Completed" },
        { label: "Possession Notice Delivered", isDone: done("notice") || t.NoticeStatus === "Acknowledged" },
        { label: "Key Handover & Clearances", isDone: done("handover") || t.HandoverStatus === "Completed" },
      ],
    },
    {
      title: "5. Sale Deed & Final Registration",
      icon: FileText,
      status: t.DeedStatus || (done("saleDeedReg") ? "Registered" : "Pending"),
      isDone: done("saleDeedReg"),
      actionLabel: "Open Sale Deed",
      go: () => nav.navigate("CrmSaleDeed", { bookingId, title: t.DeedNo || "Sale Deed" }),
      items: [
        { label: "Query Payment & Drafting", isDone: done("sdQP") || !!t.DeedNo },
        { label: "Sub-Registrar Registration", isDone: done("saleDeedReg") || t.DeedStatus === "Registered" },
      ],
    },
    {
      title: "6. Property Mutation",
      icon: UserCog,
      status: t.MutationStatus || (done("mutation") ? "Completed" : "Pending"),
      isDone: done("mutation"),
      actionLabel: "Open Mutation",
      go: () => nav.navigate("CrmMutation", { bookingId, title: t.ApplicantName || "Mutation" }),
      items: [
        { label: "Documents Collection & Submission", isDone: done("mutationDocs") || t.MutationStatus === "Applied" || done("mutation") },
        { label: "Government Mutation Record", isDone: done("mutation") || t.MutationStatus === "Completed" },
      ],
    },
  ];

  const totalDone = sections.filter((s) => s.isDone).length;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, backgroundColor: b.surface }}>
      {/* Hero Card */}
      <View style={{ padding: 16, borderRadius: 16, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 }}>
              {`Legal Journey · Booking ${t.BookingNo || ""}`}
            </Text>
            <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: b.textPrimary, marginTop: 2 }}>
              {t.ApplicantName}
            </Text>
            <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 2 }}>
              {[t.ProjectName, t.BlockName, t.UnitNo].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <Pill label={`${totalDone} of ${sections.length} done`} />
        </View>

        {/* Progress Bar */}
        <View style={{ height: 6, borderRadius: 3, backgroundColor: b.border, overflow: "hidden", marginTop: 8 }}>
          <View style={{ width: `${(totalDone / sections.length) * 100}%`, height: "100%", backgroundColor: CRM }} />
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <ActionKey outline label="View Full Booking" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(bookingId), title: t.BookingNo || "Booking" })} />
        </View>
      </View>

      {/* Sections List */}
      <View style={{ gap: 12 }}>
        {sections.map((sec, idx) => {
          const Icon = sec.icon;
          return (
            <View key={sec.title} style={{ padding: 16, borderRadius: 16, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border, gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                  <View style={{
                    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
                    backgroundColor: sec.isDone ? CRM : `${CRM}15`,
                  }}>
                    <Icon size={18} color={sec.isDone ? "#fff" : CRM} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{sec.title}</Text>
                    {sec.status ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sec.status}</Text> : null}
                  </View>
                </View>
                {sec.isDone ? (
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: CRM, alignItems: "center", justifyContent: "center" }}>
                    <Check size={13} color="#fff" />
                  </View>
                ) : null}
              </View>

              {/* Sub-steps checklist */}
              <View style={{ gap: 6, paddingLeft: 44 }}>
                {sec.items.map((it) => (
                  <View key={it.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{
                      width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center",
                      backgroundColor: it.isDone ? CRM : b.border,
                    }}>
                      {it.isDone ? <Check size={9} color="#fff" /> : null}
                    </View>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: it.isDone ? b.textPrimary : b.textSecondary }}>
                      {it.label}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Navigation Button */}
              <View style={{ marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: b.border, flexDirection: "row", justifyContent: "flex-end" }}>
                <ActionKey outline label={sec.actionLabel} onPress={sec.go} />
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
